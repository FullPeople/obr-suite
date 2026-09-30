import type {Kind} from './types';
/** Semantic result -> an existing engraved physical surface. Never manufacture an extra face. */
export function physicalRuleFace(kind:Kind,value:number):number|null{
  if(!Number.isSafeInteger(value))return null;
  if(kind==='d_percentile')return value>=0&&value<=90&&value%10===0?value:null;
  const sides=Number(kind.slice(1));if(value<1||value>sides)return null;
  return kind==='d10'&&value===10?0:value;
}
export const FLIP_DAMPING=2.4;
/** Inverse launch seed. The target is an already computed rule, NOT a requested random-roll face.
 * Jolt alone integrates each candidate; a wrong landing is rejected before any frame is shown. */
export function ruleFlipLaunch(normal:number[],q:number[],nominal:number,revision:number){
  const [x,y,z,w]=q,[nx,ny,nz]=normal,tx=2*(y*nz-z*ny),ty=2*(z*nx-x*nz),tz=2*(x*ny-y*nx);
  const target=[nx+w*tx+y*tz-z*ty,ny+w*ty+z*tx-x*tz,nz+w*tz+x*ty-y*tx];
  const angle=Math.acos(Math.max(-1,Math.min(1,target[1]))),length=Math.hypot(target[0],target[2]);
  const ax=length>1e-6?-target[2]/length:1,az=length>1e-6?target[0]/length:0;
  const phases=[-.16,0,-.32,.16,-.48,.32,-.64,.48],axisOffsets=[0,.16,-.16,.32,-.32,.55,-.55,1];
  const offset=axisOffsets[Math.floor(revision/phases.length)%axisOffsets.length],co=Math.cos(offset),si=Math.sin(offset);
  const height=Math.max(.05,Math.min(.07,nominal*2)),up=Math.sqrt(2*9.81*height),flight=2*up/9.81;
  const turn=Math.max(.12,angle+phases[revision%phases.length]);
  const spin=turn*FLIP_DAMPING/(1-Math.exp(-FLIP_DAMPING*flight));
  return{linear:[0,up,0],angular:[(ax*co-az*si)*spin,0,(ax*si+az*co)*spin],angle};
}
