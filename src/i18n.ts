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

  // === Dice panel ===
  diceTabRoll: { zh: "投掷", en: "Roll" },
  diceTabCombos: { zh: "组合", en: "Combos" },
  diceTabHistory: { zh: "历史", en: "History" },
  diceSectDice: { zh: "骰子", en: "Dice" },
  diceSectExpression: { zh: "表达式", en: "Expression" },
  diceHintDicePm: {
    zh: "左键 + 1，右键 − 1。优势/劣势按钮填入表达式后点击「投掷」实际投骰",
    en: "Left-click +1, right-click −1. Advantage/Disadvantage buttons fill the expression — click Roll to actually roll.",
  },
  diceTitleDicePm: { zh: "左键 +1，右键 −1", en: "Left-click +1, right-click −1" },
  diceBtnAdv: { zh: "优势", en: "Adv" },
  diceBtnDis: { zh: "劣势", en: "Dis" },
  diceTitleAdv: {
    zh: "优势 = 投两次 d20，取较高（不会自动投掷）",
    en: "Advantage = roll d20 twice, keep higher (does not auto-roll)",
  },
  diceTitleDis: {
    zh: "劣势 = 投两次 d20，取较低（不会自动投掷）",
    en: "Disadvantage = roll d20 twice, keep lower (does not auto-roll)",
  },
  diceExprPlaceholder: {
    zh: "例如 2d6 + 1d20 + 5  或  adv(1d20) 等",
    en: "e.g. 2d6 + 1d20 + 5  or  adv(1d20)",
  },
  diceTitleModDec: { zh: "加值 -1", en: "Modifier -1" },
  diceTitleModInc: { zh: "加值 +1", en: "Modifier +1" },
  diceLabelPlaceholder: {
    zh: "备注（可选，例如 偷袭）",
    en: "Note (optional, e.g. Sneak Attack)",
  },
  diceBtnRoll: { zh: "投掷", en: "Roll" },
  diceBtnLast: { zh: "上一次", en: "Last" },
  diceBtnSaveCombo: { zh: "保存组合", en: "Save Combo" },
  diceBtnClear: { zh: "清空", en: "Clear" },
  diceBtnDarkRoll: { zh: "暗骰", en: "Dark Roll" },
  diceBtnForceClr: { zh: "⚠ 强制结束(若动画卡住)", en: "⚠ Force End (if stuck)" },
  diceRulesTitle: { zh: "表达式说明", en: "Expression Guide" },
  diceRule1: {
    zh: "：把若干种骰子和加值组合在一起一起投。",
    en: ": combine multiple dice types + modifiers into one roll.",
  },
  diceRule2: { zh: "：优势 — 投两次取较高的那次。", en: ": advantage — roll twice, keep higher." },
  diceRule3: { zh: "：劣势 — 投两次取较低的那次。", en: ": disadvantage — roll twice, keep lower." },
  diceRule4: {
    zh: "：最低保底 — 骰出来低于 10 时按 10 算。",
    en: ": floor — values below 10 are clamped to 10.",
  },
  diceRule5: {
    zh: "：最高封顶 — 骰出来高于 15 时按 15 算。",
    en: ": ceiling — values above 15 are clamped to 15.",
  },
  diceRule6: {
    zh: "：投到 12 时自动重投一次（只触发一次）。",
    en: ": triggered reroll — if value equals 12, reroll once.",
  },
  diceRule7: {
    zh: "：重复 3 次投，每次的总数单独显示。",
    en: ": repeat 3 times, each row shows its own total.",
  },
  diceRule8: {
    zh: "：当多颗骰子点数相同时，自动给重复的高亮一下。",
    en: ": highlight duplicate values across dice.",
  },
  diceRule9: {
    zh: "：术法爆发 — 骰子掷到最大点会再追加一颗。",
    en: ": exploding dice — rolling max adds another die.",
  },
  diceRule10: {
    zh: "支持非标骰，比如",
    en: "Non-standard dice are supported, e.g.",
  },
  diceRule10b: {
    zh: "。中文括号",
    en: ". Full-width parentheses",
  },
  diceRule10c: {
    zh: "、逗号",
    en: " and comma",
  },
  diceRule10d: {
    zh: "也能识别。",
    en: " are also recognized.",
  },
  diceExamplesTitle: { zh: "示例（点击填入表达式）", en: "Examples (click to fill expression)" },
  diceExampleElven: { zh: "精灵之准", en: "Elven Accuracy" },
  diceExampleBurst: { zh: "术法爆发", en: "Spell Burst" },
  diceComboEmpty: {
    zh: "还没有保存的组合<br>在「投掷」标签里组好骰子后点「保存组合」",
    en: "No saved combos yet.<br>Set up dice in the Roll tab, then click Save Combo.",
  },
  diceHistoryEmpty: { zh: "还没有掷骰记录", en: "No roll history yet" },
  diceHistoryAll: { zh: "全部", en: "All" },
  diceComboBtnRoll: { zh: "投掷", en: "Roll" },
  diceComboBtnDark: { zh: "暗骰", en: "Dark" },
  diceComboBtnEdit: { zh: "编辑", en: "Edit" },
  diceComboBtnDel: { zh: "删除", en: "Delete" },
  diceJustNow: { zh: "刚刚", en: "just now" },
  diceAgoS: { zh: "s 前", en: "s ago" },
  diceAgoMin: { zh: "min 前", en: "min ago" },
  diceAgoH: { zh: "h 前", en: "h ago" },
  diceAgoD: { zh: "d 前", en: "d ago" },
  diceShakeAnim: { zh: "动画进行中…", en: "Animation in progress…" },
  diceShakeParse: { zh: "表达式无法解析", en: "Cannot parse expression" },
  diceShakeEmpty: { zh: "请先输入表达式", en: "Enter an expression first" },
  diceShakeNoToken: { zh: "请先选中角色", en: "Select a token first" },
  diceComboPrompt: { zh: "组合名称：", en: "Combo name:" },
  diceConfirmClearHistory: { zh: "清空所有掷骰历史？", en: "Clear all roll history?" },
  diceRollerFallback: { zh: "投骰人", en: "Roller" },

  // === Dice history popover ===
  diceHistTitle: { zh: "投骰记录", en: "Dice History" },
  diceHistDismissTitle: { zh: "隐藏到下次投骰", en: "Hide until next roll" },
  diceHistEmpty: { zh: "还没人投骰", en: "Nobody has rolled yet" },
  diceHistPlayer: { zh: "玩家", en: "Player" },
  diceHistBack: { zh: "← 返回", en: "← Back" },
  diceHistDarkTag: { zh: "暗", en: "DARK" },
  diceHistColl: { zh: "集体", en: "Group" },
  diceHistCount: { zh: "位", en: " " },
  diceHistTimes: { zh: "次", en: "rolls" },
  diceHistNoEntries: { zh: "（无记录）", en: "(no entries)" },
  diceHistEmptyDetail: { zh: "该玩家还没有投过", en: "No rolls from this player" },

  // === Dice replay overlay ===
  diceReplayHint: {
    zh: "点击气泡或再次点击词条关闭",
    en: "Click bubble or click row again to close",
  },

  // === Dice rollable context menu ===
  diceMenuRoll: { zh: "投掷", en: "Roll" },
  diceMenuDark: { zh: "暗骰", en: "Dark Roll" },
  diceMenuAdv: { zh: "优势", en: "Advantage" },
  diceMenuDis: { zh: "劣势", en: "Disadvantage" },
  diceMenuTray: { zh: "添加到骰盘", en: "Add to Tray" },

  // === Portals ===
  portalTitle: { zh: "传送门", en: "Portal" },
  portalToolName: { zh: "传送门", en: "Portal" },
  portalToolHint: { zh: "画圈创建传送门", en: "Drag to create a portal" },
  portalNew: { zh: "新建传送门", en: "New Portal" },
  portalEdit: { zh: "编辑传送门", en: "Edit Portal" },
  portalLblName: { zh: "名字", en: "Name" },
  portalLblTag: { zh: "标签（同标签互联）", en: "Tag (same tag = linked)" },
  portalLblNamePresets: { zh: "名字预设", en: "Name Presets" },
  portalLblTagPresets: { zh: "标签预设", en: "Tag Presets" },
  portalAdd: { zh: "+ 添加", en: "+ Add" },
  portalAddBtn: { zh: "添加", en: "Add" },
  portalNewName: { zh: "新名字", en: "New name" },
  portalNewTag: { zh: "新标签", en: "New tag" },
  portalNamePh: { zh: "例如 一楼", en: "e.g. 1F" },
  portalTagPh: { zh: "例如 001", en: "e.g. 001" },
  portalDel: { zh: "删除传送门", en: "Delete Portal" },
  portalCancel: { zh: "取消", en: "Cancel" },
  portalSave: { zh: "保存", en: "Save" },
  portalConfirmDel: { zh: "确定删除该传送门？", en: "Delete this portal?" },
  portalUnnamed: { zh: "(未命名)", en: "(unnamed)" },
  portalDestSelect: { zh: "选择目的地", en: "Select destination" },
  portalDestUnits: { zh: "个单位", en: "unit(s)" },
  portalDestNoMatch: { zh: "没有同标签的其它传送门", en: "No other portals with the same tag" },
  portalDestHidden: { zh: "隐藏", en: "Hidden" },

  // === Character card bind ===
  ccBindTitle: { zh: "绑定角色卡", en: "Bind Character Card" },
  ccBindUnbind: { zh: "解绑", en: "Unbind" },
  ccBindLoading: { zh: "加载中…", en: "Loading…" },
  ccBindFoot: {
    zh: "选择一张卡绑定到该角色，单选该角色时自动弹出信息",
    en: "Pick a card to bind. The info popup opens when the token is selected.",
  },
  ccBindCurrent: { zh: "当前", en: "Current" },
  ccBindCardDeleted: { zh: "(卡已删除)", en: "(card deleted)" },
  ccBindNoCards: {
    zh: "这个场景还没有上传任何角色卡",
    en: "No character cards uploaded in this scene yet",
  },
  ccBindUploadHint: {
    zh: "先去右下角",
    en: "Drop a .xlsx into the right rail of the",
  },
  ccBindUploadHint2: {
    zh: "面板的右侧栏拖一张 .xlsx 上来",
    en: "panel.",
  },

  // === Character card panel ===
  ccPanelTitle: { zh: "角色卡", en: "Character Cards" },
  ccPanelDownloadTpl: { zh: "下载模板", en: "Template" },
  ccPanelDownloadTplTitle: {
    zh: "下载本插件支持的悲灵 v1.0.12 角色卡模板（xlsx）",
    en: "Download the supported xlsx character-sheet template (悲灵 v1.0.12)",
  },
  ccPanelClose: { zh: "关闭 (Esc)", en: "Close (Esc)" },
  ccPanelDragHint: { zh: "拖拽 xlsx 到此处上传，或", en: "Drag xlsx here to upload, or" },
  ccPanelChooseFile: { zh: "📁 选择文件", en: "📁 Choose File" },
  ccPanelChooseFileTitle: {
    zh: "打开本地文件选择器上传 xlsx",
    en: "Open local file picker to upload xlsx",
  },
  ccPanelRefreshHint: {
    zh: "每张卡片旁的 ↻ 可重新选择 xlsx 覆盖更新",
    en: "Click ↻ next to a card to re-pick xlsx and overwrite",
  },
  ccPanelEmpty: { zh: "从右侧选择一张角色卡", en: "Select a character card from the right" },
  ccPanelEmpty2: { zh: "拖拽 xlsx 到右侧栏上传", en: "Drag xlsx onto the right rail to upload" },
  ccPanelMiniTitle: { zh: "角色卡面板", en: "Character Card Panel" },
  ccPanelUploading: { zh: "⏳ 上传中…", en: "⏳ Uploading…" },
  ccPanelUploaded: { zh: "已上传", en: "Uploaded" },
  ccPanelUploadFailed: { zh: "上传失败", en: "Upload failed" },
  ccPanelOnlyXlsx: { zh: "只支持 .xlsx 文件", en: "Only .xlsx files are supported" },
  ccPanelRefreshed: { zh: "已刷新", en: "Refreshed" },
  ccPanelRefreshFailed: { zh: "刷新失败", en: "Refresh failed" },
  ccPanelEmpty3: {
    zh: "还没有角色卡\n拖拽 xlsx 到左侧上传",
    en: "No character cards yet.\nDrag xlsx to the panel to upload.",
  },
  ccPanelNoCards: { zh: "暂无角色卡", en: "No character cards" },
  ccPanelRefreshTitle: { zh: "从最新的 xlsx 重新加载", en: "Reload from the latest xlsx" },
  ccPanelDeleteTitle: { zh: "删除", en: "Delete" },
  ccPanelDeleteConfirm: { zh: "删除", en: "Delete" },
  ccPanelMinAgo: { zh: "分钟前", en: " min ago" },
  ccPanelHourAgo: { zh: "小时前", en: " h ago" },
  ccPanelDayAgo: { zh: "天前", en: " d ago" },
  ccPanelJustNow: { zh: "刚刚", en: "just now" },

  // === Search bar ===
  searchPlaceholder: {
    zh: "搜索 5etools…（怪物/法术/物品/职业/种族…）",
    en: "Search 5etools… (monsters/spells/items/classes/races…)",
  },
  searchClearAria: { zh: "清空", en: "Clear" },

  // === Bestiary panel (UI chrome bits) ===
  bestiaryPanelOnlyDM: { zh: "仅 DM 可用", en: "DM only" },
  bestiaryPanelHint: {
    zh: "点击下方怪物以绑定到所选 token（覆盖当前数据 / HP / AC）",
    en: "Click a monster below to bind to the selected token (overwrites data / HP / AC)",
  },
  bestiarySearchPh: {
    zh: "搜索怪物名称/类型/CR...",
    en: "Search monsters by name / type / CR…",
  },
  bestiaryClearSearch: { zh: "清空搜索", en: "Clear search" },
  bestiaryLoading: { zh: "加载中...", en: "Loading…" },
  bestiarySortByCR: { zh: "按CR排序", en: "Sort by CR" },
  bestiaryNoMatch: { zh: "未找到匹配的怪物", en: "No matching monsters" },
};

