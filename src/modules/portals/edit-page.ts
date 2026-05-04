import OBR from "@owlbear-rodeo/sdk";
import {
  PLUGIN_ID,
  PORTAL_KEY,
  PRESETS_KEY,
  DEFAULT_PRESETS,
  Presets,
  PortalMeta,
} from "./types";
import { applyI18nDom, t } from "../../i18n";
import { getLocalLang, onLangChange } from "../../state";

let lang = getLocalLang();
const tt = (k: Parameters<typeof t>[1]) => t(lang, k);

// Per-client preset persistence — names + tags lists shown as chips for
// quick fill-in. User can add/remove freely without touching the scene.
function readPresets(): Presets {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.names) && Array.isArray(parsed.tags)) {
        return parsed;
      }
    }
  } catch {}
  return { ...DEFAULT_PRESETS };
}
function writePresets(p: Presets) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(p)); } catch {}
}

const params = new URLSearchParams(location.search);
const portalId = params.get("id") ?? "";
const isNew = params.get("isNew") === "1";

const EDIT_POPOVER_ID = `${PLUGIN_ID}/edit-popover`;
const BROADCAST_EDIT_SAVE = `${PLUGIN_ID}/edit-save`;
const BROADCAST_EDIT_DELETE = `${PLUGIN_ID}/edit-delete`;
const BROADCAST_EDIT_CLOSE = `${PLUGIN_ID}/edit-close`;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $i = (id: string) => document.getElementById(id) as HTMLInputElement;

const inpName = $i("inp-name");
const inpTag = $i("inp-tag");
const chipsNames = $("chips-names");
const chipsTags = $("chips-tags");
const titleEl = $("title");

let presets = readPresets();

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function renderChips() {
  chipsNames.innerHTML = presets.names
    .map(
      (n, idx) =>
        `<span class="chip" data-kind="name" data-idx="${idx}"><span class="lab">${escHtml(
          n
        )}</span><button class="del" data-kind="name" data-idx="${idx}">×</button></span>`
    )
    .join("");
  chipsTags.innerHTML = presets.tags
    .map(
      (t, idx) =>
        `<span class="chip" data-kind="tag" data-idx="${idx}"><span class="lab">${escHtml(
          t
        )}</span><button class="del" data-kind="tag" data-idx="${idx}">×</button></span>`
    )
    .join("");

  // Click chip body → fill input. Click × → remove preset.
  chipsNames.querySelectorAll<HTMLElement>(".chip").forEach((el) => {
    el.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      const idx = Number(el.dataset.idx);
      if (target.classList.contains("del")) {
        presets.names.splice(idx, 1);
        writePresets(presets);
        renderChips();
        return;
      }
      inpName.value = presets.names[idx] ?? "";
    });
  });
  chipsTags.querySelectorAll<HTMLElement>(".chip").forEach((el) => {
    el.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      const idx = Number(el.dataset.idx);
      if (target.classList.contains("del")) {
        presets.tags.splice(idx, 1);
        writePresets(presets);
        renderChips();
        return;
      }
      inpTag.value = presets.tags[idx] ?? "";
    });
  });
}

function setupAddForms() {
  // "+ 添加当前" buttons grab whatever is in the matching main input
  // and push it into the presets list — no second input row.
  $("btn-add-name").addEventListener("click", () => addPreset("name"));
  $("btn-add-tag").addEventListener("click", () => addPreset("tag"));
}

function addPreset(kind: "name" | "tag") {
  // Source the value from the MAIN input field (inpName / inpTag)
  // rather than a separate "new preset" input — the user wanted
  // "click + add → save current value as preset" instead of opening
  // another input box.
  const src = kind === "name" ? inpName : inpTag;
  const v = src.value.trim();
  if (!v) return;
  const arr = kind === "name" ? presets.names : presets.tags;
  if (!arr.includes(v)) arr.push(v);
  writePresets(presets);
  renderChips();
}

// Snapshot of the loaded portal — if the user hits Cancel we revert
// the name/tag back to these values BEFORE closing. Auto-save on close
// would otherwise overwrite them with the in-progress edits.
let originalName = "";
let originalTag = "";
let cancelled = false;
// Mirrors of OBR's native item flags + suite-side metadata flags so
// the toggle buttons reflect the actual portal state from first paint
// (re-opening the dialog never shows a stale toggle). Each is
// updated on load and after every successful write.
let isLocked = false;
let isVisible = true;
let showName = false;

