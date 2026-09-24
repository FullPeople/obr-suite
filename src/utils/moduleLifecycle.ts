export type ModuleHooks = { setup: () => Promise<void>; teardown: () => Promise<void> };
export type ModuleStatus = "off" | "starting" | "on" | "stopping" | "error";
export interface ModuleLifecycleSnapshot {
  id: string;
  status: ModuleStatus;
  desired: boolean;
  attempts: number;
  elapsedMs: number;
  slow: boolean;
  error?: string;
  retryAt?: number;
}

interface Entry extends ModuleLifecycleSnapshot {
  hooks: ModuleHooks;
  dirty: boolean;
  revision: number;
}

interface LifecycleOptions {
  onChange?: (modules: ModuleLifecycleSnapshot[]) => void;
  onError?: (id: string, operation: "setup" | "teardown", error: unknown) => void;
  retryDelays?: readonly number[];
  slowAfterMs?: number;
  now?: () => number;
}

/** One ordered worker owns all hooks. Desired state may change while a hook
 * awaits; completion always rechecks it. A failed setup is cleaned before any
 * retry so partially registered listeners are never duplicated intentionally.
 * Hooks must settle: timing out a non-cancellable setup would leave it free to
 * register late listeners behind a later teardown. Slow hooks are reported,
 * never treated as cancelled or successfully running. */
export class ModuleLifecycle {
  private entries: Entry[];
  private worker: Promise<void> | undefined;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  private paused = false;
  private readonly now: () => number;
  private readonly retryDelays: readonly number[];

  constructor(modules: Record<string, ModuleHooks | undefined>, private options: LifecycleOptions = {}) {
    this.now = options.now ?? Date.now;
    this.retryDelays = options.retryDelays ?? [1000, 4000];
    this.entries = Object.entries(modules).flatMap(([id, hooks]) => hooks ? [{
      id, hooks, status: "off" as const, desired: false, dirty: false,
      attempts: 0, elapsedMs: 0, slow: false, revision: 0,
    }] : []);
  }

  snapshot(): ModuleLifecycleSnapshot[] {
    return this.entries.map(({ hooks: _hooks, dirty: _dirty, revision: _revision, ...snapshot }) => ({
      ...snapshot, retryAt: Number.isFinite(snapshot.retryAt) ? snapshot.retryAt : undefined,
    }));
  }

  setDesired(enabled: Record<string, boolean | undefined>): Promise<void> {
    let changed = false;
    for (const entry of this.entries) {
      const desired = !!enabled[entry.id];
      if (entry.desired === desired) continue;
      changed = true;
      entry.desired = desired;
      entry.revision++;
      entry.attempts = 0;
      entry.retryAt = undefined;
    }
    if (changed) this.emit();
    return this.kick();
  }

  /** Keep established module listeners across scenes; pause new operations
   * until the new scene's settings have arrived. Modules own scene cleanup. */
  setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    return this.kick();
  }

  retry(id: string): Promise<void> {
    const entry = this.entries.find(entry => entry.id === id);
    if (entry?.status === "error") {
      entry.revision++;
      entry.attempts = 0;
      entry.retryAt = undefined;
      this.emit();
    }
    return this.kick();
  }

  private emit(): void {
    // Diagnostics must not break lifecycle ownership.
    try { this.options.onChange?.(this.snapshot()); } catch {}
  }

  private needsWork(entry: Entry): boolean {
    if (!entry.desired && !entry.dirty) return entry.status !== "off";
    return !entry.desired || entry.status !== "on";
  }

  private eligible(entry: Entry): boolean {
    if (!this.needsWork(entry)) return false;
    // An already-clean failed setup can always be switched off.
    if (!entry.desired && !entry.dirty) return true;
    return entry.retryAt === undefined || entry.retryAt <= this.now();
  }

  private kick(): Promise<void> {
    if (this.wakeTimer !== undefined) clearTimeout(this.wakeTimer);
    this.wakeTimer = undefined;
    if (!this.worker) {
      // Defer execution until worker owns the promise, including hooks that
      // synchronously trigger another desired-state notification.
      this.worker = Promise.resolve().then(() => this.drain()).finally(() => {
        this.worker = undefined;
        // A desired change can arrive after drain returned but before this
        // finalizer runs. Chain immediately eligible work into the promise
        // callers await; a zero-delay timer would report completion too soon.
        if (!this.paused && this.entries.some(entry => this.eligible(entry))) return this.kick();
        this.scheduleWake();
      });
    }
    return this.worker;
  }

  private scheduleWake(): void {
    if (this.paused) return;
    const waiting = this.entries.filter(entry => this.needsWork(entry));
    const next = Math.min(...waiting.map(entry => entry.retryAt ?? this.now()));
    if (!Number.isFinite(next)) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = undefined;
      void this.kick();
    }, Math.max(0, next - this.now()));
  }

  private async drain(): Promise<void> {
    while (!this.paused) {
      // Reconsider from the original registration order after every await.
      const entry = this.entries.find(entry => this.eligible(entry));
      if (!entry) return;
      if (!entry.desired && !entry.dirty) {
        this.markOff(entry);
        continue;
      }
      const operation = entry.dirty ? "teardown" : "setup";
      const revision = entry.revision;
      const started = this.now();
      entry.status = operation === "setup" ? "starting" : "stopping";
      entry.slow = false;
      entry.elapsedMs = 0;
      entry.error = undefined;
      if (operation === "setup") entry.dirty = true;
      this.emit();
      const slowTimer = setTimeout(() => {
        entry.slow = true;
        entry.elapsedMs = this.now() - started;
        this.emit();
      }, this.options.slowAfterMs ?? 5000);
      try {
        await entry.hooks[operation]();
        entry.elapsedMs = this.now() - started;
        entry.slow = false;
        entry.retryAt = undefined;
        if (operation === "setup") {
          entry.attempts = 0;
          entry.status = "on";
          this.emit();
        } else {
          this.markOff(entry);
        }
      } catch (error) {
        entry.elapsedMs = this.now() - started;
        entry.slow = false;
        // Partial setup needs cleanup immediately, before the retry delay.
        // A teardown failure leaves dirty=true and must be retried first.
        if (operation === "setup") {
          entry.status = "stopping";
          this.emit();
          try {
            await entry.hooks.teardown();
            entry.dirty = false;
          } catch (cleanupError) {
            try { this.options.onError?.(entry.id, "teardown", cleanupError); } catch {}
          }
        }
        entry.slow = false;
        entry.status = "error";
        entry.error = error instanceof Error ? error.message : String(error);
        // A new click while the old operation failed owns a fresh attempt.
        if (entry.revision === revision) {
          entry.attempts++;
          const delay = this.retryDelays[entry.attempts - 1];
          entry.retryAt = delay === undefined ? Infinity : this.now() + delay;
        } else {
          entry.retryAt = undefined;
        }
        try { this.options.onError?.(entry.id, operation, error); } catch {}
        this.emit();
      } finally {
        clearTimeout(slowTimer);
        entry.slow = false;
      }
    }
  }

  private markOff(entry: Entry): void {
    entry.status = "off";
    entry.dirty = false;
    entry.error = undefined;
    entry.retryAt = undefined;
    if (!entry.desired) entry.attempts = 0;
    entry.slow = false;
    this.emit();
  }
}

