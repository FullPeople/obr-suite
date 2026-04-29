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
  document.querySelectorAll<HTMLElement>(".add[data-form]").forEach((b) => {
    b.addEventListener("click", () => {
      const which = b.dataset.form;
      const form = document.getElementById(`form-${which}`)!;
      form.classList.toggle("on");
      const input = form.querySelector<HTMLInputElement>("input");
      if (form.classList.contains("on") && input) input.focus();
    });
  });

  $("btn-add-name").addEventListener("click", () => addPreset("name"));
  $("btn-add-tag").addEventListener("click", () => addPreset("tag"));
  $i("inp-add-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addPreset("name"); }
  });
  $i("inp-add-tag").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addPreset("tag"); }
  });
}

function addPreset(kind: "name" | "tag") {
  const inp =
    kind === "name" ? $i("inp-add-name") : $i("inp-add-tag");
  const v = inp.value.trim();
  if (!v) return;
  const arr = kind === "name" ? presets.names : presets.tags;
  if (!arr.includes(v)) arr.push(v);
  inp.value = "";
  writePresets(presets);
  renderChips();
}

async function loadCurrent() {
  if (!portalId) return;
  try {
    const items = await OBR.scene.items.getItems([portalId]);
    if (items.length === 0) return;
    const meta = items[0].metadata[PORTAL_KEY] as PortalMeta | undefined;
    if (meta) {
      inpName.value = meta.name ?? "";
      inpTag.value = meta.tag ?? "";
    }
  } catch {}
  if (isNew) {
    titleEl.textContent = tt("portalNew");
    inpName.focus();
  } else {
    titleEl.textContent = tt("portalEdit");
  }
}

async function save() {
  const name = inpName.value.trim();
  const tag = inpTag.value.trim();
  try {
    await OBR.broadcast.sendMessage(
      BROADCAST_EDIT_SAVE,
      { id: portalId, name, tag },
      { destination: "LOCAL" }
    );
  } catch {}
  await closeSelf();
}

async function del() {
  const ok = confirm(tt("portalConfirmDel"));
  if (!ok) return;
  try {
    await OBR.broadcast.sendMessage(
      BROADCAST_EDIT_DELETE,
      { id: portalId },
      { destination: "LOCAL" }
    );
  } catch {}
}

async function cancel() {
  if (isNew) {
    // Drag-draw was cancelled — remove the just-created portal.
    try {
      await OBR.broadcast.sendMessage(
        BROADCAST_EDIT_DELETE,
        { id: portalId },
        { destination: "LOCAL" }
      );
    } catch {}
  }
  await closeSelf();
}

async function closeSelf() {
  try {
    await OBR.broadcast.sendMessage(
      BROADCAST_EDIT_CLOSE,
      {},
      { destination: "LOCAL" }
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
  $("btn-save").addEventListener("click", save);
  $("btn-cancel").addEventListener("click", cancel);
  $("btn-del").addEventListener("click", del);
  $("x").addEventListener("click", cancel);
  // Enter on either main input → save
  for (const el of [inpName, inpTag]) {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
  }
});
