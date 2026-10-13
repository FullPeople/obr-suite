import type {Relay} from './relay';
import {applyPatch,sameValue} from './merge';
import {conditionIdentity} from './conditions';
import {documentCoins,COIN_TYPES} from './currency';
import {emptyLedger,inventoryOperation,recordProjection,type Ledger,type Stock,type Container,type InventoryAuthority} from './inventory-model';
export type InventoryDefinition={id:string;name:string;kind:Container['kind'];write:boolean;document?:any};
const moneyNames:Record<string,string>={cp:'铜币',sp:'银币',ep:'琥珀金币',gp:'金币',pp:'铂金币'};
const money=()=>({cp:0,sp:0,ep:0,gp:0,pp:0});
function stock(selection:any,slot:number):Stock{return {id:selection.id,name:selection.entry.name,kind:selection.entry.kind==='condition'?'condition':'item',entry:selection.entry,quantity:selection.quantity??1,unitWeight:Number(selection.entry.raw?.weight)||0,equipped:!!selection.equipped,attuned:!!selection.attuned,slot,revision:1};}
function itemFields(row:any){return {entry:row.entry,quantity:row.quantity??1,equipped:!!row.equipped,attuned:!!row.attuned};}
const same=sameValue;
const selected=(native:any,kind:string)=>(native?.selections||[]).filter((row:any)=>row.entry?.kind===kind);
/** Only changes actually projected into stock require the ledger. Sorting a
 * character sheet, resource spending and adding/updating a runtime condition do
 * not. Removed conditions still check the ledger to retire any matching grant. */
