/**
 * Direct port of the Desktop Dice C++ contract, so the web layer throws and settles dice the same
 * way the native program does. Units here are the native ones — metres, kilograms, seconds — and
 * only the trajectory boundary converts to the renderer's visual units (1 unit = 0.025 m).
 *
 * Sources: src/graphics/desktop_projection.h, src/physics/dice_throw_layout.cpp,
 * src/physics/dice_settle_policy.cpp, src/physics/dice_physics_limits.h, src/assets/dice_asset.cpp.
 */
import type {Kind} from './types';

export const REFERENCE_METERS=0.025;
const COS_TILT=0.984807753,SIN_TILT=0.173648178;
export const VISUAL_PER_METER=1/REFERENCE_METERS;

export const FIXED_STEP=1/240,MAX_SIM_SECONDS=8,MAX_SIM_SECONDS_STRESS=16;
export const SETTLE_TICKS=30;
export const SETTLE_LINEAR=0.003,SETTLE_ANGULAR=0.15,SETTLE_ALIGNMENT=0.95,SETTLE_ALIGNMENT_GAP=0.08;
export const SUPPORT_NORMAL_MIN_Y=0.25,SUPPORT_PLANE_TOLERANCE=0.00035,ELEVATED_SUPPORT_LIMIT=0.001;
export const WALL_HALF_THICKNESS=0.002,WALL_HALF_HEIGHT=0.060;
/** Native product cap: one batch is one physical launch of at most this many dice. */
export const NATIVE_BATCH=20;

export interface PhysicsParameters{nominal:number;mass:number;friction:number;restitution:number;linearDamping:number;angularDamping:number;convexRadius:number}
export const PHYSICS:Record<Kind,PhysicsParameters>={
  d4:{nominal:0.027,mass:0.0080,friction:0.62,restitution:0.08,linearDamping:0.045,angularDamping:0.15,convexRadius:0.000675},
  d6:{nominal:0.025,mass:0.0100,friction:0.50,restitution:0.01,linearDamping:0.045,angularDamping:0.14,convexRadius:0.00180},
  d8:{nominal:0.032,mass:0.0120,friction:0.56,restitution:0.07,linearDamping:0.040,angularDamping:0.65,convexRadius:0.00100},
  d10:{nominal:0.033,mass:0.0130,friction:0.32,restitution:0.06,linearDamping:0.040,angularDamping:0.16,convexRadius:0.00120},
  d12:{nominal:0.029,mass:0.0115,friction:0.58,restitution:0.02,linearDamping:0.040,angularDamping:0.35,convexRadius:0.00120},
  d20:{nominal:0.030,mass:0.0120,friction:0.57,restitution:0.02,linearDamping:0.040,angularDamping:0.13,convexRadius:0.00120},
  d_percentile:{nominal:0.033,mass:0.0130,friction:0.32,restitution:0.06,linearDamping:0.040,angularDamping:0.16,convexRadius:0.00120},
};
const POINTED:Kind[]=['d4','d8','d10','d_percentile'];
export const pointedCockedProfile=(kind:Kind)=>POINTED.includes(kind);
export const requiredFaceAlignment=(configured:number,kind:Kind)=>pointedCockedProfile(kind)?Math.max(0.9995,configured):configured;
export const requiredFaceSupportVertices=(kind:Kind)=>(kind==='d4'||kind==='d8'?3:4);
export const initialAngularSpeedScale=(kind:Kind)=>kind==='d6'?0.55:kind==='d20'?0.75:kind==='d8'?0.35:(kind==='d10'||kind==='d_percentile')?0.55:1;

/** splitmix64, bit-exact with src/physics/deterministic_random.h. */
export class DeterministicRandom{
  private state:bigint;
  constructor(seed:bigint){this.state=BigInt.asUintN(64,seed)}
  next64():bigint{
    const MASK=(1n<<64n)-1n;
    this.state=(this.state+0x9e3779b97f4a7c15n)&MASK;
    let v=this.state;
    v=((v^(v>>30n))*0xbf58476d1ce4e5b9n)&MASK;
    v=((v^(v>>27n))*0x94d049bb133111ebn)&MASK;
    return v^(v>>31n);
  }
  next():number{return Number(this.next64()>>11n)}
  unit():number{return Number(this.next64()>>11n)/9007199254740992}
  range(minimum:number,maximum:number):number{return minimum+(maximum-minimum)*this.unit()}
}
export const bigSeed=(seed:number|null|undefined)=>BigInt.asUintN(64,BigInt(seed??0));

