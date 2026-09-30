import {type Catalog,type Roll,type Request,type ThemeID} from '../types';
import {dieTotalValue} from '../cue';
import type {CastSpec,FormulaRow} from './formula';
import type {PhysicalHop} from '../physical-hop';
import {physicalRuleFace} from '../rule-flip-launch';
import {DECISION_DELAY,HOP_CHARGE,HOP_TAIL,type HopStage,type ClampKind,type PhysicalEntry} from './rule-timeline';
export interface Wave{roll:Roll;offset:number;reason:string;groups:CastSpec[]}
/** One actual Jolt simulation per causal wave, including all its independent formula groups. */
export class LocalPhysics{
  private worker=new Worker(new URL('../physics.worker.ts',import.meta.url),{type:'module'});
  private waiting=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:number}>();
  private retained:string[]=[];
  waves:Wave[]=[];
  hops:HopStage[]=[];
  constructor(private catalog:Catalog,private view:()=>{w:number;h:number}){
    this.worker.onmessage=e=>{const key=e.data.type==='warm'?'warm':e.data.id,pending=this.waiting.get(key);if(!pending)return;
      clearTimeout(pending.timer);this.waiting.delete(key);e.data.error?pending.reject(Error(e.data.error)):pending.resolve(e.data.roll??e.data);};
    this.worker.onerror=e=>{for(const p of this.waiting.values()){clearTimeout(p.timer);p.reject(Error(e.message))}this.waiting.clear()};
  }
  private request(key:string,data:any){return new Promise<any>((resolve,reject)=>{
    const timer=window.setTimeout(()=>{this.waiting.delete(key);reject(Error('本地物理预测超时，请重新加载实验页'))},40000);
    this.waiting.set(key,{resolve,reject,timer});this.worker.postMessage(data);
  })}
  warm(){return this.request('warm',{type:'warmup',catalog:this.catalog,view:this.view()})}
  clear(){for(const id of this.retained)this.worker.postMessage({type:'release',id});this.retained=[];this.waves=[];this.hops=[];}
  async prepareClamps(rows:FormulaRow[]):Promise<HopStage[]>{
    const queues=new Map<string,{id:string;kind:ClampKind;label:string;from:number;to:number}[]>();
    for(const row of rows)for(const event of row.events)if(event.kind==='max'||event.kind==='min')for(const id of event.dice){
      if(!Number.isSafeInteger(event.from)||!Number.isSafeInteger(event.to))throw Error('规则起跳缺少明确的前后数值: '+id);
      const die=row.dice.find(d=>d.id===id);if(!die)throw Error('规则翻面缺少骰子身份: '+id);
      if(physicalRuleFace(die.kind,event.to!)===null){event.physicalNote=`${die.kind} 没有 ${event.to} 面：保留真实刻字，仅计算规则值`;continue;}
      const queue=queues.get(id)||[];queue.push({id,kind:event.kind,label:event.label,from:event.from!,to:event.to!});queues.set(id,queue);
    }
    const end=Math.max(0,...this.waves.map(w=>w.offset+w.roll.duration));let start=Math.ceil((end+DECISION_DELAY+HOP_CHARGE)*120)/120;
    while([...queues.values()].some(q=>q.length)){
      const rules=[...queues.values()].filter(q=>q.length).map(q=>q.shift()!),id='hop-'+crypto.randomUUID();
      const response=await this.request(id,{type:'research-hop',id,ids:rules.map(r=>r.id),targets:rules.map(r=>r.to),catalog:this.catalog});
      const hop=response.hop as PhysicalHop;
      if(hop.ids.length!==rules.length||hop.ids.some((value,i)=>value!==rules[i].id))throw Error('规则起跳返回身份不匹配');
      if(hop.surfaces.some((value,i)=>value!==physicalRuleFace(hop.kinds[i],rules[i].to)))throw Error('物理翻面未匹配规则目标，拒绝换字补救');
      this.hops.push({hop,start,rules});start=Math.ceil((start+hop.duration+HOP_TAIL+HOP_CHARGE)*120)/120;
    }
    return this.hops;
  }
  async rollBatch(groups:CastSpec[],theme:ThemeID,color:string,name:string){
    if(this.retained.length>=8)throw Error('该公式超过 8 批物理投掷的研究上限；不会删除仍参与碰撞的旧骰来凑数');
    const kinds=groups.flatMap(g=>Array.from({length:g.count},()=>g.kind));
    const request:Request={id:crypto.randomUUID(),source:'local-formula-research',name,kind:'mixed',count:kinds.length,theme,bodyColor:color,seed:crypto.getRandomValues(new Uint32Array(1))[0]};
    const roll:Roll=await this.request(request.id,{type:'research-wave',request,kinds,catalog:this.catalog,view:this.view()});
    this.retained.push(request.id);
    if(roll.kinds.length!==kinds.length||roll.kinds.some((k,i)=>k!==kinds[i]))throw Error('物理批次返回的骰型顺序与公式不匹配');
    const last=this.waves.at(-1),offset=last?Math.ceil((last.offset+last.roll.duration+.35)*120)/120:0;
    this.waves.push({roll,offset,reason:[...new Set(groups.map(g=>g.reason))].join(' / '),groups:groups.map(g=>({...g}))});
    let index=0;
    return groups.map(g=>Array.from({length:g.count},()=>{const i=index++;return{id:`${roll.request.id}:${i}`,value:dieTotalValue(roll.kinds[i],roll.results[i])};}));
  }
}
/** Select a result row from shared waves, then concatenate its untouched tracks on the causal clock.
 * Future dice remain at their real offscreen start pose. Old ones retain their final transform.
 * Different repeat rows share the real collision world but not meshes, totals or impact sounds.
 * This is a local research timeline, not a wire packet or a revision of a published old roll. */
