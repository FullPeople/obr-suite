import {sameValue} from './merge';
export type Stock = {id:string;kind:'item'|'currency'|'resource'|'condition';name:string;quantity:number;slot:number;revision:number;entry?:any;coin?:string;max?:number;locked?:boolean;equipped?:boolean;attuned?:boolean;unitWeight?:number;unlimited?:boolean;type?:string};
/** Stack identity excludes position, quantity and transport revision, never source or rules. */
export function sameStock(a:Stock,b:Stock):boolean {
 if(a.kind==='resource'||b.kind==='resource')return false;
 const normalize=(v:any):any=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,normalize(v[k])])):v;
 const identity=({id,slot,quantity,revision,equipped,attuned,...row}:Stock)=>normalize({...row,locked:!!row.locked,unitWeight:row.unitWeight||0});
 return JSON.stringify(identity(a))===JSON.stringify(identity(b));
}
export type Container = {id:string;name:string;kind:'public'|'card'|'monster';revision:number;items:Stock[];columns:number;capacity:number;locked?:boolean};
export type Ledger = {version:1;containers:Record<string,Container>;receipts:{id:string;at:number}[];silent?:boolean;projections?:Record<string,{revision:number;conditions:string[];entries?:any[]}>};
export type InventoryAuthority = {gm:boolean;read:Set<string>;write:Set<string>;give:Set<string>};
export const emptyLedger=():Ledger=>({version:1,containers:{},receipts:[]});
const safeId=(id:unknown):id is string=>typeof id==='string'&&/^[a-zA-Z0-9:_-]{1,200}$/.test(id)&&!['constructor','prototype','__proto__'].includes(id);
const count=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=999999999;
function fail(message:string):never{throw Error(message);}
function vacancy(container:Container,start=0){let slot=Math.max(0,start);while(container.items.some(row=>row.slot===slot))slot++;if(slot>=10000)fail('背包格子已满');return slot;}
function validate(row:Stock){if(!safeId(row.id)||!row.name?.trim()||row.name.length>160||!count(row.quantity)||!count(row.slot)||row.slot>=10000||!['item','currency','resource','condition'].includes(row.kind))fail('物品数据无效');if(['item','condition'].includes(row.kind)&&(!row.entry||typeof row.entry.id!=='string'||typeof row.entry.name!=='string'||row.entry.kind!==row.kind))fail('词条类型无效');if(row.kind==='currency'&&row.quantity>1000000||row.kind==='item'&&row.quantity>100000||row.kind==='resource'&&(row.max||0)>99999)fail('数量超过角色卡上限');if(row.unitWeight!==undefined&&(!Number.isFinite(row.unitWeight)||row.unitWeight<0))fail('物品重量无效');if(row.kind==='currency'&&!['cp','sp','ep','gp','pp'].includes(row.coin||''))fail('货币类型无效');if(row.kind==='resource'&&(!count(row.max)||!row.unlimited&&row.quantity>row.max!))fail('资源上限无效');if(row.kind==='resource'&&row.unlimited&&row.type!=='number')fail('只有数值资源可以没有上限');if(row.entry&&JSON.stringify(row.entry).length>500_000)fail('物品正文过大');}
export function stockWeight(container:Container){return container.items.reduce((total,row)=>total+(row.kind==='currency'?.02:row.unitWeight||0)*row.quantity,0);}
/** One pure transaction across every touched container. Only commit the returned ledger. */
export function inventoryOperation(previous:Ledger,message:any,authority:InventoryAuthority){
 if(!safeId(message?.operationId))fail('无效操作编号');
 if(previous.receipts.some(row=>row.id===message.operationId))return {ledger:previous,touched:[] as string[],moved:[] as Stock[],duplicate:true};
 const ledger=structuredClone(previous),touched=new Set<string>(),moved:Stock[]=[];
 const get=(id:string)=>{if(!safeId(id)||!Object.prototype.hasOwnProperty.call(ledger.containers,id))fail('找不到背包');if(!authority.gm&&!authority.read.has(id))fail('此背包不可查看');return ledger.containers[id];};
 const canWrite=(c:Container,row?:Stock)=>authority.gm||(c.kind==='public'?!c.locked&&!row?.locked:authority.write.has(c.id));
 const expect=(c:Container)=>{if(message.expected?.[c.id]!==c.revision)fail('背包已被其他人修改，请重试');};
 const touch=(c:Container)=>touched.add(c.id);
 if(message.action==='silent'){if(!authority.gm)fail('只有 DM 可以切换消息提示');ledger.silent=!!message.value;}
 else if(message.action==='containerLock'){if(!authority.gm)fail('只有 DM 可以锁定公共仓库');const c=get(message.container);if(c.kind!=='public')fail('不是公共仓库');expect(c);c.locked=!!message.locked;touch(c);}
 else if(message.action==='restore'){
  // Constructed only by the host from a recorded operation, never accepted from a client.
  if(!message.historyGrant)fail('撤销凭证无效');
  for(const change of message.lockChanges||[]){const c=get(change.id);if(!authority.gm||c.kind!=='public')fail('只有 DM 可以调整仓库锁定');if(!!c.locked!==change.after)fail('仓库锁定已被修改，不能撤销');c.locked=!!change.before;touch(c);}
  for(const change of message.changes as {id:string;before:Stock[];after:Stock[]}[]){const c=get(change.id);
   if(!authority.gm&&(c.kind==='public'?c.locked:!authority.write.has(c.id)&&!authority.give.has(c.id)))fail('背包权限已经改变');
   const clean=(r:Stock|undefined)=>r?Object.fromEntries(Object.entries(r).filter(([k])=>k!=='revision')):null;
   const ids=new Set([...change.before,...change.after].map(row=>row.id));
   for(const id of ids){const live=c.items.find(row=>row.id===id),expected=change.after.find(row=>row.id===id);if(!sameValue(clean(live),clean(expected)))fail('物品已被其他人修改，不能撤销此操作');if(!authority.gm&&c.kind==='public'&&live?.locked)fail('物品已上锁');}
   const restored=change.before.map(row=>({...structuredClone(row),revision:(c.items.find(r=>r.id===row.id)?.revision||row.revision)+1}));restored.forEach(validate);
   const retained=c.items.filter(row=>!ids.has(row.id));if(new Set([...retained,...restored].map(row=>row.slot)).size!==retained.length+restored.length)fail('原格子已被占用，不能撤销');c.items=[...retained,...restored];touch(c);
  }
 }else if(message.action==='transfer'){
  const source=get(message.from),target=get(message.to);expect(source);if(source.id===target.id)fail('请选择另一个背包');
  if(!authority.gm&&target.kind==='public'&&target.locked)fail('公共仓库已上锁');
  if(!authority.gm&&target.kind!=='public'&&!authority.give.has(target.id))fail('不能向此背包给予物品');
  if(!Array.isArray(message.rows)||!message.rows.length||new Set(message.rows.map((r:any)=>r.id)).size!==message.rows.length)fail('请选择物品');
  for(const request of message.rows){const row=source.items.find(row=>row.id===request.id);if(!row||!canWrite(source,row))fail('物品已移走或已上锁');if(row.kind==='resource')fail('公共资源不能作为物品转移');if(!count(request.quantity)||request.quantity<1||request.quantity>row.quantity)fail('物品数量不足');
   const same=target.items.find(item=>sameStock(item,{...row,equipped:false,attuned:false,locked:false}));
   if(same){if(!count(same.quantity+request.quantity))fail('数量超过上限');same.quantity+=request.quantity;validate(same);same.revision++;}
   else{const nextId=safeId(request.newId)?request.newId:crypto.randomUUID();if(target.items.some(item=>item.id===nextId))fail('目标背包已存在此物品编号');const item={...row,id:nextId,quantity:request.quantity,slot:vacancy(target,Number.isSafeInteger(message.slot)?message.slot:0),revision:1,equipped:false,attuned:false,locked:false};target.items.push(item);}
   moved.push({...row,quantity:request.quantity});row.quantity-=request.quantity;row.revision++;if(!row.quantity&&row.kind!=='currency')source.items=source.items.filter(item=>item.id!==row.id);
  }touch(source);touch(target);
 }else{
  const c=get(message.container);if(message.action!=='move'||!message.observedSlots)expect(c);
  if(message.action==='add'){
   if(!canWrite(c))fail('背包不可编辑');
   const row=structuredClone(message.row) as Stock;validate(row);if(!authority.gm&&row.locked)fail('只有 DM 可以设置锁定');if(c.items.some(item=>item.id===row.id))fail('条目已存在');const same=c.items.find(item=>sameStock(item,row));if(same){same.quantity+=row.quantity;same.equipped=!!(same.equipped||row.equipped);same.attuned=!!(same.attuned||row.attuned);validate(same);same.revision++;}else{row.revision=1;row.slot=vacancy(c,row.kind==='resource'?Math.max(9000,row.slot):row.slot);c.items.push(row);}moved.push(row);touch(c);
  }else if(message.action==='merge'){
   const row=c.items.find(r=>r.id===message.id),target=c.items.find(r=>r.id===message.targetId);if(!row||!target||row.id===target.id||!canWrite(c,row)||!canWrite(c,target)||!sameStock(row,target))fail('只有完全相同且可修改的物品可以合并');target.quantity+=row.quantity;target.equipped=!!(target.equipped||row.equipped);target.attuned=!!(target.attuned||row.attuned);validate(target);target.revision++;c.items=c.items.filter(r=>r.id!==row.id);touch(c);
  }else if(message.action==='split'){
   const row=c.items.find(row=>row.id===message.id);if(!row||!canWrite(c,row)||row.kind!=='item'&&row.kind!=='condition')fail('该条目不可拆分');
   if(!count(message.quantity)||message.quantity<1||message.quantity>=row.quantity||!safeId(message.newId)||c.items.some(row=>row.id===message.newId))fail('拆分数量无效');
   row.quantity-=message.quantity;row.revision++;const added={...structuredClone(row),id:message.newId,quantity:message.quantity,slot:vacancy(c,Number.isSafeInteger(message.slot)?message.slot:0),revision:1,equipped:false,attuned:false};c.items.push(added);touch(c);
  }else if(message.action==='update'){
   const row=c.items.find(row=>row.id===message.id);if(!row||!canWrite(c,row))fail('条目已移走或已上锁');
   if('locked' in (message.patch||{})&&!authority.gm)fail('只有 DM 可以调整公共区锁定');
   const allowed=['name','quantity','max','locked','equipped','attuned','unitWeight','type','unlimited'];if(Object.keys(message.patch||{}).some(key=>!allowed.includes(key)))fail('无效物品字段');Object.assign(row,message.patch);validate(row);row.revision++;if(row.quantity===0&&['item','condition'].includes(row.kind))c.items=c.items.filter(item=>item.id!==row.id);touch(c);
  }else if(message.action==='remove'){
   if(!Array.isArray(message.ids)||!message.ids.length)fail('请选择物品');for(const id of message.ids){const row=c.items.find(row=>row.id===id);if(!row||row.kind==='currency'||!canWrite(c,row))fail('条目不可删除');}c.items=c.items.filter(row=>!message.ids.includes(row.id));touch(c);
  }else if(message.action==='move'){
   if(!canWrite(c))fail('背包排列不可编辑');if(!Array.isArray(message.positions)||new Set(message.positions.map((v:any)=>v.id)).size!==message.positions.length)fail('无效位置');
   if(message.observedSlots){if(typeof message.observedSlots!=='object'||Array.isArray(message.observedSlots))fail('无效原位置');for(const position of message.positions){const row=c.items.find(row=>row.id===position.id),observed=message.observedSlots[position.id];if(!Object.prototype.hasOwnProperty.call(message.observedSlots,position.id)||!count(observed)||observed>=10000)fail('无效原位置');if(!row||row.slot!==observed&&row.slot!==position.slot)fail('该物品的位置已被其他人修改，请重试');}}
   const ids=new Set(message.positions.map((v:any)=>v.id)),occupied=new Set(c.items.filter(row=>!ids.has(row.id)).map(row=>row.slot));
   for(const position of message.positions){const row=c.items.find(row=>row.id===position.id);if(!row||!canWrite(c,row)||!count(position.slot)||position.slot>=10000||occupied.has(position.slot))fail('目标格子已被占用');occupied.add(position.slot);row.slot=position.slot;row.revision++;}touch(c);
  }else fail('未知背包操作');
 }
 for(const id of touched){const c=ledger.containers[id];c.revision++;c.capacity=Math.max(c.capacity,Math.ceil((Math.max(0,...c.items.filter(row=>row.kind!=='resource').map(row=>row.slot))+1)/c.columns)*c.columns);recordProjection(ledger,previous,id);}
 ledger.receipts=[...ledger.receipts.slice(-511),{id:message.operationId,at:Date.now()}];return {ledger,touched:[...touched],moved,duplicate:false};
}

export function recordProjection(ledger:Ledger,previous:Ledger,id:string){const c=ledger.containers[id];if(c.kind!=='public'){const old=previous.containers[id].items.filter(row=>row.kind==='condition'),next=c.items.filter(row=>row.kind==='condition'),ids=new Set([...old,...next].map(row=>row.entry.id));const changed=[...ids].filter(entry=>JSON.stringify(old.filter(row=>row.entry.id===entry))!==JSON.stringify(next.filter(row=>row.entry.id===entry)));(ledger.projections||={})[id]={revision:c.revision,conditions:[...new Set([...(ledger.projections?.[id]?.conditions||[]),...changed])],entries:[...new Map([...(ledger.projections?.[id]?.entries||[]),...old.map(row=>row.entry),...next.map(row=>row.entry)].map(entry=>[entry.id,entry])).values()]};}}
