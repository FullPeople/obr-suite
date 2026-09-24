// Resource Tracker — edit modal page.
//
// Loads with a payload encoded in the URL hash:
//   { itemId, resource? }
// where `resource` is undefined for "create new" and an existing
// Resource for "edit". The page is a standalone OBR modal so the
// form has the entire viewport to render its scrollable icon grid;
// the panel popover that triggered this stays open behind us.
//
// On save / delete the page broadcasts back to the popover side
// which mutates OBR scene metadata and refreshes its list. We
// don't write metadata directly here — keeps the source-of-truth
// flow simple (panel-side reads, panel-side writes).
//
// 2026-05-15 — UX rev:
//   • Click on the dimmed area outside the card → cancel-close.
//   • All boxes use square corners (border-radius:0) for a modern look.
//   • Icon grid: gap:0, square highlights that fully fill the cell.
//   • Default name on "create" = "自定义"; focus selects the whole
//     name input so the user can type-replace immediately.
//   • Per-client presets (name + type + max + icon, persisted to
//     localStorage). Pattern mirrors portal-edit's name-presets:
//     "+ 保存当前为预设" pushes the current form state in; clicking
//     a chip restores it; the × deletes that preset.

import OBR from "@owlbear-rodeo/sdk";
import {
  Resource,
  IconId,
  ResourceType,
  PLUGIN_ID,
} from "./types";
import { ICON_LIBRARY, iconLabel, ICON_IDS } from "./icons";
import { markEditSession, clearEditSession, editSessionOpen } from "./session";
import { applyI18nDom, t } from "../../i18n";
import { getLocalLang, onLangChange } from "../../state";

// i18n — static text via data-i18n; dynamic strings via T().
let lang = getLocalLang();
const T = (k: Parameters<typeof t>[1]) => t(lang, k);
try { applyI18nDom(lang); } catch {}

interface HashPayload {
  itemId: string;
  session: string;
  resource?: Resource;
}

interface ResourcePreset {
  name: string;
  type: ResourceType;
  max: number;
  icon: IconId;
}

const BC_RESOURCE_SAVE = `${PLUGIN_ID}/edit-save`;
const BC_RESOURCE_DELETE = `${PLUGIN_ID}/edit-delete`;
const BC_RESOURCE_CANCEL = `${PLUGIN_ID}/edit-cancel`;
const PRESETS_KEY = `${PLUGIN_ID}/edit-presets`;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $i = (id: string) => document.getElementById(id) as HTMLInputElement;

const titleEl = $("title");
const inpName = $i("name");
const typeToggle = $("typeToggle");
const inpCurrent = $i("current");
const inpMax = $i("max");
const iconGrid = $("iconGrid");
const previewIconEl = $("previewIcon");
const previewLabelEl = $("previewLabel");
const btnX = $("btnX");
const btnCancel = $("btnCancel");
const btnSave = $("btnSave");
const btnDelete = $("btnDelete");
const btnAddPreset = $("btnAddPreset");
const chipsPresets = $("chipsPresets");
const cardEl = document.querySelector<HTMLElement>(".card");

let selectedIcon: IconId = "gem";
let editingResourceId: string | null = null;
let itemId = "";
let session = "", active = true;
const isEditorCurrent = () => active && !!session && editSessionOpen(session);

// Type toggle state. Lives outside the DOM so payload (re-)apply
// doesn't fight with the .on class.
let selectedType: ResourceType = "count";

// ---------- presets ---------------------------------------------------------
function readPresets(): ResourcePreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter to entries that match the expected shape — defensive against
    // schema drift from older versions of this same key.
    return parsed.filter((p) =>
      p && typeof p.name === "string"
      && (p.type === "count" || p.type === "bar" || p.type === "number")
      && typeof p.max === "number"
      && typeof p.icon === "string"
    );
  } catch {
    return [];
  }
}
function writePresets(arr: ResourcePreset[]): void {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(arr)); } catch {}
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function renderPresets(): void {
  const arr = readPresets();
  if (!arr.length) {
    chipsPresets.innerHTML = `<span class="empty">${escHtml(T("rePresetsEmpty"))}</span>`;
    return;
  }
  // Each chip carries the icon SVG + name, plus a × delete button.
  // Click chip body → load this preset into the form. Click × → drop it.
  chipsPresets.innerHTML = arr.map((p, idx) => {
    const iconSvg = ICON_LIBRARY[p.icon] ?? ICON_LIBRARY.gem;
    const typeName = T(p.type === "count" ? "reTypeCount" : p.type === "bar" ? "reTypeBar" : "reTypeNumber");
    return `<span class="chip" data-idx="${idx}" title="${escHtml(p.name)} · ${escHtml(typeName)} · ${escHtml(T("rePresetMax"))} ${p.max}">
      <span class="ico">${iconSvg}</span>
      <span class="lab">${escHtml(p.name)}</span>
      <button class="del" type="button" data-del="${idx}" title="${escHtml(T("rePresetDel"))}">×</button>
    </span>`;
  }).join("");
}

