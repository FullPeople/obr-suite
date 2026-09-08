import { getLocalLang } from "../../state";
const text = {
  title: ["Boss 血条", "Boss health bar"], show: ["显示为 Boss", "Show as Boss"], hide: ["隐藏 Boss 血条", "Hide Boss bar"],
  configure: ["Boss 显示选项", "Boss display options"], exact: ["公开精确生命值", "Show exact health to everyone"],
  phase: ["阶段名称（可不填）", "Phase name (optional)"], segments: ["血条分段", "Bar segments"],
  noSegments: ["不分段", "No dividers"], save: ["保存", "Save"], close: ["关闭", "Close"], saved: ["已保存", "Saved"],
  missing: ["单位已隐藏、删除或生命值未设置", "Token hidden, removed, or missing health"],
  needHp: ["请先给可见单位设置当前及最大生命值。", "Set current and maximum health on a visible token first."],
  limit: ["最多同时显示 3 个 Boss，请先隐藏一个。", "Up to 3 Bosses can be shown. Hide one first."],
  failed: ["操作失败，请重试。", "Could not save. Please try again."],
  gmOnly: ["仅 DM 可以设置 Boss 显示。", "Only the GM can configure Boss display."],
  localHide: ["仅在本机隐藏（可在设置中恢复）", "Hide on this device (restore in Settings)"],
  loading: ["正在读取…", "Loading…"], emptyName: ["无名首领", "Unnamed Boss"],
  hpHint: ["同步单位现有生命值。分段仅作视觉标记，不会改变生命值或自动切换阶段。", "Uses the token’s existing health. Dividers are visual markers; they do not change health or advance phases."],
  defeated: ["已击败", "Defeated"],
} as const;
export function t(key: keyof typeof text): string { return text[key][getLocalLang() === "en" ? 1 : 0]; }