function applyLockButtonState() {
  const btn = document.getElementById("btn-lock");
  if (!btn) return;
  btn.classList.toggle("on", isLocked);
  btn.setAttribute("aria-pressed", isLocked ? "true" : "false");
  const titleZh = isLocked ? "已锁定（点击解锁）" : "未锁定（点击锁定）";
  const titleEn = isLocked ? "Locked (click to unlock)" : "Unlocked (click to lock)";
  btn.title = lang === "en" ? titleEn : titleZh;
}

function applyVisibleButtonState() {
  const btn = document.getElementById("btn-visible");
  if (!btn) return;
  btn.classList.toggle("on", isVisible);
  btn.setAttribute("aria-pressed", isVisible ? "true" : "false");
  const titleZh = isVisible ? "玩家可见（点击隐藏）" : "对玩家隐藏（点击显示）";
  const titleEn = isVisible ? "Visible to players (click to hide)" : "Hidden from players (click to show)";
  btn.title = lang === "en" ? titleEn : titleZh;
}

function applyTextButtonState() {
  const btn = document.getElementById("btn-show-name");
  if (!btn) return;
  btn.classList.toggle("on", showName);
  btn.setAttribute("aria-pressed", showName ? "true" : "false");
  const titleZh = showName
    ? "显示名字标签（保存时把当前名字写到 token 上）"
    : "隐藏名字标签（保存时清空 token 文字）";
  const titleEn = showName
    ? "Show name label (save will sync current name to token)"
    : "Hide name label (save will clear token text)";
  btn.title = lang === "en" ? titleEn : titleZh;
}

async function toggleLock() {
  if (!portalId) return;
  const next = !isLocked;
  isLocked = next;
  applyLockButtonState();
  try {
    // OBR's native item lock — once true, the token can't be moved /
    // deleted from the scene by normal user interaction. Same flag
    // the suite sets on freshly-spawned portal previews.
    await OBR.scene.items.updateItems([portalId], (drafts) => {
      for (const d of drafts) d.locked = next;
    });
  } catch (e) {
    console.warn("[obr-suite/portals] toggle lock failed", e);
    isLocked = !next; // revert visual state on failure
    applyLockButtonState();
  }
}

async function toggleVisible() {
  if (!portalId) return;
  const next = !isVisible;
  isVisible = next;
  applyVisibleButtonState();
  try {
    await OBR.scene.items.updateItems([portalId], (drafts) => {
      for (const d of drafts) d.visible = next;
    });
  } catch (e) {
    console.warn("[obr-suite/portals] toggle visible failed", e);
    isVisible = !next;
    applyVisibleButtonState();
  }
}

async function toggleShowName() {
  if (!portalId) return;
  const next = !showName;
  showName = next;
  applyTextButtonState();
  // Apply the text label change immediately too — most users expect
  // a flip to show on the scene right away, not only after Save.
  try {
    const nameNow = inpName.value.trim();
    await OBR.scene.items.updateItems([portalId], (drafts) => {
      for (const d of drafts) {
        const meta = (d.metadata[PORTAL_KEY] as PortalMeta | undefined) ?? { name: "", tag: "", radius: 0 };
        d.metadata[PORTAL_KEY] = { ...meta, showName: next };
        const txt = (d as any).text;
        if (txt) {
          txt.plainText = next ? nameNow : "";
        }
      }
    });
  } catch (e) {
    console.warn("[obr-suite/portals] toggle showName failed", e);
    showName = !next;
    applyTextButtonState();
  }
}

async function loadCurrent() {
  if (!portalId) return;
  try {
    const items = await OBR.scene.items.getItems([portalId]);
    if (items.length === 0) return;
    const it = items[0];
    const meta = it.metadata[PORTAL_KEY] as PortalMeta | undefined;
    if (meta) {
      originalName = meta.name ?? "";
      originalTag = meta.tag ?? "";
      inpName.value = originalName;
      inpTag.value = originalTag;
      showName = meta.showName === true;
    }
    isLocked = !!it.locked;
    isVisible = it.visible !== false;
    applyLockButtonState();
    applyVisibleButtonState();
    applyTextButtonState();
  } catch {}
  if (isNew) {
    titleEl.textContent = tt("portalNew");
    inpName.focus();
  } else {
    titleEl.textContent = tt("portalEdit");
  }
}