export function combineWaves(allWaves:Wave[],name:string,selected?:ReadonlySet<string>):PhysicalEntry{
  const parts=allWaves.map(wave=>({wave,indices:wave.roll.kinds.map((_,i)=>i).filter(i=>!selected||selected.has(`${wave.roll.request.id}:${i}`))})).filter(p=>p.indices.length);
  const waves=parts.map(p=>p.wave);if(!waves.length)throw Error('缺少本条结果的物理波次');
  const offset=waves[0].offset,duration=Math.max(...waves.map(w=>w.offset-offset+w.roll.duration));
  const frames=Math.round(duration*120)+1,kinds=parts.flatMap(p=>p.indices.map(i=>p.wave.roll.kinds[i])),results=parts.flatMap(p=>p.indices.map(i=>p.wave.roll.results[i])),ids=parts.flatMap(p=>p.indices.map(i=>`${p.wave.roll.request.id}:${i}`));
  if(selected&&(ids.length!==selected.size||ids.some(id=>!selected.has(id))))throw Error('结果行与共享物理批次中的骰子身份不匹配');
  const count=kinds.length,poses=new Float32Array(frames*count*7),contacts:Roll['contacts']=[];
  const births=parts.flatMap(p=>p.indices.map(()=>p.wave.offset-offset));
  let dieOffset=0;
  for(const {wave,indices} of parts){const r=wave.roll,startFrame=Math.round((wave.offset-offset)*120);
    for(let frame=0;frame<frames;frame++){const local=Math.max(0,Math.min(r.frames-1,frame-startFrame));
      for(const [i,source] of indices.entries()){const from=(local*r.kinds.length+source)*7;poses.set(r.poses.subarray(from,from+7),(frame*count+dieOffset+i)*7);}}
    const tags=new Map(indices.map((source,i)=>[source+1,dieOffset+i+1]));
    // Contact A owns a shared cross-row impact; the other row must not play it a second time.
    // B=0 denotes an external/static witness while kind=1 still keeps the dice impact sound.
    for(const c of r.contacts)if(tags.has(c.a))contacts.push({...c,t:c.t+wave.offset-offset,a:tags.get(c.a)!,b:tags.get(c.b)??0,seq:contacts.length});
    dieOffset+=indices.length;
  }
  const bounds=waves.flatMap(w=>w.roll.bounds?[w.roll.bounds]:[]);
  return{offset,ids,births,roll:{...waves[0].roll,request:{...waves[0].roll.request,id:'formula-'+crypto.randomUUID(),name,count,kind:'mixed',modifier:0},
    kinds,results,frames,duration,poses,contacts:contacts.sort((a,b)=>a.t-b.t),collisions:contacts.length,
    physicsMs:waves.reduce((n,w)=>n+w.roll.physicsMs,0),
    bounds:bounds.length?{minX:Math.min(...bounds.map(b=>b.minX)),maxX:Math.max(...bounds.map(b=>b.maxX)),minZ:Math.min(...bounds.map(b=>b.minZ)),maxZ:Math.max(...bounds.map(b=>b.maxZ))}:undefined}};
}
