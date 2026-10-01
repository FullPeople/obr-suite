import type {Catalog,Request,Roll,Kind,FormulaData} from './types';
import {parseFormula,evaluateFormula,type FormulaRow,type CastSpec} from './research/formula';
import type {Wave} from './research/physical';
import {combineWaves} from './suite-waves';
import {appendRuleHops,type HopStage,HOP_CHARGE,HOP_TAIL,DECISION_DELAY} from './research/rule-timeline';
import {physicalRuleFace} from './rule-flip-launch';
import {dieTotalValue} from './cue';
import {shapeSymmetries,rotate,multiply} from './hidden-roll';
import type {PhysicalHop} from './physical-hop';

export function validateRecipe(r:Request){
 if(!r.recipe)return;
 if(r.formulas){if(r.formula||r.preset||!Array.isArray(r.formulas)||!r.formulas.length||r.formulas.length>100||r.contexts?.length!==r.formulas.length)throw Error('群体公式和目标数量不符');for(const formula of r.formulas){const ast=parseFormula(formula);if(ast.type==='call'&&ast.name==='repeat')throw Error('每个群体目标只接受一个结果');}}
 else if(r.formula){parseFormula(r.formula);if(r.preset)throw Error('公式和预设结果不能同时提交');}
 else if(!r.preset)throw Error('缺少公式或权威兼容结果');
 if(r.preset){const p=r.preset;if(!Array.isArray(p.dice)||!p.dice.length||p.dice.length>100||!Number.isSafeInteger(p.total)||p.dice.some(d=>!/^d(4|6|8|10|12|20|100)$/.test(d.type)||!Number.isInteger(d.value)||d.value<1||d.value>Number(d.type.slice(1))))throw Error('无效或没有模型的兼容结果');}
}
export const percentileValue=(tens:number,unit:number)=>tens===0&&unit===0?100:tens+unit;
/** Symmetry changes only engraved face identity. All occupied volumes/contact samples stay exact.
 * Used ONLY for already-authoritative legacy/fixed results, never random physical recipes. */
