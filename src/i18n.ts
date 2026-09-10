import type { Language } from "./state";
import { PORTAL_I18N } from "./i18n-portal";
export type { Language } from "./state";

// Translation strings shared across all suite UI. Keep keys flat so it's
// easy to grep. Add a key once it's used in ≥2 places, or once it appears
// in user-facing copy that needs both languages.

type Dict = Record<string, { zh: string; en: string }>;

const TR: Dict = {
  // The portals module needs three of these on the BOOT path, and
  // pulling this whole file in for them cost every client 46 kB before
  // startup. They live in their own module now and are spread back in
  // here, so this is still the one place to look up any suite string.
  // See i18n-portal.ts.
  ...PORTAL_I18N,

  // Cluster buttons
  btnTimeStop: { zh: "时停", en: "Time Stop" },
  btnFocus: { zh: "同步视口", en: "Sync Viewport" },
  btnMusic: { zh: "音乐", en: "Music" },
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
  diceTabSkins: { zh: "皮肤", en: "Skins" },
  diceSectDice: { zh: "骰子", en: "Dice" },
  diceSectExpression: { zh: "表达式", en: "Expression" },
  diceHintDicePm: {
    zh: "左键 + 1，右键 − 1。优势/劣势按钮填入表达式后点击「投掷」实际投骰",
    en: "Left-click +1, right-click −1. Advantage/Disadvantage buttons fill the expression — click Roll to actually roll.",
  },
  diceTitleDicePm: { zh: "左键 +1，右键 −1", en: "Left-click +1, right-click −1" },
  diceBtnAdv: { zh: "优势", en: "Adv" },
  diceBtnDis: { zh: "劣势", en: "Dis" },
  diceBtnCrit: { zh: "重击", en: "Crit" },
  diceTitleAdv: {
    zh: "优势 = 投两次 d20，取较高（不会自动投掷）",
    en: "Advantage = roll d20 twice, keep higher (does not auto-roll)",
  },
  diceTitleDis: {
    zh: "劣势 = 投两次 d20，取较低（不会自动投掷）",
    en: "Disadvantage = roll d20 twice, keep lower (does not auto-roll)",
  },
  diceTitleCrit: {
    zh: "重击 = 把表达式里所有骰子数量翻倍（加值不变）。点击应用，再次点击取消。",
    en: "Critical = double every dice term in the expression (modifier unchanged). Click to apply; click again to undo.",
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
  diceBtnDarkRollGlobalOn: { zh: "全局暗骰：开", en: "Global Dark: ON" },
  diceBtnDarkRollGlobalOff: { zh: "全局暗骰：关", en: "Global Dark: OFF" },
  diceBtnDarkRollGlobalTitle: {
    zh: "开启后，所有普通投掷都会自动变为暗骰（包括组合面板的投掷按钮）。仅 DM 可见。",
    en: "When ON, all normal rolls (including combo panel roll buttons) are auto-treated as Dark Rolls. DM only.",
  },
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
  diceRuleResetMin: {
    zh: "：投到 ≤5 时自动重投一次（只触发一次）。",
    en: ": triggered reroll — if value ≤ 5, reroll once.",
  },
  diceRuleResetMax: {
    zh: "：投到 ≥18 时自动重投一次（只触发一次）。",
    en: ": triggered reroll — if value ≥ 18, reroll once.",
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
  diceHistoryReplayTooltip: { zh: "点击：在 token 上回放气泡", en: "Click: replay bubble over the token" },
  diceComboBtnRoll: { zh: "投掷", en: "Roll" },
  diceComboBtnDark: { zh: "暗骰", en: "Dark" },
  diceComboBtnCrit: { zh: "重击", en: "Crit" },
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
  diceComboCatPrompt: { zh: "分类（留空 = 未分类）：", en: "Category (blank = uncategorized):" },
  diceComboCatUncategorized: { zh: "未分类", en: "Uncategorized" },
  diceComboCatNew: { zh: "+ 新分类", en: "+ New category" },
  diceComboCatRename: { zh: "重命名分类", en: "Rename category" },
  diceComboCatDelete: { zh: "删除分类（组合移到未分类）", en: "Delete category (combos move to Uncategorized)" },
  diceComboCatNewPrompt: { zh: "新分类名：", en: "New category name:" },
  diceComboCatRenamePrompt: { zh: "新名称：", en: "New name:" },
  diceComboCatChangePrompt: { zh: "移动到哪个分类？", en: "Move to which category?" },
  diceComboCatLabel: { zh: "分类", en: "Category" },
  diceComboDragHint: { zh: "拖动手柄可以重新排序 / 跨分类移动", en: "Drag the handle to reorder / move across categories" },
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
  portalLockTitle: { zh: "锁定 / 解锁此传送门", en: "Lock / Unlock this portal" },
  portalConfirmDel: { zh: "确定删除该传送门？", en: "Delete this portal?" },
  portalDestSelect: { zh: "选择目的地", en: "Select destination" },
  portalDestUnits: { zh: "个单位", en: "unit(s)" },
  portalDestNoMatch: { zh: "没有同标签的其它传送门", en: "No other portals with the same tag" },
  portalDestHidden: { zh: "隐藏", en: "Hidden" },
  portalBlinkLabel: { zh: "传送眨眼特效", en: "Teleport Blink Effect" },
  portalBlinkDesc: {
    zh: "本机偏好。开启后传送瞬间播放闭眼/睁眼动画，闭眼时刻执行实际传送，因此略慢；关闭则直接平滑过场。",
    en: "Per-client preference. When on, picking a destination plays a close-eye / open-eye animation with the actual teleport happening at the closed moment — slightly slower. Off = immediate smooth pan.",
  },

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
  ccPanelDownloadTpl2014: { zh: "2014 模板", en: "2014 sheet (Chinese)" },
  ccPanelDownloadTpl2014Title: {
    zh: "下载 5E2014 中文角色卡模板（悲灵 · 弗人 · 枭熊适配版）",
    en: "Download the 2014 Chinese XLSX sheet (Belling · FullPeople · Owlbear-adapted)",
  },
  ccPanelDownloadTpl2024: { zh: "2024 模板", en: "2024 sheet (Chinese)" },
  ccPanelDownloadTpl2024Title: {
    zh: "下载 5E2024 中文角色卡模板（悲灵 · 弗人 · 枭熊适配版）",
    en: "Download the 2024 Chinese XLSX sheet (Belling · FullPeople · Owlbear-adapted)",
  },
  ccPanelVisibilityDm: { zh: "仅 DM 可见", en: "DMs only" },
  ccPanelVisibilityOwners: { zh: "DM 和指定玩家可见", en: "DMs and assigned players" },
  ccPanelMakePublic: { zh: "点击改为公开", en: "Make public" },
  ccPanelVisibilityPublic: { zh: "公开", en: "Public" },
  ccPanelMakePrivate: { zh: "点击改为仅 DM 可见", en: "Make visible to DMs only" },
  ccPanelLoadFailed: { zh: "角色卡列表读取失败。", en: "Could not load the character card list." },
  ccPanelLoading: { zh: "正在读取角色卡…", en: "Loading character cards…" },
  ccPanelOpenScene: { zh: "打开场景后即可查看角色卡。", en: "Open a scene to view character cards." },
  ccPanelRetry: { zh: "重试", en: "Retry" },
  ccPanelWriteUnavailable: { zh: "请等待场景和角色卡列表加载完成后再试。", en: "Wait for the scene and character card list to load, then try again." },
  ccPanelWriteCancelled: { zh: "操作已停止。已发送的请求可能已完成，请确认原场景中的结果后再试。", en: "This operation stopped. A request already sent may have completed; check the original scene before trying again." },
  ccPanelWriteFailed: { zh: "角色卡更新失败", en: "Could not update the character card" },
  ccPanelCloseFailed: { zh: "窗口关闭失败，请再试一次。", en: "Could not close the window. Please try again." },
  ccPanelClose: { zh: "关闭 (Esc)", en: "Close (Esc)" },
  ccPanelDragHint: { zh: "拖拽 xlsx 到此处上传，或", en: "Drag xlsx here to upload, or" },
  ccPanelChooseFile: { zh: "📁 选择文件", en: "📁 Choose File" },
  ccPanelChooseFileTitle: {
    zh: "打开本地文件选择器上传 xlsx",
    en: "Open local file picker to upload xlsx",
  },
  // 2026-05-26 — preview entry points right below 选择文件.
  ccPanelViewSample: { zh: "👁 查看示例", en: "👁 View Example" },
  ccPanelViewSampleTitle: {
    zh: "打开一份内置的示例角色卡（只读）",
    en: "Open a bundled example character card (read-only)",
  },
  ccPanelPasteJson: { zh: "📋 粘贴 JSON", en: "📋 Paste JSON" },
  ccPanelPasteJsonTitle: {
    zh: "粘贴角色卡 JSON，确认后上传并添加到当前场景",
    en: "Paste character card JSON, then confirm to upload and add it to the current scene",
  },
  ccPasteJsonModalTitle: { zh: "粘贴角色卡 JSON", en: "Paste Character Card JSON" },
  ccPasteJsonHint: {
    zh: "粘贴角色卡 JSON。点击“创建角色卡”后，会上传并添加到当前场景，默认向所有玩家显示。",
    en: "Paste character card JSON. Create Card uploads it and adds it to the current scene, visible to all players by default.",
  },
  ccPasteJsonApply: { zh: "创建角色卡", en: "Create Card" },
  ccPasteJsonApplying: { zh: "导入中…", en: "Importing…" },
  ccPasteJsonCancel: { zh: "取消", en: "Cancel" },
  ccPasteJsonInvalid: {
    zh: "无效的 JSON（应为角色卡 schema，至少含 abilities 或 identity 字段）",
    en: "Invalid JSON (expected a character-card schema with at least abilities or identity)",
  },
  // Read-only badge shown on the preview card in cc-fullscreen.
  // 2026-05-26 — dropped "中文"/"Chinese" qualifier now that each
  // language has its own dedicated example (zh→本杰明, en→Benjamin
  // Flamingo). The badge just says "Example" because the sample
  // matches the UI language naturally.
  ccPreviewBadgeSample: { zh: "示例 · 只读", en: "Example · Read-only" },
  ccPreviewBadgePaste: { zh: "粘贴预览 · 只读", en: "Pasted Preview · Read-only" },
  ccPreviewMissingPayload: {
    zh: "未找到预览数据 —— 请回到角色卡面板重新点击「查看示例」或「粘贴 JSON」。",
    en: "No preview payload found — go back to the character card panel and click 'View Example' or 'Paste JSON' again.",
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
  ccPanelUploadHint: {
    zh: "请检查：① 角色卡版本是否受支持（v1.0.12 即 2024 / v1.0.12-2014mode 即 2014 悲灵卡）；② 角色卡内是否嵌入了损坏 / 超大图片（先在 Excel 里删除图片再上传）。",
    en: "Please check: (1) sheet version is supported (v1.0.12 = 2024 / v1.0.12-2014mode = 2014 悲灵 sheets); (2) no broken or oversized embedded images (remove images in Excel first, then re-upload).",
  },
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

  // Music board (popover) — player-facing, so fully bilingual.
  mbTitle: { zh: "音乐板", en: "Music Board" },
  mbMinimize: { zh: "收起到小条，保留音乐和配对", en: "Minimize (keeps music + pairing)" },
  mbDragExpand: { zh: "拖动音乐板，点击唱片展开", en: "Drag to move · click the disc to expand" },
  mbDiscExpand: { zh: "点击唱片展开音乐板", en: "Click the disc to expand" },
  mbStatusIdle: { zh: "空闲", en: "Idle" },
  mbStatusPlaying: { zh: "正在播放", en: "Playing" },
  mbStatusPaused: { zh: "已暂停", en: "Paused" },
  mbNoBgm: { zh: "没有 BGM 在播放", en: "No BGM playing" },
  mbUnnamedBgm: { zh: "未命名 BGM", en: "Untitled BGM" },
  mbMuteSelf: { zh: "静音（仅自己）", en: "Mute (only me)" },
  mbPairTitle: { zh: "接入网页音乐板", en: "Connect to web Music Studio" },
  mbPairCodePh: { zh: "网页那边的 6 位配对码", en: "6-char pair code from the web" },
  mbConnect: { zh: "连接", en: "Connect" },
  mbDisconnect: { zh: "断开", en: "Disconnect" },
  mbPairHint: {
    zh: "在 <a href=\"https://obr.dnd.center/studio/music-studio/\" target=\"_blank\">obr.dnd.center/studio/music-studio/</a> 点「配对枭熊」拿到配对码，粘到这里。<br>连接后网页里的所有播放/暂停操作会同步到所有<b>已打开本面板</b>的玩家。<br><b>提示</b>：关闭此弹窗会停止音乐 + 断开配对。要保留请点右上角「−」收起到小条。",
    en: "At <a href=\"https://obr.dnd.center/studio/music-studio/\" target=\"_blank\">obr.dnd.center/studio/music-studio/</a> click \"Pair\" to get a code, paste it here.<br>Once connected, every play/pause on the web syncs to all players who have <b>opened this panel</b>.<br><b>Note</b>: closing this popover stops the music + unpairs. To keep it, use the \"−\" minimize button.",
  },
  // pair status (dynamic)
  mbStLoadingPeer: { zh: "加载 PeerJS…", en: "Loading PeerJS…" },
  mbStSignaling: { zh: "连接信令…", en: "Connecting signal…" },
  mbStConnecting: { zh: "连接中…", en: "Connecting…" },
  mbStDialing: { zh: "拨号", en: "Dialing" },
  mbStConnectedTo: { zh: "已连接", en: "Connected" },
  mbStDisconnected: { zh: "已断开", en: "Disconnected" },
  mbStConnError: { zh: "连接错误", en: "Connection error" },
  mbStSignalError: { zh: "信令错误", en: "Signaling error" },
  mbStLoadFail: { zh: "加载失败", en: "Load failed" },
  mbStNotConnected: { zh: "未连接", en: "Not connected" },
  // toasts (dynamic; trailing-space variants are prefixes for an error detail)
  mbToastConnected: { zh: "已连接到网页音乐板", en: "Connected to the web Music Studio" },
  mbToastCodeShort: { zh: "配对码至少 4 位", en: "Pair code needs at least 4 characters" },
  mbToastAutoplay: { zh: "浏览器拦截了自动播放，请点击页面任意位置允许", en: "Browser blocked autoplay — click anywhere on the page to allow" },
  mbToastConnFail: { zh: "连接失败：", en: "Connection failed: " },
  mbToastPeerErr: { zh: "PeerJS：", en: "PeerJS: " },
  mbToastLoadPeerFail: { zh: "加载 PeerJS 失败：", en: "Failed to load PeerJS: " },

  // Resource tracker — DM full-screen panel (GM-only).
  rtTitle: { zh: "资源追踪", en: "Resource Tracker" },
  rtTabPlayers: { zh: "玩家", en: "Players" },
  rtTabMonsters: { zh: "怪物", en: "Monsters" },
  rtUnnamed: { zh: "(未命名)", en: "(unnamed)" },
  rtOwnerCardNpc: { zh: "角色卡", en: "Card NPC" },
  rtSubTail: { zh: "血量 / 资源可直接增删改", en: "HP / resources are editable here" },
  rtSavePreset: { zh: "+ 存为预设", en: "+ Save preset" },
  rtSavePresetTitle: { zh: "把该角色当前所有资源存为一个预设", en: "Save this character's current resources as a preset" },
  rtEmptyAll: {
    zh: "没有找到要追踪的角色 token。<br>有角色卡的单位、玩家拥有的 token、或在先攻里的单位会列在这里。",
    en: "No trackable tokens found.<br>Tokens with a character card, player-owned tokens, or anything in the current initiative will be listed here.",
  },
  rtEmptyPlayers: { zh: "暂无玩家角色 —— 给 token 绑定角色卡后会出现在这里。", en: "No player characters yet — bind a character card to a token and it shows up here." },
  rtEmptyMonsters: { zh: "暂无怪物 —— 玩家无卡 token / 先攻中的单位会出现在这里。", en: "No monsters — card-less player tokens / units in the current initiative appear here." },
  // preset bar (HTML)
  rtPresetsLbl: { zh: "预设", en: "Presets" },
  rtPresetsEmpty: {
    zh: "还没有预设。鼠标移到某张角色卡上点「+ 存为预设」可保存其当前资源；保存后这里出现的 chip：<b>点击</b>=覆盖/叠加给全员、<b>拖到角色卡上</b>=只给那一张。",
    en: "No presets yet. Hover a character card and click \"+ Save preset\" to snapshot its resources. The chip here: <b>click</b> = overwrite/merge to everyone, <b>drag onto a card</b> = apply to just that one.",
  },
  rtExport: { zh: "导出", en: "Export" },
  rtImport: { zh: "导入", en: "Import" },
  // preset dialogs (dynamic)
  rtPresetChipTitle: { zh: "点击：应用菜单（覆盖/叠加全员）· 拖到角色卡：仅给那一张", en: "Click: apply menu (overwrite/merge all) · Drag onto a card: apply to just that one" },
  rtPresetNoRes: { zh: "该角色当前没有可保存的资源。先在卡片上添加几个资源再来。", en: "This character has no resources to save. Add some on the card first." },
  rtPresetDefaultName: { zh: "我的预设", en: "My preset" },
  rtPresetSavePrompt: { zh: "保存为预设（{n} 个资源）。给它起个名字：", en: "Save as a preset ({n} resources). Name it:" },
  rtPresetMenuOverwrite: { zh: "覆盖应用到全员（替换现有资源）", en: "Overwrite to everyone (replace existing)" },
  rtPresetMenuMerge: { zh: "叠加应用到全员（按 id 去重合并）", en: "Merge to everyone (dedupe by id)" },
  rtPresetMenuRename: { zh: "重命名预设", en: "Rename preset" },
  rtPresetMenuDelete: { zh: "删除预设", en: "Delete preset" },
  rtActOverwrite: { zh: "覆盖", en: "overwrote to" },
  rtActMerge: { zh: "叠加", en: "merged into" },
  rtPresetAppliedZh: { zh: "预设「{name}」已{act}应用到 {count} 个角色", en: "Preset \"{name}\" {act} {count} characters" },
  rtPresetRenamePrompt: { zh: "新名字：", en: "New name:" },
  rtPresetDeleteConfirm: { zh: "删除预设「{name}」？", en: "Delete preset \"{name}\"?" },
  rtPresetMergedTo: { zh: "预设「{name}」已合并到 {target}", en: "Preset \"{name}\" merged into {target}" },
  rtThisChar: { zh: "该角色", en: "this character" },
  rtImportErrFormat: { zh: "JSON 格式错误：应为预设数组，或包含 { presets: [...] }。", en: "Bad JSON: expected a preset array or { presets: [...] }." },
  rtImportErrEmpty: { zh: "JSON 里没有有效的预设条目。", en: "No valid preset entries in the JSON." },
  rtImportOk: { zh: "已导入 {n} 个预设", en: "Imported {n} presets" },
  rtImportFail: { zh: "导入失败：{e}", en: "Import failed: {e}" },

  // Resource edit modal + resource panel component.
  reEditTitle: { zh: "编辑资源", en: "Edit Resource" },
  reNewTitle: { zh: "新建资源", en: "New Resource" },
  reDefaultName: { zh: "自定义", en: "Custom" },
  rePresetsEmpty: { zh: "没有预设。改完后点右上角「+ 保存当前为预设」即可加进来。", en: "No presets. Tweak the form, then click \"+ Save current as preset\" to add one." },
  rePresetMax: { zh: "上限", en: "max" },
  rePresetDel: { zh: "删除该预设", en: "Delete this preset" },
  reConfirmDelete: { zh: "删除该资源？此操作不可撤销。", en: "Delete this resource? This can't be undone." },
  reErrNameEmpty: { zh: "名字不能为空", en: "Name can't be empty" },
  reErrNumbers: { zh: "当前 / 最大值需为数字", en: "Current / max must be numbers" },
  // Resource panel component (mounted in cards / cc-info)
  rpNoToken: { zh: "未选中任何 token", en: "No token selected" },
  rpNoResources: { zh: "该 token 还没有任何资源", en: "This token has no resources yet" },
  rpCreate: { zh: "＋ 创建资源", en: "＋ Create resource" },
  rpAdd: { zh: "＋ 新增资源", en: "＋ Add resource" },
  rpReorder: { zh: "拖动以重新排序", en: "Drag to reorder" },
  rpEdit: { zh: "编辑", en: "Edit" },
  rpMaxZero: { zh: "最大值为 0（点 ⚙ 设置）", en: "Max is 0 (click ⚙ to set)" },
  rpEditExpr: { zh: "点击编辑：可输入数字 / +5 -3 / current+5 / max-2 等表达式", en: "Click to edit: a number, +5 / -3, current+5, max-2, …" },
  rpPipTitle: { zh: "{name} · 第 {i} 格 · 点击赋值 {i}（已为 {i} 时减 1）· 右键归满", en: "{name} · pip {i} · click = set to {i} (−1 if already {i}) · right-click = fill" },
  rpBarTitle: { zh: "{name} · 左键拖动设置进度，右键 +1 / 归满", en: "{name} · drag = set progress, right-click = +1 / fill" },
  rpJumpMin: { zh: "跳到最小（{min}）", en: "Jump to min ({min})" },
  rpJumpMax: { zh: "跳到最大（{max}）", en: "Jump to max ({max})" },
  // Resource edit modal — static labels (resource-edit.html)
  reLblName: { zh: "名字", en: "Name" },
  reNamePh: { zh: "如：一环法术槽 / 灵感", en: "e.g. 1st-level slot / Inspiration" },
  reLblType: { zh: "类型", en: "Type" },
  reTypeCount: { zh: "个数", en: "Pips" },
  reTypeBar: { zh: "进度", en: "Bar" },
  reTypeNumber: { zh: "数字", en: "Number" },
  reLblCurrent: { zh: "当前", en: "Current" },
  reLblMax: { zh: "最大", en: "Max" },
  reLblIcon: { zh: "图标", en: "Icon" },
  rePresetsLabel: { zh: "预设（名字 · 类型 · 上限 · 图标 一起存）", en: "Presets (name · type · max · icon, saved together)" },
  reAddPreset: { zh: "+ 保存当前为预设", en: "+ Save current as preset" },
  rePreview: { zh: "预览", en: "Preview" },
  reBtnDelete: { zh: "删除", en: "Delete" },
  reBtnCancel: { zh: "取消", en: "Cancel" },
  reBtnSave: { zh: "保存", en: "Save" },
  reClose: { zh: "关闭", en: "Close" },

  // Status tracker — buff edit popup + effect presets (GM-only).
  // (Buff catalog NAMES and category/group names are user data and
  // stay untranslated.)
  stFxLabel: { zh: "实验性 · 视觉特效（仅 GM / 桌面端）", en: "Experimental · visual FX (GM / desktop only)" },
  stFxParticleUrlPh: { zh: "粒子图片 URL（留空 = 默认）", en: "Particle image URL (blank = default)" },
  stFxPickFromLib: { zh: "从 OBR 资源库选择", en: "Pick from OBR asset library" },
  stEffectLabel: { zh: "特效", en: "Effect" },
  stWebmNone: { zh: "无", en: "None" },
  stWebmDefault: { zh: "默认特效", en: "Default FX" },
  stWebmHintBuiltin: { zh: "想用其它预制 webm 当特效？把 webm 拖进场景，状态追踪打开时右键它选「以此创建状态」。", en: "Want a different preset webm as the FX? Drop a webm into the scene, then (with the status tool open) right-click it and choose \"Create status from this\"." },
  stWebmHintCustom: { zh: "自定义状态没有内置特效。想加特效？把 webm / 图片拖进场景，状态追踪打开时右键它选「以此创建状态」。", en: "Custom statuses have no built-in FX. Want one? Drop a webm / image into the scene, then right-click it (status tool open) and choose \"Create status from this\"." },
  stNamePh: { zh: "名称", en: "Name" },
  stRoundsLabel: { zh: "持续轮数", en: "Rounds" },
  stRoundsUnlimited: { zh: "0=不限", en: "0 = unlimited" },
  stPreview: { zh: "预览", en: "Preview" },
  stDelete: { zh: "删除", en: "Delete" },
  stCancel: { zh: "取消", en: "Cancel" },
  stSave: { zh: "保存", en: "Save" },
  stDeleteBuffConfirm: { zh: "删除「{name}」？", en: "Delete \"{name}\"?" },
  // FX preset labels + hints
  stFxDefault: { zh: "默认", en: "Default" },
  stFxDefaultHint: { zh: "静态气泡（不带特效）", en: "Static bubble (no FX)" },
  stFxFloat: { zh: "漂浮", en: "Float" },
  stFxFloatHint: { zh: "粒子从角色脚下随机漂浮上升", en: "Particles drift up from the character's feet" },
  stFxDrop: { zh: "下降", en: "Drop" },
  stFxDropHint: { zh: "粒子从角色头顶随机降落", en: "Particles fall from above the character" },
  stFxFlicker: { zh: "闪烁", en: "Flicker" },
  stFxFlickerHint: { zh: "随机位置闪烁淡入淡出", en: "Random fade-in/out flickers" },
  stFxCurve: { zh: "悠扬", en: "Sway" },
  stFxCurveHint: { zh: "曲线从角色背后散播（渲染于角色下方）", en: "Curving spread from behind (rendered under the character)" },
  stFxSpread: { zh: "扩散", en: "Spread" },
  stFxSpreadHint: { zh: "同心圆扩散（渲染于角色下方）", en: "Concentric ripples (rendered under the character)" },
  // segment 3b — palette presets / categories / footer hints / render modes / import.
  // NOTE: "全部" and "未分类" are DISPLAY labels only — the stored filter
  // sentinels (null filter / the UNCATEGORIZED group key) keep their
  // original values so saved catalogs / presets never break.
  stCatAll: { zh: "全部", en: "All" },
  stCatUncategorized: { zh: "未分类", en: "Uncategorized" },
  stHoverPreview: { zh: "悬停预览效果", en: "Hover to preview" },
  stPresetsLbl: { zh: "预设", en: "Presets" },
  stPresetsEmpty: { zh: "还没有预设。先在过滤栏选一个分组，再点右边「+ 保存当前为预设」。", en: "No presets yet. Pick a group in the filter row, then click \"+ Save current as preset\" on the right." },
  stPresetChipTitle: { zh: "点击：应用 / 删除 · 拖拽：拖到 token 上应用", en: "Click: apply / delete · Drag: drop onto a token to apply" },
  stPresetSave: { zh: "+ 保存当前为预设", en: "+ Save current as preset" },
  stPresetSaveTitle: { zh: "把当前过滤分组的所有 buffs 保存为一个新预设", en: "Save all buffs in the current filter group as a new preset" },
  stPresetOverwrite: { zh: "覆盖应用到所有角色卡 token", en: "Overwrite onto all character-card tokens" },
  stPresetMerge: { zh: "叠加应用到所有角色卡 token", en: "Merge onto all character-card tokens" },
  stPresetRename: { zh: "重命名预设", en: "Rename preset" },
  stPresetDelete: { zh: "删除预设", en: "Delete preset" },
  stPresetApplied: { zh: "预设「{name}」已{mode}应用到 {count} 个角色卡 token", en: "Preset \"{name}\" {mode} onto {count} character-card token(s)" },
  stModeOverwrite: { zh: "覆盖", en: "overwritten" },
  stModeMerge: { zh: "叠加", en: "merged" },
  stRenamePromptNew: { zh: "新名字：", en: "New name:" },
  stPresetDeleteConfirm: { zh: "删除预设「{name}」？", en: "Delete preset \"{name}\"?" },
  stPresetNoBuffs: { zh: "当前过滤分组里没有可用的 buff，无法保存为预设。", en: "No usable buffs in the current filter group — nothing to save as a preset." },
  stPresetNamePrompt: { zh: "给这个预设起个名字（{count} 个 buff）：", en: "Name this preset ({count} buffs):" },
  stPresetAppliedMerge: { zh: "预设「{name}」已应用到 token（叠加）", en: "Preset \"{name}\" applied to token (merged)" },
  stNewCatPh: { zh: "新分类名", en: "New category" },
  stAddCat: { zh: "添加分类", en: "Add category" },
  stClearAllBuffs: { zh: "清除该角色全部 buff", en: "Clear all buffs on this character" },
  stManageBuffs: { zh: "管理该角色 buff", en: "Manage this character's buffs" },
  stNewBuffPill: { zh: "+ 新 buff", en: "+ New buff" },
  stRenameCatPrompt: { zh: "重命名分类「{name}」（留空=删除）", en: "Rename category \"{name}\" (blank = delete)" },
  stCatMinOne: { zh: "至少保留一个分组，无法删除「{name}」。", en: "Keep at least one group — can't delete \"{name}\"." },
  stCatDeleteConfirm: { zh: "删除分类「{name}」？该分类下的 buff 会移到「{uncat}」。", en: "Delete category \"{name}\"? Its buffs move to \"{uncat}\"." },
  // footer hint lines — contain <b>/<kbd> markup; {x} = the red cross SVG icon
  stFootApply1: { zh: "<b>左键</b>状态 = 选中；再点角色 = 应用 / 切换", en: "<b>Left-click</b> a status = select; then click a character = apply / toggle" },
  stFootApply2: { zh: "<b>右键</b> = 取消当前选中", en: "<b>Right-click</b> = cancel current selection" },
  stFootApply3: { zh: "<b>左键</b>红色 {x}= 选中清除；再点角色 = 清空", en: "<b>Left-click</b> red {x}= select clear; then click a character = clear" },
  stFootApply4: { zh: "<b>管理</b> = 选中后点角色，打开该角色 buff 管理", en: "<b>Manage</b> = select, then click a character to open buff management" },
  stFootApply5: { zh: "<kbd>]</kbd> 关闭面板", en: "<kbd>]</kbd> close panel" },
  stFootEdit1: { zh: "<b>点击</b>分类 = 重命名（清空 = 删除）", en: "<b>Click</b> a category = rename (clear = delete)" },
  stFootEdit2: { zh: "<b>拖</b>分类 = 排序", en: "<b>Drag</b> a category = reorder" },
  stFootEdit3: { zh: "<b>点击</b> buff = 颜色 / 名字 / 特效编辑", en: "<b>Click</b> a buff = edit color / name / FX" },
  stFootEdit4: { zh: "<b>拖</b> buff 到分类 = 切换分组", en: "<b>Drag</b> a buff onto a category = move group" },
  stFootEdit5: { zh: "<kbd>]</kbd> 退出编辑", en: "<kbd>]</kbd> exit edit" },
  // render-mode cycle button (short labels)
  stRenderEffect: { zh: "特效", en: "FX" },
  stRenderText: { zh: "文字", en: "Text" },
  stRenderAuto: { zh: "自动", en: "Auto" },
  // import
  stImportBadJson: { zh: "JSON 文件格式错误：应为 buff 数组或 { buffs, groupOrder } 对象。", en: "Bad JSON: expected a buff array or a { buffs, groupOrder } object." },
  stImportFailed: { zh: "导入失败：{err}", en: "Import failed: {err}" },
  // manage popover
  stRoleFallback: { zh: "角色", en: "Character" },
  stUnknownBuff: { zh: "未知 buff", en: "Unknown buff" },
  stNoBuffsOnChar: { zh: "该角色没有 buff", en: "This character has no buffs" },
  // static palette toolbar (status-tracker.html)
  stPaletteTitle: { zh: "状态调色板", en: "Status Palette" },
  stRenderModeTitle: { zh: "渲染模式：循环 自动 → 特效 → 文字 → 自动 …", en: "Render mode: cycle Auto → FX → Text → Auto …" },
  stCloseTitle: { zh: "关闭 (])", en: "Close (])" },
  stEditTitle: { zh: "编辑 buff 库", en: "Edit buff library" },
  stEditLabel: { zh: "编辑", en: "Edit" },
  stExportTitle: { zh: "导出 buff 库为 JSON", en: "Export buff library as JSON" },
  stExportLabel: { zh: "导出", en: "Export" },
  stImportTitle: { zh: "导入 buff 库 JSON", en: "Import buff library JSON" },
  stImportLabel: { zh: "导入", en: "Import" },
  stStudioTitle: { zh: "打开 Buff Studio：在线制作 buff 特效（多图层合成 / GIF·视频转 WebM），导出后放进 buff 库", en: "Open Buff Studio: make buff FX online (multi-layer compositing, GIF / video → WebM), then drop the export into your buff library" },
  stStudioLabel: { zh: "特效工坊", en: "FX Studio" },
  // manage popover static HTML (status-tracker-manage.html)
  stManageTitle: { zh: "buff 管理", en: "Buff manager" },
  stClosePlain: { zh: "关闭", en: "Close" },
  stManageFootHint: { zh: "拖到 <b>其他角色</b> = 转移 · 拖到 <b>外面</b> = 取消", en: "Drag onto <b>another character</b> = transfer · Drag <b>outside</b> = cancel" },
  // ===== Character card v2 (fullscreen-page.tsx) — segment 4 =====
  // tabs
  ccTabOverview: { zh: "概览", en: "Overview" },
  ccTabSpells: { zh: "法术", en: "Spells" },
  ccTabFeatures: { zh: "特性", en: "Features" },
  ccTabBackground: { zh: "背景", en: "Background" },
  ccTabsAria: { zh: "角色卡标签", en: "Character card tabs" },
  // abilities / skills — roll-label suffixes + tooltips
  ccCheckSuffix: { zh: "检定", en: " Check" },
  ccCheckAdvSuffix: { zh: "检定（优势）", en: " Check (adv)" },
  ccSaveSuffix: { zh: "豁免", en: " Save" },
  ccSave: { zh: "豁免", en: "Save" },
  ccRollHint: { zh: "（左键投，右键优势）", en: "(left-click roll, right-click adv)" },
  ccTipAutoMod: { zh: "自动从属性值推算", en: "Auto-derived from ability score" },
  ccTipToggleSaveProf: { zh: "点击切换豁免熟练", en: "Click to toggle save proficiency" },
  ccTipCycleSkillProf: { zh: "点击循环切换：无 → 熟练 → 专精 → 无", en: "Click to cycle: none → proficient → expertise → none" },
  // header — identity meta pips
  ccUnnamed: { zh: "未命名", en: "Unnamed" },
  ccTotalLevel: { zh: "总等级", en: "Total Level" },
  ccAlignment: { zh: "阵营", en: "Alignment" },
  ccSize: { zh: "体型", en: "Size" },
  ccFaith: { zh: "信仰", en: "Faith" },
  // header — toolbar buttons + tooltips
  ccEditTitleOn: { zh: "退出编辑模式（再次切换回只读视图）", en: "Exit edit mode (back to read-only view)" },
  ccEditTitleOff: { zh: "进入编辑模式：自由修改属性、添加词条、法术、特性、装备、背景", en: "Enter edit mode: edit stats, add entries, spells, features, gear, background" },
  ccEditingLabel: { zh: "编辑中", en: "Editing" },
  ccEditLabel: { zh: "编辑", en: "Edit" },
  ccSaveTitle: { zh: "把当前所有改动保存到服务器（不退出编辑模式）", en: "Save all changes to the server (stays in edit mode)" },
  ccSaving: { zh: "保存中…", en: "Saving…" },
  ccSaveBtn: { zh: "保存", en: "Save" },
  ccRefreshTitle: { zh: "重新拉取服务器上的最新数据", en: "Re-fetch the latest data from the server" },
  ccRefresh: { zh: "刷新", en: "Refresh" },
  ccExportTitle: { zh: "把当前角色卡数据导出为 JSON 文件", en: "Export this card's data as a JSON file" },
  ccExportJson: { zh: "导出 JSON", en: "Export JSON" },
  ccCopyTitle: { zh: "仅复制：把当前角色卡 JSON 复制到剪贴板（不下载文件）", en: "Copy only: copy the card JSON to the clipboard (no file download)" },
  ccImportTitle: { zh: "从 JSON 文件加载角色卡", en: "Load a character card from a JSON file" },
  ccImportJson: { zh: "导入 JSON", en: "Import JSON" },
  ccPasteTitle: { zh: "仅粘贴：弹窗输入 JSON 文本，识别后应用为当前角色卡数据", en: "Paste only: enter JSON text in a dialog, apply it as the card data" },
  // paste-JSON modal
  ccPasteEmpty: { zh: "✕ 文本框为空，请粘贴角色卡 JSON", en: "✕ Text box is empty — paste the card JSON" },
  ccPasteModalTitle: { zh: "粘贴角色卡 JSON", en: "Paste character card JSON" },
  ccPasteKbdHint: { zh: "Ctrl+Enter 应用 · Esc 取消", en: "Ctrl+Enter apply · Esc cancel" },
  ccPastePlaceholder: { zh: '直接粘贴 JSON 文本，例如 {"identity": {...}, "abilities": {...}, "core_stats": {...}}', en: 'Paste JSON text directly, e.g. {"identity": {...}, "abilities": {...}, "core_stats": {...}}' },
  ccCancel: { zh: "取消", en: "Cancel" },
  ccApplying: { zh: "应用中…", en: "Applying…" },
  ccApply: { zh: "应用", en: "Apply" },
  // spell-pick modal
  ccSpellModalHint: { zh: "输入中文 / 英文名筛选 · Esc 取消", en: "Type a Chinese / English name to filter · Esc cancel" },
  ccSpellSearchPh: { zh: "法术名（中 / 英，留空浏览全部）", en: "Spell name (CN / EN, blank = browse all)" },
  ccSpellAddFree: { zh: "＋ 直接添加「{q}」", en: '＋ Add "{q}" directly' },
  ccSpellLoading: { zh: "加载法术库…", en: "Loading spell library…" },
  ccSpellLoadErr: { zh: "法术库加载失败 — 上方“直接添加”仍可用", en: 'Spell library failed to load — "Add directly" above still works' },
  ccSpellNoMatch: { zh: "库内没有匹配项 — 可用上方“直接添加”", en: 'No matches in the library — use "Add directly" above' },
  // stat banner labels (HP / AC stay as-is)
  ccTemp: { zh: "临时", en: "Temp" },
  ccInit: { zh: "先攻", en: "Init" },
  ccSpeed: { zh: "速度", en: "Speed" },
  ccFtUnit: { zh: "尺", en: "ft" },
  ccPassivePerc: { zh: "被察", en: "Pass." },
  ccProf: { zh: "熟练", en: "Prof" },
  ccHitDice: { zh: "生命骰", en: "Hit Dice" },
  // combat section
  ccConfirmDelWeapon: { zh: "删除武器「{name}」？", en: 'Delete weapon "{name}"?' },
  ccNewWeapon: { zh: "新武器", en: "New weapon" },
  ccSecCombat: { zh: "战斗 · 武器 · 护甲", en: "Combat · Weapons · Armor" },
  ccAddWeaponTitle: { zh: "新增武器", en: "Add weapon" },
  ccAddWeaponBtn: { zh: "+ 武器", en: "+ Weapon" },
  ccArmor: { zh: "护甲", en: "Armor" },
  ccEquipped: { zh: "已装备", en: "Equipped" },
  ccUnequipped: { zh: "未装备", en: "Not equipped" },
  ccAttuned: { zh: "同调", en: "Attuned" },
  ccArmorAcTip: { zh: "基础 AC + 敏捷上限", en: "Base AC + Dex cap" },
  ccDexAbbr: { zh: "敏", en: "DEX" },
  ccWeight: { zh: "重量", en: "Weight" },
  ccLbUnit: { zh: "磅", en: "lb" },
  ccShield: { zh: "盾牌", en: "Shield" },
  ccNoWeaponsArmor: { zh: "暂未配置武器或护甲", en: "No weapons or armor configured" },
  ccWeaponNamePh: { zh: "武器名", en: "Weapon name" },
  ccDmgTypePh: { zh: "挥砍 / 穿刺 / …", en: "Slashing / Piercing / …" },
  ccDelWeaponTitle: { zh: "删除武器", en: "Delete weapon" },
  ccProfShort: { zh: "熟", en: "Prof" },
  ccHit: { zh: "命中", en: "Hit" },
  ccHitAdv: { zh: "命中（优势）", en: "Hit (adv)" },
  ccRollLR: { zh: "左键投，右键优势", en: "left-click roll, right-click adv" },
  ccDamage: { zh: "伤害", en: "Damage" },
  ccExtraDamage: { zh: "附加伤害", en: "Extra Damage" },
  ccExtraDmgDie: { zh: "附加伤害骰", en: "Extra damage dice" },
  ccAmmo: { zh: "弹药", en: "Ammo" },
  // inventory section
  ccBackpack: { zh: "背包", en: "Backpack" },
  ccConfirmDelItem: { zh: "删除「{name}」？", en: 'Delete "{name}"?' },
  ccNewItem: { zh: "新物品", en: "New item" },
  ccNewWondrous: { zh: "新奇物", en: "New wondrous item" },
  ccSecInventory: { zh: "装备 · 货币 · 负重", en: "Gear · Currency · Encumbrance" },
  ccTotalValue: { zh: "总值", en: "Total value" },
  ccAddItemTitle: { zh: "新增物品", en: "Add item" },
  ccAddItemBtn: { zh: "+ 物品", en: "+ Item" },
  ccCoinPP: { zh: "铂PP", en: "PP" },
  ccCoinGP: { zh: "金GP", en: "GP" },
  ccCoinEP: { zh: "银EP", en: "EP" },
  ccCoinSP: { zh: "铜SP", en: "SP" },
  ccCoinCP: { zh: "铜CP", en: "CP" },
  ccEncumbrance: { zh: "负重", en: "Encumbrance" },
  ccEquipmentWt: { zh: "装备", en: "Gear" },
  ccTotal: { zh: "总计", en: "Total" },
  ccCapacity: { zh: "上限", en: "Capacity" },
  ccWondrousTitle: { zh: "奇物 / 魔法物品", en: "Wondrous / Magic Items" },
  ccNoPackDetail: { zh: '（暂无背包细目，可在 xlsx 角色卡 "背包1/2" 表更新）', en: '(No pack details — update the "Backpack 1/2" sheets in the xlsx card)' },
  ccItemNamePh: { zh: "物品名", en: "Item name" },
  ccWeightPh: { zh: "重量", en: "Weight" },
  ccLocationPh: { zh: "位置", en: "Location" },
  ccDelete: { zh: "删除", en: "Delete" },
  // app-level errors
  ccErrNoParams: { zh: "URL 缺少 room 或 card 参数", en: "URL is missing the room or card parameter" },
  ccLoadFailedPrefix: { zh: "加载失败：", en: "Load failed: " },
  // spells section
  ccSpellLevelTip: { zh: "环阶（0 = 戏法）", en: "Spell level (0 = cantrip)" },
  ccSpellNamePh: { zh: "法术名", en: "Spell name" },
  ccSpellExpandTip: { zh: "点击展开法术详情", en: "Click to expand spell details" },
  ccCantripBadge: { zh: "戏", en: "C" },
  ccRing: { zh: "环", en: "" },
  ccConcentration: { zh: "专注", en: "Conc." },
  ccRitual: { zh: "仪式", en: "Ritual" },
  ccCastingTime: { zh: "施法", en: "Cast" },
  ccRange: { zh: "距离", en: "Range" },
  ccDuration: { zh: "持续", en: "Duration" },
  ccSecSpells: { zh: "法术", en: "Spells" },
  ccSpellAbility: { zh: "关键属性", en: "Ability" },
  ccSaveDC: { zh: "豁免DC", en: "Save DC" },
  ccSpellAttack: { zh: "攻击", en: "Attack" },
  ccMaxPrepared: { zh: "最大准备", en: "Max prepared" },
  ccCantrips: { zh: "戏法", en: "Cantrips" },
  ccAddCantripTitle: { zh: "从法术库挑选戏法加入", en: "Pick a cantrip from the library" },
  ccAlwaysPrepared: { zh: "始终准备", en: "Always Prepared" },
  ccAddAlwaysTitle: { zh: "从法术库挑选始终准备法术加入", en: "Pick an always-prepared spell from the library" },
  ccPrepared: { zh: "准备法术", en: "Prepared" },
  ccAddPreparedTitle: { zh: "从法术库挑选准备法术加入", en: "Pick a prepared spell from the library" },
  ccGroup: { zh: "组", en: "Group" },
  ccAddCantripModal: { zh: "添加戏法", en: "Add cantrip" },
  ccAddAlwaysModal: { zh: "添加始终准备法术", en: "Add always-prepared spell" },
  ccAddPreparedModal: { zh: "添加准备法术", en: "Add prepared spell" },
  // feature block + features section
  ccAddPrefix: { zh: "新增", en: "Add " },
  ccNamePh: { zh: "名称", en: "Name" },
  ccDescPh: { zh: "描述（点击展开 · 此处编辑全文）", en: "Description (click to expand · edit full text here)" },
  ccToggleCollapse: { zh: "点击折叠 / 展开", en: "Click to collapse / expand" },
  ccNewEntry: { zh: "新条目", en: "New entry" },
  ccSecFeatures: { zh: "特性 · 专长", en: "Features · Feats" },
  ccClassFeatures: { zh: "职业特性", en: "Class Features" },
  ccRaceFeatures: { zh: "种族特性", en: "Race Features" },
  ccFightingStyle: { zh: "战斗风格", en: "Fighting Style" },
  ccSpecialAbilities: { zh: "特殊能力", en: "Special Abilities" },
  ccFeats: { zh: "专长", en: "Feats" },
  // background section
  ccBgAppearance: { zh: "外貌", en: "Appearance" },
  ccBgPersonality: { zh: "性格", en: "Personality" },
  ccBgTraits: { zh: "特质", en: "Traits" },
  ccBgIdeals: { zh: "理念", en: "Ideals" },
  ccBgBonds: { zh: "羁绊", en: "Bonds" },
  ccBgFlaws: { zh: "缺陷", en: "Flaws" },
  ccBgStory: { zh: "故事", en: "Story" },
  ccBgOther: { zh: "其他", en: "Other" },
  ccSecBackground: { zh: "背景 · 个人", en: "Background · Personal" },
  ccBackgroundLabel: { zh: "背景：", en: "Background: " },
  ccBackgroundNameField: { zh: "背景名", en: "Background name" },
  ccBackgroundNamePh: { zh: "如：哲人 / 罪犯 / 海上水手 ...", en: "e.g. Sage / Criminal / Sailor ..." },
  ccPlayer: { zh: "玩家", en: "Player" },
  ccGender: { zh: "性别", en: "Gender" },
  ccAge: { zh: "年龄", en: "Age" },
  ccHeight: { zh: "身高", en: "Height" },
  ccBodyWeight: { zh: "体重", en: "Weight" },
  ccHometown: { zh: "家乡", en: "Hometown" },
  ccNoBackground: { zh: "暂无背景信息", en: "No background info yet" },
  // abilities section header
  ccSecAbilities: { zh: "属性 · 豁免 · 技能", en: "Abilities · Saves · Skills" },
  ccSecAbilitiesEditHint: { zh: "（编辑中 — 点击 ●/○/★ 切换熟练）", en: " (editing — click ●/○/★ to toggle proficiency)" },
  // defenses section
  ccSecDefenses: { zh: "防御 · 语言 · 工具", en: "Defenses · Languages · Tools" },
  ccResistances: { zh: "抗性", en: "Resistances" },
  ccImmunities: { zh: "免疫", en: "Immunities" },
  ccAdvantages: { zh: "优势", en: "Advantages" },
  ccDisadvantages: { zh: "劣势", en: "Disadvantages" },
  ccLanguages: { zh: "语言", en: "Languages" },
  ccTools: { zh: "工具", en: "Tools" },
  ccRemove: { zh: "移除", en: "Remove" },
  ccAddTagHint: { zh: "（用逗号分隔可一次添加多条）", en: " (comma-separated to add several at once)" },
  // import / copy / loading (app-level)
  ccCopiedAlert: { zh: "已复制角色卡 JSON 到剪贴板（{n} 字符）。可粘贴到另一张卡的「粘贴 JSON」或 xlsx 主要!AV1 公式里。", en: 'Copied the card JSON to the clipboard ({n} chars). Paste it into another card\'s "Paste JSON" or the xlsx 主要!AV1 formula.' },
  ccCopyFailAlert: { zh: "复制到剪贴板失败 — 请用「导出 JSON」下载文件后手动打开复制。", en: 'Clipboard copy failed — use "Export JSON" to download the file and copy it manually.' },
  ccNotCardJson: { zh: "(不像角色卡 JSON，缺少 identity / abilities 字段)", en: "(not character-card JSON — missing identity / abilities)" },
  ccSaveFailHttp: { zh: "(本地预览，服务器保存失败 HTTP {status}: {body})", en: "(local preview only — server save failed HTTP {status}: {body})" },
  ccRenderWarn: { zh: "\n  (旧版 HTML 渲染告警：{warn})", en: "\n  (legacy HTML render warning: {warn})" },
  ccSaveFail: { zh: "(服务器保存失败: {err})", en: "(server save failed: {err})" },
  ccSkipImported: { zh: "(跳过 — 已导入当前卡，多个 JSON 无法批量替换)", en: "(skipped — current card already imported; multiple JSONs can't batch-replace)" },
  ccJsonParseFail: { zh: "(JSON 解析失败: {err})", en: "(JSON parse failed: {err})" },
  ccXlsxFailHttp: { zh: "(xlsx 上传失败 HTTP {status}: {body})", en: "(xlsx upload failed HTTP {status}: {body})" },
  ccShieldReconcileFail: { zh: "(盾牌着装纠偏失败: {err})", en: "(shield-state reconcile failed: {err})" },
  ccNewCardArrow: { zh: '新卡 "{name}"', en: 'new card "{name}"' },
  ccXlsxFail: { zh: "(xlsx 上传失败: {err})", en: "(xlsx upload failed: {err})" },
  ccUnsupportedExt: { zh: "(不支持的扩展名 — 仅支持 .json / .xlsx)", en: "(unsupported extension — only .json / .xlsx)" },
  ccImportResultHead: { zh: "导入结果（{n} 个文件）：", en: "Import result ({n} files):" },
  ccImportResultNote: { zh: "（其他客户端会自动刷新已存在的卡片；新建的卡片需要他们刷新一下面板列表。）", en: "(Other clients auto-refresh existing cards; for newly created cards they need to refresh their panel list.)" },
  ccLoadingCard: { zh: "加载角色卡…", en: "Loading character card…" },
  ccSavedEdit: { zh: "已保存的编辑", en: "saved edits" },
  ccJsonParseFailColon: { zh: "✕ JSON 解析失败：{err}", en: "✕ JSON parse failed: {err}" },
  ccPasteSource: { zh: "粘贴文本", en: "pasted text" },
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
