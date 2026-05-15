// Shared editable stat banner — HP / max HP / temp HP / AC inputs +
// a DM-only lock button.
//
// Built to be the single source of truth for the stat row that the
// character-card info popover (cc-info) and the standalone DM resource
// tracker both show, so the two render, edit, and sync stats
// identically: same per-token bubbles metadata, same parse/clamp
// logic (statEdit.ts), same markup, same CSS.
//
// Mount once into a container; the component renders the banner from
// `initialLive` (flicker-free when the caller already has the data),
// binds the inputs + lock, and self-syncs on scene.items.onChange.
// Call refresh() to force a re-read. unmount() drops the subscription
// and clears the container.
//
// The `.stat-banner` rule injected here is context-neutral (no
// position:sticky / no host background) — a host that needs the
// banner to stick (cc-info's scrolling card) styles its OWN mount
// element; the resource tracker just drops it into a card.

import OBR from "@owlbear-rodeo/sdk";
import {
  type BubblesData,
  readBubbles,
  patchBubbles,
  parseStatInput,
  clampStat,
} from "./statEdit";

export interface StatBannerOptions {
  container: HTMLElement;
  /** Bound token id, or null when nothing is bound. */
  getItemId: () => string | null;
  /** GM clients get the lock button; players don't. */
  isGM: boolean;
  /** Fallback values (e.g. cc-info's card-data HP/AC) shown when the
   *  token has no bubbles metadata for a field yet. */
  fallback?: Partial<Record<keyof BubblesData, number>>;
  /** Already-fetched bubbles data, for a flicker-free initial paint. */
  initialLive?: BubblesData;
}

const LOCK_TITLE_LOCKED =
  "已上锁：玩家在战斗准备 / 战斗中只看到血条比例（无数值 / AC）";
const LOCK_TITLE_UNLOCKED = "已解锁：所有玩家可见完整 HP / AC 数值";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function lockButtonHtml(locked: boolean): string {
  const title = locked ? LOCK_TITLE_LOCKED : LOCK_TITLE_UNLOCKED;
  return `
    <button class="stat-lock" data-locked="${locked ? "true" : "false"}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" type="button">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" stroke="none"/>
        <path class="lock-shackle" d="M5 7 V5 a3 3 0 0 1 6 0 V7"/>
      </svg>
    </button>
  `;
}

function statBannerHtml(
  live: BubblesData,
  isGM: boolean,
  fb: Partial<Record<keyof BubblesData, number>>,
): string {
  const liveHp = typeof live.health === "number" ? live.health : (fb.health ?? 0);
  const liveMaxHp = typeof live["max health"] === "number" ? live["max health"] : (fb["max health"] ?? 0);
  const liveTempHp = typeof live["temporary health"] === "number" ? live["temporary health"] : (fb["temporary health"] ?? 0);
  const liveAc = typeof live["armor class"] === "number" ? live["armor class"] : (fb["armor class"] ?? 10);
  // HP fill ratio for the pill mask. Defaults to 1 when maxHp is 0 so
  // the pill reads as solid red instead of an empty dark slot.
  const hpRatio = liveMaxHp > 0 ? Math.max(0, Math.min(1, liveHp / liveMaxHp)) : 1;
  return `
    <div class="stat-banner">
      <div class="hp-pill" style="--hp-ratio: ${hpRatio.toFixed(3)}">
        <span class="stat-cell">
          <span class="prev-hint" data-prev></span>
          <input class="stat-input" type="text" inputmode="numeric"
                 data-field="health" value="${escapeHtml(String(liveHp))}"
                 title="支持 20 / +5 / -3 / 15+5">
        </span>
        <span class="slash">/</span>
        <span class="stat-cell">
          <span class="prev-hint" data-prev></span>
          <input class="stat-input" type="text" inputmode="numeric"
                 data-field="max health" value="${escapeHtml(String(liveMaxHp))}"
                 title="支持 20 / +5 / -3 / 15+5">
        </span>
      </div>
      <div class="temp-pill stat-cell">
        <span class="prev-hint" data-prev></span>
        <input class="stat-input" type="text" inputmode="numeric"
               data-field="temporary health" value="${escapeHtml(String(liveTempHp))}"
               title="支持 20 / +5 / -3 / 15+5">
      </div>
      <div class="ac-pill stat-cell">
        <span class="prev-hint" data-prev></span>
        <input class="stat-input" type="text" inputmode="numeric"
               data-field="armor class" value="${escapeHtml(String(liveAc))}"
               title="支持 20 / +5 / -3 / 15+5">
      </div>
      ${isGM ? lockButtonHtml(live.locked !== false) : ""}
    </div>
  `;
}

