/* Transform picker popover (Phase 1 — ad-hoc form).
 *
 * Collects a target form (image URL + size + optional name) and
 * broadcasts BC_APPLY_FORM to the background module, which owns the
 * actual snapshot + swap on the canvas. The popover does NOT mutate
 * items itself — it has no business doing scene writes, and keeping the
 * mutation in one place (background) avoids races.
 *
 * Phase 2 will add: preset-form library (saved forms with effect ids +
 * bestiary slug), two-stage effect picker, and a "bind monster data"
 * toggle. The BC_APPLY_FORM payload shape (TransformForm) already has
 * the optional fields reserved.
 */
import OBR from "@owlbear-rodeo/sdk";
import { getLocalLang } from "./state";

// Dev-only transform form; per-client language read once at load.
const en = getLocalLang() === "en";

// Translate the static HTML chrome (data-en / data-en-title / data-en-ph).
if (en) {
  document.title = "Transform";
  document.querySelectorAll<HTMLElement>("[data-en]").forEach((el) => { el.textContent = el.dataset.en!; });
  document.querySelectorAll<HTMLElement>("[data-en-title]").forEach((el) => { el.title = el.dataset.enTitle!; });
  document.querySelectorAll<HTMLInputElement>("[data-en-ph]").forEach((el) => { el.placeholder = el.dataset.enPh!; });
}

// Full literal keys so the dev-channel namespace-isolation plugin
// rewrites "com.obr-suite/" → "com.obr-suite-dev/" consistently with
// the background module (a `${PLUGIN_ID}/…` template would escape it).
const BC_APPLY_FORM = "com.obr-suite/transform:apply";
const POPOVER_ID = "com.obr-suite/transform/picker";

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T;

const params = new URLSearchParams(location.search);
const itemId = params.get("itemId") || "";

const imgUrlEl = $("#imgUrl") as HTMLInputElement;
const formNameEl = $("#formName") as HTMLInputElement;
const previewEl = $("#preview");
const sizeGrid = $("#sizeGrid");
const applyBtn = $("#applyBtn") as HTMLButtonElement;
const closeBtn = $("#closeBtn") as HTMLButtonElement;
const toastStack = $("#toastStack");

let footprint = 1;
// Natural dimensions of the loaded image — needed for the grid math on
// the background side. Filled in when a valid URL loads.
let natW = 0;
let natH = 0;

function toast(text: string, kind: "" | "warn" | "error" = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = text;
  toastStack.appendChild(el);
  setTimeout(() => { el.remove(); }, 2400);
}

// ---- size chips ----
sizeGrid.querySelectorAll<HTMLElement>(".size-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    sizeGrid.querySelectorAll(".size-chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    footprint = Number(chip.dataset.fp || "1") || 1;
  });
});

// ---- image preview + validation ----
let loadToken = 0;
function refreshPreview() {
  const url = imgUrlEl.value.trim();
  natW = 0; natH = 0;
  applyBtn.disabled = true;
  if (!url) { previewEl.textContent = en ? "Preview" : "预览"; previewEl.style.backgroundImage = ""; return; }
  const my = ++loadToken;
  const probe = new Image();
  probe.crossOrigin = "anonymous";
  probe.onload = () => {
    if (my !== loadToken) return; // a newer URL superseded this load
    natW = probe.naturalWidth || 0;
    natH = probe.naturalHeight || 0;
    if (natW > 0 && natH > 0) {
      previewEl.style.backgroundImage = `url("${url}")`;
      previewEl.textContent = "";
      applyBtn.disabled = false;
    } else {
      previewEl.textContent = en ? "Can't read dimensions" : "无法读取尺寸";
    }
  };
  probe.onerror = () => {
    if (my !== loadToken) return;
    previewEl.style.backgroundImage = "";
    previewEl.textContent = en ? "Load failed" : "加载失败";
    applyBtn.disabled = true;
  };
  probe.src = url;
}
imgUrlEl.addEventListener("input", refreshPreview);
imgUrlEl.addEventListener("change", refreshPreview);

function mimeFromUrl(url: string): string {
  const u = url.split("?")[0].toLowerCase();
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
  if (u.endsWith(".gif")) return "image/gif";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

// ---- apply ----
applyBtn.addEventListener("click", () => {
  const url = imgUrlEl.value.trim();
  if (!url || natW <= 0 || natH <= 0) { toast(en ? "Enter a valid direct image link first" : "请先填入有效的图片直链", "warn"); return; }
  if (!itemId) { toast(en ? "Missing target token" : "缺少目标 token", "error"); return; }
  const name = formNameEl.value.trim();
  const form = {
    image: { url, width: natW, height: natH, mime: mimeFromUrl(url) },
    footprint,
    // Empty name → keep the token's current name. Background treats an
    // empty string as "no rename" only if we omit it, so send the
    // current value and let the user's blank mean "rename to blank"?
    // Simpler: fall back to a generic label so the token always has a
    // name; the snapshot still restores the original on revert.
    name: name || (en ? "Transformed" : "变身形态"),
    label: name || (en ? "Transformed" : "变身形态"),
  };
  try {
    OBR.broadcast.sendMessage(BC_APPLY_FORM, { itemId, form }, { destination: "LOCAL" });
  } catch (e) {
    toast((en ? "Send failed: " : "发送失败：") + ((e as any)?.message || e), "error");
    return;
  }
  applyBtn.disabled = true;
  applyBtn.textContent = en ? "Transforming…" : "变身中…";
});

closeBtn.addEventListener("click", () => {
  // The picker popover is a plain popover; closing it is just closing
  // our own window. Background also closes it after a successful apply.
  try { OBR.popover.close(POPOVER_ID); } catch {}
});

OBR.onReady(() => {
  // nothing to boot — the form is local until "变身" is clicked.
});
