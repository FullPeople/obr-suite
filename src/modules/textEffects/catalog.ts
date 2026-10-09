export interface EffectChoice { id: string; label: string; group?: string }
const list = (items: [string, string, string?][]): EffectChoice[] => items.map(([id, label, group]) => ({ id, label, group }));
export const ENTRY_EFFECTS = list([
  ['fade','淡入','轻柔'], ['rise','浮现','轻柔'], ['drop','落下','移动'], ['converge','上下汇合','移动'],
  ['slide','滑入','移动'], ['tracking','字距收拢','文字'], ['spread','中央展开','文字'], ['blur','模糊变清晰','轻柔'],
  ['pop','弹出','弹性'], ['shrink','由大缩小','空间'], ['spin','旋转','空间'], ['flip','翻转','空间'],
  ['bounce','落下弹跳','弹性'], ['assemble','聚合','空间'], ['typewriter','打字机','文字'], ['flicker','明灭','特殊'],
  ['slam','重击砸入','特殊'], ['approach','逼近','空间'], ['emerge','深处浮现','空间'], ['wipe','擦入','遮罩'],
  ['shutter','展开','遮罩'], ['glitch','故障','特殊'], ['flash','闪光','特殊'],
]);
export const EXIT_EFFECTS = list([
  ['none','保持至结束','基础'], ['fade','淡出','基础'], ['rise','向上消失','移动'], ['sink','向下沉没','移动'],
  ['diverge','上下分离','移动'], ['slide','滑出','移动'], ['tracking','字距散开','文字'], ['blur','逐渐模糊','基础'],
  ['grow','膨胀消失','空间'], ['shrink','缩小消失','空间'], ['scatter','飞散','空间'], ['erase','逐字消除','文字'],
  ['flicker','明灭','特殊'], ['through','逼近消失','空间'], ['recede','远去','空间'], ['wipe','擦出','遮罩'],
  ['shutter','收起','遮罩'], ['glitch','故障','特殊'],
]);
export const HOLD_EFFECTS = list([['none','静止'], ['float','轻轻飘浮'], ['wave','波浪'], ['pulse','心跳'],
  ['shake','颤抖'], ['glow','光晕明灭'], ['flicker','忽明忽暗'], ['blink','闪烁'], ['glitch','间歇故障']]);
export const ORNAMENTS = list([['none','无'], ['band','色带'], ['tape','警戒胶带'], ['box','方框'], ['frame','标题框'],
  ['lines','上下线'], ['underline','下划线'], ['sides','两侧线'], ['bar','强调条'], ['corners','角框'],
  ['rays','光芒'], ['mist','雾气'], ['sparks','光点'], ['rings','光环']]);
export const FLOWS = list([['all','整体显示'], ['char','逐字'], ['solo','中央逐字'], ['spread','中央展开'],
  ['line','逐行'], ['sweep','流畅扫过'], ['scroll','滚动']]);
export const EASINGS = list([['auto','自动'], ['out','减速'], ['strong','强减速'], ['smooth','平滑'], ['back','超出回弹'],
  ['elastic','弹簧'], ['bounce','弹跳'], ['linear','匀速'], ['in','加速']]);
export const ORDERS = list([['forward','从开头'], ['reverse','从末尾'], ['center','从中间'], ['edges','从两端'], ['random','随机']]);
export const DIRECTIONS = list([['left','左'], ['right','右'], ['up','上'], ['down','下'], ['center','中央'], ['vertical','上下'], ['horizontal','左右']]);
export const SUB_EFFECTS = [{ id: 'same', label: '跟随标题' }, ...ENTRY_EFFECTS.filter(effect => ['fade','rise','blur','tracking','typewriter','slide'].includes(effect.id))];
export const STYLE_PRESETS = [
  { name:'暖金',color:'#fff2d5',color2:'#bc7838',accent:'#e5a45b',fill:'gradient',outlineColor:'#31211d',glow:18 },
  { name:'银白',color:'#ffffff',color2:'#a4b1c8',accent:'#c6d5ee',fill:'gradient',outlineColor:'#28313e',glow:12 },
  { name:'朱红',color:'#fff1e2',color2:'#d0313f',accent:'#ee4652',fill:'gradient',outlineColor:'#421c24',glow:18 },
  { name:'冰蓝',color:'#eefbff',color2:'#55a9e0',accent:'#7dd3ef',fill:'gradient',outlineColor:'#163849',glow:16 },
  { name:'幽紫',color:'#eee4ff',color2:'#9370db',accent:'#b995ef',fill:'gradient',outlineColor:'#30213e',glow:22 },
  { name:'墨色',color:'#25272e',color2:'#25272e',accent:'#50525b',fill:'solid',outlineColor:'#ffffff',glow:0 },
] as const;
