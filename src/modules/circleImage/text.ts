// UI-owned copy only. Image pixels and host error details are never translated.
const TEXT = {
  title: { zh: "图片处理", en: "Image editor" },
  close: { zh: "关闭", en: "Close" },
  circle: { zh: "圆形裁剪", en: "Circle crop" },
  bgremove: { zh: "白底黑底剔除", en: "Remove background" },
  drop: { zh: "拖入图片 / 点击选择 / Ctrl+V 粘贴", en: "Drop an image / click to choose / paste with Ctrl+V" },
  formats: { zh: "支持 JPG / PNG / WebP / SVG，最大 10 MB", en: "JPG / PNG / WebP / SVG, up to 10 MB" },
  size: { zh: "大小", en: "Size" },
  zoom: { zh: "缩放", en: "Zoom" },
  ring: { zh: "环颜色", en: "Ring" },
  ringColor: { zh: "环颜色", en: "Ring color" },
  ringWidth: { zh: "环宽度", en: "Ring width" },
  background: { zh: "背景", en: "Background" },
  white: { zh: "剔除白底", en: "White" },
  black: { zh: "剔除黑底", en: "Black" },
  tolerance: { zh: "容差", en: "Tolerance" },
  feather: { zh: "羽化", en: "Feather" },
  replace: { zh: "换图", en: "Change image" },
  uploadHelp: { zh: "把当前裁剪结果上传到 OBR 资源库；之后可从资源库拖到场景使用", en: "Upload the edited image to your OBR library, then drag it from the library into a scene." },
  upload: { zh: "⤴ 添加到资源库", en: "⤴ Add to library" },
  uploading: { zh: "上传中…", en: "Uploading…" },
  uploaded: { zh: "✓ 已上传，从资源库拖入场景", en: "✓ Uploaded; drag from library" },
  fileType: { zh: "请选择图片文件（JPG / PNG / WebP / SVG）", en: "Choose an image file (JPG / PNG / WebP / SVG)." },
  fileSize: { zh: "图片大于 10 MB，太大了。先压缩一下吧。", en: "This image exceeds 10 MB. Compress it first." },
  imageFailed: { zh: "图片加载失败", en: "The image could not be loaded." },
  readFailed: { zh: "读取失败", en: "The file could not be read." },
  notReady: { zh: "OBR 还在初始化，稍后再试", en: "OBR is still starting. Try again shortly." },
  bakeFailed: { zh: "生成图片失败：", en: "Could not create the image: " },
  uploadFailed: { zh: "上传到资源库失败：", en: "Upload to library failed: " },
  circleName: { zh: "圆形图片", en: "Circle image" },
  bgremoveName: { zh: "去底图片", en: "Background removed" },
} as const;

export type ImageTextKey = keyof typeof TEXT;
export function imageText(language: "zh" | "en", key: ImageTextKey): string {
  return TEXT[key][language];
}
