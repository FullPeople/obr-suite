import { ENTRY_EFFECTS, EXIT_EFFECTS, HOLD_EFFECTS, ORNAMENTS, FLOWS, EASINGS, ORDERS, DIRECTIONS, SUB_EFFECTS } from './catalog';
export const FONTS = { sans: '"Microsoft YaHei", "PingFang SC", sans-serif', serif: '"Noto Serif SC", "Songti SC", SimSun, serif', mono: 'Consolas, "Microsoft YaHei", monospace', kai: 'KaiTi, STKaiti, "Songti SC", serif', rounded: 'YouYuan, "Yuanti SC", "Microsoft YaHei", sans-serif', song: 'SimSun, "Songti SC", serif' } as const;
export const MOTIONS = ['fade', 'rise', 'left', 'right', 'zoom', 'typewriter'] as const;
export const DECORATIONS = ORNAMENTS.map(item => item.id);
export const DEFAULT_CONFIG = {
  version: 1 as const, title: '战斗开始', subtitle: '命运已掷下骰子', body: '', font: 'serif' as keyof typeof FONTS, size: 7,
  color: '#fff2d5', accent: '#e5a45b', outline: 1, outlineColor: '#241a19', glow: 22, spacing: 6,
  align: 'center' as 'left'|'center'|'right', position: 'center' as 'top'|'center'|'bottom', motion: 'zoom' as typeof MOTIONS[number], decoration: 'rays', background: 'band', backgroundColor: '#161522',
  opacity: .75, enter: 900, hold: 2400, exit: 700, entry: 'shrink', leave: 'fade', idle: 'none',
  entryDirection: 'left', exitDirection: 'right', entryOrder: 'forward', exitOrder: 'forward', entryEase: 'auto', exitEase: 'auto',
  entryPower: 1, exitPower: 1, idlePower: 1, entryStagger: 0, exitStagger: 0,
  flow: 'all', cps: 18, lineInterval: 650, sweepTime: 900, punctPause: 180, linePause: 350,
  spreadHold: 350, spreadTime: 900, soloSize: .48, soloPause: 250, soloImpact: 1,
  scrollSpeed: 80, scrollFade: true, cursor: false, cursorColor: '#fff2d5', pageSplit: true, pageGap: 300, wrapChars: 0,
  fill: 'solid' as 'solid'|'gradient', color2: '#bc7838', color3: '#ffffff', thirdColor: false, gradientDirection: 'vertical', fillOpacity: 1,
  weight: 700, italic: false, writing: 'horizontal' as 'horizontal'|'vertical', lineHeight: 1.6, bodySize: 3.2,
  subtitleFont: 'same', subtitleWeight: 400, subtitleItalic: false, subtitleSize: .36, subtitleSpacing: 12,
  subtitleGap: .6, subtitlePosition: 'below', subtitleColor: '#e5a45b', subtitleEffect: 'same', subtitleDelay: 0,
  outerOutline: 0, outerOutlineColor: '#ffffff', shadow: true, shadowColor: '#000000', shadowOpacity: .7,
  shadowBlur: 8, shadowX: 0, shadowY: 2, glowColor: '#e5a45b', glowStrength: 1,
  glitchColor: '#ff4365', glitchColor2: '#44dce7', decorationColor: '#161522', decorationLineColor: '#e5a45b',
  decorationOpacity: .7, decorationThickness: 2, decorationPadding: .55, decorationExtend: 1,
  decorationRadius: .12, decorationSoftness: .2, decorationFade: .25, decorationOutline: false,
  decorationAnimation: 'grow', decorationTime: 700, tapeStripe: '#17191f', tapeWidth: 26, tapeSpeed: 80, tapeBlink: 0,
  anchor: 'center-center', marginX: 6, marginY: 6, offsetX: 0, offsetY: 0,
  backgroundSync: true, startDelay: 0, endDelay: 0,
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
  font: Object.keys(FONTS), motion: [...MOTIONS], decoration: DECORATIONS, align: ['left','center','right'], position: ['top','center','bottom'],
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
  if (v.version !== 1 || typeof v.title !== 'string' || v.title.length > 160 || typeof v.subtitle !== 'string' || v.subtitle.length > 240 || typeof v.body !== 'string' || v.body.length > 1800) return null;
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
export const entryTime = (c:TextEffectConfig) => c.enter+(c.subtitle?Math.max(0,c.subtitleDelay):0);
export const duration = (c:TextEffectConfig) => Math.round(c.startDelay+entryTime(c)+narrationTime(c)+c.hold+c.exit+c.endDelay);
export const hasContent = (c:TextEffectConfig) => !!(c.title.trim()||c.subtitle.trim()||c.body.trim()||c.decoration!=='none'||c.background!=='transparent'&&c.opacity>0);
export const PRESETS: {name:string;config:TextEffectConfig}[] = [
  {name:'战斗宣告',config:{...DEFAULT_CONFIG}},
  {name:'暗处低语',config:{...DEFAULT_CONFIG,title:'有人在暗处',subtitle:'你听见了什么？',color:'#dadce6',accent:'#8498b8',glowColor:'#8498b8',subtitleColor:'#8498b8',entry:'blur',idle:'float',motion:'fade',decoration:'mist',background:'dim',opacity:.45,glow:12,spacing:8,hold:3200}},
  {name:'地点字幕',config:{...DEFAULT_CONFIG,title:'雾港',subtitle:'第三日 · 黄昏',size:5,anchor:'bottom-center',position:'bottom',entry:'rise',motion:'rise',decoration:'lines',background:'bottom',spacing:4,hold:4000}},
  {name:'旁白',config:{...DEFAULT_CONFIG,title:'',subtitle:'',body:'雨停了。\n远处的钟声，终于传来。',font:'serif',size:5,entry:'fade',flow:'char',cursor:true,motion:'fade',decoration:'none',background:'dim',opacity:.65,hold:3500}},
  {name:'发现线索',config:{...DEFAULT_CONFIG,title:'新的线索',subtitle:'一些碎片，开始连在一起',color:'#e5f4ff',accent:'#83cfea',glowColor:'#83cfea',subtitleColor:'#83cfea',entry:'typewriter',leave:'tracking',motion:'typewriter',decoration:'sparks',background:'transparent',spacing:3,hold:3000}},
  {name:'警报',config:{...DEFAULT_CONFIG,title:'危险迫近',subtitle:'退路正在消失',color:'#fff3bd',accent:'#edc35d',decorationLineColor:'#edc35d',subtitleColor:'#edc35d',entry:'slam',idle:'pulse',leave:'glitch',decoration:'tape',background:'dim',glow:8,hold:2600}},
  {name:'信号中断',config:{...DEFAULT_CONFIG,title:'信号中断',subtitle:'连接另一端的人，已经离开',font:'mono',color:'#e5fbf8',accent:'#7ce8d6',subtitleColor:'#7ce8d6',entry:'glitch',idle:'glitch',leave:'glitch',decoration:'corners',background:'transparent',glow:4}},
  {name:'章节标题',config:{...DEFAULT_CONFIG,title:'第四章',subtitle:'风暴来临之前',entry:'tracking',leave:'wipe',fill:'gradient',decoration:'frame',background:'transparent',hold:3500}},
];
