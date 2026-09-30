/**
 * Physics prediction, ported from the Desktop Dice C++ contract.
 *
 * One long-lived Jolt world holds the floor, the four screen-edge walls and every retained die, so a
 * later roll physically strikes the dice an earlier roll left on the desktop. A roll is predicted
 * end to end before it plays: the immutable pose track and the contact trace are what every client
 * replays, and the audio layer may only ever read sounds out of that trace.
 *
 * Public units are metres, kilograms and seconds. All engine lengths are conditioned by the same
 * factor of 40; the emitted trajectory uses visual units (1 unit = 0.025 m).
 */
import {KINDS,url,type Catalog,type Contact,type Kind,type Request,type Roll,type Viewport} from './types';
import * as N from './native';
import {spreadTargets,distributedThrow} from './launch-layout';
import {incomingBounds} from './physics-capacity';
import {physicalKinds} from './physics-kinds';
import {hiddenRequest,privateLaunchRotation} from './hidden-roll';
import type {PhysicalHop} from './physical-hop';
import {physicalRuleFace,ruleFlipLaunch,FLIP_DAMPING} from './rule-flip-launch';
import {predictRecipe} from './suite-formula';
import {DiceAssets} from './asset-loading';

/** User data round-trips through a 32-bit int in this binding, so the tags stay small. */
const FLOOR_TAG=1000000,WALL_TAG=1000001,INCUMBENT_TAG=1000002,ENTRY_TAG=1000003;
const MAX_RETAINED=8,WALL_BASE=900000,SAMPLE_EVERY=2;
// Numerical conditioning only: positions/velocities/gravity/tolerances all use the same scale.
// Time, mass, restitution, damping and the outward metre/second contract do not change.
const ENGINE_SCALE=40;

let J:any,loading:Promise<any>|null=null,world:any,bi:any,listener:any=null;
/** Retained dice from earlier rolls: static colliders that later rolls really hit. */
const incumbents=new Map<string,any[]>();
const incumbentBounds=new Map<string,N.Bounds>();
const incumbentKinds=new Map<string,Kind[]>();
// Local rule stages may tumble to a different pose. Keep that pose separately from raw roll
// witnesses; install it only during another rule prediction and always restore the real world.
const ruleRestPoses=new Map<string,{position:number[];rotation:number[]}>();
let slotCursor=0;
/** Contact trace of the roll being predicted, filled from the Jolt callback. */
let trace:Contact[]|null=null;
let sequence=0,activeCount=0,currentStep=0,boundaryContacts=0;
const supported:boolean[]=new Array(160).fill(false),supportSeen:boolean[]=new Array(160).fill(false);
const directRoot:boolean[]=new Array(160).fill(false),rooted:boolean[]=new Array(160).fill(false);
const rootedSeen:boolean[]=new Array(160).fill(false),parents=new Uint8Array(100*100);
const incumbentSeen:boolean[]=new Array(160).fill(false);
const entered:boolean[]=new Array(100).fill(false);
const entryEdges:number[]=new Array(100).fill(0);
const isWall=(tag:number)=>tag===WALL_TAG||(tag>=ENTRY_TAG&&tag<ENTRY_TAG+4);

function engine():Promise<any>{
  if(!loading){
    const moduleURL=new URL(url('vendor/jolt-physics.wasm.js'),self.location.origin).href;
    loading=(async()=>{
      const assets=new DiceAssets(progress=>self.postMessage({type:'load-progress',progress}));
      const lock=await assets.json<{version:string;files:Record<string,string>}>('vendor/lock.json');if(lock.version!=='1.1.0')throw Error('Jolt 版本不符合锁定合同: '+lock.version);
      assets.locks=Object.fromEntries(Object.entries(lock.files).map(([name,digest])=>['vendor/'+name,digest]));assets.plan(['vendor/jolt-physics.wasm.js','vendor/jolt-physics.wasm.wasm']);
      const [,binary]=await Promise.all([assets.bytes('vendor/jolt-physics.wasm.js'),assets.bytes('vendor/jolt-physics.wasm.wasm')]);
      const module=await import(/* @vite-ignore */ moduleURL).catch(error=>{throw Error(`Jolt 模块 ${moduleURL}: ${String(error)}`);});
      assets.stage('初始化物理引擎');J=await module.default({wasmBinary:new Uint8Array(binary),locateFile:(file:string)=>new URL(file,moduleURL).href});return J;
    })();
  }
  return loading;
}
/** The binding hands back a shared temporary for these reads: copy the components at once. */
const vec3=(v:any):number[]=>[v.GetX(),v.GetY(),v.GetZ()];
const metres=(v:any):number[]=>vec3(v).map(x=>x/ENGINE_SCALE);
const vec=(v:number[])=>new J.Vec3(v[0],v[1],v[2]);
const rvec=(v:number[])=>new J.RVec3(v[0]*ENGINE_SCALE,v[1]*ENGINE_SCALE,v[2]*ENGINE_SCALE);
const quat=(q:number[])=>new J.Quat(q[0],q[1],q[2],q[3]);
/** This binding hands the contact callbacks raw pointers; the C++ arguments are recovered here. */
const bodyOf=(pointer:number)=>J.wrapPointer(pointer,J.Body);
const manifoldOf=(pointer:number)=>J.wrapPointer(pointer,J.ContactManifold);
const tagOf=(body:any)=>body.GetUserData();
function boxShape(half:number[],radius:number){const size=vec(half.map(x=>x*ENGINE_SCALE));try{return new J.BoxShape(size,radius*ENGINE_SCALE)}finally{J.destroy(size)}}
function bodySettings(shape:any,position:number[],rotation:number[],motion:number,layer:number){
  const p=rvec(position),q=quat(rotation);try{return new J.BodyCreationSettings(shape,p,q,motion,layer)}finally{J.destroy(p);J.destroy(q)}
}
/** Returns one owned shape reference; use the same collider for prediction and authority recovery. */
function dieShape(kind:Kind,hull:number[][]){
  const parameters=N.PHYSICS[kind];
  if(kind==='d6'){const half=Math.max(...hull.flat().map(Math.abs)),shape=boxShape([half,half,half],parameters.convexRadius);shape.AddRef();return shape}
  const settings=new J.ConvexHullShapeSettings();
  try{settings.mMaxConvexRadius=parameters.convexRadius*ENGINE_SCALE;settings.mHullTolerance=parameters.nominal*1e-3*ENGINE_SCALE;settings.mMaxErrorConvexRadius=parameters.convexRadius*1.5*ENGINE_SCALE;
    for(const v of hull){const p=vec(v.map(x=>x*ENGINE_SCALE));settings.mPoints.push_back(p);J.destroy(p)}
    const result=settings.Create();try{if(result.HasError())throw Error('Jolt 凸包创建失败: '+String(result.GetError()));const shape=result.Get();shape.AddRef();return shape}finally{J.destroy(result)}
  }finally{J.destroy(settings)}
}
const destroyBody=(body:any)=>{const id=body.GetID();bi.RemoveBody(id);bi.DestroyBody(id)};
/** Inverse mass per active die: the native masses are known, so no inverse-mass binding is needed. */
let inverseMassByDie:number[]=[];
let scratchVector:any;
const setLinear=(body:any,v:number[])=>{scratchVector.Set(v[0]*ENGINE_SCALE,v[1]*ENGINE_SCALE,v[2]*ENGINE_SCALE);bi.SetLinearVelocity(body.GetID(),scratchVector)};
const setAngular=(body:any,v:number[])=>{scratchVector.Set(v[0],v[1],v[2]);bi.SetAngularVelocity(body.GetID(),scratchVector)};

