export interface Pose { x: number; y: number; scale: number; sx: number; sy: number; rotation: number; flip: number; tilt: number; opacity: number; blur: number; brightness: number; glow: number; glitch: number; clip: string }
export interface MotionContext { size: number; x: number; y: number; index: number; count: number; seed: number; power: number; direction: string; ease: string }
export const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
export const noise = (seed: number, tick = 0) => { let x = Math.imul(seed + tick * 101 + 17, 1597334677); x ^= x >>> 13; return (x >>> 0) / 4294967295; };
export const neutral = (): Pose => ({ x:0,y:0,scale:1,sx:1,sy:1,rotation:0,flip:0,tilt:0,opacity:1,blur:0,brightness:1,glow:1,glitch:0,clip:'' });
export function easing(t: number, kind: string) {
  const p = clamp(t);
  switch (kind) {
    case 'linear': return p;
    case 'in': return p*p*p;
    case 'strong': return 1-Math.pow(1-p,5);
    case 'smooth': return p*p*(3-2*p);
    case 'back': return 1+Math.pow(p-1,2)*(2.8*(p-1)+1.8);
    case 'elastic': return 1-Math.cos(p*Math.PI*4)*Math.exp(-6*p)*(1-p);
    case 'bounce': return 1-Math.abs(Math.cos(p*Math.PI*3.5))*Math.pow(1-p,2);
    default: return 1-Math.pow(1-p,3);
  }
}
export function rank(index: number, count: number, order: string) {
  if (count < 2) return 0;
  if (order === 'reverse') return count-1-index;
  if (order === 'center') return Math.abs(index-(count-1)/2)*2;
  if (order === 'edges') return Math.min(index,count-1-index)*2;
  if (order === 'random') return noise(index+57)*(count-1);
  return index;
}
export const stagger = (p: number, index: number, count: number, order: string, amount: number) => clamp((p-(count>1?rank(index,count,order)/(count-1)*amount:0))/(1-amount));
const direction = (d: string): [number,number] => d==='right'?[1,0]:d==='up'?[0,-1]:d==='down'?[0,1]:[-1,0];
function wipe(p: number, d: string) {
  const cut = 100*(1-clamp(p));
  if (d === 'right') return `inset(0 0 0 ${cut}%)`;
  if (d === 'up') return `inset(${cut}% 0 0 0)`;
  if (d === 'down') return `inset(0 0 ${cut}% 0)`;
  if (d === 'center') return `inset(0 ${cut/2}% 0 ${cut/2}%)`;
  return `inset(0 ${cut}% 0 0)`;
}
export const BLOCK_EFFECTS = new Set(['slam','approach','emerge','through','recede','wipe','shutter','glitch','flash']);
export function entrance(effect: string, progress: number, c: MotionContext): Pose {
  const s = neutral(), p = clamp(progress), automatic = ['pop','flip'].includes(effect)?'back':effect==='bounce'?'bounce':['glitch','flicker','slam','typewriter'].includes(effect)?'linear':'out';
  const e = easing(p,c.ease==='auto'?automatic:c.ease), q = 1-e, size = c.size*c.power;
  s.opacity = clamp(p*4);
  switch (effect) {
    case 'fade': s.opacity=clamp(e); break;
    case 'rise': s.y=q*size*.8; break;
    case 'drop': s.y=-q*size*.8; break;
    case 'converge': s.y=q*size*(c.index%2?1:-1); break;
    case 'slide': { const [x,y]=direction(c.direction); s.x=x*q*size*1.8;s.y=y*q*size*1.8;break; }
    case 'tracking': s.x=c.x*q*.9*c.power; if(c.direction==='vertical') {s.y=c.y*q*.9*c.power;s.x=0;} break;
    case 'spread': s.x=-c.x*q;s.y=-c.y*q; break;
    case 'blur': s.blur=Math.max(0,q*size*.3);s.opacity=clamp(e);break;
    case 'pop': s.scale=Math.max(.01,e);break;
    case 'shrink': s.scale=1+q*1.6*c.power;break;
    case 'spin': s.rotation=-210*q*c.power;s.scale=.2+.8*e;break;
    case 'flip': if(['vertical','up','down'].includes(c.direction))s.tilt=110*q*c.power;else s.flip=110*q*c.power;break;
    case 'bounce': s.y=-q*size*1.8;break;
    case 'assemble': s.x=(noise(c.seed)-.5)*q*size*7;s.y=(noise(c.seed+19)-.5)*q*size*5;s.rotation=(noise(c.seed+73)-.5)*q*300;break;
    case 'typewriter': s.opacity=p>=.55?1:0;break;
    case 'flicker': s.opacity=p>=1?1:clamp(e)*(noise(c.seed,Math.floor(p*19))>.32?1:.12);break;
    case 'slam': {const arrival=clamp(p/.58);s.scale=1+(1-arrival)*2.5*c.power;s.opacity=clamp(arrival*3);const hit=Math.sin(clamp((p-.58)/.42)*Math.PI);s.x=(noise(c.seed,Math.floor(p*27))-.5)*size*.25*hit;s.y=(noise(c.seed+3,Math.floor(p*27))-.5)*size*.12*hit;break;}
    case 'approach': s.scale=.15+.85*e;s.blur=Math.max(0,q*size*.04);break;
    case 'emerge': s.scale=.65+.35*e;s.y=q*size*.18;s.blur=Math.max(0,q*size*.15);s.opacity=clamp(e);break;
    case 'wipe': s.clip=wipe(e,c.direction);s.opacity=1;break;
    case 'shutter': if(c.direction==='horizontal')s.sx=Math.max(.001,e);else s.sy=Math.max(.001,e);s.opacity=clamp(e*2);break;
    case 'glitch': s.glitch=clamp(1-p);s.x=(noise(c.seed,Math.floor(p*23))-.5)*size*.5*s.glitch;s.opacity=p>=1?1:noise(c.seed+7,Math.floor(p*11))>.25?clamp(p*3):.12;break;
    case 'flash': s.opacity=clamp(p*7);s.brightness=1+q*4*c.power;s.glow=1+q*5*c.power;break;
  }
  if(p>=1)return neutral();
  return s;
}
export function departure(effect: string, progress: number, c: MotionContext): Pose {
  if(effect==='none')return neutral();
  const p=clamp(progress), e=easing(p,c.ease==='auto'?'in':c.ease), s=neutral(), size=c.size*c.power;
  s.opacity=1-clamp(e);
  switch(effect){
    case 'rise':s.y=-e*size*.8;break;
    case 'sink':s.y=e*size*.8;break;
    case 'diverge':s.y=e*size*(c.index%2?1:-1);break;
    case 'slide':{const[x,y]=direction(c.direction);s.x=x*e*size*1.8;s.y=y*e*size*1.8;break;}
    case 'tracking':s.x=c.x*e*.9*c.power;if(c.direction==='vertical'){s.y=c.y*e*.9*c.power;s.x=0;}break;
    case 'blur':s.blur=Math.max(0,e*size*.35);break;
    case 'grow':s.scale=1+e*1.6*c.power;break;
    case 'shrink':s.scale=Math.max(.01,1-e);break;
    case 'scatter':s.x=(noise(c.seed)-.5)*e*size*7;s.y=(noise(c.seed+19)-.5)*e*size*5;s.rotation=(noise(c.seed+73)-.5)*e*300;break;
    case 'erase':s.opacity=p>=.5?0:1;break;
    case 'flicker':s.opacity=(1-p)*(noise(c.seed,Math.floor(p*19))>.32?1:.1);break;
    case 'through':s.scale=1+e*5*c.power;break;
    case 'recede':s.scale=Math.max(.03,1-e*.95);s.blur=e*size*.06;break;
    case 'wipe':s.clip=wipe(1-e,c.direction);s.opacity=1-p;break;
    case 'shutter':if(c.direction==='horizontal')s.sx=Math.max(.001,1-e);else s.sy=Math.max(.001,1-e);break;
    case 'glitch':s.glitch=p;s.x=(noise(c.seed,Math.floor(p*23))-.5)*size*.5*p;s.opacity=(1-p)*(noise(c.seed+7,Math.floor(p*11))>.2?1:.08);break;
  }
  if(p>=1){s.opacity=0;s.glitch=0;}
  return s;
}
export function holding(effect:string, time:number, c:MotionContext):Pose {
  const s=neutral(), t=time/1000, size=c.size*c.power;
  switch(effect){
    case 'float':s.y=Math.sin(t*2.2)*size*.06;s.rotation=Math.sin(t*1.3)*c.power;break;
    case 'wave':s.y=Math.sin(t*4-c.index*.48)*size*.1;break;
    case 'pulse':s.scale=1+Math.pow(Math.max(0,Math.sin(t*5)),8)*.075*c.power;break;
    case 'shake':s.x=(noise(c.seed,Math.floor(t*24))-.5)*size*.085;s.y=(noise(c.seed+19,Math.floor(t*24))-.5)*size*.06;break;
    case 'glow':s.glow=.45+(1+Math.sin(t*2.5))*.6*c.power;break;
    case 'flicker':s.opacity=noise(c.seed,Math.floor(t*9))>.15?1:.35;break;
    case 'blink':s.opacity=Math.sin(t*6)>-.25?1:.08;break;
    case 'glitch':{const burst=Math.floor(t*10)%29<3;s.glitch=burst?.8:0;s.x=burst?(noise(c.seed,Math.floor(t*30))-.5)*size*.24:0;s.opacity=burst?.75:1;break;}
  }
  return s;
}
