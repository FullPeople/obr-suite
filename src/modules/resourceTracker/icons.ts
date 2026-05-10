// Built-in icon library for the resource tracker. Each icon is a
// 24×24 SVG string with hard-coded fill colors so resources stay
// visually distinct without the user picking colors. SVGs use
// gradients + shading to read at small sizes.
//
// Each icon ships in TWO visual states via CSS — `.full` and
// `.spent` (set on the parent <span>). Spent shrinks the saturation
// + opacity so the consumed slots look distinct without redrawing.

import type { IconId } from "./types";

/** Generic SVG wrapper applying a uniform 24×24 viewBox. */
function svg(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="none">${inner}</svg>`;
}

export const ICON_LIBRARY: Record<IconId, string> = {
  // 棱形紫水晶 — 上下对称的菱形宝石
  gem: svg(`
    <defs><linearGradient id="g-gem" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#d8b4fe"/><stop offset="100%" stop-color="#7e22ce"/>
    </linearGradient></defs>
    <path d="M12 2 l8 7 l-8 13 l-8 -13 z" fill="url(#g-gem)" stroke="#4c1d95" stroke-width="0.8"/>
    <path d="M12 2 l8 7 l-8 4 l-8 -4 z" fill="rgba(255,255,255,0.18)"/>
  `),

  // 红心
  heart: svg(`
    <defs><linearGradient id="g-heart" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ef4444"/><stop offset="100%" stop-color="#991b1b"/>
    </linearGradient></defs>
    <path d="M12 21 c-7 -5 -10 -9 -10 -13 a4 4 0 0 1 7 -2 a4 4 0 0 1 6 0 a4 4 0 0 1 7 2 c0 4 -3 8 -10 13 z"
          fill="url(#g-heart)" stroke="#7f1d1d" stroke-width="0.7"/>
    <ellipse cx="9" cy="9" rx="2" ry="1.4" fill="rgba(255,255,255,0.25)"/>
  `),

  // 四角星（更"sparkle"风）
  starFour: svg(`
    <path d="M12 2 L13.6 10.4 L22 12 L13.6 13.6 L12 22 L10.4 13.6 L2 12 L10.4 10.4 z"
          fill="#fbbf24" stroke="#92400e" stroke-width="0.6"/>
  `),

  // 五芒星
  starFive: svg(`
    <path d="M12 2.5 l2.85 6.85 l7.4 0.6 l-5.65 4.85 l1.75 7.2 l-6.35 -3.85 l-6.35 3.85 l1.75 -7.2 l-5.65 -4.85 l7.4 -0.6 z"
          fill="#facc15" stroke="#78350f" stroke-width="0.6"/>
  `),

  // 骷髅
  skull: svg(`
    <path d="M5 11 c0 -4 3 -7 7 -7 c4 0 7 3 7 7 v3 c0 1.5 -1 2 -2 2.5 l-0.4 2 a1 1 0 0 1 -1 0.8 h-1.4 v-2.5 h-2.4 v2.5 h-1.4 a1 1 0 0 1 -1 -0.8 l-0.4 -2 c-1 -0.5 -2 -1 -2 -2.5 z"
          fill="#e5e7eb" stroke="#6b7280" stroke-width="0.7"/>
    <circle cx="9" cy="12" r="1.4" fill="#1f2937"/>
    <circle cx="15" cy="12" r="1.4" fill="#1f2937"/>
    <path d="M11 15.5 l1 -1.5 l1 1.5" stroke="#374151" stroke-width="0.8" fill="none" stroke-linecap="round"/>
  `),

  // 沙漏
  hourglass: svg(`
    <path d="M5 3 h14 v3 c0 3 -3 4 -7 6 c4 2 7 3 7 6 v3 h-14 v-3 c0 -3 3 -4 7 -6 c-4 -2 -7 -3 -7 -6 z"
          fill="#fcd34d" stroke="#92400e" stroke-width="0.8"/>
    <path d="M5 3 h14 v0.6 h-14 z M5 21 h14 v-0.6 h-14 z" fill="#78350f"/>
    <path d="M9 8 c1 1 2 2 3 2 c1 0 2 -1 3 -2 z" fill="#dc2626" opacity="0.7"/>
  `),

  // 猫眼石（椭圆 + 中心竖线）
  catEye: svg(`
    <defs><radialGradient id="g-cat" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#86efac"/><stop offset="100%" stop-color="#14532d"/>
    </radialGradient></defs>
    <ellipse cx="12" cy="12" rx="9" ry="6" fill="url(#g-cat)" stroke="#052e16" stroke-width="0.6"/>
    <path d="M12 6 c1 2 1 10 0 12 c-1 -2 -1 -10 0 -12 z" fill="#000" opacity="0.85"/>
    <ellipse cx="9.5" cy="9.5" rx="1.5" ry="1" fill="rgba(255,255,255,0.6)"/>
  `),

  // 齿轮
  gear: svg(`
    <path d="M12 2 l1.6 2 l2.5 -0.6 l1 2.4 l2.4 0.6 l-0.6 2.5 l2 1.6 l-2 1.6 l0.6 2.5 l-2.4 0.6 l-1 2.4 l-2.5 -0.6 l-1.6 2 l-1.6 -2 l-2.5 0.6 l-1 -2.4 l-2.4 -0.6 l0.6 -2.5 l-2 -1.6 l2 -1.6 l-0.6 -2.5 l2.4 -0.6 l1 -2.4 l2.5 0.6 z"
          fill="#94a3b8" stroke="#1f2937" stroke-width="0.7"/>
    <circle cx="12" cy="12" r="3.2" fill="#1f2937"/>
    <circle cx="12" cy="12" r="1.6" fill="#94a3b8"/>
  `),

  // 交叉双剑
  swords: svg(`
    <path d="M5 4 L11 13 L13 11 L4 5 z M19 4 L13 13 L11 11 L20 5 z"
          fill="#cbd5e1" stroke="#1e293b" stroke-width="0.6"/>
    <rect x="3" y="3" width="3" height="2" rx="0.5" fill="#7c2d12" stroke="#1e293b" stroke-width="0.5"/>
    <rect x="18" y="3" width="3" height="2" rx="0.5" fill="#7c2d12" stroke="#1e293b" stroke-width="0.5"/>
    <path d="M9 13 l-2 4 l-3 1 l1 -3 l4 -2 z" fill="#cbd5e1" stroke="#1e293b" stroke-width="0.5"/>
    <path d="M15 13 l2 4 l3 1 l-1 -3 l-4 -2 z" fill="#cbd5e1" stroke="#1e293b" stroke-width="0.5"/>
  `),

  // 苹果
  apple: svg(`
    <path d="M12 7 c-3 -1.5 -7 0.5 -7 5 c0 4 3 8 7 8 c4 0 7 -4 7 -8 c0 -4.5 -4 -6.5 -7 -5 z"
          fill="#ef4444" stroke="#7f1d1d" stroke-width="0.7"/>
    <path d="M12 7 v-2 a3 3 0 0 1 3 -3" stroke="#15803d" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <ellipse cx="9" cy="11" rx="1.8" ry="1.2" fill="rgba(255,255,255,0.35)"/>
  `),

  // 鸡腿
  drumstick: svg(`
    <path d="M16 5 a4 4 0 0 1 3 6 a4 4 0 0 1 -5 4 l-2 2 l-2 -2 a3 3 0 0 1 -3 -3 a3 3 0 0 1 3 -3 l1 -1 a4 4 0 0 1 5 -3 z"
          fill="#d4a574" stroke="#78350f" stroke-width="0.7"/>
    <path d="M11 16 l-4 5" stroke="#fef3c7" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M11 16 l-4 5" stroke="#9a3412" stroke-width="0.6" stroke-linecap="round"/>
  `),

  // 面具（trickster / 戏剧面具）
  mask: svg(`
    <path d="M3 9 c0 -2.5 2 -4 5 -4 c2 0 3 1 4 2 c1 -1 2 -2 4 -2 c3 0 5 1.5 5 4 c0 4 -3 8 -6 8 c-1.5 0 -2.5 -0.7 -3 -1.5 c-0.5 0.8 -1.5 1.5 -3 1.5 c-3 0 -6 -4 -6 -8 z"
          fill="#9333ea" stroke="#3b0764" stroke-width="0.7"/>
    <circle cx="8" cy="11" r="1.2" fill="#fafafa"/>
    <circle cx="16" cy="11" r="1.2" fill="#fafafa"/>
    <path d="M10 16 c1 0.5 3 0.5 4 0" stroke="#fafafa" stroke-width="0.8" fill="none" stroke-linecap="round"/>
  `),

  // 十字架
  cross: svg(`
    <rect x="10.4" y="2" width="3.2" height="20" rx="0.4" fill="#fcd34d" stroke="#78350f" stroke-width="0.6"/>
    <rect x="4" y="7" width="16" height="3.2" rx="0.4" fill="#fcd34d" stroke="#78350f" stroke-width="0.6"/>
  `),

  // 斧头
  axe: svg(`
    <path d="M3 5 l8 -2 l4 6 l-4 6 l-8 -2 l2 -4 z" fill="#a3a3a3" stroke="#1f2937" stroke-width="0.7"/>
    <rect x="11" y="9" width="9" height="2" rx="0.4" fill="#7c2d12" transform="rotate(15 15 10)" stroke="#1f2937" stroke-width="0.5"/>
    <ellipse cx="6" cy="9.5" rx="1.5" ry="0.6" fill="rgba(255,255,255,0.5)"/>
  `),

  // 盾牌
  shield: svg(`
    <path d="M12 2 l8 3 v6 c0 5 -3 9 -8 11 c-5 -2 -8 -6 -8 -11 v-6 z"
          fill="#3b82f6" stroke="#1e3a8a" stroke-width="0.8"/>
    <path d="M12 5 l6 2 v5 c0 3 -2 6 -6 8 c-4 -2 -6 -5 -6 -8 v-5 z" fill="rgba(255,255,255,0.18)"/>
    <path d="M12 9 v6 M9 12 h6" stroke="#fef3c7" stroke-width="1.4" stroke-linecap="round"/>
  `),

  // 拳头
  fist: svg(`
    <path d="M5 9 c0 -2 2 -3 4 -3 h7 c2 0 3 1 3 2 v9 c0 1.5 -1 2 -3 2 h-9 c-2 0 -3 -1 -3 -2 z"
          fill="#fbbf24" stroke="#78350f" stroke-width="0.8"/>
    <path d="M9 10 v6 M12 10 v6 M15 10 v6" stroke="#92400e" stroke-width="0.8"/>
    <path d="M5 9 c-1.5 0 -2 1 -2 2 v3 c0 1 0.5 2 2 2" fill="#fbbf24" stroke="#78350f" stroke-width="0.7"/>
  `),

  // 弓箭
  bow: svg(`
    <path d="M5 3 c4 4 8 12 4 18" stroke="#15803d" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <line x1="5" y1="3" x2="9" y2="21" stroke="#fef3c7" stroke-width="0.5" stroke-dasharray="2 2"/>
    <path d="M3 12 l16 0 M19 12 l-3 -2 M19 12 l-3 2" stroke="#7c2d12" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3 11 l-1 1 l1 1 z" fill="#7c2d12"/>
  `),

  // 音符
  note: svg(`
    <ellipse cx="7" cy="18" rx="3" ry="2" fill="#7c3aed" stroke="#3b0764" stroke-width="0.6"/>
    <ellipse cx="17" cy="16" rx="3" ry="2" fill="#7c3aed" stroke="#3b0764" stroke-width="0.6"/>
    <path d="M10 18 v-13 l10 -2 v13" stroke="#3b0764" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10 7 l10 -2" stroke="#3b0764" stroke-width="1.6" fill="none"/>
  `),

  // 鲁特琴
  lute: svg(`
    <ellipse cx="11" cy="16" rx="6" ry="6.5" fill="#92400e" stroke="#3f1d04" stroke-width="0.8"/>
    <circle cx="11" cy="16" r="2.5" fill="#3f1d04"/>
    <rect x="13" y="3" width="2" height="11" rx="0.4" fill="#78350f" stroke="#3f1d04" stroke-width="0.5"/>
    <rect x="12" y="2" width="4" height="2" rx="0.4" fill="#3f1d04"/>
    <path d="M14 5 v10 M14 9 h-1 M14 11 h-1" stroke="#fef3c7" stroke-width="0.4"/>
  `),

  // 匕首
  dagger: svg(`
    <path d="M12 2 l1.5 12 l-3 0 z" fill="#cbd5e1" stroke="#1e293b" stroke-width="0.7"/>
    <rect x="10" y="14" width="4" height="1.4" fill="#7c2d12" stroke="#1e293b" stroke-width="0.5"/>
    <rect x="9" y="14" width="6" height="1" fill="#92400e" stroke="#1e293b" stroke-width="0.5"/>
    <rect x="11" y="15.4" width="2" height="6" rx="0.3" fill="#7c2d12" stroke="#1e293b" stroke-width="0.5"/>
    <ellipse cx="11.5" cy="6" rx="0.4" ry="3" fill="rgba(255,255,255,0.5)"/>
  `),

  // 闪电
  lightning: svg(`
    <path d="M14 2 l-9 11 l5 0 l-3 9 l9 -12 l-5 0 z"
          fill="#facc15" stroke="#78350f" stroke-width="0.7" stroke-linejoin="round"/>
    <path d="M14 2 l-7 9 l5 0" fill="rgba(255,255,255,0.35)"/>
  `),

  // 血滴
  bloodDrop: svg(`
    <path d="M12 2 c-3 5 -6 9 -6 12 a6 6 0 0 0 12 0 c0 -3 -3 -7 -6 -12 z"
          fill="#dc2626" stroke="#7f1d1d" stroke-width="0.8"/>
    <ellipse cx="10" cy="13" rx="1.4" ry="2.4" fill="rgba(255,255,255,0.35)"/>
  `),

  // 树叶
  leaf: svg(`
    <path d="M3 21 c2 -10 9 -16 18 -18 c0 9 -8 17 -18 18 z"
          fill="#22c55e" stroke="#14532d" stroke-width="0.7"/>
    <path d="M5 19 c4 -7 10 -13 16 -16" stroke="#14532d" stroke-width="0.6" fill="none"/>
    <path d="M8 16 l-2 1 M11 13 l-2 1 M14 10 l-2 1" stroke="#14532d" stroke-width="0.5" fill="none" stroke-linecap="round"/>
  `),

  // 水滴
  waterDrop: svg(`
    <path d="M12 2 c-4 7 -7 11 -7 14 a7 7 0 0 0 14 0 c0 -3 -3 -7 -7 -14 z"
          fill="#0ea5e9" stroke="#0c4a6e" stroke-width="0.7"/>
    <path d="M9 14 c0 2 1 3 2 3" stroke="rgba(255,255,255,0.6)" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  `),

  // 魔法书
  spellbook: svg(`
    <path d="M4 4 l8 -1 l8 1 v15 l-8 1 l-8 -1 z" fill="#7e22ce" stroke="#3b0764" stroke-width="0.8"/>
    <path d="M12 3 v17" stroke="#3b0764" stroke-width="0.8"/>
    <path d="M8 8 l3 0 M8 11 l3 0 M14 8 l2 0 M14 11 l2 0" stroke="#fef3c7" stroke-width="0.6"/>
    <circle cx="12" cy="14" r="2" fill="#fbbf24" stroke="#78350f" stroke-width="0.5"/>
    <path d="M10.5 14 l1 1 l2 -2" stroke="#78350f" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  `),
};

/** Display labels for the icon picker UI. */
export const ICON_LABELS: Record<IconId, string> = {
  gem: "宝石",
  heart: "心",
  starFour: "四角星",
  starFive: "五芒星",
  skull: "骷髅",
  hourglass: "沙漏",
  catEye: "猫眼石",
  gear: "齿轮",
  swords: "双剑",
  apple: "苹果",
  drumstick: "鸡腿",
  mask: "面具",
  cross: "十字架",
  axe: "斧头",
  shield: "盾牌",
  fist: "拳头",
  bow: "弓箭",
  note: "音符",
  lute: "琴",
  dagger: "匕首",
  lightning: "闪电",
  bloodDrop: "血滴",
  leaf: "树叶",
  waterDrop: "水滴",
  spellbook: "魔法书",
};

export const ICON_IDS: IconId[] = Object.keys(ICON_LIBRARY) as IconId[];
