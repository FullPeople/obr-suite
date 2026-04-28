import { Language } from "./state";

// Translation strings shared across all suite UI. Keep keys flat so it's
// easy to grep. Add a key once it's used in ≥2 places, or once it appears
// in user-facing copy that needs both languages.

type Dict = Record<string, { zh: string; en: string }>;

const TR: Dict = {
  // Cluster buttons
  btnTimeStop: { zh: "时停", en: "Time Stop" },
  btnFocus: { zh: "同步视口", en: "Sync Viewport" },
  btnBestiaryPopup: { zh: "怪物图鉴", en: "Bestiary" },
  btnCharCardPopup: { zh: "角色卡", en: "Character Card" },
  btnCharCardPanel: { zh: "角色卡界面", en: "Character Card Panel" },
  btnSettings: { zh: "设置", en: "Settings" },
  btnAbout: { zh: "关于", en: "About" },
  groupLabelPopups: { zh: "悬浮窗", en: "Auto Popup" },

  // Settings panel
  settingsTitle: { zh: "设置", en: "Settings" },
  settingsModules: { zh: "启用的功能", en: "Enabled Modules" },
  settingsDataVersion: { zh: "数据版本", en: "Data Version" },
  settingsLanguage: { zh: "语言", en: "Language" },
  settingsRoleNotice: {
    zh: "玩家端只读 · 由 DM 设置",
    en: "Read-only for players · Set by DM",
  },
  modTimeStop: { zh: "时停模式", en: "Time Stop" },
  modFocus: { zh: "同步视口", en: "Sync Viewport" },
  modBestiary: { zh: "怪物图鉴", en: "Bestiary" },
  modCharacterCards: { zh: "角色卡", en: "Character Cards" },
  modInitiative: { zh: "先攻追踪", en: "Initiative Tracker" },
  modSearch: { zh: "全局搜索", en: "Global Search" },
  modPortals: { zh: "传送门", en: "Portals" },
  ver2014: { zh: "2014（PHB + MM）", en: "2014 (PHB + MM)" },
  ver2024: { zh: "2024（XPHB + XMM）", en: "2024 (XPHB + XMM)" },
  verAll: { zh: "全部（2014 + 2024）", en: "All (2014 + 2024)" },
  langZh: { zh: "中文", en: "中文" },
  langEn: { zh: "English", en: "English" },
  searchAllowMonsters: {
    zh: "允许玩家查询怪物",
    en: "Players Can Search Monsters",
  },
  charCardEnWarning: {
    zh: "",
    en: "This module currently only supports the Chinese D&D community's xlsx character sheet format (悲灵 ver.). It is not useful for English players unless you create your own template.",
  },

  // About panel
  aboutTitle: { zh: "关于", en: "About" },
  tabSupport: { zh: "支持作者 / 反馈", en: "Support / Feedback" },
  tabTimeStop: { zh: "时停", en: "Time Stop" },
  tabFocus: { zh: "同步视口", en: "Sync Viewport" },
  tabBestiary: { zh: "怪物图鉴", en: "Bestiary" },
  tabCharacterCards: { zh: "角色卡", en: "Character Cards" },
  tabInitiative: { zh: "先攻追踪", en: "Initiative Tracker" },
  tabSearch: { zh: "全局搜索", en: "Global Search" },
  tabPortals: { zh: "传送门", en: "Portals" },
  supportBlurb: {
    zh: "如果这套插件对你的跑团有帮助，欢迎来支持一下作者 —— 用于服务器续费和新插件开发。",
    en: "If this suite helps your campaigns, please consider supporting the author — covers server costs and new plugin development.",
  },
  contactBlurb: {
    zh: "反馈或建议：",
    en: "Feedback / Suggestions:",
  },

  // Misc
  close: { zh: "关闭", en: "Close" },
  on: { zh: "开启", en: "On" },
  off: { zh: "关闭", en: "Off" },
};

export function t(lang: Language, key: keyof typeof TR): string {
  return TR[key]?.[lang] ?? key;
}

export function applyLangAttr(lang: Language) {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
}