interface SceneCoordinatorOptions {
  lifecycle: Pick<ModuleLifecycle, "setPaused">;
  syncModules: () => Promise<void>;
  refreshSettings: () => Promise<unknown>;
  openCluster: () => Promise<void>;
  closeCluster: () => Promise<void>;
  onReady?: () => Promise<void>;
  onError?: (operation: "cluster" | "settings" | "modules", error: unknown) => void;
  settingsRetryDelays?: readonly number[];
  onSettingsUnavailable?: () => void;
}

/** Scene entry has two independent prerequisites: an authoritative settings
 * result and the ordered cluster transition. Superseded settings reads never
 * mark readiness. Notification-based convergence avoids chasing a succession
 * of obsolete read promises or waiting across scene generations. */
export class SceneModuleCoordinator {
  revision = 0;
  private ready = false;
  private settingsRevision = -1;
  private clusterRevision = -1;
  private resumedRevision = -1;
  private clusterQueue = Promise.resolve();
  private settingsFailures = 0;
  private settingsFailureNotified = false;
  private settingsRetryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private options: SceneCoordinatorOptions) {}

  handleReady(ready: boolean): void {
    const revision = ++this.revision;
    this.ready = ready;
    this.clearSettingsRetry();
    this.settingsFailures = 0;
    this.settingsFailureNotified = false;
    this.settingsRevision = -1;
    this.clusterRevision = -1;
    void this.options.lifecycle.setPaused(true);
    // Finish an in-flight open before close/new open. Queued obsolete jobs
    // are skipped; a failed open is reported but does not block all modules.
    this.clusterQueue = this.clusterQueue.then(async () => {
      if (revision !== this.revision) return;
      try {
        if (ready) await this.options.openCluster();
        else await this.options.closeCluster();
      } catch (error) {
        this.report("cluster", error);
      }
      if (revision !== this.revision) return;
      this.clusterRevision = revision;
      this.resumeIfReady();
    });
    if (ready) {
      // Completion alone is insufficient: refreshFromScene may return the
      // cache when a newer read supersedes it. Only settingsRefreshed resumes.
      this.requestSettings(revision);
    }
  }

  settingsRefreshed(): void {
    if (!this.ready) return;
    this.clearSettingsRetry();
    this.settingsFailures = 0;
    this.settingsFailureNotified = false;
    this.settingsRevision = this.revision;
    this.resumeIfReady();
  }

  settingsFailed(error: unknown): void {
    if (!this.ready || this.resumedRevision === this.revision) return;
    this.settingsRevision = -1;
    this.report("settings", error);
    if (this.settingsRetryTimer !== undefined || this.settingsFailureNotified) return;
    const delay = (this.options.settingsRetryDelays ?? [1000, 4000])[this.settingsFailures++];
    if (delay === undefined) {
      this.settingsFailureNotified = true;
      try { this.options.onSettingsUnavailable?.(); } catch {}
      return;
    }
    const revision = this.revision;
    this.settingsRetryTimer = setTimeout(() => {
      this.settingsRetryTimer = undefined;
      if (revision === this.revision && this.ready) this.requestSettings(revision);
    }, delay);
  }

  private requestSettings(revision: number): void {
    void this.options.refreshSettings().catch(error => {
      if (revision === this.revision) this.settingsFailed(error);
    });
  }

  private clearSettingsRetry(): void {
    if (this.settingsRetryTimer !== undefined) clearTimeout(this.settingsRetryTimer);
    this.settingsRetryTimer = undefined;
  }

  private resumeIfReady(): void {
    const revision = this.revision;
    if (!this.ready || this.settingsRevision !== revision || this.clusterRevision !== revision || this.resumedRevision === revision) return;
    this.resumedRevision = revision;
    void this.options.syncModules().catch(error => this.report("modules", error));
    void this.options.lifecycle.setPaused(false).then(async () => {
      if (revision === this.revision) await this.options.onReady?.();
    }).catch(error => this.report("modules", error));
  }

  private report(operation: "cluster" | "settings" | "modules", error: unknown): void {
    try { this.options.onError?.(operation, error); } catch {}
  }
}