// Mirrors cc-info.html's stat-banner CSS, minus the cc-info-specific
// position:sticky / host-background (see file header).
const STAT_BANNER_CSS = `
.stat-banner{
  display:flex;align-items:center;gap:8px;
  padding:4px 2px;
}
.stat-banner .hp-pill{
  flex:1;
  position:relative;isolation:isolate;overflow:hidden;
  display:flex;align-items:center;justify-content:center;gap:2px;
  min-height:34px;padding:0 12px;
  background:linear-gradient(135deg,#3a1a18,#4a221d);
  border:1px solid rgba(231,76,60,0.7);
  border-radius:18px;
  color:#fff;font-weight:800;font-size:17px;letter-spacing:0.3px;
  box-shadow:0 2px 6px rgba(231,76,60,0.32),0 0 0 1px rgba(0,0,0,0.18) inset;
}
.stat-banner .hp-pill::before{
  content:"";position:absolute;inset:0;z-index:0;pointer-events:none;
  background:linear-gradient(135deg,#c0392b,#e94560);
  width:calc(var(--hp-ratio, 1) * 100%);
  transition:width 0.18s ease-out;
}
.stat-banner .hp-pill > *{position:relative;z-index:1}
.stat-banner .hp-pill .slash{
  font-size:14px;font-weight:400;opacity:0.55;margin:0 1px;
  pointer-events:none;
}
.stat-banner .temp-pill{
  flex-shrink:0;width:36px;height:36px;border-radius:50%;
  background:linear-gradient(135deg,#f5a3c7,#ee7eaa);
  border:1px solid rgba(232,138,174,0.75);
  display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:800;font-size:13px;
  box-shadow:0 2px 6px rgba(232,138,174,0.30),0 0 0 1px rgba(0,0,0,0.18) inset;
}
.stat-banner .ac-pill{
  flex-shrink:0;width:38px;height:42px;
  background:linear-gradient(135deg,#7ec8f0,#3498db);
  border:1px solid rgba(52,152,219,0.7);
  clip-path:polygon(0% 8%,100% 8%,100% 60%,50% 100%,0% 60%);
  display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:800;font-size:14px;padding-bottom:8px;
  filter:drop-shadow(0 2px 4px rgba(52,152,219,0.40));
}
.stat-banner .stat-cell{
  position:relative;
  display:flex;align-items:center;justify-content:center;
  cursor:text;
}
.stat-banner .hp-pill .stat-cell{flex:1;align-self:stretch}
.stat-banner .temp-pill,.stat-banner .ac-pill{cursor:text}
.stat-banner .stat-cell .prev-hint{
  position:absolute;left:50%;bottom:calc(100% + 3px);
  transform:translateX(-50%);
  font-size:9.5px;font-weight:700;letter-spacing:0.3px;
  color:rgba(255,255,255,0.92);
  background:rgba(7,19,32,0.78);
  padding:1px 6px;border-radius:8px;
  pointer-events:none;white-space:nowrap;
  opacity:0;transition:opacity .12s, transform .12s;z-index:20;
}
.stat-banner .stat-cell.editing .prev-hint{
  opacity:1;transform:translateX(-50%) translateY(-2px);
}
.stat-banner .stat-input{
  background:transparent;border:none;color:inherit;
  font-family:inherit;font-weight:inherit;font-size:inherit;
  text-align:center;outline:none;padding:0;
  font-variant-numeric:tabular-nums;
  width:100%;height:100%;cursor:text;
  caret-color:rgba(255,255,255,0.9);
}
.stat-banner .stat-input:focus{
  text-decoration:underline;
  text-decoration-color:rgba(255,255,255,0.65);
  text-decoration-thickness:1px;text-underline-offset:2px;
}
.stat-banner .stat-lock{
  flex-shrink:0;width:28px;height:28px;
  display:flex;align-items:center;justify-content:center;
  background:rgba(190,24,24,0.38);
  border:1px solid rgba(248,113,113,0.95);
  border-radius:7px;cursor:pointer;color:#fecaca;
  box-shadow:0 0 0 2px rgba(127,29,29,0.28),0 0 12px rgba(248,113,113,0.35);
  margin-left:auto;padding:0;
  transition:filter .12s, background .12s, border-color .12s, color .12s;
}
.stat-banner .stat-lock:hover{filter:brightness(1.18)}
.stat-banner .stat-lock[data-locked="false"]{
  background:transparent;border-color:transparent;
  color:rgba(255,255,255,0.48);box-shadow:none;
}
.stat-banner .stat-lock[data-locked="false"] .lock-shackle{
  d:path("M5 7 V5 a3 3 0 0 1 6 0");
}
`;

let stylesInjected = false;
function ensureStatBannerStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = STAT_BANNER_CSS;
  document.head.appendChild(style);
}

