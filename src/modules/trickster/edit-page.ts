// Trickster edit popover page.
//
// Loads the trickster Item by id (from URL ?id=...), pre-fills the
// inputs with its current metadata, and broadcasts edit-save / -delete
// / -reset / -close back to the background module which owns the
// scene-write side. We only mutate the form's local state here; the
// commit happens in modules/trickster/index.ts.

import OBR from "@owlbear-rodeo/sdk";
import {
  PLUGIN_ID,
  TRICKSTER_KEY,
  CREATE_PREFS_KEY,
  CreatePrefs,
  TricksterMeta,
  TricksterTargetMode,
} from "./types";

const params = new URLSearchParams(location.search);
const tricksterId = params.get("id") ?? "";
const isNew = params.get("isNew") === "1";

const BC_SAVE = `${PLUGIN_ID}/edit-save`;
const BC_DELETE = `${PLUGIN_ID}/edit-delete`;
const BC_CLOSE = `${PLUGIN_ID}/edit-close`;
const BC_RESET = `${PLUGIN_ID}/edit-reset`;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $i = (id: string) => document.getElementById(id) as HTMLInputElement;
const $s = (id: string) => document.getElementById(id) as HTMLSelectElement;

const inpName = $i("name");
const selTargetMode = $s("targetMode");
const swOneShot = $("swOneShot");
const swVisible = $("swVisible");
const swLocked = $("swLocked");
const firedBadge = $("firedBadge");
const btnReset = $("btnReset");
const btnClose = $("btnClose");
const btnCancel = $("btnCancel");
const btnDelete = $("btnDelete");
const btnSave = $("btnSave");

// --- Mutable form state — pre-filled in init() from item metadata. ---
let oneShot = true;
let isVisible = false;  // default for new tricksters; loaded from meta on edit
let isLocked = true;
let fired = false;

function syncSwitch(el: HTMLElement, on: boolean): void {
  el.classList.toggle("on", on);
}

async function init(): Promise<void> {
  if (!tricksterId) {
    btnSave.setAttribute("disabled", "true");
    return;
  }
  let meta: TricksterMeta | null = null;
  try {
    const items = await OBR.scene.items.getItems([tricksterId]);
    if (items.length > 0) {
      const m = items[0].metadata[TRICKSTER_KEY];
      if (m && typeof m === "object") meta = m as TricksterMeta;
    }
  } catch {}
  if (!meta) {
    // Item not found / wrong type → nothing to edit.
    return;
  }

  inpName.value = meta.name ?? "";
  // Migrate legacy "specific" → "all" silently when the dropdown
  // doesn't include it anymore.
  const mode = meta.targetMode === ("specific" as any) ? "all" : meta.targetMode;
  selTargetMode.value = mode ?? "all";
  oneShot = meta.oneShot !== false;
  // Default flipped: new tricksters are invisible to players. Edits
  // of existing items still load their persisted value verbatim, so
  // the user's pre-existing visible:true zones don't get clobbered.
  isVisible = meta.visible === true;
  isLocked = meta.locked !== false;
  fired = !!meta.fired;

  syncSwitch(swOneShot, oneShot);
  syncSwitch(swVisible, isVisible);
  syncSwitch(swLocked, isLocked);

  if (fired && oneShot) {
    firedBadge.style.display = "";
    btnReset.style.display = "";
  }

  if (isNew) inpName.focus();
}

swOneShot.addEventListener("click", () => { oneShot = !oneShot; syncSwitch(swOneShot, oneShot); });
swVisible.addEventListener("click", () => { isVisible = !isVisible; syncSwitch(swVisible, isVisible); });
swLocked.addEventListener("click", () => { isLocked = !isLocked; syncSwitch(swLocked, isLocked); });

/** Close-without-save side. For brand-new tricksters (isNew=1), this
 *  also DELETES the placeholder item — user intent is "I changed my
 *  mind about creating this" — same convention as the status-tracker
 *  popup's discard-unnamed-buff cleanup. For existing edits, just
 *  close the popover; the on-canvas item stays untouched. */
async function close(): Promise<void> {
  if (isNew && tricksterId) {
    try {
      await OBR.broadcast.sendMessage(BC_DELETE, { id: tricksterId }, { destination: "LOCAL" });
    } catch {}
    return; // BC_DELETE handler also closes the popover
  }
  try {
    await OBR.broadcast.sendMessage(BC_CLOSE, {}, { destination: "LOCAL" });
  } catch {}
}

btnClose.addEventListener("click", () => { void close(); });
btnCancel.addEventListener("click", () => { void close(); });

btnDelete.addEventListener("click", async () => {
  if (!confirm("确定删除此捣蛋鬼？此操作不可撤销。")) return;
  try {
    await OBR.broadcast.sendMessage(BC_DELETE, { id: tricksterId }, { destination: "LOCAL" });
  } catch {}
});

btnReset.addEventListener("click", async () => {
  try {
    await OBR.broadcast.sendMessage(BC_RESET, { id: tricksterId }, { destination: "LOCAL" });
  } catch {}
  fired = false;
  firedBadge.style.display = "none";
  btnReset.style.display = "none";
});

btnSave.addEventListener("click", async () => {
  const targetMode = selTargetMode.value as TricksterTargetMode;
  const payload: Partial<TricksterMeta> & { id: string } = {
    id: tricksterId,
    name: inpName.value.trim(),
    targetMode,
    oneShot,
    visible: isVisible,
    locked: isLocked,
    // Saving with a fresh form clears the fired flag — same intent
    // as 重置. The user's mental model: "I just edited this thing,
    // it's ready to fire again."
    fired: false,
  };
  // Also persist as default-create prefs so the next trickster opens
  // with the same toggles pre-applied.
  try {
    const prefs: CreatePrefs = {
      visible: isVisible,
      locked: isLocked,
      oneShot,
      targetMode,
    };
    localStorage.setItem(CREATE_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
  try {
    await OBR.broadcast.sendMessage(BC_SAVE, payload, { destination: "LOCAL" });
  } catch {}
  // Save fires BC_SAVE (commit) THEN BC_CLOSE (popover close). Don't
  // route through close() — that path would mistake a saved-isNew
  // form for a cancelled one and delete the item we just persisted.
  try {
    await OBR.broadcast.sendMessage(BC_CLOSE, {}, { destination: "LOCAL" });
  } catch {}
});

OBR.onReady(() => { void init(); });