function applyPresetIntoForm(p: ResourcePreset): void {
  inpName.value = p.name;
  selectedType = p.type;
  selectedIcon = p.icon;
  inpMax.value = String(p.max);
  // For "count" type the new resource starts FULL by convention; for
  // bar/number we mirror max into current too — the user can tweak after.
  inpCurrent.value = String(p.max);
  applyTypeToggleClasses();
  renderIconGrid();
  updatePreview();
}

chipsPresets.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const delBtn = target.closest<HTMLButtonElement>("button[data-del]");
  if (delBtn) {
    e.stopPropagation();
    const idx = Number(delBtn.dataset.del);
    const arr = readPresets();
    if (idx >= 0 && idx < arr.length) {
      arr.splice(idx, 1);
      writePresets(arr);
      renderPresets();
    }
    return;
  }
  const chip = target.closest<HTMLElement>(".chip");
  if (!chip) return;
  const idx = Number(chip.dataset.idx);
  const arr = readPresets();
  if (idx >= 0 && idx < arr.length) {
    applyPresetIntoForm(arr[idx]);
  }
});

btnAddPreset.addEventListener("click", () => {
  const name = inpName.value.trim() || T("reDefaultName");
  const max = Number(inpMax.value);
  if (!Number.isFinite(max)) return;
  const next: ResourcePreset = {
    name,
    type: selectedType,
    max,
    icon: selectedIcon,
  };
  const arr = readPresets();
  // Replace any existing preset with the same name + type combo so users
  // can iterate on a preset without piling up duplicates.
  const dupeIdx = arr.findIndex((p) => p.name === next.name && p.type === next.type);
  if (dupeIdx >= 0) arr[dupeIdx] = next;
  else arr.push(next);
  writePresets(arr);
  renderPresets();
});

// ---------- type toggle -----------------------------------------------------
function applyTypeToggleClasses(): void {
  if (!typeToggle) return;
  for (const b of typeToggle.querySelectorAll<HTMLButtonElement>("button[data-type]")) {
    b.classList.toggle("on", b.dataset.type === selectedType);
  }
}
typeToggle?.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-type]");
  if (!t) return;
  const v = t.dataset.type as ResourceType | undefined;
  if (!v || (v !== "count" && v !== "bar" && v !== "number")) return;
  selectedType = v;
  applyTypeToggleClasses();
  updatePreview();
});

function broadcast(channel: string, data: unknown): void {
  if (!isEditorCurrent()) return;
  try {
    void OBR.broadcast.sendMessage(channel, { ...(data as object), session }, { destination: "LOCAL" }).catch((error) => console.warn("[resource-edit] send failed", error));
  } catch (e) {
    console.warn("[resource-edit] broadcast failed", channel, e);
  }
}

async function close(): Promise<void> {
  broadcast(BC_RESOURCE_CANCEL, {});
  clearEditSession(session); active = false;
}

// ---------- icon grid -------------------------------------------------------
function renderIconGrid(): void {
  iconGrid.innerHTML = ICON_IDS.map((id) => `
    <div class="icon-pick ${id === selectedIcon ? "on" : ""}"
         data-icon-id="${id}"
         title="${escHtml(iconLabel(id, lang))}" role="button" tabindex="0" aria-label="${escHtml(iconLabel(id, lang))}" aria-pressed="${id === selectedIcon}">
      ${ICON_LIBRARY[id]}
    </div>
  `).join("");
  iconGrid.querySelectorAll<HTMLElement>(".icon-pick").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.iconId as IconId | undefined;
      if (!id) return;
      selectedIcon = id;
      iconGrid.querySelectorAll(".icon-pick").forEach((x) => x.classList.remove("on"));
      el.classList.add("on");
      iconGrid.querySelectorAll(".icon-pick").forEach((x) => x.setAttribute("aria-pressed", String(x === el)));
      updatePreview();
    });
    el.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); el.click(); } });
  });
}

function updatePreview(): void {
  previewIconEl.innerHTML = ICON_LIBRARY[selectedIcon] ?? ICON_LIBRARY.gem;
  const cur = inpCurrent.value || "0";
  const max = inpMax.value || "0";
  const name = inpName.value.trim() || T("rtUnnamed");
  previewLabelEl.textContent = `${name} · ${cur} / ${max}`;
}