/** Jolt SetMassProperties treats |principal inertia|² <= 1e-12 as zero and silently
 * substitutes a radius-one-metre sphere. Our 12 g / 32 mm d8 legitimately falls below
 * that threshold (inverse inertia 1.6–1.9 million, not 208). Install the actual tensor.
 * The seven hash-locked hulls have local principal axes; never assume this for new assets. */
function installDieInertia(body:any,shape:any,mass:number):boolean{
  const properties=shape.GetMassProperties();properties.ScaleToMass(mass);
  const columns=[0,1,2].map(i=>vec3(properties.mInertia.GetColumn3(i)));
  const diagonal=columns.map((column,i)=>column[i]),scale=Math.max(...diagonal);
  if(!diagonal.every(x=>Number.isFinite(x)&&x>0)||columns.some((column,i)=>column.some((x,j)=>i!==j&&Math.abs(x)>scale*1e-4)))
    throw Error('骰子惯量轴不符合锁定资产合同，拒绝球体回退');
  const inverse=diagonal.map(x=>1/x),motion=body.GetMotionProperties();
  const old=vec3(motion.GetLocalSpaceInverseInertia().GetDiagonal3());
  const corrected=old.some((x,i)=>Math.abs(x-inverse[i])>inverse[i]*.001);
  const rotation=quat([0,0,0,1]);scratchVector.Set(inverse[0],inverse[1],inverse[2]);
  try{motion.SetInverseInertia(scratchVector,rotation)}finally{J.destroy(rotation)}
  const installed=vec3(motion.GetInverseInertiaDiagonal());
  if(installed.some((x,i)=>Math.abs(x-inverse[i])>inverse[i]*1e-5))throw Error('骰子真实惯量写入失败');
  return corrected;
}

/** src/physics/d6_prediction_world.cpp: one world, native settings, never recreated per roll. */
function ensureWorld(){
  if(world)return;
  const settings=new J.JoltSettings();
  settings.mMaxBodies=832;settings.mMaxBodyPairs=8192;settings.mMaxContactConstraints=16384;
  const pair=new J.ObjectLayerPairFilterTable(2);pair.EnableCollision(0,1);pair.EnableCollision(1,1);
  const broadPhase=new J.BroadPhaseLayerInterfaceTable(2,2),a=new J.BroadPhaseLayer(0),b=new J.BroadPhaseLayer(1);
  broadPhase.MapObjectToBroadPhaseLayer(0,a);broadPhase.MapObjectToBroadPhaseLayer(1,b);J.destroy(a);J.destroy(b);
  const filter=new J.ObjectVsBroadPhaseLayerFilterTable(broadPhase,2,pair,2);
  settings.mObjectLayerPairFilter=pair;settings.mBroadPhaseLayerInterface=broadPhase;settings.mObjectVsBroadPhaseLayerFilter=filter;
  world=new J.JoltInterface(settings);J.destroy(settings);
  const physics=world.GetPhysicsSystem();bi=physics.GetBodyInterface();
  scratchVector=new J.Vec3(0,0,0);
  const config=physics.GetPhysicsSettings();
  Object.assign(config,{mSpeculativeContactDistance:.0015*ENGINE_SCALE,mPenetrationSlop:.0003*ENGINE_SCALE,mLinearCastThreshold:.02,
    mLinearCastMaxPenetration:.02,mManifoldTolerance:.0002*ENGINE_SCALE,mMaxPenetrationDistance:.0005*ENGINE_SCALE,
    mBodyPairCacheMaxDeltaPositionSq:(.0002*ENGINE_SCALE)**2,mContactPointPreserveLambdaMaxDistSq:(.002*ENGINE_SCALE)**2,
    mBodyPairCacheCosMaxDeltaRotationDiv2:Math.cos(.10*Math.PI/360),
    mMinVelocityForRestitution:.20*ENGINE_SCALE,mPointVelocitySleepThreshold:.002*ENGINE_SCALE,mNumPositionSteps:4});
  physics.SetPhysicsSettings(config);
  scratchVector.Set(0,-9.81*ENGINE_SCALE,0);physics.SetGravity(scratchVector);
  // The floor must continue well past the visible projection: an off-screen die is already under
  // physics before it enters the overlay, and must never fall through an arbitrary one-metre box.
  const shape=boxShape([4,0.002,4],0.0005);
  const body=bodySettings(shape,[0,-0.002,0],[0,0,0,1],J.EMotionType_Static,0);
  body.mFriction=0.8;body.mRestitution=0.01;
  const floor=bi.CreateBody(body);
  bi.AddBody(floor.GetID(),J.EActivation_DontActivate);
  bi.SetUserData(floor.GetID(),FLOOR_TAG);
  J.destroy(body);
  // Every JS-implemented interface function has to be assigned before SetContactListener.
  listener=new J.ContactListenerJS();
  listener.OnContactValidate=(a:number,b:number)=>{const ta=tagOf(bodyOf(a)),tb=tagOf(bodyOf(b));
    const wall=isWall(ta)?ta:isWall(tb)?tb:0,die=isWall(ta)?tb:isWall(tb)?ta:0;
    return die>0&&die<=activeCount&&!entered[die-1]&&entryEdges[die-1]===wall-ENTRY_TAG?J.ValidateResult_RejectAllContactsForThisBodyPair:J.ValidateResult_AcceptAllContactsForThisBodyPair;};
  listener.OnContactRemoved=()=>{};
  listener.OnContactPersisted=(a:number,b:number,m:number,s:any)=>collect(bodyOf(a),bodyOf(b),manifoldOf(m),false,s);
  listener.OnContactAdded=(a:number,b:number,m:number,s:any)=>collect(bodyOf(a),bodyOf(b),manifoldOf(m),true,s);
  physics.SetContactListener(listener);
}