function alignPreset(roll:Roll,wanted:number[],catalog:Catalog){
 const n=roll.kinds.length;
 for(let i=0;i<n;i++){const k=roll.kinds[i],end=((roll.frames-1)*n+i)*7+3,q=Array.from(roll.poses.slice(end,end+4));
  const target=catalog.dice[k].outcomes.find(o=>o.value===wanted[i]);if(!target)throw Error('兼容面值不存在');
  const rotation=shapeSymmetries(catalog.dice[k]).find(s=>{const qq=multiply(q,s);return [...catalog.dice[k].outcomes].sort((a,b)=>rotate(b.normal,qq)[1]-rotate(a.normal,qq)[1])[0].value===wanted[i]});
  if(!rotation)throw Error('兼容结果没有保持碰撞形体的对称朝向');
  for(let f=0;f<roll.frames;f++){const at=(f*n+i)*7+3;roll.poses.set(multiply(Array.from(roll.poses.slice(at,at+4)),rotation),at);}
 }
 roll.results=[...wanted];
}
export async function predictRecipe(request:Request,catalog:Catalog,cast:(r:Request,kinds:Kind[])=>Promise<Roll>,hop:(ids:string[],values:number[])=>Promise<PhysicalHop>,release:(id:string)=>void,retain:(r:Roll)=>Promise<void>):Promise<Roll>{
 validateRecipe(request);const waves:Wave[]=[],hops:HopStage[]=[],retained:string[]=[];let physicalCount=0;
 const batch=async(groups:CastSpec[])=>{
  if(waves.length>=7)throw Error('公式超过 7 个因果物理波次，未发布不完整结果');
  const kinds=groups.flatMap(g=>Array.from({length:g.count},()=>g.kind as string).flatMap(k=>k==='d100'?['d_percentile','d10'] as Kind[]:[k as Kind]));
  physicalCount+=kinds.length;if(physicalCount>100)throw Error('包含 d100 双骰/追加的实际骰子超过 100 枚');
  const r={...request,id:`${request.id}.w${waves.length}`,count:kinds.length,seed:(request.seed+waves.length*2654435761)>>>0,formula:undefined,preset:undefined,recipe:undefined};
  const roll=await cast(r,kinds);retained.push(r.id);
  const previous=waves.at(-1),offset=previous?Math.ceil((previous.offset+previous.roll.duration+.35)*120)/120:0;
  waves.push({roll,offset,groups,reason:groups.map(g=>g.reason).join(' / ')});
  let index=0;return groups.map(g=>Array.from({length:g.count},()=>{const i=index++;if((g.kind as string)==='d100'){index++;return{id:`${r.id}:${i}`,value:percentileValue(roll.results[i],roll.results[i+1])};}return{id:`${r.id}:${i}`,value:dieTotalValue(kinds[i],roll.results[i])};}));
 };
 try{
  let rows:FormulaRow[];
  if(request.preset){
   const preset=request.preset,groups=preset.dice.map(d=>({kind:d.type as Kind,count:1,reason:'既有权威结果兼容'}));
   const answers=await batch(groups),wave=waves[0],wanted:number[]=[],dice=preset.dice.map((d,i)=>{const raw=d.originalValue??d.value;wanted.push(...(d.type==='d100'?[d.value===100?0:Math.floor(d.value/10)*10,d.value===100?0:d.value%10]:[d.type==='d10'&&d.value===10?0:d.value]));return{id:answers[i][0].id,kind:d.type as Kind,raw,value:d.value,sign:d.subtract?-1:1,kept:!d.loser,flags:d.loser?['舍弃']:[]};});
   alignPreset(wave.roll,wanted,catalog);
   release(wave.roll.request.id);await retain(wave.roll);
   const starts=preset.rowStarts?.length?preset.rowStarts:[0];rows=starts.map((start,i)=>{const selected=dice.slice(start,starts[i+1]??dice.length),total=starts.length===1?preset.total:selected.filter(d=>d.kept).reduce((n,d)=>n+d.value*d.sign,request.modifier??0);return{dice:selected,events:[],compute:()=>total,operation:'',formula:request.formula||'',index:i,total};});
  }else rows=await evaluateFormula(request.formulas?request.formulas.map(parseFormula):parseFormula(request.formula!),batch);
  const logicalRows=rows.map(({compute,...row})=>structuredClone(row));
  // Pair each logical percentile with BOTH physical identities; contributions are tens + unit.
  for(const row of rows){
   const percentiles=new Map(row.dice.filter(d=>(d.kind as string)==='d100').map(d=>[d.id,d]));
   row.events=row.events.flatMap(e=>{if((e.kind!=='max'&&e.kind!=='min')||e.dice.length!==1)return[e];const d=percentiles.get(e.dice[0]);if(!d||!Number.isInteger(e.to)||e.to!<1||e.to!>100)return[e];const split=d.id.lastIndexOf(':'),stem=d.id.slice(0,split),i=Number(d.id.slice(split+1)),parts=(n:number)=>n===100?[0,0]:[Math.floor(n/10)*10,n%10];return parts(e.to!).flatMap((target,j)=>parts(e.from!)[j]===target?[]:[{...e,dice:[`${stem}:${i+j}`],from:parts(e.from!)[j],to:j===1&&target===0?10:target}]);});
   row.dice=row.dice.flatMap(d=>{if((d.kind as string)!=='d100')return[d];const split=d.id.lastIndexOf(':'),wave=waves.find(w=>w.roll.request.id===d.id.slice(0,split))!,i=Number(d.id.slice(split+1)),legal=d.value>=1&&d.value<=100,tens=legal?(d.value===100?0:Math.floor(d.value/10)*10):wave.roll.results[i],unit=legal?(d.value===100?0:d.value%10):wave.roll.results[i+1];return[{...d,kind:'d_percentile' as Kind,raw:wave.roll.results[i],value:tens}, {...d,id:`${wave.roll.request.id}:${i+1}`,kind:'d10' as Kind,raw:wave.roll.results[i+1],value:unit}];});
  }
  const queues=new Map<string,{id:string;kind:'max'|'min';label:string;from:number;to:number}[]>();
  for(const row of rows)for(const e of row.events)if(e.kind==='max'||e.kind==='min')for(const id of e.dice){const d=row.dice.find(d=>d.id===id)!;if(physicalRuleFace(d.kind,e.to!)===null){e.physicalNote='超出实体面的规则值，保留原刻字';continue;}const q=queues.get(id)||[];q.push({id,kind:e.kind,label:e.label,from:e.from!,to:e.to!});queues.set(id,q);}
  let start=Math.ceil((Math.max(...waves.map(w=>w.offset+w.roll.duration))+DECISION_DELAY+HOP_CHARGE)*120)/120;
  while([...queues.values()].some(q=>q.length)){const rules=[...queues.values()].filter(q=>q.length).map(q=>q.shift()!),physical=await hop(rules.map(r=>r.id),rules.map(r=>r.to));hops.push({hop:physical,start,rules});start=Math.ceil((start+physical.duration+HOP_TAIL+HOP_CHARGE)*120)/120;}
  const entry=appendRuleHops(combineWaves(waves,request.name),hops),roll=entry.roll;
  // The wire result is the ACTUAL final engraved face; raw/adjusted rule values remain separate.
  for(const stage of hops)for(const [i,id] of stage.hop.ids.entries())roll.results[entry.ids.indexOf(id)]=stage.hop.surfaces[i];
  const formulaData:FormulaData={ids:entry.ids,rows:rows.map(({compute,...row})=>row),logicalRows,births:entry.births,timeline:entry.timeline,context:request.context,contexts:request.contexts,expression:request.formula||request.context?.expression||''};
  Object.assign(roll,{request:{...request,count:roll.kinds.length},formulaData,births:entry.births});
  for(const id of retained)release(id);retained.length=0;await retain(roll);return roll;
 }finally{for(const id of retained)release(id);}
}