// ---------- payload (initial paint) -----------------------------------------
function applyPayload(p: HashPayload): void {
  if (!p.session || !p.itemId) return;
  session = p.session; markEditSession(session);
  itemId = p.itemId;
  if (p.resource) {
    editingResourceId = p.resource.id;
    titleEl.textContent = T("reEditTitle");
    btnDelete.style.display = "";
    inpName.value = p.resource.name;
    selectedType = p.resource.type;
    inpCurrent.value = String(p.resource.current);
    inpMax.value = String(p.resource.max);
    selectedIcon = p.resource.icon;
  } else {
    editingResourceId = null;
    titleEl.textContent = T("reNewTitle");
    btnDelete.style.display = "none";
    // Default name "自定义" + auto-select on first focus → user can
    // start typing the real name without manually clearing the field.
    inpName.value = T("reDefaultName");
    selectedType = "count";
    inpCurrent.value = "2";
    inpMax.value = "2";
    selectedIcon = "gem";
  }
  applyTypeToggleClasses();
  renderIconGrid();
  renderPresets();
  updatePreview();
  document.title = titleEl.textContent ?? T("reEditTitle");
  // Auto-focus name on first paint — saves a click for the common
  // "+ 新建资源" flow. The focus handler below selects all text, so
  // typing immediately replaces "自定义".
  setTimeout(() => {
    if (isEditorCurrent() && (!document.activeElement || document.activeElement === document.body)) inpName.focus();
  }, 100);
}

[inpName, inpCurrent, inpMax].forEach((el) => {
  el.addEventListener("input", updatePreview);
});

// Click-to-replace: focus on any of the three text/number inputs selects
// the whole value so a single keystroke replaces it. Mirrors OBR's HP-bar
// editor and the user's #4 spec for the name field.
[inpName, inpCurrent, inpMax].forEach((el) => {
  el.addEventListener("focus", () => {
    // requestAnimationFrame so focus-set / blur-restore cycles settle
    // before the selection paints — without this, Chrome sometimes
    // deselects right after focus.
    requestAnimationFrame(() => { if (isEditorCurrent() && document.activeElement === el) el.select(); });
  });
});

// ---------- close paths -----------------------------------------------------
btnX.addEventListener("click", () => { void close(); });
btnCancel.addEventListener("click", () => { void close(); });

// Click on the dimmed area outside the card → cancel-close. We listen on
// the body and bail out if the click landed inside the card. This matches
// the portal-edit "click backdrop to dismiss" pattern.
document.body.addEventListener("mousedown", (e) => {
  if (!cardEl) return;
  const target = e.target as Node | null;
  if (target && cardEl.contains(target)) return;
  e.preventDefault();
  void close();
});

btnDelete.addEventListener("click", () => {
  if (!isEditorCurrent() || !editingResourceId) return;
  if (!confirm(T("reConfirmDelete"))) return;
  broadcast(BC_RESOURCE_DELETE, { itemId, resourceId: editingResourceId });
});

btnSave.addEventListener("click", () => {
  if (!isEditorCurrent()) return;
  const name = inpName.value.trim();
  if (!name) {
    alert(T("reErrNameEmpty"));
    inpName.focus();
    return;
  }
  const type = selectedType;
  const current = Number(inpCurrent.value);
  const max = Number(inpMax.value);
  if (!Number.isFinite(current) || !Number.isFinite(max)) {
    alert(T("reErrNumbers"));
    return;
  }
  const resource: Resource = {
    id: editingResourceId || `r-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    name,
    type,
    current,
    max,
    icon: selectedIcon,
  };
  broadcast(BC_RESOURCE_SAVE, { itemId, resource });
});

inpName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); btnSave.click(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); void close(); }
});

OBR.onReady(() => {
  try {
    const raw = location.hash.replace(/^#/, "");
    if (raw) {
      const payload = JSON.parse(decodeURIComponent(raw)) as HashPayload;
      applyPayload(payload);
    } else {
      console.warn("[resource-edit] no payload in URL hash");
    }
  } catch (e) {
    console.warn("[resource-edit] failed to parse hash payload", e);
  }
});

const languageUnsub = onLangChange((next) => {
  if (!active) return;
  lang = next; applyI18nDom(lang);
  titleEl.textContent = T(editingResourceId ? "reEditTitle" : "reNewTitle");
  document.title = titleEl.textContent;
  iconGrid.querySelectorAll<HTMLElement>("[data-icon-id]").forEach((element) => {
    const label = iconLabel(element.dataset.iconId as IconId, lang);
    element.title = label; element.setAttribute("aria-label", label);
  });
  renderPresets(); updatePreview();
});
window.addEventListener("pagehide", () => {
  clearEditSession(session); active = false; languageUnsub();
});