/** src/physics/dice_contact_collector.cpp: only added contacts enter the trace; walls never do. */
function collect(body1:any,body2:any,manifold:any,record:boolean,_settings:any){
  const ud1=tagOf(body1),ud2=tagOf(body2);
  const floor1=ud1===FLOOR_TAG,floor2=ud2===FLOOR_TAG;
  if(!record){const die=floor1?ud2:floor2?ud1:0;if(die>0&&die<=activeCount&&directRoot[die-1])return}
  const wall1=!floor1&&isWall(ud1),wall2=!floor2&&isWall(ud2);
  const inc1=!floor1&&ud1===INCUMBENT_TAG,inc2=!floor2&&ud2===INCUMBENT_TAG;
  const env1=floor1||wall1||inc1,env2=floor2||wall2||inc2;
  const die1=!env1&&ud1>0&&ud1<=activeCount,die2=!env2&&ud2>0&&ud2<=activeCount;
  if((!env1&&!die1)||(!env2&&!die2))return;
  if(wall1||wall2){if(record)boundaryContacts++;return}
  const dieA=die1?ud1:0,dieB=die2?ud2:0;
  let recordEvent=record;
  if(inc1||inc2){
    const active=dieA>0?dieA:dieB;
    // A preserved collider can survive Jolt's contact cache; its first persisted callback is still
    // this roll's first contact with it and must enter the trace exactly once.
    if(active>0&&!incumbentSeen[active-1]){incumbentSeen[active-1]=true;recordEvent=true}
  }
  const normal=manifold.mWorldSpaceNormal;
  const on1:number[]=[-normal.GetX(),-normal.GetY(),-normal.GetZ()];
  const on2:number[]=[normal.GetX(),normal.GetY(),normal.GetZ()];
  if(dieA>0&&on1[1]>N.SUPPORT_NORMAL_MIN_Y){
    supported[dieA-1]=true;supportSeen[dieA-1]=true;
    if(floor2||inc2)directRoot[dieA-1]=true;else if(dieB>0)parents[(dieA-1)*100+dieB-1]=1;
  }
  if(dieB>0&&on2[1]>N.SUPPORT_NORMAL_MIN_Y){
    supported[dieB-1]=true;supportSeen[dieB-1]=true;
    if(floor1||inc1)directRoot[dieB-1]=true;else if(dieA>0)parents[(dieB-1)*100+dieA-1]=1;
  }
  if(!recordEvent||!trace)return;
  const dieOrder=dieB===0||(dieA>0&&dieA<dieB);
  const a=dieOrder?dieA:dieB,b=dieOrder?dieB:dieA;
  const kind:0|1=(floor1||floor2)?0:1;
  const p1=metres(manifold.GetWorldSpaceContactPointOn1(0)),p2=metres(manifold.GetWorldSpaceContactPointOn2(0));
  const px=(p1[0]+p2[0])*0.5,py=(p1[1]+p2[1])*0.5,pz=(p1[2]+p2[2])*0.5;
  // v(contact) = v(COM) + omega x lever. Read Body directly while callbacks hold its lock.
  const point=[px,py,pz];
  const pointVelocity=(body:any)=>{const v=metres(body.GetLinearVelocity()),w=vec3(body.GetAngularVelocity()),c=metres(body.GetCenterOfMassPosition());
    const r=point.map((x,i)=>x-c[i]);return[v[0]+w[1]*r[2]-w[2]*r[1],v[1]+w[2]*r[0]-w[0]*r[2],v[2]+w[0]*r[1]-w[1]*r[0]]};
  const v1=pointVelocity(body1),v2=pointVelocity(body2);
  const speed=Math.max(0,-((v1[0]-v2[0])*on1[0]+(v1[1]-v2[1])*on1[1]+(v1[2]-v2[2])*on1[2]));
  const inverse=inverseEffectiveMass(body1,body2,point,on1);
  const event:any={t:currentStep*N.FIXED_STEP,kind,a,b,seq:sequence++,
    x:px*N.VISUAL_PER_METER,y:py*N.VISUAL_PER_METER,z:pz*N.VISUAL_PER_METER,
    speed,impulse:speed/inverse};
  trace.push(event);
}
/** impact_speed / inverse_effective_mass, including the rotational term, as the native collector does. */
function inverseEffectiveMass(body1:any,body2:any,point:number[],normal:number[]):number{
  let inverse=0;
  for(const body of [body1,body2]){
    const tag=tagOf(body);
    if(tag<=0||tag>activeCount)continue;
    inverse+=inverseMassByDie[tag-1];
    const com=metres(body.GetCenterOfMassPosition()),r=point.map((x,i)=>x-com[i]);
    const cross=[r[1]*normal[2]-r[2]*normal[1],r[2]*normal[0]-r[0]*normal[2],r[0]*normal[1]-r[1]*normal[0]];
    scratchVector.Set(cross[0],cross[1],cross[2]);
    const transformed=vec3(body.GetInverseInertia().Multiply3x3(scratchVector)).map(x=>x*ENGINE_SCALE*ENGINE_SCALE);
    inverse+=transformed.reduce((sum,v,i)=>sum+v*cross[i],0);
  }
  return inverse>1.0e-9?inverse:1.0e-9;
}
function commitSupportGraph(){
  for(let i=0;i<activeCount;i++)rooted[i]=directRoot[i];
  let changed=true;
  for(let pass=0;changed&&pass<activeCount;pass++){
    changed=false;
    for(let i=0;i<activeCount;i++){
      if(rooted[i])continue;
      for(let parent=0;parent<activeCount;parent++)if(parents[i*100+parent]&&rooted[parent]){rooted[i]=true;changed=true;break}
    }
  }
  for(let i=0;i<activeCount;i++)rootedSeen[i]=rootedSeen[i]||rooted[i];
}
function beginStep(){
  parents.fill(0,0,activeCount*100);
  for(let i=0;i<activeCount;i++){supported[i]=false;directRoot[i]=false;rooted[i]=false}
}

interface Resolution{value:number;alignment:number;secondAlignment:number;gap:number;valid:boolean;worldDirection:number[]}
class InvalidPrediction extends Error{constructor(message:string,readonly dice:number[],readonly positions?:number[][],readonly bounds?:N.Bounds){super(message)}}
interface DieState{body:any;kind:Kind;edge:N.EntryEdge;hull:number[][];nominal:number;radius:number;previous:number[];previousSpeed:number;settleTicks:number;cockedTicks:number;resolution:Resolution}
const rotateBy=(n:number[],q:number[]):number[]=>{
  const[x,y,z]=n,[qx,qy,qz,qw]=q;
  const tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);
  return[x+qw*tx+(qy*tz-qz*ty),y+qw*ty+(qz*tx-qx*tz),z+qw*tz+(qx*ty-qy*tx)];
};
function resolveFace(outcomes:{value:number;normal:number[]}[],q:number[]):Resolution{
  let value=0,alignment=-2,second=-2,worldDirection=[0,1,0];
  for(const outcome of outcomes){
    const d=rotateBy(outcome.normal,q);
    if(d[1]>alignment){second=alignment;value=outcome.value;alignment=d[1];worldDirection=d}
    else if(d[1]>second)second=d[1];
  }
  return{value,alignment,secondAlignment:second,gap:alignment-second,valid:true,worldDirection};
}
/** The native minimum_surface_height: centre height plus the lowest rotated hull point. */
function minimumSurfaceHeight(state:Pick<DieState,'hull'>,q:number[],y:number):number{
  let lowest=Infinity;
  for(const v of state.hull){const world=rotateBy(v,q);if(world[1]<lowest)lowest=world[1]}
  return y+lowest;
}
function lowestSupportVertexCount(state:Pick<DieState,'hull'>,q:number[]):number{
  const heights=state.hull.map(v=>rotateBy(v,q)[1]);
  const lowest=Math.min(...heights);
  return heights.filter(h=>h-lowest<=N.SUPPORT_PLANE_TOLERANCE).length;
}
/**
 * Sequential allocation through CreateBody, which is the path this binding is known to support; the
 * fixed-BodyID scheme the native uses is not exercised here. The source client predicts once and
 * broadcasts, so identical allocation order across clients is not required.
 */
