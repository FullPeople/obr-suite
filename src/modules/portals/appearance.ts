import type { Image, ImageContent, Item } from "@owlbear-rodeo/sdk";
import { PORTAL_KEY } from "./types";

export const PORTAL_ICON_SIZE = 64;
export function isPortalImage(item: Item | undefined): item is Image {
  return item?.type === "IMAGE" && !!item.metadata[PORTAL_KEY] && typeof item.metadata[PORTAL_KEY] === "object";
}
export function readLibraryImage(value: unknown): ImageContent | null {
  const image = value as Partial<ImageContent> | null;
  if (!image || typeof image.width !== "number" || !Number.isFinite(image.width) || image.width <= 0 || image.width > 100000 ||
      typeof image.height !== "number" || !Number.isFinite(image.height) || image.height <= 0 || image.height > 100000 ||
      typeof image.mime !== "string" || !/^(?:image\/|video\/(?:mp4|webm)$)/i.test(image.mime) || image.mime.length > 100 ||
      typeof image.url !== "string" || image.url.length > 8192) return null;
  try { if (!["https:", "http:"].includes(new URL(image.url).protocol)) return null; } catch { return null; }
  return { width: image.width, height: image.height, mime: image.mime, url: image.url };
}
export function defaultPortalImage(url: string): ImageContent {
  return { width: PORTAL_ICON_SIZE, height: PORTAL_ICON_SIZE, mime: "image/svg+xml", url };
}
/** Fit the new artwork to the current largest image edge; preserve its aspect ratio.
 * Native grid DPI cancels out, so changing artwork requires no scene/grid roundtrip.
 * Position, rotation, label, metadata (including trigger radius) are untouched. */
export function applyPortalImage(item: Image, image: ImageContent): void {
  const oldEdge = Math.max(item.image.width * Math.abs(item.scale.x), item.image.height * Math.abs(item.scale.y));
  const cells = oldEdge / item.grid.dpi;
  if (!Number.isFinite(cells) || cells <= 0) throw Error("Invalid portal image geometry");
  item.image = { ...image };
  item.grid = { dpi: Math.max(image.width, image.height), offset: { x: image.width / 2, y: image.height / 2 } };
  item.scale = { x: item.scale.x < 0 ? -cells : cells, y: item.scale.y < 0 ? -cells : cells };
}
/** The old migration matched every custom URL. Only repair known bundled assets. */
export function needsPortalIconMigration(item: Item, defaultUrl: string): boolean {
  if (!isPortalImage(item)) return false;
  const raw = item.image.url;
  try {
    const target = new URL(defaultUrl), source = new URL(raw, target);
    const ownOrigin = source.origin === target.origin || source.origin === "https://obr.dnd.center";
    const bundledPath = /^\/(?:suite(?:-dev)?\/)?portal-icon\.svg$/.test(source.pathname);
    return ownOrigin && bundledPath && (raw !== defaultUrl || item.image.width !== PORTAL_ICON_SIZE || item.image.height !== PORTAL_ICON_SIZE);
  } catch { return false; }
}
export function migratePortalIconDraft(item: Item, defaultUrl: string): void {
  if (!needsPortalIconMigration(item, defaultUrl) || !isPortalImage(item)) return;
  item.image = defaultPortalImage(defaultUrl);
}