export function nativeInventoryChanged(before:any,after:any,identify=conditionIdentity):boolean {
 const oldRows=selected(before,'item'),newRows=selected(after,'item');
 if(oldRows.length!==newRows.length)return true;
 const nextById=new Map<string,any>(newRows.map((row:any)=>[row.id,row]));
 if(oldRows.some((row:any)=>!nextById.has(row.id)||!same(itemFields(row),itemFields(nextById.get(row.id)))))return true;
 const nextConditions=new Set<string>(selected(after,'condition').map((row:any)=>identify(row.entry)));
 if(selected(before,'condition').some((row:any)=>!nextConditions.has(identify(row.entry))))return true;
 return Object.keys(moneyNames).some(coin=>(Number(before?.inventory?.coins?.[coin])||0)!==(Number(after?.inventory?.coins?.[coin])||0));
}
export type NativeInventorySync={container?:Container;projection?:NonNullable<Ledger['projections']>[string];ledgerRevision?:number;ledgerCommitted?:boolean};
function initial(def:InventoryDefinition):Container{
 const doc=def.document,native=doc?.dnd_card_web,selected=native?.selections?.filter((s:any)=>s.entry?.kind==='item');
 const items:Stock[]=selected?.map(stock)||(doc?.inventory?.items||[]).filter((v:any)=>v?.name).map((v:any,index:number)=>stock({id:`imported-item:${index}`,quantity:v.quantity??1,equipped:v.equipped,attuned:v.attuned,entry:{id:`imported:item:${v.name}`,kind:'item',name:v.name,english:v.name,source:'IMPORTED',edition:'both',packId:'imported',revision:'0.3',entries:v.description?[v.description]:[],raw:{weight:Number(v.weight)||0}}},index));
 const coins=documentCoins(doc);
 if(def.kind!=='public')for(const coin of COIN_TYPES)items.push({id:`coin:${coin}`,kind:'currency',coin,name:moneyNames[coin],quantity:Number(coins[coin])||0,slot:items.length,revision:1,equipped:native?.inventory?.displayEquipment?.includes(`coin:${coin}`),attuned:native?.inventory?.displayAttunement?.includes(`coin:${coin}`)});
 const occupied=new Set<number>();for(const row of items){const saved=native?.inventory?.positions?.[row.id];if(Number.isSafeInteger(saved)&&saved>=0&&saved<10000&&!occupied.has(saved)){row.slot=saved;occupied.add(saved);}else row.slot=-1;}for(const row of items)if(row.slot<0){let slot=0;while(occupied.has(slot))slot++;row.slot=slot;occupied.add(slot);}
 return {id:def.id,name:def.name,kind:def.kind,items,columns:4,capacity:Math.max(def.kind==='public'?20:24,Math.ceil(items.length/4)*4),revision:1};
}
/** Room ledger is the single authority for all stock locations. Card JSON is a projection. */
export function inventoryDocuments(relay:Relay,room:string){
 const key=`inventory_${room.replace(/[^a-zA-Z0-9_-]/g,'_')}`;let cached:{revision:number;data:Ledger}|undefined,readAt=0;
 let reading:Promise<any>|undefined;
 async function read(force=false){if(force||!cached||Date.now()-readAt>10000){if(!reading)reading=relay.send({sharedDocument:{key,operation:'read'}}).finally(()=>{reading=undefined;});const value=await reading;if(!cached||value.revision>=cached.revision){cached={revision:value.revision,data:value.data||emptyLedger()};readAt=Date.now();}}return cached!;}
 async function transaction<T extends {ledger:Ledger}>(change:(ledger:Ledger)=>T){
  for(let attempt=0;attempt<5;attempt++){const current=await read(true),result=change(current.data);if(result.ledger===current.data)return {...result,revision:current.revision};try{const next=await relay.send({sharedDocument:{key,operation:'write',expected:current.revision,data:result.ledger}});if(!cached||next.revision>=cached.revision){cached=next;readAt=Date.now();}return {...result,revision:next.revision};}catch(error){const status=(error as any)?.status;if(status===409&&attempt<4)continue;if(status&&status<500)throw error;
   try{const next=await relay.send({sharedDocument:{key,operation:'read'}}),added=result.ledger.receipts.filter(receipt=>!current.data.receipts.some(r=>r.id===receipt.id));if(same(next.data,result.ledger)||added.length&&added.every(receipt=>next.data?.receipts?.some((r:any)=>r.id===receipt.id))){if(!cached||next.revision>=cached.revision){cached=next;readAt=Date.now();}return {...result,revision:next.revision};}}catch{}
   throw Object.assign(Error('库存保存结果暂时无法确认；本地改动已保留，请恢复连接后核对。'),{uncertain:true,diagnostic:{code:'INVENTORY_RESULT_UNKNOWN'}});
  }}
  throw Error('背包正在被其他人修改，请重试');
 }
 async function ensure(definitions:InventoryDefinition[]){const value=await read();if(definitions.every(def=>value.data.containers[def.id]&&!value.data.containers[def.id].items.some(r=>r.kind==='resource'&&r.slot<9000)))return value;await transaction(previous=>{const next=structuredClone(previous);let changed=false;for(const def of definitions){if(!Object.prototype.hasOwnProperty.call(next.containers,def.id)){next.containers[def.id]=initial(def);changed=true;}const c=next.containers[def.id];for(const row of c.items.filter(r=>r.kind==='resource'&&r.slot<9000)){let slot=9000;while(c.items.some(r=>r.slot===slot))slot++;row.slot=slot;c.revision++;changed=true;}}return {ledger:changed?next:previous};});return read();}

 async function view(definitions:InventoryDefinition[],gm:boolean,publicId:string){const value=await ensure(definitions);return {revision:value.revision,publicId,access:definitions.map(d=>JSON.stringify([d.id,d.write,d.name])).join('|'),silent:gm&&!!value.data.silent,containers:Object.fromEntries(definitions.map(def=>[def.id,{...value.data.containers[def.id],name:def.name,write:gm||def.kind==='public'&&!value.data.containers[def.id]?.locked||def.kind!=='public'&&def.write}]))};}
 async function command(message:any,authority:InventoryAuthority){return transaction(previous=>inventoryOperation(previous,message,authority));}
 async function syncNative(id:string,before:any,after:any,identify=conditionIdentity):Promise<NativeInventorySync>{
  // A no-op must not read the ledger, clear pending projections, or manufacture
  // an inventory guard. Concurrent transfers/grants remain authoritative.
  if(!nativeInventoryChanged(before,after,identify))return {};
  const oldRows=selected(before,'item'),newRows=selected(after,'item');
  const oldConditions=selected(before,'condition'),newConditions=selected(after,'condition');
  const removed=oldConditions.filter((old:any)=>!newConditions.some((next:any)=>identify(next.entry)===identify(old.entry)));
  const result=await transaction(previous=>{
   if(!previous.containers[id])return {ledger:previous,modified:false};const ledger=structuredClone(previous),container=ledger.containers[id];let changed=false;
   for(const row of oldRows){const next=newRows.find((v:any)=>v.id===row.id);if(next&&same(itemFields(row),itemFields(next)))continue;const live=container.items.find(item=>item.id===row.id);
    // Removing an already absent row is fulfilled; editing it must never resurrect stock.
    if(!live){if(!next)continue;throw Error('背包条目已经转移，请刷新后再编辑');}
    if(!next){if(!same(itemFields(live),itemFields(row)))throw Error('背包条目已经更新，请重试');container.items=container.items.filter(item=>item.id!==row.id);changed=true;}
    else{const fields=applyPatch(itemFields(live),itemFields(row),itemFields(next),'inventory['+id+'].items['+row.id+']');if(same(fields,itemFields(live)))continue;Object.assign(live,fields,{revision:live.revision+1});if(!same(fields.entry,row.entry)){live.name=fields.entry.name;live.unitWeight=Number(fields.entry.raw?.weight)||0;}changed=true;}
   }
   for(const row of newRows)if(!oldRows.some((v:any)=>v.id===row.id)){const live=container.items.find(item=>item.id===row.id);if(live){if(!same(itemFields(live),itemFields(row)))throw Error('背包条目已经更新，请重试');continue;}let slot=0;while(container.items.some(item=>item.slot===slot))slot++;container.items.push(stock(row,slot));changed=true;}
   // Runtime conditions may come from Wiki, token metadata or a grant. Only retire
   // matching grants here; ordinary status edits do not require/invent a stock row.
   const remaining=container.items.filter(row=>row.kind!=='condition'||!removed.some((old:any)=>old.entry.id===row.entry?.id||identify(old.entry)===identify(row.entry)));
   if(remaining.length!==container.items.length){container.items=remaining;changed=true;}
   for(const coin of Object.keys(moneyNames)){const old=Number(before?.inventory?.coins?.[coin])||0,next=Number(after?.inventory?.coins?.[coin])||0;if(old===next)continue;const row=container.items.find(item=>item.coin===coin);if(row){if(row.quantity===next)continue;if(row.quantity!==old)throw Error('货币已被转移，请重试');row.quantity=next;row.revision++;changed=true;}}
   if(changed){container.revision++;recordProjection(ledger,previous,id);}return {ledger:changed?ledger:previous,modified:changed};
  });
  const container=result.ledger.containers[id],projection=result.ledger.projections?.[id];
  return {container,projection,ledgerRevision:result.revision,ledgerCommitted:result.modified};
 }
 async function projected(id:string,revision:number){await transaction(previous=>{if(previous.projections?.[id]?.revision!==revision)return {ledger:previous};const ledger=structuredClone(previous);delete ledger.projections![id];return {ledger};});}
 return {key,read,ensure,view,command,syncNative,projected,invalidate(){readAt=0;}};
}
export function inventoryProjection(doc:any,container:Container,conditionIds:string[]=[],conditionEntries:any[]=[],identify=conditionIdentity){
 const known=[...conditionEntries,...container.items.filter(row=>row.kind==='condition').map(row=>row.entry),...(doc.dnd_card_web?.selections||[]).filter((s:any)=>s.entry?.kind==='condition').map((s:any)=>s.entry),...(doc.web_conditions||[])];
 const affected=new Set(conditionIds.map(id=>identify(known.find(entry=>entry.id===id)||{id})));
 const matches=(entry:any)=>entry?.kind==='condition'&&(conditionIds.includes(entry.id)||affected.has(identify(entry)));
 const result=structuredClone(doc),items=container.items.filter(row=>row.kind==='item'),conditions=[...new Map(container.items.filter(row=>matches(row.entry)).map(row=>[identify(row.entry),row])).values()],coins=money();for(const row of container.items)if(row.kind==='currency'&&row.coin&&row.coin in coins)(coins as any)[row.coin!]=row.quantity;
 result.inventory={...result.inventory,items:items.map(row=>({id:row.id,name:row.name,quantity:row.quantity,equipped:!!row.equipped,attuned:!!row.attuned,weight:row.unitWeight||0,description:row.entry?.entries?.filter((v:any)=>typeof v==='string').join('\n')||''})),coins};
 result.web_conditions=[...(result.web_conditions||[]).filter((entry:any)=>!matches(entry)),...conditions.map(row=>row.entry)];
 if(result.dnd_card_web){const native=result.dnd_card_web;native.selections=[...native.selections.filter((s:any)=>s.entry?.kind!=='item'&&!matches(s.entry)),...[...items,...conditions].map(row=>{const old=native.selections.find((s:any)=>s.id===row.id||row.kind==='condition'&&s.entry?.kind==='condition'&&identify(s.entry)===identify(row.entry));return {...old,id:row.id,entry:row.entry,quantity:row.quantity,level:old?.level??1,equipped:!!row.equipped,attuned:!!row.attuned};})];native.inventory={view:'grid',order:[],attunementLimit:3,...native.inventory,coins,positions:Object.fromEntries(container.items.filter(r=>r.kind!=='resource').map(r=>[r.id,r.slot])),displayEquipment:container.items.filter(r=>r.equipped).map(r=>r.id),displayAttunement:container.items.filter(r=>r.attuned).map(r=>r.id)};}
 return result;
}
/** A successful card save can acknowledge its own projection, but never swallow
 * unrelated pending grants or newer container revisions. */
export function inventoryReflected(native:any,container:Container,projection:NonNullable<Ledger['projections']>[string],identify=conditionIdentity){
 const rows=native.selections||[],items=rows.filter((row:any)=>row.entry?.kind==='item'),stockItems=container.items.filter(row=>row.kind==='item');
 if(items.length!==stockItems.length||stockItems.some(row=>!items.some((s:any)=>s.id===row.id&&same(itemFields(s),itemFields(row)))))return false;
 if(container.items.some(row=>row.kind==='currency'&&row.quantity!==(Number(native.inventory?.coins?.[row.coin!])||0)))return false;
 if(container.items.some(row=>row.kind!=='resource'&&native.inventory?.positions?.[row.id]!==row.slot))return false;
 return projection.conditions.every(id=>{const entry=projection.entries?.find(e=>e.id===id)||{id};return rows.some((s:any)=>s.entry?.kind==='condition'&&(s.entry.id===id||identify(s.entry)===identify(entry)))===container.items.some(row=>row.kind==='condition'&&(row.entry.id===id||identify(row.entry)===identify(entry)));});
}