function createBodyId(settings:any,_preferred:number){
  return bi.CreateBody(settings);
}
function makeWall(id:number,bounds:N.Bounds,edge:N.EntryEdge,shapes:any[],entry=false){
  const ht=N.WALL_HALF_THICKNESS,hh=N.WALL_HALF_HEIGHT;
  const centerX=(bounds.minX+bounds.maxX)*0.5,centerZ=(bounds.minZ+bounds.maxZ)*0.5;
  const halfWidth=(bounds.maxX-bounds.minX)*0.5,halfDepth=(bounds.maxZ-bounds.minZ)*0.5;
  let half:number[],position:number[];
  if(edge==='left'){half=[ht,hh,halfDepth+ht*2];position=[bounds.minX-ht,hh,centerZ]}
  else if(edge==='right'){half=[ht,hh,halfDepth+ht*2];position=[bounds.maxX+ht,hh,centerZ]}
  else if(edge==='top'){half=[halfWidth+ht*2,hh,ht];position=[centerX,hh,bounds.maxZ+ht]}
  else{half=[halfWidth+ht*2,hh,ht];position=[centerX,hh,bounds.minZ-ht]}
  const shape=boxShape(half,0.0005);shape.AddRef();shapes.push(shape);
  const settings=bodySettings(shape,position,[0,0,0,1],J.EMotionType_Static,0);
  settings.mFriction=0.55;settings.mRestitution=0.01;
  const body=createBodyId(settings,id);
  bi.AddBody(body.GetID(),J.EActivation_DontActivate);
  bi.SetUserData(body.GetID(),ENTRY_TAG+N.ENTRY_EDGES.indexOf(edge));
  J.destroy(settings);
  return body;
}

