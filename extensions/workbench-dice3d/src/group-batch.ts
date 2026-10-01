import type {Roll} from './types';
/** Slice one common physics prediction. No dice are resampled and every part keeps
 * the same frame count, birth times and start barrier. Hidden faces are sealed later. */
export function splitGroupRoll(roll:Roll):Roll[]{
 const f=roll.formulaData,contexts=f?.contexts;
 if(!contexts)return[roll];
 if(!f||contexts.length!==f.rows.length||contexts.length!==roll.request.groupSize)throw Error('群体计算结果数量不符');
 return f.rows.map((row,index)=>{
  const included=new Set(row.dice.map(d=>d.id)),indices=f.ids.map((id,i)=>included.has(id)?i:-1).filter(i=>i>=0),n=indices.length;
  if(!n)throw Error('群体目标缺少真实骰子');
  const poses=new Float32Array(roll.frames*n*7),tags=new Map(indices.map((source,i)=>[source+1,i+1]));
  for(let frame=0;frame<roll.frames;frame++)for(const [i,source]of indices.entries())poses.set(roll.poses.subarray((frame*roll.kinds.length+source)*7,(frame*roll.kinds.length+source+1)*7),(frame*n+i)*7);
  const context=contexts[index],contacts=roll.contacts.filter(c=>tags.has(c.a)).map(c=>({...c,a:tags.get(c.a)!,b:tags.get(c.b)??0}));
  return {...roll,diagnostics:context.visibility==='all'||!context.visibility?undefined:roll.diagnostics,request:{...roll.request,seed:context.visibility==='all'||!context.visibility?0:roll.request.seed,id:`${roll.request.id}.g${index}`,groupSize:undefined,batch:{id:roll.request.id,index,size:contexts.length},count:n,visibility:context.visibility||'all',formula:row.formula,formulas:undefined,contexts:undefined,context},kinds:indices.map(i=>roll.kinds[i]),results:indices.map(i=>roll.results[i]),poses,contacts,collisions:contacts.length,births:indices.map(i=>f.births[i]),formulaData:{...f,ids:indices.map(i=>f.ids[i]),births:indices.map(i=>f.births[i]),rows:[{...row,index:0}],logicalRows:[{...(f.logicalRows?.[index]||row),index:0}],timeline:{...f.timeline,births:indices.map(i=>f.births[i]),clamps:f.timeline.clamps.filter(c=>included.has(c.id))},context,contexts:undefined,expression:row.formula}};
 });
}
