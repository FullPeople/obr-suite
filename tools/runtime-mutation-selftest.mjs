#!/usr/bin/env node
// Prove the race/failure regressions reject broken implementations, without
// changing the working source files. Each mutation exists only in its bundle.
import { build } from "rolldown";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const lifecycleEntry = "tools/module-lifecycle-selftest.entry.ts";
const stateEntry = "tools/state-freshness-selftest.entry.ts";
const sceneEntry = "tools/scene-lifecycle-selftest.entry.ts";
const mutations = [
  { name: "drop clicks during setup", entry: lifecycleEntry, file: "moduleLifecycle.ts",
    from: "if (entry.desired === desired) continue;",
    to: 'if (entry.status === "starting" || entry.status === "stopping" || entry.desired === desired) continue;' },
  { name: "report failed setup as running", entry: lifecycleEntry, file: "moduleLifecycle.ts",
    from: 'entry.status = "error";', to: 'entry.status = "on";' },
  { name: "omit partial-setup cleanup", entry: lifecycleEntry, file: "moduleLifecycle.ts",
    from: "await entry.hooks.teardown();", to: "await Promise.resolve();" },
  { name: "forget failures after cleanup", entry: lifecycleEntry, file: "moduleLifecycle.ts",
    from: "if (!entry.desired) entry.attempts = 0;", to: "entry.attempts = 0;" },
  { name: "accept an older settings read", entry: stateEntry, file: "state.ts",
    from: "revision !== refreshRevision", to: "false" },
  { name: "accept an old-scene write acknowledgement", entry: stateEntry, file: "state.ts",
    from: "if (writeScene !== sceneGeneration) return;", to: "if (false) return;" },
  { name: "resume modules before cluster opening", entry: sceneEntry, file: "moduleLifecycle.ts",
    from: " || this.clusterRevision !== revision", to: "" },
  { name: "treat superseded refresh completion as authoritative", entry: sceneEntry, file: "moduleLifecycle.ts",
    from: "this.options.refreshSettings().catch", to: "this.options.refreshSettings().then(() => this.settingsRefreshed()).catch" },
  { name: "report completion before pending immediate lifecycle work", entry: lifecycleEntry, file: "moduleLifecycle.ts",
    from: "if (!this.paused && this.entries.some(entry => this.eligible(entry))) return this.kick();", to: "" },
  { name: "run obsolete queued scene transitions", entry: sceneEntry, file: "moduleLifecycle.ts",
    from: "if (revision !== this.revision) return;", to: "" },
  { name: "turn failed reads into default settings", entry: stateEntry, file: "state.ts",
    from: "return failedRefresh(revision, error);", to: "next = DEFAULT_STATE;" },
  { name: "retry failed settings reads forever", entry: sceneEntry, file: "moduleLifecycle.ts",
    from: "[this.settingsFailures++]", to: "[0]" },
];
const out = mkdtempSync(join(tmpdir(), "suite-runtime-mutations-"));
try {
  for (const [index, mutation] of mutations.entries()) {
    let changed = false;
    const bundle = join(out, `${index}.mjs`);
    await build({ input: resolve(mutation.entry), platform: "node", plugins: [{
      name: "regression-mutation",
      resolveId(id) {
        if (mutation.entry === stateEntry && id === "@owlbear-rodeo/sdk") return resolve("tools/fixtures/state-sdk.ts");
      },
      transform(code, id) {
        if (!id.replaceAll("\\", "/").endsWith(`/src/${mutation.file === "state.ts" ? "" : "utils/"}${mutation.file}`)) return;
        if (!code.includes(mutation.from)) throw Error(`Mutation no longer matches: ${mutation.name}`);
        changed = true;
        return code.replaceAll(mutation.from, mutation.to);
      },
    }], output: { file: bundle, format: "esm" } });
    if (!changed) throw Error(`No source mutated: ${mutation.name}`);
    try {
      // A mutation that creates endless retries is rejected by the deadline.
      execFileSync(process.execPath, [bundle], { stdio: "pipe", timeout: 5000 });
      throw Error(`SURVIVED: ${mutation.name}`);
    } catch (error) {
      if (error.message?.startsWith("SURVIVED:")) throw error;
      const output = String(error.stderr ?? "");
      if (error.code !== "ETIMEDOUT" && !output.includes("ERR_ASSERTION")) throw error;
      console.log(`REJECTED: ${mutation.name}${error.code === "ETIMEDOUT" ? " (retry loop)" : ""}`);
    }
  }
  console.log(`${mutations.length} lifecycle/state mutations rejected`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