async function simulate(request:Request,catalog:Catalog,view:Viewport,revisions:number[]=[],replacementTargets=new Map<number,number[]>(),kinds:Kind[]=physicalKinds(request),privateRotations?:number[][]):Promise<Roll>{
  if(!Number.isInteger(request.count)||request.count<1||request.count>100)throw Error('单次数量必须是 1–100');
  await engine();
  const began=performance.now();
  ensureWorld();
  const projection=N.makeProjection(Math.max(64,view.w||1920),Math.max(64,view.h||1080));
  let bounds=incomingBounds(request,catalog,{w:projection.width,h:projection.height},[...incumbentKinds.values()].flat(),kinds);
  for(const held of incumbentBounds.values())bounds=N.unionBounds(bounds,held);
  // A small window would break the native minimum ground span; expand symmetrically instead.
  const spanX=bounds.maxX-bounds.minX,spanZ=bounds.maxZ-bounds.minZ;
  if(spanX<0.20||spanZ<0.12){
    const cx=(bounds.minX+bounds.maxX)*0.5,cz=(bounds.minZ+bounds.maxZ)*0.5;
    const hx=Math.max(spanX,0.20)*0.5,hz=Math.max(spanZ,0.12)*0.5;
    bounds.minX=cx-hx;bounds.maxX=cx+hx;bounds.minZ=cz-hz;bounds.maxZ=cz+hz;
  }
  activeCount=kinds.length;sequence=0;currentStep=0;boundaryContacts=0;inverseMassByDie=[];
  trace=[];supportSeen.fill(false,0,activeCount);rootedSeen.fill(false,0,activeCount);incumbentSeen.fill(false,0,activeCount);
  entered.fill(false);
  beginStep();

  if(incumbents.size>=MAX_RETAINED)throw Error('同场保留 roll 已达 8 条，请等一条演出结束；不得删除仍在场的碰撞体');
  const slot=slotCursor++%MAX_RETAINED,baseId=slot*20+1;
  const edge=N.selectEntryEdge(N.bigSeed(request.seed));
  const dice:DieState[]=[];const shapes:any[]=[];const walls:any[]=[];
  let kept=false,inertiaCorrections=0;
  try{
    for(const side of N.ENTRY_EDGES){
      walls.push(makeWall(WALL_BASE+slot*8+walls.length,bounds,side,shapes,side===edge));
    }
    const seeded=new N.DeterministicRandom(N.bigSeed(request.seed));
    const radii=kinds.map(kind=>Math.max(...catalog.dice[kind].hull.map(v=>Math.hypot(...v)))/N.VISUAL_PER_METER+.0015);
    const occupied=[...incumbents.values()].flatMap(held=>held.map(body=>metres(body.GetPosition())));
    const targets=spreadTargets(bounds,kinds.length,occupied,N.bigSeed(request.seed),Math.max(...radii));
    for(const [i,target] of replacementTargets)targets[i]=target;
    for(let index=0;index<kinds.length;index++){
      const kind=kinds[index],parameters=N.PHYSICS[kind];
      const hull=catalog.dice[kind].hull.map(v=>[v[0]/N.VISUAL_PER_METER,v[1]/N.VISUAL_PER_METER,v[2]/N.VISUAL_PER_METER]);
      const shape=dieShape(kind,hull);shapes.push(shape);
      const dieSeed=seeded.next64()^(BigInt(revisions[index]||0)*0x9e3779b97f4a7c15n);
      const radius=radii[index];
      const initial=distributedThrow(dieSeed,N.bigSeed(request.seed),kind,bounds,index,kinds.length,targets[index],radius,dice);
      // Private face orientation exists before body creation; never relabel a computed result.
      if(privateRotations)initial.rotation=[...privateRotations[index]] as typeof initial.rotation;
      entryEdges[index]=N.ENTRY_EDGES.indexOf(initial.edge);
      const settings=bodySettings(shape,initial.position,initial.rotation,J.EMotionType_Dynamic,1);
      settings.mFriction=parameters.friction;settings.mRestitution=parameters.restitution;
      settings.mLinearDamping=parameters.linearDamping;settings.mAngularDamping=parameters.angularDamping;
      settings.mMotionQuality=J.EMotionQuality_LinearCast;settings.mAllowSleeping=true;
      settings.mOverrideMassProperties=J.EOverrideMassProperties_CalculateInertia;
      settings.mMassPropertiesOverride.mMass=parameters.mass;
      const body=createBodyId(settings,baseId+index);
      if(installDieInertia(body,shape,parameters.mass))inertiaCorrections++;
      bi.AddBody(body.GetID(),J.EActivation_Activate);
      bi.SetUserData(body.GetID(),index+1);
      inverseMassByDie[index]=1/parameters.mass;
      setLinear(body,initial.linear);setAngular(body,initial.angular);
      J.destroy(settings);
      dice.push({body,kind,edge:initial.edge,hull,nominal:parameters.nominal,radius,previous:[...initial.position],previousSpeed:Math.hypot(...initial.linear),settleTicks:0,cockedTicks:0,
        resolution:resolveFace(catalog.dice[kind].outcomes,[0,0,0,1])});
    }
    const stressTier=kinds.length>N.NATIVE_BATCH;
    const poses:number[]=[];let steps=0,clearedAll=false,substepsTotal=0;
    const sample=()=>{for(const state of dice){
      const p=metres(state.body.GetPosition()),q=[state.body.GetRotation().GetX(),state.body.GetRotation().GetY(),state.body.GetRotation().GetZ(),state.body.GetRotation().GetW()];
      poses.push(p[0]*N.VISUAL_PER_METER,p[1]*N.VISUAL_PER_METER,p[2]*N.VISUAL_PER_METER,q[0],q[1],q[2],q[3]);
    }};
    sample();
    const maxSteps=Math.round((stressTier?N.MAX_SIM_SECONDS_STRESS:N.MAX_SIM_SECONDS)/N.FIXED_STEP);
    for(steps=1;steps<=maxSteps;steps++){
      currentStep=steps;
      let surfaceSpeed=0;
      for(const state of dice){
        const v=metres(bi.GetLinearVelocity(state.body.GetID())),w=vec3(bi.GetAngularVelocity(state.body.GetID()));
        surfaceSpeed=Math.max(surfaceSpeed,Math.hypot(v[0],v[1],v[2])+Math.hypot(w[0],w[1],w[2])*state.nominal*0.75);
      }
      // The native sub-stepping assumes a product batch of at most 20 dice; the web stress tiers
      // cap it so a 100-dice prediction still finishes inside the wall-clock budget.
      const substeps=Math.max(2,Math.min(32,Math.ceil(surfaceSpeed*N.FIXED_STEP/.00035)));
      substepsTotal+=substeps;
      beginStep();
      const updateError=world.Step(N.FIXED_STEP,substeps);
      if(typeof updateError==='number'&&updateError!==0)throw Error(`Jolt update failed: ${updateError}`);
      commitSupportGraph();
      if(steps%SAMPLE_EVERY===0)sample();
      if(!clearedAll){
        dice.forEach((state,index)=>{
          if(entered[index])return;
          const p=metres(state.body.GetPosition());
          const edge=state.edge;
          const axis=edge==='left'||edge==='right'?0:2,sign=edge==='left'||edge==='bottom'?-1:1;
          const q=state.body.GetRotation(),rotation=[q.GetX(),q.GetY(),q.GetZ(),q.GetW()];
          const clearance=Math.max(...state.hull.map(v=>rotateBy(v,rotation)[axis]*sign))+.0005;
          entered[index]=edge==='left'?p[0]>=bounds.minX+clearance:edge==='right'?p[0]<=bounds.maxX-clearance:
            edge==='top'?p[2]<=bounds.maxZ-clearance:p[2]>=bounds.minZ+clearance;
          if(entered[index])bi.InvalidateContactCache(state.body.GetID());
        });
        clearedAll=entered.slice(0,dice.length).every(Boolean);
      }
      let settled=0,allQuiet=true,exhaustedUnresolved=false;
      for(let index=0;index<dice.length;index++){
        const state=dice[index];
        const p=metres(state.body.GetPosition());
        const rotation=[state.body.GetRotation().GetX(),state.body.GetRotation().GetY(),state.body.GetRotation().GetZ(),state.body.GetRotation().GetW()];
        const v=metres(bi.GetLinearVelocity(state.body.GetID()));
        const w=vec3(bi.GetAngularVelocity(state.body.GetID()));
        const resolution=resolveFace(catalog.dice[state.kind].outcomes,rotation);
        state.resolution=resolution;
        // Never inject a rethrow/continuous angular motor into an already visible trajectory.
        // A piled or jammed prediction is rejected before publication and retried from new initial
        // conditions, not kicked across the table after it appeared to stop.
        const pointed=N.pointedCockedProfile(state.kind);
        const faceReadable=resolution.alignment>=N.requiredFaceAlignment(N.SETTLE_ALIGNMENT,state.kind)&&resolution.gap>=N.SETTLE_ALIGNMENT_GAP;
        const supportVertices=pointed?lowestSupportVertexCount(state,rotation):0;
        const fullSupport=!pointed||supportVertices>=N.requiredFaceSupportVertices(state.kind);
        const speedSquared=v[0]*v[0]+v[1]*v[1]+v[2]*v[2];
        const spinSquared=w[0]*w[0]+w[1]*w[1]+w[2]*w[2];
        const speed=Math.sqrt(speedSquared),span=Math.max(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ),margin=Math.max(.35,span*2.5);
        if(![...p,...rotation,...v,...w].every(Number.isFinite)||speed>5||spinSquared>40000||p[1]<-.25||p[1]>Math.max(1.5,span*4)||
          p[0]<bounds.minX-margin||p[0]>bounds.maxX+margin||p[2]<bounds.minZ-margin||p[2]>bounds.maxZ+margin)
          throw new InvalidPrediction(`非物理飞射被拒绝: ${kindLabel(state,index)} step=${steps}`,[index]);
        if(Math.hypot(...p.map((x,i)=>x-state.previous[i]))>Math.max(speed,state.previousSpeed)*N.FIXED_STEP+.0015)
          throw new InvalidPrediction(`轨迹不连续被拒绝: ${kindLabel(state,index)} step=${steps}`,[index]);
        state.previous=p;state.previousSpeed=speed;
        const lowLinear=speedSquared<=N.SETTLE_LINEAR*N.SETTLE_LINEAR;
        const lowAngular=spinSquared<=N.SETTLE_ANGULAR*N.SETTLE_ANGULAR;
        allQuiet=allQuiet&&lowLinear&&lowAngular;
        const isSupported=rooted[index]||(bi.IsActive(state.body.GetID())===false&&rootedSeen[index]);
        const elevated=isSupported&&minimumSurfaceHeight(state,rotation,p[1])>N.ELEVATED_SUPPORT_LIMIT;
        const illegalRest=isSupported&&lowLinear&&lowAngular&&(!entered[index]||elevated||!faceReadable||!fullSupport);
        state.cockedTicks=illegalRest?state.cockedTicks+1:0;
        if(state.cockedTicks>=72)exhaustedUnresolved=true;
        if(clearedAll&&isSupported&&!elevated&&lowLinear&&lowAngular&&faceReadable&&fullSupport){
          state.settleTicks++;
          if(state.settleTicks>=N.SETTLE_TICKS)settled++;
        }else state.settleTicks=0;
      }
      if(settled===dice.length)break;
      if(allQuiet&&exhaustedUnresolved)throw new InvalidPrediction(`预测超时：静止叠骰/卡骰，拒绝人工弹射，重新安排入场 step=${steps} `+dice.filter(s=>s.cockedTicks>=72).map(s=>{
        const p=metres(s.body.GetPosition()),q=s.body.GetRotation(),rotation=[q.GetX(),q.GetY(),q.GetZ(),q.GetW()];
        const wall=Math.min(p[0]-bounds.minX,bounds.maxX-p[0],p[2]-bounds.minZ,bounds.maxZ-p[2]);
        const neighbour=Math.min(...dice.filter(d=>d!==s).map(d=>{const q=metres(d.body.GetPosition());return Math.hypot(q[0]-p[0],q[2]-p[2])}));
        return `${s.kind}#${dice.indexOf(s)+1} h=${minimumSurfaceHeight(s,rotation,p[1]).toFixed(5)} a=${s.resolution.alignment.toFixed(6)} support=${lowestSupportVertexCount(s,rotation)} wall=${wall.toFixed(4)} neighbour=${neighbour.toFixed(4)}`;
      }).join(' | '),dice.map((s,i)=>s.cockedTicks>0?i:-1).filter(i=>i>=0),dice.map(s=>metres(s.body.GetPosition())),bounds);
    }
    if(!clearedAll||steps>maxSteps){
      const span=(stressTier?N.MAX_SIM_SECONDS_STRESS:N.MAX_SIM_SECONDS);
      const why=dice.map((state,index)=>{
        const p=metres(state.body.GetPosition());
        const rotation=[state.body.GetRotation().GetX(),state.body.GetRotation().GetY(),state.body.GetRotation().GetZ(),state.body.GetRotation().GetW()];
        const r=resolveFace(catalog.dice[state.kind].outcomes,rotation);
        const v=metres(bi.GetLinearVelocity(state.body.GetID()));
        const w=vec3(bi.GetAngularVelocity(state.body.GetID()));
        const pointed=N.pointedCockedProfile(state.kind);
        const flags=(r.alignment>=N.requiredFaceAlignment(N.SETTLE_ALIGNMENT,state.kind)&&r.gap>=N.SETTLE_ALIGNMENT_GAP?'F':'-')+
          ((!pointed||lowestSupportVertexCount(state,rotation)>=N.requiredFaceSupportVertices(state.kind))?'S':'-')+
          (Math.hypot(v[0],v[1],v[2])<=N.SETTLE_LINEAR?'v':'-')+(Math.hypot(w[0],w[1],w[2])<=N.SETTLE_ANGULAR?'w':'-')+
          (rooted[index]?'R':'-')+(bi.IsActive(state.body.GetID())===false?'z':'-');
        return `${state.kind}#${index+1}[${flags}]y${p[1].toFixed(3)}h${minimumSurfaceHeight(state,rotation,p[1]).toFixed(3)}a${r.alignment.toFixed(2)}g${r.gap.toFixed(2)}sv${lowestSupportVertexCount(state,rotation)}st${state.settleTicks}`;
      }).join(' | ');
      throw Error(`预测超时：${span} 秒内未全部合法落稳；cleared=${clearedAll} steps=${steps}；${why}`);
    }
    // The committed pose is re-checked against the elevated-support contract, as the native does.
    for(let index=0;index<dice.length;index++){
      const state=dice[index],p=metres(state.body.GetPosition()),q=state.body.GetRotation();
      const height=minimumSurfaceHeight(state,[q.GetX(),q.GetY(),q.GetZ(),q.GetW()],p[1]);
      if(height>N.ELEVATED_SUPPORT_LIMIT)throw new InvalidPrediction(`拒绝非落地结果：${state.kind} #${index+1} 离地 ${height.toFixed(4)} m`,[index]);
      for(const vertex of state.hull){const point=rotateBy(vertex,[q.GetX(),q.GetY(),q.GetZ(),q.GetW()]);
        if(p[0]+point[0]<bounds.minX-.001||p[0]+point[0]>bounds.maxX+.001||p[2]+point[2]<bounds.minZ-.001||p[2]+point[2]>bounds.maxZ+.001)
          throw new InvalidPrediction(`拒绝屏幕外结果: ${kindLabel(state,index)}`,[index]);}
    }
    if(steps%SAMPLE_EVERY!==0)sample();
    const frames=poses.length/(dice.length*7);
    const roll:Roll={version:2,request,kinds,bounds,results:dice.map(state=>state.resolution.value),fps:120,frames,
      poses:new Float32Array(poses),contacts:trace,physicsMs:performance.now()-began,steps,
      collisions:trace.length,duration:(frames-1)/120,diagnostics:{attempts:1,rejected:[],simulationSeed:request.seed,
        incumbentContacts:incumbentSeen.slice(0,activeCount).filter(Boolean).length,boundaryContacts,retained:incumbents.size,substeps:substepsTotal,inertiaCorrections}};
    // Retained dice become static incumbents: a later roll hits them for real, and their own
    // committed result is already authoritative and never revised by that hit.
    const held:any[]=[];
    for(const state of dice){
      bi.SetMotionType(state.body.GetID(),J.EMotionType_Static,J.EActivation_DontActivate);bi.SetObjectLayer(state.body.GetID(),0);
      bi.SetUserData(state.body.GetID(),INCUMBENT_TAG);
      held.push(state.body);
    }
    incumbents.set(request.id,held);incumbentBounds.set(request.id,bounds);incumbentKinds.set(request.id,kinds);kept=true;
    return roll;
  }finally{
    if(!kept)for(const state of dice)destroyBody(state.body);
    for(const w of walls)destroyBody(w);
    for(const shape of shapes)shape.Release();
    trace=null;activeCount=0;currentStep=0;
  }
}
const kindLabel=(state:DieState,index:number)=>`${state.kind}#${index+1}`;
function releaseIncumbent(id:string){
  const held=incumbents.get(id);
  if(!held)return;
  for(const body of held)destroyBody(body);
  incumbents.delete(id);
  incumbentBounds.delete(id);
  incumbentKinds.delete(id);
  for(const key of ruleRestPoses.keys())if(key.startsWith(id+':'))ruleRestPoses.delete(key);
}

