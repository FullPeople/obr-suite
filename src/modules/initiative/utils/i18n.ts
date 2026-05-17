export type Lang = "en" | "zh";

const translations = {
  en: {
    initiative: "Initiative",
    round: "Round",
    startCombat: "Start Combat",
    startPreparation: "Prepare",
    ambush: "Ambush",
    cancelPreparation: "Cancel",
    preparing: "Preparing",
    // Flying text words
    effectCombat: "COMBAT",
    effectPrepare: "PREPARE!",
    effectBegin: "BEGIN!",
    effectAmbush: "AMBUSH!",
    prev: "◀ Prev",
    next: "Next ▶",
    endCombat: "End Combat",
    clearAllInit: "Clear All",
    clearAllInitConfirm: "Click again to clear",
    clearAllInitTitle: "Remove every token from initiative (two-click confirm)",
    noCharacters: "No characters in initiative",
    rightClickHint: "Right-click a token to add",
    addToInitiative: "Add to Initiative",
    invisibleAddToInitiative: "Add to Initiative (Invisible)",
    removeFromInitiative: "Remove from Initiative",
    added: "Added to initiative",
    removed: "Removed from initiative",
    setInitiative: "Set Initiative",
    add: "Add",
    skip: "Skip",
    initiativeValue: "Initiative value",
    loading: "Loading...",
    addFirst: "Add characters first",
    dragHint: "Drag a Character into the scene during combat to quickly add it to the initiative list",
    rollDisadvantage: "Disadvantage",
    rollNormal: "Normal",
    rollAdvantage: "Advantage",
    gatherHere: "Gather Initiative Here",
    gathered: "Initiative characters gathered",
    about: "About",
    endTurn: "End Turn",
    makeInvisible: "Mark Invisible",
    revealInvisible: "Reveal (Lift Invisibility)",
    effectStealth: "Someone is hiding...",
    dragInAutoOn: "Auto join initiative",
    dragInAutoOff: "Auto join initiative",
    dragInAutoTitle: "When ON, characters that appear during prep/combat are auto-added to initiative with a rolled value (dark-rolled when the token is invisible). Click to disable (strikethrough).",
    reorderOn: "Reordering",
    reorderOff: "Reorder",
    reorderTitle: "Manual reorder mode — tap a card to pick it up, then tap a gap to drop it there. The card's initiative count is nudged so it lands at that spot (modifier untouched). Tap the card again to cancel.",
  },
  zh: {
    initiative: "先攻",
    round: "回合",
    startCombat: "开始战斗",
    startPreparation: "战斗准备",
    ambush: "突袭",
    cancelPreparation: "取消",
    preparing: "准备中",
    effectCombat: "战斗",
    effectPrepare: "准备！",
    effectBegin: "开始！",
    effectAmbush: "突袭！",
    prev: "◀ 上一个",
    next: "下一个 ▶",
    endCombat: "结束战斗",
    clearAllInit: "一键清空",
    clearAllInitConfirm: "再点一次确认",
    clearAllInitTitle: "把所有 token 移出先攻表（需点两次确认）",
    noCharacters: "先攻列表为空",
    rightClickHint: "右键点击角色加入先攻",
    addToInitiative: "加入先攻",
    invisibleAddToInitiative: "隐形加入先攻",
    removeFromInitiative: "移出先攻",
    added: "已加入先攻",
    removed: "已移出先攻",
    setInitiative: "设置先攻",
    add: "添加",
    skip: "跳过",
    initiativeValue: "先攻值",
    loading: "加载中...",
    addFirst: "请先添加角色",
    dragHint: "在战斗中拖拽 Character 角色到场景中，可以快速加入先攻列表",
    rollDisadvantage: "劣势",
    rollNormal: "普通",
    rollAdvantage: "优势",
    gatherHere: "集结先攻角色到此处",
    gathered: "先攻角色已集结",
    about: "关于",
    endTurn: "结束回合",
    makeInvisible: "标记隐形",
    revealInvisible: "解除隐形",
    effectStealth: "有人在暗处...",
    dragInAutoOn: "加入自动先攻",
    dragInAutoOff: "加入自动先攻",
    dragInAutoTitle: "开启后，准备/战斗中出现的新角色会自动加入先攻并随机投出一个先攻值（隐形角色暗投）。点击切换（删除线表示已关闭）。",
    reorderOn: "排序中",
    reorderOff: "更改排序",
    reorderTitle: "手动排序模式 —— 点一张卡片选中，再点空位放下。该卡的先攻值会被微调，使它落到那个位置（先攻加值不变）。再次点击卡片可取消。",
  },
} as const;

export type TranslationKey = keyof (typeof translations)["en"];

export function t(lang: Lang, key: TranslationKey): string {
  return translations[lang][key];
}

export function getStoredLang(): Lang {
  try {
    const stored = localStorage.getItem("initiative-tracker-lang");
    if (stored === "zh" || stored === "en") return stored;
  } catch {}
  return "zh";
}

export function setStoredLang(lang: Lang) {
  try {
    localStorage.setItem("initiative-tracker-lang", lang);
  } catch {}
}
