import { ENTRY_EFFECTS, EXIT_EFFECTS, HOLD_EFFECTS, ORNAMENTS, FLOWS, EASINGS, ORDERS, DIRECTIONS, SUB_EFFECTS } from './catalog';
import { BLOCK_EFFECTS } from './motion';
export const FONTS = { sans: '"Microsoft YaHei", "PingFang SC", sans-serif', serif: '"Full Text Serif", "Noto Serif SC", "Songti SC", SimSun, serif', mono: 'Consolas, "Microsoft YaHei", monospace', kai: 'KaiTi, STKaiti, "Songti SC", serif', rounded: 'YouYuan, "Yuanti SC", "Microsoft YaHei", sans-serif', song: 'SimSun, "Songti SC", serif', roman: '"Full Text Roman", "Palatino Linotype", "Book Antiqua", Georgia, serif' } as const;
export const MOTIONS = ['fade', 'rise', 'left', 'right', 'zoom', 'typewriter'] as const;
export const DECORATIONS = ORNAMENTS.map(item => item.id);
export const DEFAULT_CONFIG = {
  version: 1 as const, title: '战斗开始', subtitle: 'BATTLE START', body: '', font: 'serif' as keyof typeof FONTS, size: 9.6875,
  color: '#ffffff', accent: '#ffffff', outline: 0, outlineColor: '#241a19', glow: 0, spacing: 12,
  align: 'center' as 'left'|'center'|'right', position: 'center' as 'top'|'center'|'bottom', motion: 'fade' as typeof MOTIONS[number], decoration: 'frame', background: 'transparent', backgroundColor: '#161522',
  opacity: .45, enter: 550, hold: 1400, exit: 500, entry: 'drop', leave: 'through', idle: 'none',
  entryDirection: 'left', exitDirection: 'right', entryOrder: 'forward', exitOrder: 'forward', entryEase: 'auto', exitEase: 'auto',
  entryPower: 1.1, exitPower: 1, idlePower: 1, entryStagger: .1, sequence: 'staged' as 'staged'|'parallel', exitStagger: 0,
  flow: 'all', cps: 18, lineInterval: 650, sweepTime: 900, punctPause: 180, linePause: 350,
  spreadHold: 350, spreadTime: 900, soloSize: .48, soloPause: 250, soloImpact: 1,
  scrollSpeed: 80, scrollFade: true, cursor: false, cursorColor: '#fff2d5', pageSplit: true, pageGap: 300, wrapChars: 0,
  fill: 'solid' as 'solid'|'gradient', color2: '#bc7838', color3: '#ffffff', thirdColor: false, gradientDirection: 'vertical', fillOpacity: 1,
  weight: 800, italic: false, writing: 'horizontal' as 'horizontal'|'vertical', lineHeight: 1.5, bodySize: 3.2,
  subtitleFont: 'roman', subtitleWeight: 700, subtitleItalic: false, subtitleSize: .2, subtitleSpacing: 60,
  subtitleGap: .62, subtitlePosition: 'below', subtitleColor: '#ffffff', subtitleEffect: 'fade', subtitleDelay: -100,
  outerOutline: 0, outerOutlineColor: '#ffffff', shadow: true, shadowColor: '#000000', shadowOpacity: .35,
  shadowBlur: 10, shadowX: 0, shadowY: 3, glowColor: '#ffffff', glowStrength: 1,
  glitchColor: '#ff4365', glitchColor2: '#44dce7', decorationColor: '#161522', decorationLineColor: '#ffffff',
  decorationOpacity: 0, decorationThickness: 3, decorationPadding: .28, decorationExtend: 12,
  decorationRadius: .12, decorationSoftness: .2, decorationFade: .25, decorationOutline: false,
  decorationAnimation: 'grow', decorationTime: 600, tapeStripe: '#17191f', tapeWidth: 26, tapeSpeed: 80, tapeBlink: 0,
  anchor: 'center-center', marginX: 5, marginY: 7.7778, offsetX: 0, offsetY: 0,
  backgroundSync: true, startDelay: 100, endDelay: 300,
};
export type TextEffectConfig = typeof DEFAULT_CONFIG;
const member = (value: unknown, values: readonly string[]) => typeof value === 'string' && values.includes(value);
const number = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const color = (value: unknown) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
export const BOUNDS: Partial<Record<keyof TextEffectConfig, [number, number]>> = {
  size: [2,25], outline: [0,12], glow: [0,150], spacing: [-20,120], opacity: [0,1], enter: [0,4000], hold: [500,20000], exit: [0,4000],
  entryPower: [.2,2.5], exitPower: [.2,2.5], idlePower: [.2,3], entryStagger: [0,.8], exitStagger: [0,.8],
  cps: [2,80], lineInterval: [100,4000], sweepTime: [200,5000], punctPause: [0,1500], linePause: [0,2000],
  spreadHold: [0,3000], spreadTime: [100,3000], soloSize: [.15,.9], soloPause: [0,2000], soloImpact: [0,2],
  scrollSpeed: [10,400], pageGap: [0,3000], wrapChars: [0,60], fillOpacity: [0,1],
  weight: [100,900], lineHeight: [.9,3.2], bodySize: [1.5,10], subtitleWeight: [100,900], subtitleSize: [.1,.9],
  subtitleSpacing: [-20,150], subtitleGap: [0,1.5], subtitleDelay: [-2000,2000],
  outerOutline: [0,16], shadowOpacity: [0,1], shadowBlur: [0,80], shadowX: [-60,60], shadowY: [-60,60], glowStrength: [.2,3],
  decorationOpacity: [0,1], decorationThickness: [0,16], decorationPadding: [0,2], decorationExtend: [0,12],
  decorationRadius: [0,1], decorationSoftness: [0,1], decorationFade: [0,1], decorationTime: [100,2500],
  tapeWidth: [8,120], tapeSpeed: [0,400], tapeBlink: [0,1], marginX: [0,30], marginY: [0,30],
  offsetX: [-40,40], offsetY: [-40,40], startDelay: [0,3000], endDelay: [0,5000],
};
const ids = (values: {id:string}[]) => values.map(value => value.id);
const enums: Partial<Record<keyof TextEffectConfig, string[]>> = {
  sequence:['staged','parallel'], font: Object.keys(FONTS), motion: [...MOTIONS], decoration: DECORATIONS, align: ['left','center','right'], position: ['top','center','bottom'],
  background: ['transparent','band','dim','solid','vignette','bottom','top'], entry: ids(ENTRY_EFFECTS), leave: ids(EXIT_EFFECTS), idle: ids(HOLD_EFFECTS), flow: ids(FLOWS),
  entryDirection: ids(DIRECTIONS), exitDirection: ids(DIRECTIONS), entryOrder: ids(ORDERS), exitOrder: ids(ORDERS), entryEase: ids(EASINGS), exitEase: ids(EASINGS),
  fill: ['solid','gradient'], gradientDirection: ['vertical','horizontal','diagonal'], writing: ['horizontal','vertical'],
  subtitleFont: ['same',...Object.keys(FONTS)], subtitlePosition: ['above','below'], subtitleEffect: ids(SUB_EFFECTS), decorationAnimation: ['grow','fade','none'],
  anchor: ['top-left','top-center','top-right','center-left','center-center','center-right','bottom-left','bottom-center','bottom-right'],
};
const legacy = ['version','title','subtitle','body','font','size','color','accent','outline','outlineColor','glow','spacing','align','position','motion','decoration','background','backgroundColor','opacity','enter','hold','exit'];
export function parseConfig(value: unknown): TextEffectConfig|null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string,unknown>;
  if (legacy.some(key => !Object.hasOwn(source,key))) return null;
  const v = {...DEFAULT_CONFIG,...source} as TextEffectConfig;
  if(!Object.hasOwn(source,'sequence'))v.sequence='parallel';
  if (v.version !== 1 || typeof v.title !== 'string' || v.title.length > 160 || typeof v.subtitle !== 'string' || v.subtitle.length > 240 || typeof v.body !== 'string' || v.body.length > 1800) return null;
  if (['rays','mist','sparks','rings'].includes(v.decoration)) v.decoration='none';
  if(v.idle==='glow')v.idle='none';
  for (const [key,range] of Object.entries(BOUNDS)) if (!number(v[key as keyof TextEffectConfig], ...range!)) return null;
  for (const [key,values] of Object.entries(enums)) if (!member(v[key as keyof TextEffectConfig],values!)) return null;
  for (const [key,fallback] of Object.entries(DEFAULT_CONFIG)) {
    const current = v[key as keyof TextEffectConfig];
    if (typeof fallback === 'boolean' && typeof current !== 'boolean' || typeof fallback === 'string' && key.toLowerCase().includes('color') && !color(current) || ['accent','tapeStripe'].includes(key) && !color(current)) return null;
  }
  if (!Object.hasOwn(source,'entry')) { v.entry = v.motion === 'zoom' ? 'shrink' : ['left','right'].includes(v.motion) ? 'slide' : v.motion; if (['left','right'].includes(v.motion)) v.entryDirection = v.motion; }
  if (!Object.hasOwn(source,'anchor')) v.anchor = `${v.position}-${v.align}`;
  if (!Object.hasOwn(source,'subtitleColor')) v.subtitleColor = v.accent;
  if (!Object.hasOwn(source,'glowColor')) v.glowColor = v.accent;
  if (!Object.hasOwn(source,'decorationLineColor')) v.decorationLineColor = v.accent;
  v.glow=0;v.glowStrength=1;
  return Object.fromEntries(Object.keys(DEFAULT_CONFIG).map(key => [key,v[key as keyof TextEffectConfig]])) as TextEffectConfig;
}
export function narrationTime(c:TextEffectConfig) {
  if (!c.body || c.flow === 'all') return 0;
  const chars = Array.from(c.body).length, lines = c.body.split('\n').reduce((sum,line) => sum + Math.max(1,Math.ceil(Array.from(line).length/(c.wrapChars||24))),0);
  if (c.flow === 'char') return chars/c.cps*1000 + (c.body.match(/[，。！？、,.!?;；：:]/g)?.length||0)*c.punctPause + (c.body.match(/\n/g)?.length||0)*c.linePause;
  if (c.flow === 'solo') return chars/c.cps*1000+c.soloPause;
  if (c.flow === 'spread') return c.spreadHold+c.spreadTime;
  if (c.flow === 'scroll') return (lines*640*c.bodySize/100*c.lineHeight+360)/c.scrollSpeed*1000;
  return Math.max(1,lines)*c.lineInterval+(c.flow === 'sweep' ? c.sweepTime : c.enter);
}
export function presentationTimes(c:TextEffectConfig) {
 const glyphs=(text:string)=>Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)).filter(g=>g.segment.trim()).length;
 const staged=c.sequence==='staged',lead=staged&&['band','tape','frame','box'].includes(c.decoration)&&c.decorationAnimation!=='none'?Math.min(300,c.decorationTime*.6):0;
 const mainDelay=staged&&!BLOCK_EFFECTS.has(c.entry)?Math.min(3000,Math.max(0,glyphs(c.title)-1)*c.entryStagger*1000):0,main=c.enter+mainDelay;
 const subtitleDelay=staged&&c.subtitleEffect!=='fade'?Math.min(3000,Math.max(0,glyphs(c.subtitle)-1)*(c.subtitleEffect==='same'?Math.min(.05,c.entryStagger):.035)*1000):0;
 const subtitleStart=staged?Math.max(lead,lead+main+c.subtitleDelay):Math.max(0,c.subtitleDelay),subtitle=(staged&&c.subtitleEffect==='fade'?600:c.enter)+subtitleDelay;
 return {lead,main,mainDelay,subtitleStart,subtitle,subtitleDelay,arrival:Math.max(lead+main,c.subtitle?subtitleStart+subtitle:0)};
}
export const entryTime = (c:TextEffectConfig) => presentationTimes(c).arrival;
export const exitTime = (c:TextEffectConfig) => c.sequence==='staged'&&c.decoration!=='none'&&c.decorationAnimation!=='none'?Math.max(c.exit,c.exit*.35+c.decorationTime):c.exit;
export const duration = (c:TextEffectConfig) => Math.round(c.startDelay+entryTime(c)+narrationTime(c)+c.hold+exitTime(c)+c.endDelay);
export const hasContent = (c:TextEffectConfig) => !!(c.title.trim()||c.subtitle.trim()||c.body.trim()||c.decoration!=='none'||c.background!=='transparent'&&c.opacity>0);
export const PRESETS: {name:string;config:TextEffectConfig}[] = [{name:'默认演出',config:{...DEFAULT_CONFIG}}];