async function predict(request:Request,catalog:Catalog,view:Viewport,explicitKinds?:Kind[]){
  const kinds=physicalKinds(request,explicitKinds);
  const privateRotations=hiddenRequest(request)?kinds.map(()=>privateLaunchRotation()):undefined;
  const began=performance.now(),rejected:string[]=[],revisions=new Array(request.count).fill(0),limit=12,replacementTargets=new Map<number,number[]>();
  for(let attempt=0;attempt<limit;attempt++){
    try{const roll=await simulate(request,catalog,view,revisions,replacementTargets,kinds,privateRotations);roll.physicsMs=performance.now()-began;
      roll.diagnostics={...roll.diagnostics!,attempts:attempt+1,rejected,simulationSeed:request.seed};return roll;
    }catch(error){rejected.push(error instanceof Error?error.message:String(error));
      if(!/预测超时|非物理飞射|轨迹不连续|拒绝非落地|拒绝屏幕外/.test(rejected.at(-1)!))throw error;
      const problem=error instanceof InvalidPrediction?error.dice:revisions.map((_,i)=>i);
      for(const index of problem){revisions[index]++;
        if(error instanceof InvalidPrediction&&error.positions&&error.bounds){
          const occupied=[...error.positions.filter((_,i)=>i!==index),...[...incumbents.values()].flatMap(held=>held.map(body=>metres(body.GetPosition())))];
          const radius=Math.max(...KINDS.flatMap(k=>catalog.dice[k].hull.map(v=>Math.hypot(...v))))/N.VISUAL_PER_METER+.0015;
          const target=spreadTargets(error.bounds,1,occupied,N.bigSeed(request.seed)^(BigInt(index+1)*0x2545f4914f6cdd1dn)^BigInt(revisions[index]),radius)[0];
          replacementTargets.set(index,target);error.positions[index]=target;
        }
      }
    }
  }
  throw Error(`${limit} 次合法性预测均失败（不发布轨迹）: `+rejected.join(' / '));
}
async function retainSnapshot(roll:Roll,catalog:Catalog){
  if(incumbents.has(roll.request.id))return;
  await engine();ensureWorld();
  if(incumbents.size>=MAX_RETAINED)throw Error('接管权威时保留容量不足');
  const held:any[]=[];
  try{for(let index=0;index<roll.kinds.length;index++){
    const kind=roll.kinds[index],parameters=N.PHYSICS[kind];
    const shape=dieShape(kind,catalog.dice[kind].hull.map(v=>v.map(x=>x/N.VISUAL_PER_METER)));
    const offset=((roll.frames-1)*roll.kinds.length+index)*7;
    const settings=bodySettings(shape,Array.from(roll.poses.slice(offset,offset+3),x=>x/N.VISUAL_PER_METER),Array.from(roll.poses.slice(offset+3,offset+7)),J.EMotionType_Static,0);
    try{settings.mFriction=parameters.friction;settings.mRestitution=parameters.restitution;
      const body=bi.CreateBody(settings);bi.SetUserData(body.GetID(),INCUMBENT_TAG);bi.AddBody(body.GetID(),J.EActivation_DontActivate);held.push(body);
    }finally{J.destroy(settings);shape.Release()}
  }incumbents.set(roll.request.id,held);incumbentKinds.set(roll.request.id,roll.kinds);if(roll.bounds)incumbentBounds.set(roll.request.id,roll.bounds);}catch(error){for(const body of held)destroyBody(body);throw error}
}
/** Explicit rule presentation: a predominantly upward launch with all six real Jolt DOFs.
 * One initial impulse, then gravity/contact/settling; never drive or snap a quaternion.
 * The final real, unchanged engraved face MUST match the already computed rule target. */
