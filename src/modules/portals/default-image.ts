import OBR, { type ImageContent } from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { defaultPortalImage, readLibraryImage } from "./appearance";

export const DEFAULT_IMAGE_KEY = "com.obr-suite/portals/default-image";
const cache = new Map<string, { expires: number; value: Promise<boolean> }>();

/** Load using the browser's media path: a CORS-blocked HEAD is not proof that an image is broken. */
export function imageAvailable(image: ImageContent): Promise<boolean> {
  const key = `${image.mime}:${image.url}`, existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.value;
  const entry = { expires: Date.now() + 15000, value: Promise.resolve(false) };
  entry.value = new Promise<boolean>(resolve => {
    const video = image.mime.startsWith("video/");
    const media = document.createElement(video ? "video" : "img");
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      media.removeEventListener(video ? "loadedmetadata" : "load", loaded);
      media.removeEventListener("error", failed);
      if (media instanceof HTMLVideoElement) { media.pause(); media.removeAttribute("src"); media.load(); }
      else media.removeAttribute("src");
      entry.expires = Date.now() + (ok ? 300000 : 15000); resolve(ok);
    };
    const loaded = () => done(true), failed = () => done(false);
    const timeout = setTimeout(failed, 1500);
    media.addEventListener(video ? "loadedmetadata" : "load", loaded);
    media.addEventListener("error", failed);
    if (media instanceof HTMLVideoElement) { media.preload = "metadata"; media.muted = true; }
    media.src = image.url;
  });
  if (cache.size > 24) cache.clear();
  cache.set(key, entry); return entry.value;
}

export async function resolveDefaultPortalImage(): Promise<ImageContent> {
  const fallback = defaultPortalImage(assetUrl("portal-icon.svg"));
  try {
    const selected = readLibraryImage((await OBR.room.getMetadata())[DEFAULT_IMAGE_KEY]);
    return selected && await imageAvailable(selected) ? selected : fallback;
  } catch { return fallback; }
}

/** No subscriptions survive a settings tab. Late native picker results cannot write after the tab closes. */
export function mountPortalDefault(parent: HTMLElement, language: string): void {
  const en = language === "en", room = OBR.room.id;
  const section = document.createElement("div"); section.className = "portal-default-art";
  section.innerHTML = `<h3>${en ? "Default portal image" : "默认传送门图片"}</h3><p>${en ? "New portals in this room use this image. An unavailable image falls back to the built-in portal." : "此房间新建的传送门使用这张图片。图片不可用时会自动使用内置传送门。"}</p><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><img alt="" width="56" height="56" style="object-fit:contain"><button type="button" class="btn" data-pick>${en ? "Choose from library" : "从图片库选择"}</button><button type="button" class="btn" data-reset>${en ? "Use built-in image" : "使用内置图片"}</button></div><p role="status" aria-live="polite"></p>`;
  parent.append(section);
  const preview = section.querySelector("img")!, status = section.querySelector<HTMLElement>('[role="status"]')!;
  const buttons = [...section.querySelectorAll<HTMLButtonElement>("button")];
  let busy = false, alive = true, permissionEpoch = 0, previewRevision = 0;
  const valid = () => alive && section.isConnected && OBR.room.id === room;
  const off = OBR.player.onChange(() => { permissionEpoch++; });
  const observer = new MutationObserver(() => { if (!section.isConnected) dispose(); });
  observer.observe(parent.ownerDocument.body, { childList: true, subtree: true });
  function dispose() { if (!alive) return; alive = false; off(); observer.disconnect(); window.removeEventListener("pagehide", dispose); }
  window.addEventListener("pagehide", dispose, { once: true });
  function showPreview(value: ImageContent | null) {
    const revision = previewRevision, fallback = assetUrl("portal-icon.svg");
    preview.hidden = false;
    preview.onerror = () => {
      if (!valid() || revision !== previewRevision) return;
      if (preview.getAttribute("src") !== fallback) { preview.src = fallback; return; }
      // A broken bundled fallback must not trigger an endless error loop.
      preview.onerror = null; preview.removeAttribute("src"); preview.hidden = true;
      status.textContent = en ? "The image preview is unavailable." : "图片预览暂时不可用。";
    };
    preview.src = value?.mime.startsWith("image/") ? value.url : fallback;
  }
  const initialPreview = previewRevision;
  void resolveDefaultPortalImage().then(value => {
    if (valid() && initialPreview === previewRevision) showPreview(value);
  });
  async function change(pick: boolean) {
    if (busy || !valid()) return;
    busy = true; buttons.forEach(button => button.disabled = true);
    const request = permissionEpoch;
    try {
      const selected = pick ? (await OBR.assets.downloadImages(false))[0]?.image : null;
      if (pick && !selected || !valid() || request !== permissionEpoch) return;
      const image = pick ? readLibraryImage(selected) : null;
      if (pick && !image) throw Error("Invalid library image");
      if (await OBR.player.getRole() !== "GM" || !valid() || request !== permissionEpoch) return;
      await OBR.room.setMetadata({ [DEFAULT_IMAGE_KEY]: image });
      if (!valid() || request !== permissionEpoch) return;
      previewRevision++;
      showPreview(image);
      status.textContent = en ? "Saved for new portals. Existing portals keep their images." : "已保存。新建传送门将使用此设置，已有传送门保留各自图片。";
    } catch { if (valid()) status.textContent = en ? "Could not save. Please retry." : "保存失败，请重试。"; }
    finally { busy = false; if (valid()) buttons.forEach(button => button.disabled = false); }
  }
  buttons[0].onclick = () => { void change(true); }; buttons[1].onclick = () => { void change(false); };
}
