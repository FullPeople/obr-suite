// Standalone HP / Temp / AC bar — popover script.
//
// URL params:
//   itemId — required, the token whose bubbles metadata we read & write.
//
// Reads & writes the same `com.owlbear-rodeo-bubbles-extension/metadata`
// key that bestiary-info / cc-info already use — so any change here
// updates the on-token HP bar / heater shield instantly via the
// existing bubbles plugin.

import OBR from "@owlbear-rodeo/sdk";
import { bindPanelDrag } from "./utils/panelDrag";
import { PANEL_IDS } from "./utils/panelLayout";
import {
  parseStatInput,
  readBubbles,
  patchBubbles,
  clampStat,
  type BubblesData,
} from "./utils/statEdit";

const params = new URLSearchParams(location.search);
const itemId = params.get("itemId") ?? "";

const dragHandle = document.getElementById("dragHandle") as HTMLDivElement;
const hpPillEl = document.getElementById("hpPill") as HTMLDivElement;
const lockBtn = document.getElementById("lockBtn") as HTMLButtonElement | null;
const inputs = Array.from(
  document.querySelectorAll<HTMLInputElement>(".stat-input"),
);

let live: BubblesData = {};
let isGM = false;

function fmt(v: number | undefined, fallback = 0): string {
  return String(typeof v === "number" ? v : fallback);
}

function paint(): void {
  // Set each stat input's display value from `live`. We do this when
  // not focused so the user's in-progress edit (e.g. typing "+5")
  // doesn't get overwritten mid-keystroke.
  for (const inp of inputs) {
    if (document.activeElement === inp) continue;
    const field = inp.dataset.field as keyof BubblesData;
    inp.value = fmt(live[field] as number | undefined);
  }
  // Update the HP fill ratio.
  const hp = typeof live.health === "number" ? live.health : 0;
  const max = typeof live["max health"] === "number" ? live["max health"] : 0;
  const ratio = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 1;
  hpPillEl.style.setProperty("--hp-ratio", String(ratio));
  // Lock button reflects current `locked` state. Default true (the
  // bubbles module treats absent `locked` as locked = combat-gated
  // visibility for players).
  if (lockBtn) {
    const locked = live.locked === undefined ? true : !!live.locked;
    lockBtn.dataset.locked = locked ? "true" : "false";
    lockBtn.title = locked
      ? "已锁定：战斗外玩家看不到血条详情。点击解锁让所有人可见。"
      : "已解锁：所有人可见血条与 AC。点击锁定恢复战斗外隐藏。";
  }
}

async function refresh(): Promise<void> {
  if (!itemId) return;
  try {
    live = await readBubbles(itemId);
  } catch {
    live = {};
  }
  paint();
}

// Commit the user's edit on blur or Enter. Parses the input via
// parseStatInput (supports "20", "+5", "-3", "15+5") and writes via
// patchBubbles which clamps + merges.
async function commit(inp: HTMLInputElement): Promise<void> {
  if (!itemId) return;
  const field = inp.dataset.field as keyof BubblesData;
  const cur = (live[field] as number | undefined) ?? 0;
  const parsed = parseStatInput(inp.value, cur);
  if (parsed === null) {
    // Bad input — revert to live value.
    inp.value = fmt(cur);
    return;
  }
  const v = clampStat(field, parsed);
  const updated = await patchBubbles(itemId, { [field]: v } as Partial<BubblesData>);
  live = updated;
  paint();
}

for (const inp of inputs) {
  inp.addEventListener("focus", () => { inp.select(); });
  inp.addEventListener("blur", () => { void commit(inp); });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      inp.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      const field = inp.dataset.field as keyof BubblesData;
      inp.value = fmt(live[field] as number | undefined);
      inp.blur();
    }
  });
}

bindPanelDrag(dragHandle, PANEL_IDS.hpBar);

window.addEventListener("contextmenu", (e) => e.preventDefault());

// Lock button — DM-only via body class. Toggles the `locked` field
// on the bubbles metadata. The bubbles module treats locked = true
// as "hide HP / AC details from players outside combat". Players
// don't get a button (CSS hides it via `body.is-player`).
lockBtn?.addEventListener("click", async () => {
  if (!itemId || !isGM) return;
  const next = !(live.locked === undefined ? true : !!live.locked);
  const updated = await patchBubbles(itemId, { locked: next });
  live = updated;
  paint();
});

OBR.onReady(async () => {
  try {
    isGM = (await OBR.player.getRole()) === "GM";
  } catch {}
  if (!isGM) document.body.classList.add("is-player");
  await refresh();
  // Live sync — when ANY scene item changes, refresh our snapshot
  // so external HP / AC edits (e.g. via the bestiary popover, or a
  // direct metadata edit) keep this bar accurate.
  OBR.scene.items.onChange(() => { void refresh(); });
  OBR.player.onChange((p) => {
    const nextGM = p.role === "GM";
    if (nextGM !== isGM) {
      isGM = nextGM;
      document.body.classList.toggle("is-player", !isGM);
    }
  });
});