export function t(lang: Language, key: keyof typeof TR): string {
  return TR[key]?.[lang] ?? key;
}

export function applyLangAttr(lang: Language) {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
}

// Walk the document and translate every element carrying a data-i18n*
// attribute. Iframe pages call this once at startup (and again after
// language change). Supported attrs:
//   data-i18n            → element.textContent
//   data-i18n-html       → element.innerHTML (use for keys with <br> etc.)
//   data-i18n-placeholder→ input/textarea placeholder
//   data-i18n-title      → element title attribute
//   data-i18n-aria       → aria-label attribute
export function applyI18nDom(lang: Language, root: Document | HTMLElement = document) {
  applyLangAttr(lang);
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n as keyof typeof TR | undefined;
    if (key && TR[key]) el.textContent = t(lang, key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    const key = el.dataset.i18nHtml as keyof typeof TR | undefined;
    if (key && TR[key]) el.innerHTML = t(lang, key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder as keyof typeof TR | undefined;
    if (key && TR[key]) (el as HTMLInputElement).placeholder = t(lang, key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const key = el.dataset.i18nTitle as keyof typeof TR | undefined;
    if (key && TR[key]) el.title = t(lang, key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    const key = el.dataset.i18nAria as keyof typeof TR | undefined;
    if (key && TR[key]) el.setAttribute("aria-label", t(lang, key));
  });
}
