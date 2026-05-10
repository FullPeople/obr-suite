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

import OBR from "@owlbear-rodeo/sdk";
import {
  Resource,
  IconId,
  ResourceType,
  PLUGIN_ID,
} from "./types";
import { ICON_LIBRARY, ICON_LABELS, ICON_IDS } from "./icons";

interface HashPayload {
  itemId: string;
  resource?: Resource;
}

const BC_RESOURCE_SAVE = `${PLUGIN_ID}/edit-save`;
const BC_RESOURCE_DELETE = `${PLUGIN_ID}/edit-delete`;
const BC_RESOURCE_CANCEL = `${PLUGIN_ID}/edit-cancel`;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $i = (id: string) => document.getElementById(id) as HTMLInputElement;
const $s = (id: string) => document.getElementById(id) as HTMLSelectElement;

const titleEl = $("title");
const inpName = $i("name");
const selType = $s("type");
const inpCurrent = $i("current");
const inpMax = $i("max");
const iconGrid = $("iconGrid");
const previewIconEl = $("previewIcon");
const previewLabelEl = $("previewLabel");
const btnX = $("btnX");
const btnCancel = $("btnCancel");
const btnSave = $("btnSave");
const btnDelete = $("btnDelete");

let selectedIcon: IconId = "gem";
let editingResourceId: string | null = null;
let itemId = "";

function broadcast(channel: string, data: unknown): void {
  try {
    OBR.broadcast.sendMessage(channel, data, { destination: "LOCAL" });
  } catch (e) {
    console.warn("[resource-edit] broadcast failed", channel, e);
  }
}

async function close(): Promise<void> {
  broadcast(BC_RESOURCE_CANCEL, {});
}

function renderIconGrid(): void {
  iconGrid.innerHTML = ICON_IDS.map((id) => `
    <div class="icon-pick ${id === selectedIcon ? "on" : ""}"
         data-icon-id="${id}"
         title="${ICON_LABELS[id]}">
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
      updatePreview();
    });
  });
}

function updatePreview(): void {
  previewIconEl.innerHTML = ICON_LIBRARY[selectedIcon] ?? ICON_LIBRARY.gem;
  const cur = inpCurrent.value || "0";
  const max = inpMax.value || "0";
  const name = inpName.value.trim() || "(未命名)";
  previewLabelEl.textContent = `${name} · ${cur} / ${max}`;
}

function applyPayload(p: HashPayload): void {
  itemId = p.itemId;
  if (p.resource) {
    editingResourceId = p.resource.id;
    titleEl.textContent = "编辑资源";
    btnDelete.style.display = "";
    inpName.value = p.resource.name;
    selType.value = p.resource.type;
    inpCurrent.value = String(p.resource.current);
    inpMax.value = String(p.resource.max);
    selectedIcon = p.resource.icon;
  } else {
    editingResourceId = null;
    titleEl.textContent = "新建资源";
    btnDelete.style.display = "none";
    inpName.value = "";
    selType.value = "count";
    inpCurrent.value = "2";
    inpMax.value = "2";
    selectedIcon = "gem";
  }
  renderIconGrid();
  updatePreview();
  // Auto-focus name input on first paint — saves a click for the
  // common "+ 新建资源" flow.
  setTimeout(() => inpName.focus(), 100);
}

[inpName, inpCurrent, inpMax].forEach((el) => {
  el.addEventListener("input", updatePreview);
});
selType.addEventListener("change", updatePreview);

btnX.addEventListener("click", () => { void close(); });
btnCancel.addEventListener("click", () => { void close(); });

btnDelete.addEventListener("click", () => {
  if (!editingResourceId) return;
  if (!confirm("删除该资源？此操作不可撤销。")) return;
  broadcast(BC_RESOURCE_DELETE, { itemId, resourceId: editingResourceId });
});

btnSave.addEventListener("click", () => {
  const name = inpName.value.trim();
  if (!name) {
    alert("名字不能为空");
    inpName.focus();
    return;
  }
  const type = selType.value as ResourceType;
  const current = Number(inpCurrent.value);
  const max = Number(inpMax.value);
  if (!Number.isFinite(current) || !Number.isFinite(max)) {
    alert("当前 / 最大值需为数字");
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
