import type { Item } from '@owlbear-rodeo/sdk';

/** Resolve the visible image ellipse in scene units, including its anchor. */
export function portalGeometry(item: Item, sceneDpi: number, fallbackRadius = 70) {
  const image = item as any;
  const radians = (Number.isFinite(item.rotation) ? item.rotation : 0) * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  if (item.type !== 'IMAGE' || !Number.isFinite(image.grid?.dpi) || image.grid.dpi <= 0 ||
      !Number.isFinite(image.image?.width) || image.image.width <= 0 || !Number.isFinite(image.image?.height) || image.image.height <= 0) {
    return { center: item.position, rx: fallbackRadius, ry: fallbackRadius, cos, sin };
  }
  const unit = sceneDpi / image.grid.dpi;
  const x = (image.image.width / 2 - (Number.isFinite(image.grid.offset?.x) ? image.grid.offset.x : image.image.width / 2)) * unit * item.scale.x;
  const y = (image.image.height / 2 - (Number.isFinite(image.grid.offset?.y) ? image.grid.offset.y : image.image.height / 2)) * unit * item.scale.y;
  return { center: { x: item.position.x + x * cos - y * sin, y: item.position.y + x * sin + y * cos },
    rx: Math.abs(image.image.width * unit * item.scale.x) / 2,
    ry: Math.abs(image.image.height * unit * item.scale.y) / 2, cos, sin };
}

export function insidePortal(point: { x: number; y: number }, geometry: ReturnType<typeof portalGeometry>) {
  const { center, rx, ry, cos, sin } = geometry;
  if (!(rx > 0 && ry > 0)) return false;
  const x = point.x - center.x, y = point.y - center.y;
  return ((x * cos + y * sin) / rx) ** 2 + ((-x * sin + y * cos) / ry) ** 2 <= 1 + 1e-9;
}
