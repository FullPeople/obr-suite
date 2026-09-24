import OBR, { type Image } from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { applyPortalImage, isPortalImage, readLibraryImage } from "./appearance";

import { resolveDefaultPortalImage } from "./default-image";

/** A native library picker; no asset enumeration, upload, or additional service. */
export function mountPortalAppearance(parent: HTMLElement, portalId: string, initialLanguage: string) {
  let language = initialLanguage, alive = true, epoch = 0, busy = false, initialized = false;
  let role = "PLAYER", ready = false, item: Image | undefined, status: "" | "saved" | "failed" | "invalid" = "";
  let roleRevision = 0, readyRevision = 0, itemRevision = 0, sceneValid = true;
  const room = OBR.room.id, defaultUrl = assetUrl("portal-icon.svg");
  const section = document.createElement("div"); section.className = "row portal-appearance";
  section.innerHTML = '<div class="lbl"></div><div class="portal-art-row"><img class="portal-art-preview" alt=""><div class="portal-art-actions"><button type="button" class="btn cancel portal-art-pick"></button><button type="button" class="btn cancel portal-art-reset"></button></div></div><div class="portal-art-status" role="status" aria-live="polite"></div>';
  parent.append(section);
  const label = section.querySelector(".lbl") as HTMLElement;
  let preview: HTMLImageElement | HTMLVideoElement = section.querySelector("img")!;
  const pick = section.querySelector(".portal-art-pick") as HTMLButtonElement, reset = section.querySelector(".portal-art-reset") as HTMLButtonElement;
  const message = section.querySelector(".portal-art-status") as HTMLElement;
  const retry = document.createElement("button");
  retry.type = "button"; retry.className = "btn cancel portal-art-retry"; section.append(retry);
  const allowed = () => alive && initialized && sceneValid && ready && role === "GM" && !!item && room === OBR.room.id;
  function render() {
    const en = language === "en";
    label.textContent = en ? "Portal image" : "传送门图片";
    pick.textContent = busy ? (en ? "Selecting…" : "选择中…") : (en ? "Choose from image library" : "从图片库选择");
    reset.textContent = en ? "Restore default" : "恢复默认";
    pick.disabled = reset.disabled = busy || !allowed();
    retry.textContent = en ? "Retry loading" : "重新加载";
    retry.hidden = initialized || status !== "failed";
    retry.disabled = !alive;
    const video = /^video\//i.test(item?.image.mime ?? "");
    if (video !== (preview instanceof HTMLVideoElement)) {
      if (preview instanceof HTMLVideoElement) { preview.pause(); preview.removeAttribute("src"); preview.load(); }
      const next = video ? document.createElement("video") : document.createElement("img");
      next.className = "portal-art-preview";
      if (next instanceof HTMLVideoElement) { next.preload = "metadata"; next.muted = true; next.playsInline = true; }
      preview.replaceWith(next); preview = next;
    }
    const previewLabel = en ? "Current portal image" : "当前传送门图片";
    preview.setAttribute("aria-label", previewLabel);
    if (preview instanceof HTMLImageElement) preview.alt = previewLabel;
    const url = item?.image.url ?? defaultUrl;
    if (preview.getAttribute("src") !== url) preview.src = url;
    message.textContent = status === "failed" ? (en ? "Could not change the image. Try again." : "图片更换失败，请重试。") :
      status === "invalid" ? (en ? "Choose an image from your library." : "请选择图片库中的图片。") :
      status === "saved" ? (en ? "Saved. Links and trigger range are unchanged." : "已保存，链接和触发范围保持不变。") :
      en ? "Saves immediately; keeps links and trigger range." : "立即保存，保留链接和触发范围。";
  }
  async function change(fromLibrary: boolean) {
    if (!allowed() || busy) return;
    busy = true; status = ""; render();
    const request = epoch, valid = () => allowed() && request === epoch;
    try {
      // Keep this call directly in the click path: the host opens its own picker.
      const selected = fromLibrary ? (await OBR.assets.downloadImages(false))[0]?.image : await resolveDefaultPortalImage();
      if (!valid() || !selected) return; // Native picker cancellation is a no-op.
      const image = readLibraryImage(selected);
      if (!image) { status = "invalid"; return; }
      let applied = false;
      const currentRole = await OBR.player.getRole();
      if (!valid() || currentRole !== "GM") return;
      await OBR.scene.items.updateItems([portalId], drafts => {
        if (!valid()) return;
        for (const draft of drafts) {
          if (draft.id !== portalId || !isPortalImage(draft)) continue;
          applyPortalImage(draft, image); applied = true;
        }
      });
      if (valid() && applied) {
        const latest = (await OBR.scene.items.getItems([portalId]))[0];
        if (valid()) { item = isPortalImage(latest) ? latest : undefined; status = item ? "saved" : ""; }
      }
    } catch (error) {
      if (valid()) { status = "failed"; console.warn("[portals] image change failed", error); }
    } finally { if (alive) { busy = false; render(); } }
  }
  pick.addEventListener("click", () => { void change(true); });
  reset.addEventListener("click", () => { void change(false); });
  const unsubs = [
    OBR.player.onChange(player => { if (!alive) return; roleRevision++; if (role !== player.role) { epoch++; role = player.role; render(); } }),
    OBR.scene.onReadyChange(value => { if (!alive) return; readyRevision++; itemRevision++; epoch++; sceneValid = false; ready = value; item = undefined; render(); }),
    OBR.scene.items.onChange(items => {
      if (!alive) return;
      itemRevision++;
      const previousUrl = item?.image.url;
      const next = items.find(next => next.id === portalId);
      if (!isPortalImage(next)) { epoch++; item = undefined; } else item = next;
      if (previousUrl !== item?.image.url) render();
    }),
  ];
  function initialize() {
    if (!alive) return;
    status = ""; render();
    const loadingRole = roleRevision, loadingReady = readyRevision, loadingItem = itemRevision;
    void Promise.all([OBR.player.getRole(), OBR.scene.isReady(), OBR.scene.items.getItems([portalId])]).then(([currentRole, isReady, items]) => {
      if (!alive) return;
      if (roleRevision === loadingRole) role = currentRole;
      if (readyRevision === loadingReady) ready = isReady;
      if (itemRevision === loadingItem) item = isPortalImage(items[0]) ? items[0] : undefined;
      initialized = true; render();
    }).catch(() => { if (alive) { status = "failed"; render(); } });
  }
  retry.addEventListener("click", initialize);
  initialize();
  function dispose() { if (!alive) return; alive = false; epoch++; for (const off of unsubs) off(); window.removeEventListener("pagehide", dispose); render(); if (preview instanceof HTMLVideoElement) { preview.pause(); preview.removeAttribute("src"); preview.load(); } }
  window.addEventListener("pagehide", dispose, { once: true });
  render();
  return { setLanguage(next: string) { language = next; render(); }, dispose };
}
