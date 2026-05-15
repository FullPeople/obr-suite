// Skin picker — opened from the ATTACHMENT-item right-click
// "设为我的骰子皮肤" context menu. The right-clicked item's image
// (url + mime + name) arrives in the URL hash. The user clicks one of
// the seven dice; we write that die's skin into the current player's
// OBR metadata (synced room-wide) and close the modal.

import OBR from "@owlbear-rodeo/sdk";
import { ALL_TYPES, type DiceType } from "./types";
import { writeSkin, readActiveSkins, isVideoSkin, type DiceSkins } from "./dice-skins";
import { assetUrl } from "../../asset-base";

// Literal (not imported from index.ts) so this iframe stays a leaf
// module — the dev-namespace vite plugin rewrites the prefix in both
// files identically, so the id still matches index.ts's modal id.
const MODAL_ID = "com.obr-suite/dice-skin-picker";

interface PickerPayload {
  url: string;
  mime: string;
  name: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function readPayload(): PickerPayload | null {
  try {
    const raw = decodeURIComponent(location.hash.slice(1));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PickerPayload>;
    if (typeof p.url !== "string" || !p.url) return null;
    return {
      url: p.url,
      mime: typeof p.mime === "string" ? p.mime : "",
      name: typeof p.name === "string" ? p.name : "",
    };
  } catch {
    return null;
  }
}

async function closeModal(): Promise<void> {
  try { await OBR.modal.close(MODAL_ID); } catch {}
}

OBR.onReady(async () => {
  const payload = readPayload();
  const previewEl = document.getElementById("preview") as HTMLDivElement;
  const gridEl = document.getElementById("dieGrid") as HTMLDivElement;
  const btnX = document.getElementById("btnX") as HTMLButtonElement;
  const btnCancel = document.getElementById("btnCancel") as HTMLButtonElement;

  if (!payload) {
    previewEl.textContent = "未能读取图片信息，请重试。";
  } else {
    const isVid = isVideoSkin({ url: payload.url, mime: payload.mime });
    const thumb = isVid
      ? `<video src="${esc(payload.url)}" autoplay loop muted playsinline></video>`
      : `<img src="${esc(payload.url)}" alt="">`;
    previewEl.innerHTML =
      `<span class="thumb">${thumb}</span>` +
      `<span class="meta">` +
      `<span class="nm">${esc(payload.name || "（未命名附件）")}</span>` +
      `<span class="tp">${isVid ? "动图 webm" : "静态图片"}</span>` +
      `</span>`;
  }

  // Mark dice that already have a custom skin so the user knows a
  // click here will replace it.
  // The "● already-customised" indicator should reflect the saved
  // ACTIVE skin per die — not the per-roll random pick. Picking from the
  // attachment again writes through writeSkin which appends to library
  // AND swaps active.
  let mySkins: DiceSkins = {};
  try { mySkins = await readActiveSkins(); } catch { /* default empty */ }

  gridEl.innerHTML = ALL_TYPES.map((t) => {
    const has = !!mySkins[t];
    return (
      `<button class="die-btn${has ? " has-skin" : ""}" data-type="${t}" type="button">` +
      `<img src="${esc(assetUrl(`${t}.png`))}" alt="${t}" draggable="false">` +
      `<span class="lbl">${t}${has ? " ●" : ""}</span>` +
      `</button>`
    );
  }).join("");

  gridEl.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".die-btn");
    if (!btn || !payload) return;
    const type = btn.dataset.type as DiceType;
    try {
      await writeSkin(type, { url: payload.url, mime: payload.mime });
    } catch (err) {
      console.error("[obr-suite/dice] writeSkin failed", err);
    }
    await closeModal();
  });

  btnX.addEventListener("click", () => void closeModal());
  btnCancel.addEventListener("click", () => void closeModal());
  // Click the dim area outside the card → close.
  document.body.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".card")) void closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); void closeModal(); }
  });
});