async function autoSave() {
  // Persist whatever's in the inputs RIGHT NOW. Used when the user
  // closes the panel by any means other than Cancel.
  //
  // Single atomic updateItems writes name + tag + radius + showName +
  // text label in one transaction. We used to fire a BROADCAST_EDIT_SAVE
  // and ALSO an updateItems for showName in parallel — that was a race:
  // whichever finished last clobbered the other (the broadcast handler
  // overwrites the whole PortalMeta object without showName, while the
  // edit-page updateItems read OLD name/tag and wrote them back). The
  // result was that toggling Show-name + Save sometimes lost the new
  // name/tag entirely, which was the original "Save button doesn't save"
  // bug. One transaction = no race.
  if (!portalId) return;
  const name = inpName.value.trim();
  const tag = inpTag.value.trim();
  try {
    await OBR.scene.items.updateItems([portalId], (drafts) => {
      for (const d of drafts) {
        const cur = (d.metadata[PORTAL_KEY] as PortalMeta | undefined)
          ?? { name: "", tag: "", radius: 70 };
        d.metadata[PORTAL_KEY] = {
          name,
          tag,
          radius: cur.radius,
          showName,
        };
        const txt = (d as any).text;
        if (txt) txt.plainText = showName ? name : "";
      }
    });
  } catch (e) {
    console.warn("[obr-suite/portals] autoSave failed", e);
  }
}

async function cancel() {
  cancelled = true;
  if (isNew) {
    // Drag-draw cancelled — remove the just-created portal entirely.
    try {
      await OBR.broadcast.sendMessage(
        BROADCAST_EDIT_DELETE,
        { id: portalId },
        { destination: "LOCAL" },
      );
    } catch {}
    await closeSelf();
    return;
  }
  // Existing portal: revert the in-flight edits to the snapshot we
  // grabbed at load time, then close (no save broadcast — we want
  // the original values to remain on the token).
  try {
    await OBR.broadcast.sendMessage(
      BROADCAST_EDIT_SAVE,
      { id: portalId, name: originalName, tag: originalTag },
      { destination: "LOCAL" },
    );
  } catch {}
  await closeSelf();
}

async function closeSelf() {
  // Auto-save on close (X click, Esc, etc.) — but only if Cancel
  // hasn't already taken over the close path.
  if (!cancelled) await autoSave();
  try {
    await OBR.broadcast.sendMessage(
      BROADCAST_EDIT_CLOSE,
      {},
      { destination: "LOCAL" },
    );
  } catch {}
  try { await OBR.popover.close(EDIT_POPOVER_ID); } catch {}
}

// Re-render labels + title when the user flips language in Settings.
function reapplyI18n() {
  applyI18nDom(lang);
  if (titleEl) {
    titleEl.textContent = isNew ? tt("portalNew") : tt("portalEdit");
  }
  applyLockButtonState();
  applyVisibleButtonState();
  applyTextButtonState();
}
onLangChange((next) => {
  lang = next;
  reapplyI18n();
});

OBR.onReady(async () => {
  applyI18nDom(lang);
  renderChips();
  setupAddForms();
  await loadCurrent();
  $("btn-cancel").addEventListener("click", cancel);
  // Save button — explicit save+close path (mirrors header X behavior
  // but is more discoverable next to Cancel).
  $("btn-save").addEventListener("click", () => { void closeSelf(); });
  // Lock toggle — calls OBR's native item.locked on the portal token.
  // Independent of save/cancel: toggling writes through immediately.
  $("btn-lock").addEventListener("click", () => { void toggleLock(); });
  // Visible / Show-name toggles — also write through immediately so
  // the on-scene state matches what the dialog shows. Both flags
  // persist so reopening the portal-edit popover shows the same
  // state the user last left it in.
  $("btn-visible").addEventListener("click", () => { void toggleVisible(); });
  $("btn-show-name").addEventListener("click", () => { void toggleShowName(); });
  // Header X button auto-saves and closes (Cancel button is the only
  // path that reverts changes).
  $("x").addEventListener("click", () => { void closeSelf(); });
  // Enter saves + closes; Escape cancels (revert).
  for (const el of [inpName, inpTag]) {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); void closeSelf(); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
  }
  // Auto-save when the popover unmounts via OBR's own lifecycle (e.g.
  // background close()'d us, scene change, etc.). beforeunload fires
  // synchronously but `autoSave` is async — we fire-and-forget; the
  // broadcast is in-flight by the time the iframe tears down.
  window.addEventListener("beforeunload", () => {
    if (!cancelled) void autoSave();
  });
});

// Suppress unused-warning: BROADCAST_EDIT_DELETE is still imported and
// used by the cancel path for new portals. (The standalone Delete button
// was removed per user request — players delete the portal token via
// OBR's normal delete-token UX.)
void BROADCAST_EDIT_DELETE;
