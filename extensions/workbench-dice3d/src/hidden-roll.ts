import type {Catalog,DieAsset,Request,Roll} from './types';
export type Visibility='all'|'self'|'gm'|'players';
export type Role='GM'|'PLAYER';
export const VISIBILITY=[['all','全部'],['self','仅自己'],['gm','自己 + 主持人'],['players','非主持人（含自己）']] as const;
export const validVisibility=(v:unknown):v is Visibility=>VISIBILITY.some(([id])=>id===v);
export const hiddenRequest=(r:Request|undefined)=>r?.visibility!==undefined&&r.visibility!=='all';
export function audienceFor(scope:Visibility,owner:string,members:{id:string;role:Role}[]){
  return [...new Set([owner,...members.filter(p=>scope==='all'||scope==='gm'&&p.role==='GM'||scope==='players'&&p.role==='PLAYER').map(p=>p.id)])].sort();
}
export type Q=[number,number,number,number];
const dot=(a:number[],b:number[])=>a.reduce((s,x,i)=>s+x*b[i],0);
const norm=(a:number[])=>{const n=Math.hypot(...a);return a.map(x=>x/n)};
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function multiply(a:number[],b:number[]):Q{return[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-dot(a.slice(0,3),b.slice(0,3))]}
export function rotate(v:number[],q:number[]){const t=cross(q,v).map(x=>x*2),c=cross(q,t);return v.map((x,i)=>x+q[3]*t[i]+c[i]);}
const near=(a:number[],b:number[],eps=2e-5)=>Math.hypot(...a.map((x,i)=>x-b[i]))<eps;
function frame(a:number[],b:number[]){const x=norm(a),y=norm(b.map((v,i)=>v-dot(b,x)*x[i]));return[x,y,cross(x,y)];}
function quaternion(m:number[][]):Q{
  const trace=m[0][0]+m[1][1]+m[2][2];let q:number[];
  if(trace>0){const s=Math.sqrt(trace+1)*2;q=[(m[2][1]-m[1][2])/s,(m[0][2]-m[2][0])/s,(m[1][0]-m[0][1])/s,s/4];}
  else{const i=m[0][0]>m[1][1]&&m[0][0]>m[2][2]?0:m[1][1]>m[2][2]?1:2,j=(i+1)%3,k=(i+2)%3,s=Math.sqrt(1+m[i][i]-m[j][j]-m[k][k])*2;
    q=[0,0,0,(m[k][j]-m[j][k])/s];q[i]=s/4;q[j]=(m[i][j]+m[j][i])/s;q[k]=(m[i][k]+m[k][i])/s;}
  return norm(q) as Q;
}
const symmetryCache=new WeakMap<DieAsset,Q[]>();
/** Only exact proper symmetries of the LOCKED hull and outcome normals are allowed. Random
 * right-rotation removes face identity without changing any occupied volume or contact point.
 * No outcome is picked/replaced: authorized viewers recover the original physical quaternion. */
export function shapeSymmetries(asset:DieAsset):Q[]{
  const cached=symmetryCache.get(asset);if(cached)return cached;
  const h=asset.hull,a=h[0],b=h.find(v=>Math.hypot(...cross(a,v))>1e-4)!;
  const basis=frame(a,b),rotations:Q[]=[];
  for(const c of h)for(const d of h){
    if(Math.abs(dot(a,a)-dot(c,c))>1e-5||Math.abs(dot(b,b)-dot(d,d))>1e-5||Math.abs(dot(a,b)-dot(c,d))>1e-5)continue;
    const dest=frame(c,d),m=[0,1,2].map(i=>[0,1,2].map(j=>dest.reduce((s,v,k)=>s+v[i]*basis[k][j],0))),q=quaternion(m);
    if(q.some(v=>!Number.isFinite(v))||rotations.some(r=>Math.abs(dot(q,r))>1-1e-9))continue;
    if(h.every(v=>h.some(w=>near(rotate(v,q),w)))&&asset.outcomes.every(o=>asset.outcomes.some(p=>near(rotate(o.normal,q),p.normal))))rotations.push(q);
  }
  const covered=new Set(rotations.map(q=>asset.outcomes.findIndex(o=>near(rotate(asset.outcomes[0].normal,q),o.normal))));
  if(covered.size!==asset.outcomes.length)throw Error('暗骰形体缺少完整对称群，拒绝泄漏结果: '+asset.kind);
  symmetryCache.set(asset,rotations);return rotations;
}
function randomIndex(n:number){const limit=Math.floor(0x100000000/n)*n;let value:number;do{value=crypto.getRandomValues(new Uint32Array(1))[0]}while(value>=limit);return value%n;}
/** A private, uniformly distributed launch orientation, sampled BEFORE physics. Never derive
 * hidden face identity from the ordinary 32-bit layout seed (which positions could fingerprint). */