export interface Projection{width:number;height:number;pixelsPerDie:number}
export const makeProjection=(width:number,height:number):Projection=>({width,height,pixelsPerDie:Math.min(210,Math.max(120,Math.min(width,height)*0.13))});
export interface Bounds{minX:number;maxX:number;minZ:number;maxZ:number}
export function unionBounds(a:Bounds,b:Bounds):Bounds{return{minX:Math.min(a.minX,b.minX),maxX:Math.max(a.maxX,b.maxX),minZ:Math.min(a.minZ,b.minZ),maxZ:Math.max(a.maxZ,b.maxZ)}}
/** Fit the same physical table on every viewport, preserving the ordinary native projection.
 * Dense batches widen the physical table, so they must visibly zoom out rather than land offscreen. */
export function fitPixelsPerDie(p:Projection,bounds:Bounds[]):number{
  let pixels=p.pixelsPerDie;
  // Fitting y=0 alone clips the top of a die against the far wall: the tilted projection
  // also lifts its height towards screen top. Include the tallest locked hull and border.
  // ResizeObserver can report a temporarily collapsed layer. Keep the camera finite and
  // forward-facing until its usable size returns rather than subtracting an 8px border
  // from a 1px dimension and producing a negative projection scale.
  const headroom=.040*SIN_TILT+.001,border=Math.min(8,p.width*.25,p.height*.19);
  for(const b of bounds)pixels=Math.min(pixels,
    (p.width*.5-border)/((Math.max(Math.abs(b.minX),Math.abs(b.maxX))+.001)*VISUAL_PER_METER),
    (p.height*.62-border)/((Math.max(.001,b.maxZ)*COS_TILT+headroom)*VISUAL_PER_METER),
    (p.height*.38-border)/((Math.max(.001,-b.minZ)*COS_TILT+.001)*VISUAL_PER_METER));
  return pixels;
}
export const desktopGroundBounds=(p:Projection):Bounds=>{
  const metersPerPixel=REFERENCE_METERS/p.pixelsPerDie,halfWidth=p.width*0.5*metersPerPixel;
  return{minX:-halfWidth,maxX:halfWidth,minZ:-p.height*0.38*metersPerPixel/COS_TILT,maxZ:p.height*0.62*metersPerPixel/COS_TILT};
};
export const projectVisual=(p:Projection,x:number,y:number,z:number):[number,number]=>
  [p.width*0.5+x*p.pixelsPerDie,p.height*0.62-(z*COS_TILT+y*SIN_TILT)*p.pixelsPerDie];
/** Screen position of a physics point in metres, in CSS pixels with the origin at the top left. */
export const projectMeters=(p:Projection,x:number,y:number,z:number):[number,number]=>
  projectVisual(p,x*VISUAL_PER_METER,y*VISUAL_PER_METER,z*VISUAL_PER_METER);

export type EntryEdge='left'|'right'|'top'|'bottom';
export const ENTRY_EDGES:EntryEdge[]=['left','right','top','bottom'];
export const selectEntryEdge=(seed:bigint):EntryEdge=>ENTRY_EDGES[Number(new DeterministicRandom(seed^0x8f3f73b5cf1c9aden).next64()%4n)];

export interface InitialThrow{position:[number,number,number];rotation:[number,number,number,number];
  linear:[number,number,number];angular:[number,number,number];target:[number,number,number]}
