export const FONTS = { sans: '"Microsoft YaHei", "PingFang SC", sans-serif', serif: '"Noto Serif SC", "Songti SC", SimSun, serif', mono: 'Consolas, "Microsoft YaHei", monospace' } as const;
export const MOTIONS = ['fade', 'rise', 'left', 'right', 'zoom', 'typewriter'] as const;
export const DECORATIONS = ['none', 'rays', 'mist', 'sparks', 'rings'] as const;
export interface TextEffectConfig {
  version: 1; title: string; subtitle: string; body: string;
  font: keyof typeof FONTS; size: number; color: string; accent: string;
  outline: number; outlineColor: string; glow: number; spacing: number;
  align: 'left' | 'center' | 'right'; position: 'top' | 'center' | 'bottom';
  motion: typeof MOTIONS[number]; decoration: typeof DECORATIONS[number];
  background: 'transparent' | 'band' | 'dim' | 'solid'; backgroundColor: string; opacity: number;
  enter: number; hold: number; exit: number;
}
export const DEFAULT_CONFIG: TextEffectConfig = {
  version: 1, title: '战斗开始', subtitle: '命运已掷下骰子', body: '',
  font: 'serif', size: 7, color: '#fff2d5', accent: '#e5a45b', outline: 1,
  outlineColor: '#241a19', glow: 22, spacing: 6, align: 'center', position: 'center',
  motion: 'zoom', decoration: 'rays', background: 'band', backgroundColor: '#161522',
  opacity: 0.75, enter: 900, hold: 2400, exit: 700,
};
const member = (value: unknown, values: readonly string[]) => typeof value === 'string' && values.includes(value);
const number = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const color = (value: unknown) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
export function parseConfig(value: unknown): TextEffectConfig | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as TextEffectConfig;
  if (v.version !== 1 || typeof v.title !== 'string' || v.title.length > 160
    || typeof v.subtitle !== 'string' || v.subtitle.length > 240 || typeof v.body !== 'string' || v.body.length > 1800
    || !member(v.font, Object.keys(FONTS)) || !number(v.size, 2, 14) || !color(v.color) || !color(v.accent)
    || !number(v.outline, 0, 4) || !color(v.outlineColor) || !number(v.glow, 0, 60) || !number(v.spacing, 0, 20)
    || !member(v.align, ['left', 'center', 'right']) || !member(v.position, ['top', 'center', 'bottom'])
    || !member(v.motion, MOTIONS) || !member(v.decoration, DECORATIONS)
    || !member(v.background, ['transparent', 'band', 'dim', 'solid']) || !color(v.backgroundColor) || !number(v.opacity, 0, 1)
    || !number(v.enter, 0, 3000) || !number(v.hold, 500, 20000) || !number(v.exit, 0, 3000)) return null;
  // Only normalized, bounded configuration crosses the room broadcast boundary.
  return Object.fromEntries(Object.keys(DEFAULT_CONFIG).map(key => [key, v[key as keyof TextEffectConfig]])) as unknown as TextEffectConfig;
}
export const duration = (config: TextEffectConfig) => config.enter + config.hold + config.exit;
export const hasContent = (c: TextEffectConfig) => !!(c.title.trim() || c.subtitle.trim() || c.body.trim() || c.decoration !== 'none' || c.background !== 'transparent' && c.opacity > 0);
export const PRESETS: { name: string; config: TextEffectConfig }[] = [
  { name: '战斗宣告', config: { ...DEFAULT_CONFIG } },
  { name: '暗处低语', config: { ...DEFAULT_CONFIG, title: '有人在暗处', subtitle: '你听见了什么？', color: '#dadce6', accent: '#8498b8', motion: 'fade', decoration: 'mist', background: 'dim', opacity: 0.45, glow: 12, spacing: 8, hold: 3200 } },
  { name: '地点字幕', config: { ...DEFAULT_CONFIG, title: '雾港', subtitle: '第三日 · 黄昏', size: 5, position: 'bottom', motion: 'rise', decoration: 'none', background: 'band', spacing: 4, hold: 4000 } },
  { name: '旁白', config: { ...DEFAULT_CONFIG, title: '', subtitle: '', body: '雨停了。\n远处的钟声，终于传来。', font: 'serif', size: 5, motion: 'fade', decoration: 'mist', background: 'dim', opacity: 0.65, hold: 6500 } },
  { name: '发现线索', config: { ...DEFAULT_CONFIG, title: '新的线索', subtitle: '一些碎片，开始连在一起', color: '#e5f4ff', accent: '#83cfea', motion: 'typewriter', decoration: 'sparks', background: 'transparent', spacing: 3, hold: 3000 } },
];
