import type {Roll} from './types';
import type {Wave} from './research/physical';
import type {PhysicalEntry} from './research/rule-timeline';
/** Concatenate immutable wave tracks, without importing the local research worker facade. */
export function combineWaves(waves:Wave[],name:string):PhysicalEntry{
 const ids=waves.flatMap(w=>w.roll.kinds.map((_,i)=>`${w.roll.request.id}:${i}`)),kinds=waves.flatMap(w=>w.roll.kinds),results=waves.flatMap(w=>w.roll.results);
 const duration=Math.max(...waves.map(w=>w.offset+w.roll.duration)),frames=Math.round(duration*120)+1,n=kinds.length,poses=new Float32Array(frames*n*7),contacts:Roll['contacts']=[],births=waves.flatMap(w=>w.roll.kinds.map(()=>w.offset));
 let index=0;for(const w of waves){const r=w.roll,start=Math.round(w.offset*120);for(let f=0;f<frames;f++){const local=Math.min(r.frames-1,Math.max(0,f-start));for(let i=0;i<r.kinds.length;i++)poses.set(r.poses.subarray((local*r.kinds.length+i)*7,(local*r.kinds.length+i+1)*7),(f*n+index+i)*7);}for(const c of r.contacts)contacts.push({...c,t:c.t+w.offset,a:c.a+index,b:c.b?c.b+index:0,seq:contacts.length});index+=r.kinds.length;}
 const bounds=waves.flatMap(w=>w.roll.bounds?[w.roll.bounds]:[]);
 return{offset:0,ids,births,roll:{...waves[0].roll,request:{...waves[0].roll.request,name,count:n},kinds,results,poses,frames,duration,contacts:contacts.sort((a,b)=>a.t-b.t),collisions:contacts.length,physicsMs:waves.reduce((n,w)=>n+w.roll.physicsMs,0),bounds:bounds.length?{minX:Math.min(...bounds.map(b=>b.minX)),maxX:Math.max(...bounds.map(b=>b.maxX)),minZ:Math.min(...bounds.map(b=>b.minZ)),maxZ:Math.max(...bounds.map(b=>b.maxZ))}:undefined}};
}