/** src/physics/dice_throw_layout.cpp: separated lanes, two height tiers, one seeded entry edge. */
export const makeOffscreenInitialThrow=(seed:bigint,layoutSeed:bigint,kind:Kind,bounds:Bounds,
  edge:EntryEdge,dieIndex:number,diceCount:number):InitialThrow=>{
  const random=new DeterministicRandom(seed),nominal=PHYSICS[kind].nominal;
  const u1=random.unit(),u2=random.unit(),u3=random.unit();
  const rootOneMinusU1=Math.sqrt(Math.max(0,1-u1)),rootU1=Math.sqrt(Math.max(0,u1));
  const angle2=2*Math.PI*u2,angle3=2*Math.PI*u3;
  const rotation:[number,number,number,number]=[rootOneMinusU1*Math.sin(angle2),rootOneMinusU1*Math.cos(angle2),rootU1*Math.sin(angle3),rootU1*Math.cos(angle3)];

  const centerX=(bounds.minX+bounds.maxX)*0.5,centerZ=(bounds.minZ+bounds.maxZ)*0.5;
  const halfWidth=(bounds.maxX-bounds.minX)*0.5,halfDepth=(bounds.maxZ-bounds.minZ)*0.5;
  const laneCount=Math.max(1,Math.floor((diceCount+1)/2)),laneIndex=Math.floor(dieIndex/2);
  const laneRandom=new DeterministicRandom(layoutSeed^((BigInt(laneIndex)+1n)*0xd6e8feb86659fd93n));
  const upperTier=diceCount>1&&dieIndex%2!==0;
  const orderedLateral=diceCount>1?-1+2*(laneIndex+0.5)/laneCount:random.range(-0.65,0.65);
  const edgeMargin=nominal*0.82+0.006;
  const launchHeight=random.range(0.040,0.050)+(upperTier?0.055:0);
  const tierLateralOffset=upperTier?0.010:0;
  const targetLateralFactor=diceCount>1?0.72:0.40;
  let position:[number,number,number],target:[number,number,number];
  if(edge==='left'||edge==='right'){
    const originZ=centerZ+orderedLateral*halfDepth*0.78+laneRandom.range(-halfDepth*0.06,halfDepth*0.06)+tierLateralOffset;
    const targetZ=centerZ+orderedLateral*halfDepth*targetLateralFactor+laneRandom.range(-halfDepth*0.08,halfDepth*0.08)+tierLateralOffset;
    position=[edge==='left'?bounds.minX-edgeMargin:bounds.maxX+edgeMargin,launchHeight,originZ];
    target=[centerX+laneRandom.range(-halfWidth*0.24,halfWidth*0.24),0,targetZ];
  }else{
    const originX=centerX+orderedLateral*halfWidth*0.78+laneRandom.range(-halfWidth*0.06,halfWidth*0.06)+tierLateralOffset;
    const targetX=centerX+orderedLateral*halfWidth*targetLateralFactor+laneRandom.range(-halfWidth*0.08,halfWidth*0.08)+tierLateralOffset;
    position=[originX,launchHeight,edge==='top'?bounds.maxZ+edgeMargin:bounds.minZ-edgeMargin];
    target=[targetX,0,centerZ+laneRandom.range(-halfDepth*0.24,halfDepth*0.24)];
  }
  const dx=target[0]-position[0],dz=target[2]-position[2];
  const length=Math.hypot(dx,dz)||1;
  const direction:[number,number,number]=[dx/length,0,dz/length];
  let horizontalSpeed=random.range(0.48,0.60);
  if(upperTier){
    if(kind==='d10'||kind==='d_percentile')horizontalSpeed=random.range(0.44,0.52);
    else if(kind==='d20')horizontalSpeed=random.range(0.48,0.54);
  }
  let axis:[number,number,number]=[direction[2]+random.range(-0.06,0.06),random.range(-0.10,0.10),-direction[0]+random.range(-0.06,0.06)];
  const axisLength=Math.hypot(...axis)||1;
  axis=[axis[0]/axisLength,axis[1]/axisLength,axis[2]/axisLength];
  const spin=random.range(15,27)*initialAngularSpeedScale(kind);
  return{position,rotation,linear:[direction[0]*horizontalSpeed,random.range(0.22,0.38),direction[2]*horizontalSpeed],
    angular:[axis[0]*spin,axis[1]*spin,axis[2]*spin],target};
};

/** Lowest hull point of a die at this pose, in the same units as the hull. */
export function lowestHullPoint(hull:number[][],q:number[]):number{
  const[x,y,z,w]=q;let lowest=Infinity;
  for(const v of hull){
    const tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);
    const world=v[1]+w*ty+z*tx-x*tz;
    if(world<lowest)lowest=world;
  }
  return lowest;
}
/** World-space pitch/roll rate from two quaternions, used for the rolling-sound envelope. */
export function angularSpeedBetween(a:number[],b:number[],dt:number):number{
  const dot=Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]);
  return 2*Math.acos(Math.min(1,dot))/Math.max(1e-6,dt);
}