export function privateLaunchRotation():Q{
  const [u,v,w]=Array.from(crypto.getRandomValues(new Uint32Array(3)),x=>(x+.5)/0x100000000);
  return[Math.sqrt(1-u)*Math.sin(2*Math.PI*v),Math.sqrt(1-u)*Math.cos(2*Math.PI*v),Math.sqrt(u)*Math.sin(2*Math.PI*w),Math.sqrt(u)*Math.cos(2*Math.PI*w)];
}
export interface SecretDetails{v:1;id:string;owner:string;salt:string;seed:number;modifier:number;results:number[];rotations:Q[];formulaData?:Roll['formulaData']}
export interface CipherText{iv:string;data:string}
export interface SecretPack{scope:Exclude<Visibility,'all'>;audience:string[];commitment:string;data:CipherText;keys:{to:string;box:CipherText}[]}
export function maskRoll(roll:Roll,catalog:Catalog):{roll:Roll;details:SecretDetails}{
  if(!hiddenRequest(roll.request))throw Error('公开骰不能伪装为暗骰');
  const rotations=roll.kinds.map(k=>{const group=shapeSymmetries(catalog.dice[k]);return group[randomIndex(group.length)]}),poses=roll.poses.slice();
  for(let f=0;f<roll.frames;f++)for(let i=0;i<rotations.length;i++){const o=(f*rotations.length+i)*7+3;poses.set(multiply(Array.from(poses.slice(o,o+4)),rotations[i]),o);}
  const salt=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
  const details:SecretDetails={v:1,id:roll.request.id,owner:roll.request.source,salt,seed:roll.request.seed,modifier:roll.request.modifier??0,results:[...roll.results],rotations,formulaData:roll.formulaData};
  // Explicit allowlist: seed, diagnostics/simulationSeed and raw face values must never travel.
  const r=roll.request;
  return{details,roll:{version:2,request:{id:r.id,source:r.source,name:r.name,kind:r.kind,count:r.count,theme:r.theme,bodyColor:r.bodyColor,authority:r.authority,visibility:r.visibility,seed:0,modifier:0,recipe:r.recipe},
    kinds:[...roll.kinds],results:roll.results.map(()=>0),fps:120,frames:roll.frames,poses,contacts:roll.contacts,physicsMs:roll.physicsMs,steps:roll.steps,collisions:roll.collisions,duration:roll.duration,bounds:roll.bounds,masked:true,births:roll.births}};
}
export function unmaskRoll(publicRoll:Roll,details:SecretDetails,catalog:Catalog):Roll{
  validateDetails(publicRoll.request,publicRoll.kinds,details,catalog);
  const poses=publicRoll.poses.slice(),n=publicRoll.kinds.length;
  for(let f=0;f<publicRoll.frames;f++)for(let i=0;i<n;i++){const o=(f*n+i)*7+3,q=details.rotations[i];poses.set(multiply(Array.from(poses.slice(o,o+4)),[-q[0],-q[1],-q[2],q[3]]),o);}
  for(let i=0;i<n;i++){const o=((publicRoll.frames-1)*n+i)*7+3,q=Array.from(poses.slice(o,o+4)),outcomes=catalog.dice[publicRoll.kinds[i]].outcomes;
    const face=[...outcomes].sort((a,b)=>rotate(b.normal,q)[1]-rotate(a.normal,q)[1])[0];
    if(face.value!==details.results[i])throw Error('暗骰真实面与已承诺结果不符');}
  return{...publicRoll,request:{...publicRoll.request,seed:details.seed,modifier:details.modifier},poses,results:[...details.results],masked:false,formulaData:details.formulaData};
}
export function validateDetails(request:Request,kinds:Roll['kinds'],d:SecretDetails,catalog:Catalog){
  if(!d||d.v!==1||d.id!==request.id||d.owner!==request.source||!/^[0-9a-f]{64}$/.test(d.salt)||!Number.isInteger(d.seed)||d.seed<0||d.seed>0xffffffff||
    !Number.isInteger(d.modifier)||Math.abs(d.modifier)>999999||!Array.isArray(d.results)||d.results.length!==kinds.length||!Array.isArray(d.rotations)||d.rotations.length!==kinds.length)throw Error('暗骰私有数据不合法');
  kinds.forEach((k,i)=>{if(!catalog.dice[k]?.outcomes.some(o=>o.value===d.results[i])||!Array.isArray(d.rotations[i])||d.rotations[i].length!==4||d.rotations[i].some(x=>!Number.isFinite(x))||Math.abs(Math.hypot(...d.rotations[i])-1)>1e-6||!shapeSymmetries(catalog.dice[k]).some(q=>near(q,d.rotations[i],1e-6)||near(q.map(x=>-x),d.rotations[i],1e-6)))throw Error('暗骰原面/对称变换不合法');});
}