export function mountStatBanner(opts: StatBannerOptions): {
  refresh: () => Promise<void>;
  unmount: () => void;
} {
  const { container, getItemId, isGM, fallback = {}, initialLive } = opts;
  ensureStatBannerStyles();

  // Update the four inputs + HP fill + lock state from live data
  // WITHOUT a full re-render (preserves focus, no layout jump). Used
  // by both a local commit and the external-sync path.
  function refreshInputs(live: BubblesData, skipFocused = true): void {
    const fields: Array<keyof BubblesData> = [
      "health", "max health", "temporary health", "armor class",
    ];
    for (const f of fields) {
      const v = live[f];
      if (v == null) continue;
      const el = container.querySelector<HTMLInputElement>(`.stat-input[data-field="${f}"]`);
      if (!el) continue;
      if (skipFocused && document.activeElement === el) continue;
      el.value = String(v);
    }
    const hp = typeof live.health === "number" ? live.health : null;
    const maxHp = typeof live["max health"] === "number" ? live["max health"] : null;
    const ratio = (hp != null && maxHp != null && maxHp > 0)
      ? Math.max(0, Math.min(1, hp / maxHp)) : 1;
    const pill = container.querySelector<HTMLElement>(".hp-pill");
    if (pill) pill.style.setProperty("--hp-ratio", ratio.toFixed(3));
    const lockBtn = container.querySelector<HTMLButtonElement>(".stat-lock");
    if (lockBtn) {
      const locked = live.locked === undefined ? true : !!live.locked;
      lockBtn.dataset.locked = locked ? "true" : "false";
      lockBtn.title = locked ? LOCK_TITLE_LOCKED : LOCK_TITLE_UNLOCKED;
    }
  }

  function bind(): void {
    // Lock button (GM only — render() skips it for players). Toggles
    // BUBBLES_META.locked on the bound token.
    const lockBtn = container.querySelector<HTMLButtonElement>(".stat-lock");
    if (lockBtn) {
      lockBtn.addEventListener("click", async () => {
        const id = getItemId();
        if (!id) return;
        const wasLocked = lockBtn.dataset.locked !== "false";
        const next = !wasLocked;
        lockBtn.dataset.locked = next ? "true" : "false";
        lockBtn.title = next ? LOCK_TITLE_LOCKED : LOCK_TITLE_UNLOCKED;
        try {
          await patchBubbles(id, { locked: next } as Partial<BubblesData>);
        } catch (e) {
          console.warn("[statBanner] toggle lock failed", e);
          lockBtn.dataset.locked = wasLocked ? "true" : "false";
        }
      });
    }

    const inputs = container.querySelectorAll<HTMLInputElement>(".stat-input[data-field]");
    inputs.forEach((input) => {
      const field = input.dataset.field as keyof BubblesData | undefined;
      if (!field) return;
      // "Current value at edit start" — the +/- relative parser does
      // its math against the displayed value, not the half-typed one.
      let editStart = input.value;
      const cell = input.closest<HTMLElement>(".stat-cell");
      const prevHint = cell?.querySelector<HTMLElement>(".prev-hint");

      const commit = async () => {
        const id = getItemId();
        if (!id) { input.value = editStart; return; }
        const text = input.value;
        const cur = parseFloat(editStart);
        const parsed = parseStatInput(text, Number.isFinite(cur) ? cur : 0);
        if (parsed == null) { input.value = editStart; return; }
        const next = clampStat(field, parsed);
        try {
          // patchBubbles returns the cross-field-clamped final state
          // (HP > maxHP clamps down; lowering maxHP drags HP with it).
          // Refresh all four inputs so the user sees what committed.
          const final = await patchBubbles(id, { [field]: next } as Partial<BubblesData>);
          refreshInputs(final);
          editStart = input.value;
        } catch (e) {
          console.warn("[statBanner] patch bubbles failed", e);
          input.value = editStart;
        }
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        else if (e.key === "Escape") { e.preventDefault(); input.value = editStart; input.blur(); }
      });
      input.addEventListener("focus", () => {
        editStart = input.value;
        if (prevHint) prevHint.textContent = editStart;
        cell?.classList.add("editing");
        // Clear (not select) on focus — no blue selection rectangle;
        // an empty commit on blur just reverts to editStart.
        requestAnimationFrame(() => { input.value = ""; });
      });
      input.addEventListener("blur", () => {
        cell?.classList.remove("editing");
        const text = input.value.trim();
        if (text === "") { input.value = editStart; return; }
        if (text !== editStart) void commit();
      });
    });
  }

  function renderWith(live: BubblesData): void {
    container.innerHTML = statBannerHtml(live, isGM, fallback);
    bind();
  }

  // Initial paint — synchronous (flicker-free) when the caller passed
  // initialLive; otherwise an empty banner that refresh() fills in.
  renderWith(initialLive ?? {});

  async function refresh(): Promise<void> {
    const id = getItemId();
    let live: BubblesData = {};
    if (id) { try { live = await readBubbles(id); } catch {} }
    renderWith(live);
  }

  // External sync — any other writer of this token's bubbles metadata
  // (the HP bar component, fullscreen card edits, dice damage, the
  // OTHER stat banner) re-flows here. Updates inputs in place so the
  // field the user is mid-edit on isn't clobbered.
  const itemsUnsub = OBR.scene.items.onChange(() => {
    void (async () => {
      const id = getItemId();
      if (!id) return;
      let live: BubblesData = {};
      try { live = await readBubbles(id); } catch {}
      refreshInputs(live, true);
    })();
  });

  return {
    refresh,
    unmount: () => {
      try { itemsUnsub(); } catch {}
      container.innerHTML = "";
    },
  };
}
