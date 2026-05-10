// Circle-image plugin — shared constants.
//
// User flow (changed 2026-05-08):
//   1. GM clicks the toolbar icon → cropper popover opens.
//   2. User drops / picks an image, switches between 圆形裁剪 and
//      白底黑底剔除 tabs, configures the result, then clicks
//      "添加到资源库".
//   3. Popover bakes the canvas to a PNG Blob and calls
//      OBR.assets.uploadImages — the asset lands in the user's
//      OBR library. From there the user drags it to the scene with
//      OBR's native library-drag gesture.
//
// History note: an earlier design tried to spawn the Image item
// directly from a `data:image/png;base64,...` URL with
// `OBR.scene.items.addItems` (preserving a drag-from-popover-to-
// canvas drop position). OBR silently rejects data URLs in
// `image.url` — the diagnostic logs showed `addItems failed` every
// time. uploadImages is the only supported path for getting a
// locally-generated image into an OBR scene.

export const PLUGIN_ID = "com.obr-suite/circleimage";
export const POPOVER_ID = `${PLUGIN_ID}/editor`;