async function simulateHop(ids:string[],targets:number[],catalog:Catalog,revisions:number[]):Promise<PhysicalHop>{
  if(!Array.isArray(ids)||!ids.length||ids.length>40||new Set(ids).size!==ids.length)throw Error('规则起跳身份列表不合法');
  await engine();ensureWorld();const began=performance.now();
  if(!Array.isArray(targets)||targets.length!==ids.length)throw Error('规则翻面缺少逐骰目标');
  const originals=ids.map((id,i)=>{const split=id.lastIndexOf(':'),owner=id.slice(0,split),index=Number(id.slice(split+1));
    const body=incumbents.get(owner)?.[index],kind=incumbentKinds.get(owner)?.[index];
    if(split<0||!Number.isInteger(index)||!body||!kind)throw Error('规则起跳缺少真实已落地骰子: '+id);
    const q=body.GetRotation(),rest=ruleRestPoses.get(id);
    const target=physicalRuleFace(kind,targets[i]),outcome=catalog.dice[kind].outcomes.find(o=>o.value===target);
    if(target===null||!outcome)throw Error(`${kind} 不存在 ${targets[i]} 面，不能用换字伪造翻面`);
    return{body,kind,target,normal:outcome.normal,position:rest?.position??metres(body.GetPosition()),rotation:rest?.rotation??[q.GetX(),q.GetY(),q.GetZ(),q.GetW()],hull:catalog.dice[kind].hull.map(v=>v.map(x=>x/N.VISUAL_PER_METER))};});
  const heldBounds=[...incumbentBounds.values()];if(!heldBounds.length)throw Error('规则起跳缺少已承诺的桌面边界');
  const bounds=heldBounds.reduce(N.unionBounds);
  const bodies:any[]=[],shapes:any[]=[],walls:any[]=[],removed:any[]=[],restored:{body:any;position:number[];rotation:number[]}[]=[],poses:number[]=[],landings=ids.map(()=>-1),stable=ids.map(()=>0),cocked=ids.map(()=>0),airborne=ids.map(()=>false),surfaces=ids.map(()=>0);
  const moveWitness=(body:any,position:number[],rotation:number[])=>{const p=rvec(position),q=quat(rotation);try{bi.SetPositionAndRotation(body.GetID(),p,q,J.EActivation_DontActivate)}finally{J.destroy(p);J.destroy(q)}};
  activeCount=ids.length;trace=[];sequence=0;currentStep=0;inverseMassByDie=[];entered.fill(true);supportSeen.fill(false);incumbentSeen.fill(false);
  const sample=()=>{for(const body of bodies){const p=metres(body.GetPosition()),q=body.GetRotation();poses.push(...p.map(x=>x*N.VISUAL_PER_METER),q.GetX(),q.GetY(),q.GetZ(),q.GetW());}};
  try{
    for(const edge of N.ENTRY_EDGES)walls.push(makeWall(WALL_BASE,bounds,edge,shapes));
    for(const original of originals){bi.RemoveBody(original.body.GetID());removed.push(original.body);}
    // Non-hopping neighbours also occupy their most recent rule pose, not their raw-roll pose.
    for(const [id,rest] of ruleRestPoses)if(!ids.includes(id)){
      const split=id.lastIndexOf(':'),body=incumbents.get(id.slice(0,split))?.[Number(id.slice(split+1))];if(!body)throw Error('规则邻骰身份已失效: '+id);
      const q=body.GetRotation();restored.push({body,position:metres(body.GetPosition()),rotation:[q.GetX(),q.GetY(),q.GetZ(),q.GetW()]});moveWitness(body,rest.position,rest.rotation);
    }
    for(const [i,original] of originals.entries()){
      const parameters=N.PHYSICS[original.kind],shape=dieShape(original.kind,original.hull);shapes.push(shape);
      const settings=bodySettings(shape,original.position,original.rotation,J.EMotionType_Dynamic,1);
      const freedoms=J.EAllowedDOFs_All;
      settings.mAllowedDOFs=freedoms;settings.mFriction=parameters.friction;settings.mRestitution=.02;
      settings.mLinearDamping=.01;settings.mAngularDamping=FLIP_DAMPING;settings.mMotionQuality=J.EMotionQuality_LinearCast;settings.mAllowSleeping=true;
      settings.mOverrideMassProperties=J.EOverrideMassProperties_CalculateInertia;settings.mMassPropertiesOverride.mMass=parameters.mass;
      try{const body=bi.CreateBody(settings);bodies.push(body);bi.SetUserData(body.GetID(),i+1);bi.AddBody(body.GetID(),J.EActivation_Activate);
        if(body.GetMotionProperties().GetAllowedDOFs()!==freedoms)throw Error('规则起跳旋转自由度未正确开放');
        installDieInertia(body,shape,parameters.mass);
        inverseMassByDie[i]=1/parameters.mass;
        const launch=ruleFlipLaunch(original.normal,original.rotation,parameters.nominal,revisions[i]);
        setLinear(body,launch.linear);setAngular(body,launch.angular);
      }finally{J.destroy(settings)}
    }
    sample();let done=false;
    for(let step=1;step<=1200;step++){
      currentStep=step;beginStep();const updateError=world.Step(N.FIXED_STEP,12);
      if(typeof updateError==='number'&&updateError!==0)throw Error(`规则起跳 Jolt update failed: ${updateError}`);
      let allQuiet=true;
      for(const [i,body] of bodies.entries()){
        const p=metres(body.GetPosition()),v=metres(body.GetLinearVelocity()),q=body.GetRotation(),original=originals[i],rotation=[q.GetX(),q.GetY(),q.GetZ(),q.GetW()],angular=vec3(body.GetAngularVelocity());
        if(p[1]>original.position[1]+.004)airborne[i]=true;
        if(![...p,...rotation,...angular].every(Number.isFinite)||Math.hypot(p[0]-original.position[0],p[2]-original.position[2])>.065||p[1]>original.position[1]+.15)throw new InvalidPrediction('规则起跳超出物理范围: '+ids[i],[i]);
        const face=resolveFace(catalog.dice[original.kind].outcomes,rotation),pointed=['d4','d8','d10','d_percentile'].includes(original.kind),support=lowestSupportVertexCount(original,rotation),floor=minimumSurfaceHeight(original,rotation,p[1]);
        const quiet=Math.hypot(...v)<.003&&Math.hypot(...angular)<.15;
        allQuiet=allQuiet&&quiet;
        const landed=airborne[i]&&(directRoot[i]||!body.IsActive())&&face.valid&&face.alignment>=(pointed?.9995:.998)&&support>=(original.kind==='d10'||original.kind==='d_percentile'?4:3)&&Math.abs(floor)<.001&&quiet;
        stable[i]=landed?stable[i]+1:0;
        cocked[i]=airborne[i]&&quiet&&!landed?cocked[i]+1:0;
        if(!landed)landings[i]=-1;else if(landings[i]<0)landings[i]=step*N.FIXED_STEP;
        surfaces[i]=face.value;
      }
      const rejected=cocked.flatMap((n,i)=>n>=72?[i]:[]);
      if(allQuiet&&rejected.length)throw new InvalidPrediction('规则起跳静止卡棱/叠骰，拒绝人工扶正: '+rejected.map(i=>ids[i]).join(', '),rejected);
      if(step%SAMPLE_EVERY===0)sample();
      if(stable.every(n=>n>=24)){if(step%SAMPLE_EVERY!==0)sample();done=true;break;}
    }
    if(!done)throw new InvalidPrediction('规则起跳未在 5 秒内真实落稳，不使用动画假装落地: '+JSON.stringify(bodies.flatMap((body,i)=>{if(stable[i]>=24)return[];const q=body.GetRotation(),rotation=[q.GetX(),q.GetY(),q.GetZ(),q.GetW()],o=originals[i];return[{id:ids[i],kind:o.kind,active:body.IsActive(),airborne:airborne[i],stable:stable[i],root:directRoot[i],v:metres(body.GetLinearVelocity()),w:vec3(body.GetAngularVelocity()),face:resolveFace(catalog.dice[o.kind].outcomes,rotation),floor:minimumSurfaceHeight(o,rotation,metres(body.GetPosition())[1]),support:lowestSupportVertexCount(o,rotation)}]})),stable.flatMap((n,i)=>n<24?[i]:[]));
    const frames=poses.length/(ids.length*7);
    const wrong=surfaces.flatMap((value,i)=>value===originals[i].target?[]:[i]);
    if(wrong.length)throw new InvalidPrediction('规则翻面未抵达原有目标面: '+wrong.map(i=>`${ids[i]} ${surfaces[i]} != ${originals[i].target}`).join(', '),wrong);
    for(const [i,id] of ids.entries()){
      const [x,y,z,w]=poses.slice(i*7+3,i*7+7);let turn=0,tilt=0,rise=0;
      for(let f=1;f<frames;f++){
        const a=(f*ids.length+i)*7,b=((f-1)*ids.length+i)*7,[qx,qy,qz,qw]=poses.slice(a+3,a+7);
        const dot=qx*poses[b+3]+qy*poses[b+4]+qz*poses[b+5]+qw*poses[b+6];turn+=2*Math.acos(Math.min(1,Math.abs(dot)));
        const dx=-qw*x+qx*w-qy*z+qz*y,dz=-qw*z-qx*y+qy*x+qz*w;tilt=Math.max(tilt,Math.acos(Math.max(-1,Math.min(1,1-2*(dx*dx+dz*dz)))));
        rise=Math.max(rise,poses[a+1]-poses[i*7+1]);
      }
      // Adjacent d20 faces only require ~42 degrees, not an artificial full revolution.
      // A nested arithmetic-only rule may already leave the requested physical face upwards.
      const initial=resolveFace(catalog.dice[originals[i].kind].outcomes,originals[i].rotation).value;
      if((initial!==originals[i].target&&(turn<.15||tilt<.15))||rise<1)throw new InvalidPrediction('规则起跳未形成真实翻面: '+id,[i]);
    }
    for(const [i,body] of bodies.entries()){
      const p=metres(body.GetPosition()),q=body.GetRotation(),rotation=[q.GetX(),q.GetY(),q.GetZ(),q.GetW()];
      for(const v of originals[i].hull){const w=rotateBy(v,rotation);
        if(p[0]+w[0]<bounds.minX-.001||p[0]+w[0]>bounds.maxX+.001||p[2]+w[2]<bounds.minZ-.001||p[2]+w[2]>bounds.maxZ+.001)throw new InvalidPrediction('规则起跳落点越界: '+ids[i],[i]);
      }
    }
    for(const [i,id] of ids.entries()){const at=((frames-1)*ids.length+i)*7;ruleRestPoses.set(id,{position:poses.slice(at,at+3).map(x=>x/N.VISUAL_PER_METER),rotation:poses.slice(at+3,at+7)});}
    return{ids,kinds:originals.map(o=>o.kind),fps:120,frames,poses:new Float32Array(poses),contacts:trace!,duration:(frames-1)/120,landings,surfaces,physicsMs:performance.now()-began};
  }finally{
    for(const body of bodies)destroyBody(body);for(const wall of walls)destroyBody(wall);for(const shape of shapes)shape.Release();
    for(const saved of restored)moveWitness(saved.body,saved.position,saved.rotation);
    for(const body of removed)bi.AddBody(body.GetID(),J.EActivation_DontActivate);
    trace=null;activeCount=0;currentStep=0;
  }
}
async function predictHop(ids:string[],targets:number[],catalog:Catalog):Promise<PhysicalHop>{
  const began=performance.now(),rejected:string[]=[],revisions=ids.map(()=>0);
  // Inverse physical planning of an explicit rule target. Never used for random rolls.
  for(let attempt=0;attempt<64;attempt++)try{
    const hop=await simulateHop(ids,targets,catalog,revisions);hop.physicsMs=performance.now()-began;hop.diagnostics={attempts:attempt+1,rejected};return hop;
  }catch(error){if(!(error instanceof InvalidPrediction))throw error;rejected.push(error.message);for(const index of error.dice)revisions[index]++;}
  throw Error('规则翻面 64 次初始条件候选均未成功，未发布: '+rejected.join(' / '));
}
// Serialize all commands, including initialization. Async message handlers otherwise overlap at
// the engine await and can mutate one world concurrently.
let commandChain=Promise.resolve();
self.onmessage=e=>{commandChain=commandChain.then(()=>handle(e.data)).catch(error=>self.postMessage({id:e.data.request?.id,error:String(error)}))};
async function handle(data:any){
  const {request,catalog,view,type}=data;
  if(type==='warmup'){
    const began=performance.now();
    try{
      await engine();const engineMs=performance.now()-began;
      const probe:Request={id:'warmup',source:'warmup',name:'warmup',kind:'d6',count:1,theme:Object.keys(catalog.themes)[0] as Request['theme'],seed:1};
      await predict(probe,catalog,{w:1920,h:1080});
      releaseIncumbent('warmup');
      self.postMessage({type:'warm',engineMs,totalMs:performance.now()-began});
    }catch(error){self.postMessage({type:'warm',error:error instanceof Error?error.message:String(error),engineMs:performance.now()-began})}
    return;
  }
  if(type==='release'){releaseIncumbent(data.id);return}
  if(type==='research-hop'){
    try{const hop=await predictHop(data.ids,data.targets,catalog);self.postMessage({id:data.id,hop},[hop.poses.buffer]);}
    catch(error){self.postMessage({id:data.id,error:String(error)});}return;
  }
  if(type==='retain'){try{for(const roll of data.rolls)await retainSnapshot(roll,catalog);self.postMessage({type:'retained',count:incumbents.size})}
    catch(error){self.postMessage({type:'retained',error:String(error)})}return}
  try{
    // Only the local research scheduler sends explicit mixed pools. Room requests remain unchanged.
    if(type==='research-wave'&&(!Array.isArray(data.kinds)||request.source!=='local-formula-research'||request.count>40))throw Error('本地研究物理批次不合法');
    const roll=request.recipe?await predictRecipe(request,catalog,(r,kinds)=>predict(r,catalog,view||{w:1920,h:1080},kinds),(ids,targets)=>predictHop(ids,targets,catalog),releaseIncumbent,r=>retainSnapshot(r,catalog)):await predict(request,catalog,view||{w:1920,h:1080},type==='research-wave'?data.kinds:undefined);
    self.postMessage({id:request.id,roll},[roll.poses.buffer]);
  }catch(error){self.postMessage({id:request.id,error:error instanceof Error?error.message:String(error)})}
};
