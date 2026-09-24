import {RUNTIME_BASELINE,DOCUMENT_REVISION,documentRevision,documentRuntime,tokenRuntime,mergeTokenRuntime,writeRuntime,mergeMonsterMetadata,type RuntimeBaseline} from './runtime-authority';
import {workbenchObservation} from './observation';
import {documentChanges,expandChanges} from './document-delta';
import {documentCoins} from './currency';
import {cardLocation,type CardLocation} from './card-location';
import {publishWorkbenchNotice,setupWorkbenchNotices} from './notices';
import {tokenPortrait} from './token-portrait';
import {conditionCommands,type ConditionRow} from './condition-commands';
import devManifest from '../../public/manifest-dev.json';
import {inventoryDocuments,inventoryProjection,inventoryReflected,nativeInventoryChanged,type InventoryDefinition} from './inventory';
import {conditionIdentity,runtimeConditions} from './conditions';
import {panelBridge} from './panel-rpc';
import {diceRpc,DICE_EVENTS} from './dice-rpc';
import {applyPatch,applyProjectionPatch,resourceSnapshot,sameValue} from './merge';
import OBR,{type Item} from '@owlbear-rodeo/sdk';
import {WORKBENCH_DEV,WORKBENCH_PROTOCOL as protocol} from './channel';
import {Relay} from './relay';
import {rolls,rollListeners,executeRoll} from './dice';
import {BUBBLES_META_KEY as HP,EXTERNAL_BUBBLES_META_KEY as LEGACY} from '../utils/statEdit';
import {getState,onStateChange,setState} from '../state';
import {sharedDocuments} from './shared';
import {clampStat,parseStatInput} from '../utils/statEdit';
import {BC_TRANSITIONS_RUN,BC_TRANSITIONS_STATUS} from '../modules/transitions/protocol';
import {TIME_STOP_META,readTimeStop} from '../modules/timeStopProtocol';
import {assetUrl} from '../asset-base';
import {DEFAULT_BUFFS,STATUS_BUFFS_KEY} from '../modules/statusTracker/types';
const BIND='com.character-cards/boundCardId',SLUG='com.bestiary/slug',LIST='com.character-cards/list',ROOM_LIST='com.character-cards/list-room',RES='com.obr-suite/resources/data',SHARED_BUFFS='com.obr-suite/workbench/status-catalog',DIRECTORY='com.obr-suite/workbench/cards';
const MONSTER='com.obr-suite/workbench/monster';
const monsterOverrides=new Map<string,{revision:number;data:any}>();
const DELETED='com.obr-suite/workbench/deleted-cards';
const fields=['health','max health','temporary health','armor class'];
export function setupWorkbench(){if(WORKBENCH_DEV){setupWorkbenchNotices();void start();}}
async function start(){
 const observation=workbenchObservation();
 const [playerId,playerConnection]=await Promise.all([OBR.player.getId(),OBR.player.getConnectionId()]),origin=location.origin,storageKey=`workbench:v2:${OBR.room.id}:${playerId}`;
 let credentials:{hostKey:string;clientKey:string};try{credentials=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{credentials=null as any;}
 if(!credentials?.hostKey||!credentials?.clientKey){credentials={hostKey:crypto.randomUUID()+crypto.randomUUID(),clientKey:crypto.randomUUID()+crypto.randomUUID()};localStorage.setItem(storageKey,JSON.stringify(credentials));}
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credentials.hostKey));const session=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
 let child:Window|null=null,relayActive=false,relayPeerSeen=0,chosen='',lastSelection='',last='',refreshing=false,again=false,follow=true,lastCatalog='';
 let previousSceneCards:string[]=[];let directoryWrite=false;
 let mutation=0,epoch=0,sequence=0;
 const stockHistory=new Map<string,{changes:{id:string;before:any[];after:any[]}[];lockChanges?:{id:string;before:boolean;after:boolean}[]}>();
 let queue=Promise.resolve();const seen=new Map<string,any>(),documents=new Map<string,any>(),documentTimes=new Map<string,number>();
 const cardReads=new Map<string,Promise<any>>(),cardEtags=new Map<string,string>(),cardLocations=new Map<string,CardLocation>();
 const cardInvalidations=new Map<string,number>();
 const cardReadControllers=new Map<string,AbortController>(),cardNotifiedRevisions=new Map<string,number>();
 const activeRequests=new Set<string>(),cancelledRequests=new Set<string>(),requestRuns=new Map<string,Promise<void>>();
 const relay=new Relay(new URL('relay',assetUrl('')).href,session,'host',credentials.hostKey,m=>{relayActive=true;relayPeerSeen=Date.now();void receive(m,true);},credentials.clientKey,undefined,(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_'));
 const shared=sharedDocuments(relay);
 const inventories=inventoryDocuments(relay,OBR.room.id||'default');
 const hostStarted=Date.now();
 const send=(type:string,extra:Record<string,unknown>={},route?:'relay'|'direct')=>{const data={protocol,session,hostStarted,type,...extra};if(route!=='relay'&&child&&!child.closed)try{child.postMessage(data,origin);}catch{}if(route==='relay'||route!=='direct'&&relayActive&&Date.now()-relayPeerSeen<45000)void relay.send(data).catch(()=>{});};
 const panels=panelBridge(send,relay);
 const bubble=(item:Item|undefined)=>((item?.metadata[HP]??item?.metadata[LEGACY]??{}) as Record<string,any>);
 const documentLocation=(id:string)=>cardLocations.get(id)||cardLocation(origin,OBR.room.id||'default',id);
 const definitionsFor=(scene:Record<string,unknown>)=>[...DEFAULT_BUFFS,...(Array.isArray(scene[SHARED_BUFFS])?scene[SHARED_BUFFS] as any[]:[])];
 async function loadCard(cardId:string,key:string,fresh=false){
  const cached=documents.get(key);if(!fresh&&cached&&documentTimes.has(key))return cached;
  // Reuse an in-flight read. Ten observers must not fetch ten copies of the portrait.
  const flight=cardReads.get(key);if(flight)return flight;
  const task=(async()=>{for(;;){const generation=cardInvalidations.get(key)||0,etag=cardEtags.get(key),controller=new AbortController();cardReadControllers.set(key,controller);const timeout=setTimeout(()=>controller.abort(),45000);
  try{const r=await fetch(documentLocation(cardId).url,{headers:etag?{'If-None-Match':etag}:{},cache:'no-store',signal:controller.signal});
  // A remote commit can arrive while this GET still carries an older response.
  // All readers share the next GET; completing the old one must not erase dirtiness.
  if(generation!==(cardInvalidations.get(key)||0)){await r.body?.cancel().catch(()=>{});continue;}
  if(r.status===304&&documents.has(key)){if(documentRevision(documents.get(key))<(cardNotifiedRevisions.get(key)||0)){cardEtags.delete(key);continue;}documentTimes.set(key,Date.now());return documents.get(key);}if(!r.ok)throw Error(`角色读取失败（${r.status}）`);const doc=await r.json(),latest=documents.get(key);
  if(generation!==(cardInvalidations.get(key)||0))continue;
  // A GET begun before a write may finish afterwards. Never poison the cache with it.
  if(latest&&documentRevision(latest)>documentRevision(doc))return latest;
  const nextEtag=r.headers.get('etag');if(nextEtag)cardEtags.set(key,nextEtag);documents.set(key,doc);documentTimes.set(key,Date.now());return doc;
  }catch(error){if(generation===(cardInvalidations.get(key)||0))throw error;}finally{clearTimeout(timeout);if(cardReadControllers.get(key)===controller)cardReadControllers.delete(key);}
  }})();cardReads.set(key,task);try{return await task;}finally{if(cardReads.get(key)===task)cardReads.delete(key);}
 }
 function invalidateCard(cardId:string,revision?:number){const key=`${OBR.room.id}:card:${cardId}`;
  if(Number.isSafeInteger(revision)){
   if(documents.has(key)&&documentRevision(documents.get(key))>=revision!||revision!<=(cardNotifiedRevisions.get(key)??-1))return false;
   cardNotifiedRevisions.set(key,revision!);
  }
  cardInvalidations.set(key,(cardInvalidations.get(key)||0)+1);documentTimes.delete(key);cardEtags.delete(key);cardReadControllers.get(key)?.abort();return true;
 }
 function invalidateCards(){for(const key of new Set([...documents.keys(),...cardReads.keys()])){cardInvalidations.set(key,(cardInvalidations.get(key)||0)+1);documentTimes.delete(key);cardEtags.delete(key);cardReadControllers.get(key)?.abort();}}
 async function reconcileRuntime(cardId:string,key:string,items:Item[],scene:Record<string,unknown>,doc:any,write:boolean){
  if(!write||!(await access(`card:${cardId}`)).write)return doc;
  // The catalog may have been produced before another card's slow download.
  // Scene observations must be read now, not replayed from that old catalog.
  ({items,scene}=await observation.read());
  const tokens=items.filter(i=>i.metadata[BIND]===cardId),defs=definitionsFor(scene);let runtime=documentRuntime(doc,defs);
  for(const token of tokens)runtime=mergeTokenRuntime(runtime,tokenRuntime(token.metadata,documentRuntime(doc,defs)),token.metadata[RUNTIME_BASELINE] as RuntimeBaseline|undefined,cardId,documentRevision(doc));
  if(!sameValue(runtime,documentRuntime(doc,defs))){const next=writeRuntime(doc,runtime,defs);if(write){
   // Clearing a token state also retires the matching inventory grant before any
   // pending repair can reapply it. No ordinary runtime state becomes stock.
   let guard: {key:string;revision:number}|undefined;
   if(doc.dnd_card_web&&!sameValue(documentRuntime(doc,defs).conditions,runtime.conditions)){const synced=await inventories.syncNative(`card:${cardId}`,doc.dnd_card_web,next.dnd_card_web,entry=>conditionIdentity(entry,defs));if(synced.ledgerRevision!==undefined)guard={key:inventories.key,revision:synced.ledgerRevision};}
   const liveTokens=(await observation.read()).items.filter(i=>i.metadata[BIND]===cardId);
   const tokenObservation=(rows:Item[])=>rows.map(i=>({id:i.id,runtime:tokenRuntime(i.metadata,documentRuntime(doc,defs)),baseline:i.metadata[RUNTIME_BASELINE]}));
   if(!sameValue(tokenObservation(tokens),tokenObservation(liveTokens)))return doc;
   await persistDocument({key,cardId} as any,doc,next,guard);doc=next;
  }else return next;}
  if(write&&tokens.length)void projectRuntime(cardId,doc).catch(error=>console.warn('[workbench] runtime projection pending',error));
  return doc;
 }
 const runtimeProjections=new Map<string,{pending:boolean;doc:any;work:Promise<void>}>();
 // Scene metadata is a projection of an already committed card. Keep one SDK
 // write in flight per card and coalesce its successors to the latest document;
 // their durable ACKs do not wait on this presentation lane.
 function projectRuntime(cardId:string,doc:any):Promise<void>{
  const key=`${OBR.room.id}:card:${cardId}`,existing=runtimeProjections.get(key);
  if(existing){existing.pending=true;if(documentRevision(doc)>=documentRevision(existing.doc))existing.doc=doc;return existing.work;}
  const job={pending:true,doc,work:undefined as unknown as Promise<void>};
  job.work=(async()=>{try{while(job.pending){
   job.pending=false;
   const observed=await observation.read(),cached=documents.get(key),latest=cached&&documentRevision(cached)>=documentRevision(job.doc)?cached:job.doc;
   const defs=definitionsFor(observed.scene),value=documentRuntime(latest,defs);
   // A native edit which has not reached the document must be reconciled first.
   // Refreshing a queued projection must not mistake it for stale presentation.
   const tokens=observed.items.filter(item=>item.metadata[BIND]===cardId&&sameValue(value,mergeTokenRuntime(value,tokenRuntime(item.metadata,value),item.metadata[RUNTIME_BASELINE] as RuntimeBaseline|undefined,cardId,documentRevision(latest))));
   await writeRuntimeProjection(cardId,latest,tokens,defs);
  }}finally{if(runtimeProjections.get(key)===job)runtimeProjections.delete(key);}})();
  runtimeProjections.set(key,job);return job.work;
 }
 async function writeRuntimeProjection(cardId:string,doc:any,tokens:Item[],defs:any[]){
  const value=documentRuntime(doc,defs),revision=documentRevision(doc),stamp:RuntimeBaseline={version:1,cardId,revision,value};
  const pending=tokens.filter(item=>!sameValue(item.metadata[RUNTIME_BASELINE],stamp)||!sameValue(tokenRuntime(item.metadata,value),value));if(!pending.length)return;
  await OBR.scene.items.updateItems(pending.map(i=>i.id),drafts=>{for(const item of drafts){const observed=pending.find(i=>i.id===item.id),previous=item.metadata[RUNTIME_BASELINE] as RuntimeBaseline|undefined;
   if(item.metadata[BIND]!==cardId||!observed||previous?.cardId===cardId&&previous.revision>revision)continue;
   // A genuine scene edit after the read is handled by the next reconciliation.
   if(!sameValue(tokenRuntime(item.metadata,value),tokenRuntime(observed.metadata,value))||!sameValue(item.metadata[RUNTIME_BASELINE],observed.metadata[RUNTIME_BASELINE]))continue;
   item.metadata[HP]={...bubble(item),...value.stats};if(item.metadata[LEGACY])item.metadata[LEGACY]={...item.metadata[LEGACY] as object,...value.stats};item.metadata[RES]=structuredClone(Object.values(value.resources));item.metadata[STATUS_BUFFS_KEY]=[...value.conditions];item.metadata[RUNTIME_BASELINE]=structuredClone(stamp);
  }});
 }
 async function catalog(){
  const {ready,scene,room,items,role,party}=await observation.read();
  const sceneList=Array.isArray(scene[LIST])?scene[LIST] as any[]:[],roomList=Array.isArray(room[ROOM_LIST])?room[ROOM_LIST] as any[]:[];
  const directory=Array.isArray(room[DIRECTORY])?room[DIRECTORY] as any[]:[];
  // Missing scene metadata during startup/scene switching is not a deletion.
  // Explicit deletes use DELETED; the room directory survives independent scenes.
  if(ready)previousSceneCards=sceneList.map(c=>c.id);
  const deleted=Array.isArray(room[DELETED])?room[DELETED] as string[]:[];
  // Stable rooms can contain a bound token before their cross-scene list mirror
  // initializes. Recover that binding without depending on the old plugin to
  // populate the list, and default its visibility to owner/GM until known.
  const bound=items.filter(i=>typeof i.metadata[BIND]==='string'&&/^[a-zA-Z0-9_-]+$/.test(String(i.metadata[BIND]))).map(i=>({id:String(i.metadata[BIND]),name:i.name,owner_ids:[i.createdUserId],visibility:'owners',locked:true}));
  const entries=new Map<string,any>();for(const c of [...bound,...directory,...roomList,...sceneList])if(typeof c?.id==='string'&&!deleted.includes(c.id))entries.set(c.id,{...entries.get(c.id),...c,...(c.visibility&&!Object.prototype.hasOwnProperty.call(c,'locked')?{locked:undefined}:{})});
  const all=[...entries.values()];
  // Retain a room directory independently of scene tokens, including inferred legacy ownership.
  for(const c of all){c.name=c.name||c.title||items.find(i=>i.metadata[BIND]===c.id)?.name||c.id;if(!Array.isArray(c.owner_ids)||!c.owner_ids.length){const owners=[...new Set(items.filter(i=>i.metadata[BIND]===c.id).map(i=>i.createdUserId))];if(owners.length)c.owner_ids=owners;}}
  // Legacy uploads retain their original room URL when moved between scenes.
  for(const c of all)if(typeof c.url==='string'){const next=cardLocation(origin,OBR.room.id||'default',c.id,c.url),previous=cardLocations.get(c.id);cardLocations.set(c.id,next);if(previous&&previous.url!==next.url)invalidateCard(c.id);}
  const compact=all.map(({id,name,owner_ids,locked,visibility,url})=>({id,name,owner_ids,locked,visibility,url}));
  if(role==='GM'&&!directoryWrite&&JSON.stringify(directory)!==JSON.stringify(compact)){directoryWrite=true;void OBR.room.setMetadata({[DIRECTORY]:compact}).finally(()=>{directoryWrite=false;});}
  const cards=all.map(c=>{const tokens=items.filter(i=>i.metadata[BIND]===c.id),own=Array.isArray(c.owner_ids)&&c.owner_ids.length?c.owner_ids.includes(playerId):tokens.some(i=>i.createdUserId===playerId),locked=c.locked??!!(c.visibility&&c.visibility!=='public');
   const projectedRevision=Math.max(0,...tokens.map(token=>{const baseline=token.metadata[RUNTIME_BASELINE] as RuntimeBaseline|undefined;return baseline&&baseline.cardId===c.id?baseline.revision:0;}));if(projectedRevision>documentRevision(documents.get(`${OBR.room.id}:card:${c.id}`)))invalidateCard(c.id,projectedRevision);
   return {...c,name:c.name||c.title||tokens[0]?.name||c.id,own,write:role==='GM'||own,locked,inScene:tokens.length>0,itemId:tokens[0]?.id||`card:${c.id}`,documentRevision:0,passive:undefined as number|undefined,coins:{} as Record<string,number>,player:party.filter(p=>c.owner_ids?.includes(p.id)).map(p=>p.name).join('、'),conditions:conditionRows({item:tokens[0],scene},undefined),resources:tokens[0]?.metadata[RES]||[],stats:bubble(tokens[0])};
  }).filter(c=>role==='GM'||c.own||!c.locked).sort((a,b)=>Number(b.write)-Number(a.write)||Number(b.inScene)-Number(a.inScene)||String(a.name).localeCompare(String(b.name),'zh'));
  for(const c of cards){const doc=documents.get(`${OBR.room.id}:card:${c.id}`);if(!doc)continue;const canonical=documentRuntime(doc,definitionsFor(scene));c.documentRevision=documentRevision(doc);c.passive=doc.core_stats?.passive_perception;c.coins=documentCoins(doc);const defs=definitionsFor(scene);c.conditions=conditionRows({cardId:c.id,scene} as any,doc);(c as any).player=doc.dnd_card_web?.player||doc.identity?.player_name||party.filter(p=>c.owner_ids?.includes(p.id)).map(p=>p.name).join('、');c.stats={...c.stats,...canonical.stats};c.resources=Object.values(canonical.resources);}
  const ownerRolesKey='com.obr-suite/workbench/owner-roles',ownerRoles={...room[ownerRolesKey] as Record<string,string>,[playerId]:role};for(const p of party)ownerRoles[p.id]=p.role;if(role==='GM'&&!sameValue(ownerRoles,room[ownerRolesKey]))void OBR.room.setMetadata({[ownerRolesKey]:ownerRoles});
  const monsters=items.filter(item=>ownerRoles[item.createdUserId]==='PLAYER'&&!item.metadata[BIND]&&(item.metadata[SLUG]||item.metadata[HP]||item.metadata[LEGACY])&&(role==='GM'||item.createdUserId===playerId||getState().allowPlayerMonsters&&item.metadata['com.obr-suite/workbench/locked']!==true)).map(item=>{
   const raw=(scene['com.bestiary/monsters'] as any)?.[String(item.metadata[SLUG])]||monsterOverrides.get((item.metadata[MONSTER] as any)?.key)?.data||documents.get(`${OBR.room.id}:token:${item.id}:${item.metadata[SLUG]||''}`),stats=bubble(item);
   return {id:item.id,kind:'monster',name:item.name||raw?.name||'怪物',write:role==='GM'||item.createdUserId===playerId,locked:item.metadata['com.obr-suite/workbench/locked']===true,inScene:true,itemId:item.id,resources:(Array.isArray(item.metadata[RES])?item.metadata[RES]:[]) as any[],stats:{health:raw?.hp?.average,'max health':raw?.hp?.average,'temporary health':0,'armor class':typeof raw?.ac?.[0]==='number'?raw.ac[0]:raw?.ac?.[0]?.ac,...stats},passive:raw?.passive??(raw?.wis?10+Math.floor((raw.wis-10)/2):undefined),coins:{},conditions:conditionRows({item,scene} as any,undefined),player:party.find(p=>p.id===item.createdUserId)?.name};
  });
  return {cards,monsters,items,scene,room,role,all};
 }
 async function access(id:string,existing?:Awaited<ReturnType<typeof catalog>>){
  const data=existing||await catalog(),item=data.items.find(i=>i.id===id),cardId=id.startsWith('card:')?id.slice(5):String(item?.metadata[BIND]||''),card=data.cards.find(c=>c.id===cardId);
  if(cardId&&!card)throw Error('没有此角色卡的查看权限');if(!card&&!item)throw Error('未找到角色卡或棋子');
  if(!card&&!item?.metadata[SLUG]&&!item?.metadata[HP]&&!item?.metadata[LEGACY])throw Error('棋子没有角色、怪物或生命条组件');
  if(!card&&data.role!=='GM'&&item?.createdUserId!==playerId&&(!getState().allowPlayerMonsters||item?.metadata['com.obr-suite/workbench/locked']===true))throw Error('没有此怪物的阅读权限');
  const token=item||data.items.find(i=>i.metadata[BIND]===cardId),slug=String(token?.metadata[SLUG]||'');
  return {...data,item:token,cardId,card,slug,write:card?.write??(data.role==='GM'||token?.createdUserId===playerId),key:cardId?`${OBR.room.id}:card:${cardId}`:`${OBR.room.id}:token:${id}:${slug}`};
 }
 async function read(a:Awaited<ReturnType<typeof access>>,fresh=false){
  const key=a.key;const override=a.item?.metadata[MONSTER] as {key:string;revision:number}|undefined;if(override?.key){let cached=monsterOverrides.get(override.key);if(fresh||!cached||cached.revision<override.revision){cached=await relay.send({sharedDocument:{key:override.key,operation:'read'}});monsterOverrides.set(override.key,cached!);}if(cached?.data)return cached.data;}if(!a.cardId&&!fresh&&documents.has(key))return documents.get(key);let doc:any=null;
  if(a.cardId)return loadCard(a.cardId,key,fresh);
  else if(a.slug){doc=(a.scene['com.bestiary/monsters'] as any)?.[a.slug];if(!doc){const data=await import('../modules/bestiary/data');doc=data.getRawMonster(a.slug);if(!doc){doc=await data.loadMonsterBySlug(a.slug);}}}
  documents.set(key,doc);return doc;
 }
 function live(a:Awaited<ReturnType<typeof access>>){const ids=a.item?.metadata[STATUS_BUFFS_KEY];const custom=a.scene[SHARED_BUFFS];const defs=[...DEFAULT_BUFFS,...(Array.isArray(custom)?custom:[])].filter(d=>d&&typeof d.id==='string');return {conditions:Array.isArray(ids)?ids.map(id=>defs.find(v=>v.id===id)||{id,name:id}):undefined,resources:a.item?.metadata[RES]};}
 async function snapshot(id:string,existing?:Awaited<ReturnType<typeof catalog>>){
  let a=await access(id,existing);const key=a.key,doc=await read(a);a=await access(id);if(a.key!==key)throw Error('角色关联已改变');
  const b=bubble(a.item),canonical=a.cardId?documentRuntime(doc,definitionsFor(a.scene)):undefined;
  return {sequence:++sequence,state:{key:a.key,itemId:a.item?.id||`card:${a.cardId}`,name:doc?.identity?.character_name||doc?.name||a.card?.name||a.item?.name,cardId:a.cardId,slug:a.slug,kind:a.cardId?'character':a.slug?'monster':'token',documentRevision:a.cardId?documentRevision(doc):undefined,projectionPending:!!a.cardId&&a.items.some(item=>item.metadata[BIND]===a.cardId&&(item.metadata[RUNTIME_BASELINE] as RuntimeBaseline|undefined)?.revision!==documentRevision(doc)),stats:canonical?{...a.card?.stats,...canonical.stats}:Object.fromEntries(fields.filter(k=>typeof b[k]==='number').map(k=>[k,b[k]])),write:a.write,role:a.role,pinned:!follow,tokenPortrait:tokenPortrait(a.item),locked:a.card?.locked??a.item?.metadata['com.obr-suite/workbench/locked']===true,statsLocked:b.locked!==false,...live(a),conditions:conditionRows(a,doc),resources:canonical?Object.values(canonical.resources):live(a).resources},document:doc};
 }
 async function persistDocument(a:Awaited<ReturnType<typeof access>>,existing:any,data:any,inventoryGuard?:{key:string;revision:number},conditionGrant=false){
  const permission=await access(`card:${a.cardId}`);if(!permission.write&&!(conditionGrant&&permission.card&&!permission.card.locked))throw Error('角色修改权限已改变');
  data[DOCUMENT_REVISION]=documentRevision(existing)+1;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(existing))),expected=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const location=documentLocation(a.cardId);
  try{await relay.send({saveCard:{room:location.room,card:location.card,inventoryRoom:(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_'),expected,changes:documentChanges(existing,data).map(({path,after,remove})=>({path,after,remove})),inventoryGuard}});}
  catch(error){documentTimes.delete(a.key);const e=error as any;if(e.status&&e.status<500)throw error;
   // A lost HTTP response is not evidence of a failed write. Read back once;
   // never replay the mutation, and never report a rollback while it is unknown.
   try{const response=await fetch(location.url,{cache:'no-store',signal:AbortSignal.timeout(20000)});if(response.ok){const committed=await response.json();if(sameValue(committed,data)){cardCommitted(a,committed);return;}}}catch{}
   throw Object.assign(Error('角色保存结果暂时无法确认；本地改动已保留，请恢复连接后核对。'),{uncertain:true,diagnostic:{code:'WRITE_RESULT_UNKNOWN',documentRevision:data[DOCUMENT_REVISION]}});
  }
  cardCommitted(a,data);
 }
 function cardCommitted(a:{key:string;cardId:string},data:any){
  documents.set(a.key,data);documentTimes.set(a.key,Date.now());
  // Every durable write announces its revision immediately. Token projection,
  // scene notices and their iframe handshakes must not delay another reader.
  // Only an invalidation is public; private character contents stay on the
  // existing permission-checked read path.
  void OBR.broadcast.sendMessage('com.obr-suite/cc-card-updated',{cardId:a.cardId,roomId:OBR.room.id,revision:documentRevision(data)},{destination:'ALL'}).catch(error=>console.warn('[workbench] card invalidation pending',error));
 }

 const inventoryId=(a:Awaited<ReturnType<typeof access>>)=>a.cardId?`card:${a.cardId}`:`monster:${a.item!.id}`;
 async function inventoryContext(existing?:Awaited<ReturnType<typeof catalog>>){
  const data=existing||await catalog(),rules=await shared.read(),publicId=`public:${rules.key||OBR.room.id}`;
  const ledger=await inventories.read();
  // Never seed a legacy backpack before its document has arrived. It can be added
  // to the ledger after hydration without holding up selection or other cards.
  const definitions:InventoryDefinition[]=[{id:publicId,name:'公共仓库',kind:'public',write:data.role==='GM'||!ledger.data.containers[publicId]?.locked},...data.cards.filter(c=>ledger.data.containers[`card:${c.id}`]||documents.has(`${OBR.room.id}:card:${c.id}`)).map(c=>({id:`card:${c.id}`,name:c.name,kind:'card' as const,write:c.write,document:documents.get(`${OBR.room.id}:card:${c.id}`)}))];
  for(const item of data.items.filter(i=>!i.metadata[BIND]&&(i.metadata[SLUG]||i.metadata[HP]||i.metadata[LEGACY])&&(data.role==='GM'||i.createdUserId===playerId)))definitions.push({id:`monster:${item.id}`,name:item.name,kind:'monster',write:true});
  return {definitions,publicId,gm:data.role==='GM',authority:{gm:data.role==='GM',read:new Set(definitions.map(d=>d.id)),write:new Set(definitions.filter(d=>d.write).map(d=>d.id)),give:new Set(definitions.filter(d=>d.kind!=='monster'||d.write).map(d=>d.id))}};
 }
 async function inventoryMirror(id:string,container:any,conditionIds:string[]=[],conditionEntries:any[]=[]){
  if(!id.startsWith('card:')&&!id.startsWith('monster:'))return;
  const current=await inventories.read(true),pending=current.data.projections?.[id];if(!pending)return;container=current.data.containers[id];conditionIds=pending.conditions;conditionEntries=pending.entries||[];
  const a=await access(id.startsWith('card:')?id:id.slice(8)),oldConditions=a.cardId?(await read(a,true))?.dnd_card_web?.selections?.filter((s:any)=>s.entry.kind==='condition')||[]:[];
  const custom=Array.isArray(a.scene[SHARED_BUFFS])?a.scene[SHARED_BUFFS] as any[]:[],defs=[...DEFAULT_BUFFS,...custom],identify=(entry:any)=>conditionIdentity(entry,defs);
  if(a.cardId){const existing=await read(a,true),doc=inventoryProjection(existing,container,conditionIds,conditionEntries,identify);if(JSON.stringify(doc)!==JSON.stringify(existing))await persistDocument(a,existing,doc,{key:inventories.key,revision:current.revision});}
  if(!conditionIds.length)return;
  const known=[...conditionEntries,...oldConditions.map((s:any)=>s.entry),...container.items.filter((row:any)=>row.kind==='condition').map((row:any)=>row.entry)],affected=new Set(conditionIds.map(id=>identify(known.find(entry=>entry.id===id)||{id})));
  const rows=container.items.filter((row:any)=>row.kind==='condition'&&(conditionIds.includes(row.entry.id)||affected.has(identify(row.entry))));const extra:any[]=[];
  const ids=rows.map((row:any)=>{const entry=row.entry,id=conditionIdentity(entry,defs);if(!defs.some(d=>d.id===id))extra.push({id,name:entry.name,color:'#777777'});return id;});
  const removed=new Set(conditionIds.flatMap(entryId=>[entryId,'web:'+entryId,...affected]).filter(id=>!ids.includes(id)));
  const previousIds=Array.isArray(a.item?.metadata[STATUS_BUFFS_KEY])?a.item!.metadata[STATUS_BUFFS_KEY] as string[]:[];
  if(extra.length)await OBR.scene.setMetadata({[SHARED_BUFFS]:[...custom.filter(d=>!extra.some(v=>v.id===d.id)),...extra]});await setTokens(a,{conditions:[...new Set([...previousIds.filter(id=>!removed.has(id)),...ids])]});
 }
 let repairQueued=false;
 function scheduleInventoryRepair(){
  if(repairQueued)return;repairQueued=true;
  void (async()=>{try{
   const {party:players,role,player:{connectionId:selfConnection}}=await observation.read();
   const gms=[...players.filter(p=>p.role==='GM').map(p=>p.connectionId),...(role==='GM'?[selfConnection]:[])].sort();if(gms.length&&gms[0]!==selfConnection)return;
   const context=await inventoryContext(),ledger=(await inventories.read()).data;
   for(const [id,record] of Object.entries(ledger.projections||{})){if(!context.authority.write.has(id))continue;try{await inventoryMirror(id,ledger.containers[id],record.conditions,record.entries);await inventories.projected(id,record.revision);}catch{/* Durable record remains until a later successful projection. */}}
  }finally{repairQueued=false;}})().catch(()=>{});
 }
 const canOpen=(a:Awaited<ReturnType<typeof access>>)=>a.cardId?getState().enabled.characterCards!==false:a.slug?getState().enabled.bestiary!==false:getState().enabled.hpBar!==false;
 let selectionGeneration=0,selecting=false,selectAgain=false;
 async function refreshSelection(){
  if(!relayActive&&(!child||child.closed))return;
  if(selecting){selectAgain=true;return;}selecting=true;
  try{const list=await catalog(),selection=(await observation.read()).selection,signature=JSON.stringify(selection);
   if(follow&&signature!==lastSelection){lastSelection=signature;selectionGeneration++;if(selection.length===1)try{const a=await access(selection[0],list);if(canOpen(a)){chosen=a.cardId?`card:${a.cardId}`:selection[0];send('navigate',{itemId:chosen,id:crypto.randomUUID()});}}catch{}}
   if(chosen)try{if(!canOpen(await access(chosen,list)))chosen='';}catch{chosen='';}
   if(!chosen)chosen=getState().enabled.characterCards!==false&&list.cards[0]?`card:${list.cards[0].id}`:'';
   if(!chosen){send('selection',{sequence:++sequence,message:'暂无可查看的角色卡'});return;}
   const id=chosen,generation=selectionGeneration;
   // A slow first download must not hold the selection gate: a later click on
   // another (already cached) card can finish immediately and wins the generation.
   void snapshot(id,list).then(next=>{if(id!==chosen||generation!==selectionGeneration)return;
    const signatureNext=JSON.stringify([next.state,next.document]);if(signatureNext!==last){last=signatureNext;send('selection',next);}
   }).catch(error=>{if(id===chosen&&generation===selectionGeneration)send('error',{message:String(error)});});
  }catch(error){send('error',{message:String(error)});}finally{selecting=false;if(selectAgain){selectAgain=false;void refreshSelection();}}
 }
 type HydrationJob={key:string;card:Awaited<ReturnType<typeof catalog>>['cards'][number];list:Awaited<ReturnType<typeof catalog>>;started:boolean;promise:Promise<void>;resolve:()=>void};
 const cardHydrations=new Map<string,HydrationJob>(),hydrationQueue:HydrationJob[]=[];let backgroundHydrations=0;
 function pumpHydrations(){while(backgroundHydrations<2&&hydrationQueue.length){const job=hydrationQueue.shift()!;if(!job.started)startHydration(job,true);}}
 function startHydration(job:HydrationJob,background:boolean){if(job.started)return;job.started=true;if(background)backgroundHydrations++;
  void (async()=>{const before=documents.get(job.key);try{for(;;){const generation=cardInvalidations.get(job.key)||0,{card:c,list}=job;
    // The selected card bypasses unrelated downloads. Other cards retain a
    // bounded background queue, and unchanged scene events reuse cached reads.
    const ttl=chosen===`card:${c.id}`?3000:30000;
    let doc=await loadCard(c.id,job.key,!documentTimes.has(job.key)||Date.now()-(documentTimes.get(job.key)||0)>ttl);
    if(!mutation)doc=await reconcileRuntime(c.id,job.key,list.items,list.scene,doc,c.write);
    if(generation!==(cardInvalidations.get(job.key)||0))continue;
    if(!sameValue(before,doc)){void refresh();if(chosen===`card:${c.id}`)void refreshSelection();}break;
   }}catch{}finally{cardHydrations.delete(job.key);job.resolve();if(background)backgroundHydrations--;pumpHydrations();}})();
 }
 function scheduleHydration(card:HydrationJob['card'],list:HydrationJob['list'],priority:boolean){const key=`${OBR.room.id}:card:${card.id}`,existing=cardHydrations.get(key);
  if(existing){existing.card=card;existing.list=list;if(priority&&!existing.started)startHydration(existing,false);return existing.promise;}
  let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r),job:HydrationJob={key,card,list,started:false,promise,resolve};cardHydrations.set(key,job);
  if(priority)startHydration(job,false);else{hydrationQueue.push(job);pumpHydrations();}return promise;
 }
 async function hydrate(cardId?:string){const list=await catalog();await Promise.all(list.cards.filter(c=>!cardId||c.id===cardId).map(c=>scheduleHydration(c,list,chosen===`card:${c.id}`)));}
 async function refresh(){if(!relayActive&&(!child||child.closed))return;if(refreshing){again=true;return;}refreshing=true;
  try{
   const observedVersion=observation.version(),startedEpoch=epoch;
   const list=await catalog(),[rules,observed,inventoryContextNow]=await Promise.all([shared.read(),observation.read(),inventoryContext(list)]),inventory=await inventories.view(inventoryContextNow.definitions,inventoryContextNow.gm,inventoryContextNow.publicId);for(const card of list.cards){const container=inventory.containers[`card:${card.id}`];if(container)card.coins=Object.fromEntries(container.items.filter(row=>row.kind==='currency').map(row=>[row.coin!,row.quantity]));}const data={cards:list.cards.map(({id,name,write,locked,inScene,itemId,resources,stats,passive,coins,conditions,documentRevision,player})=>({id,name,write,locked,inScene,itemId,resources,stats,passive,coins,conditions,documentRevision,player})),monsters:list.monsters,role:list.role,shared:rules,inventory,settings:getState(),enabled:getState().enabled,visibility:{wiki:getState().enabled.search!==false&&(list.role==='GM'||!getState().searchGmOnly),monsters:getState().enabled.bestiary!==false&&(list.role==='GM'||getState().allowPlayerMonsters)},console:{timeStop:readTimeStop(list.scene[TIME_STOP_META]).active,portalEffects:getState().portalEffects!==false,players:observed.party}};
   if(observation.version()!==observedVersion||epoch!==startedEpoch){again=true;return;}
   const signature=JSON.stringify(data);if(signature!==lastCatalog){lastCatalog=signature;send('catalog',{sequence:++sequence,...data});}
  }catch(error){console.warn('[workbench] catalog refresh',error);}finally{refreshing=false;if(again){again=false;void refresh();}}
 }
 async function setTokens(a:Awaited<ReturnType<typeof access>>,patch:any){
  if(a.cardId){
   const doc=await read(a);
   void projectRuntime(a.cardId,doc).catch(error=>console.warn('[workbench] runtime projection pending',error));
   // Locking is metadata-owned, so its SDK write still determines success.
   if(patch.stats&&'locked' in patch.stats){const ids=a.items.filter(i=>i.metadata[BIND]===a.cardId).map(i=>i.id);await OBR.scene.items.updateItems(ids,drafts=>{for(const item of drafts)if(item.metadata[BIND]===a.cardId)item.metadata[HP]={...bubble(item),locked:patch.stats.locked};});}
   return;
  }
  const ids=a.cardId?a.items.filter(i=>i.metadata[BIND]===a.cardId).map(i=>i.id):a.item?[a.item.id]:[];if(!ids.length)return;
  await OBR.scene.items.updateItems(ids,items=>{for(const item of items){if(a.cardId&&item.metadata[BIND]!==a.cardId)continue;
   item.metadata=mergeMonsterMetadata(item.metadata,a.item?.metadata||{},patch);
  }});
 }
 async function resourceNotices(a:Awaited<ReturnType<typeof access>>,before:Record<string,any>,after:Record<string,any>){
  const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(id=>(before[id]?.current||0)!==(after[id]?.current||0));if(!changed.length)return;
  if(a.role==='GM'&&(await inventories.read()).data.silent)return;
  const privateFor=a.card?.locked?(a.card.owner_ids||[]):a.item?.metadata['com.obr-suite/workbench/locked']?[a.item.createdUserId]:undefined;
  const actor=(await observation.read()).player.name;
  for(const id of changed){const previous=before[id],next=after[id];
   const resource={...(next||previous),id,current:next?.current||0,name:next?.name||previous?.name||id,type:next?.type||previous?.type||'count',icon:'gem'},delta=resource.current-(previous?.current||0);
   await publishWorkbenchNotice({noticeId:crypto.randomUUID(),privateFor,privateSummary:`${actor}${delta>0?'恢复':'消耗'}了什么`,tokenId:a.item?.id||`card:${a.cardId}`,tokenName:a.card?.name||a.item?.name||'',resource,delta,prevValue:previous?.current||0});
  }
 }
 function nativeStockNotices(c:any){const values:Record<string,any>={};for(const row of c?.selections||[]){if(row.entry?.kind!=='item')continue;const id='item:'+row.entry.id;const r=values[id]||={id,name:row.entry.name,current:0,max:0,type:'number'};r.current+=row.quantity||0;r.max=r.current;}for(const [coin,current] of Object.entries(c?.inventory?.coins||{}))values['coin:'+coin]={name:({cp:'铜币',sp:'银币',ep:'琥珀金币',gp:'金币',pp:'铂金币'} as Record<string,string>)[coin]||coin,current,max:current,type:'number'};return values;}
 async function spellPreparationNotices(a:Awaited<ReturnType<typeof access>>,before:any,after:any){
  const prepared=(card:any):Set<string>=>new Set(card?.spellSettings?.mode==='prepared'?card.spellSettings.prepared||[]:[]);
  const old=prepared(before),next=prepared(after);if([...old].every(id=>next.has(id))&&old.size===next.size)return;
  if(a.role==='GM'&&(await inventories.read()).data.silent)return;
  const privateFor=a.card?.locked?(a.card.owner_ids||[]):undefined,requester=(await observation.read()).player.name,actor=a.card?.name||after.name||requester;
  for(const id of new Set([...old,...next])){
   if(old.has(id)===next.has(id))continue;
   const row=(after.selections||[]).find((s:any)=>s.id===id)||(before.selections||[]).find((s:any)=>s.id===id);if(row?.entry?.kind!=='spell')continue;
   const added=next.has(id),name=row.entry.name,summary=`${actor}${added?'预备了':'取消预备了'}${name}`;
   await publishWorkbenchNotice({noticeId:crypto.randomUUID(),tokenId:a.item?.id||`card:${a.cardId}`,tokenName:actor,summary,privateFor,privateSummary:`${requester}${added?'预备':'取消预备'}了法术`,resource:{id,name,current:added?1:0,max:1,type:'count',icon:'spellbook'},delta:added?1:-1,prevValue:added?0:1});
  }
 }
 async function statNotices(a:Awaited<ReturnType<typeof access>>,before:Record<string,any>,after:Record<string,any>){
  const names:Record<string,string>={health:'生命值','temporary health':'临时生命','max health':'生命值上限','armor class':'护甲等级'};
  const values=(stats:Record<string,any>)=>Object.fromEntries(Object.entries(names).filter(([key])=>typeof stats[key]==='number').map(([key,name])=>[key,{id:key,name,current:stats[key],max:stats['max health']||stats[key]||0,type:'number'}]));
  await resourceNotices(a,values(before),values(after));
 }
 async function conditionNotices(a:Awaited<ReturnType<typeof access>>,before:any,after:any){
  const values=(card:any)=>Object.fromEntries((card?.selections||[]).filter((row:any)=>row.entry?.kind==='condition').map((row:any)=>[conditionIdentity(row.entry,definitionsFor(a.scene)),{id:row.entry.id,name:row.entry.name,current:row.level||1,max:6,type:'number'}]));
  const old=values(before),next=values(after);if(sameValue(old,next))return;
  if(a.role==='GM'&&(await inventories.read()).data.silent)return;
  const actor=a.card?.name||a.item?.name||after.name||'',requester=(await observation.read()).player.name,privateFor=a.card?.locked?(a.card.owner_ids||[]):a.item?.metadata['com.obr-suite/workbench/locked']?[a.item.createdUserId]:undefined;
  for(const id of new Set([...Object.keys(old),...Object.keys(next)])){if(sameValue(old[id],next[id]))continue;const row=next[id]||old[id],added=!!next[id],summary=`${actor}${added?'获得了':'移除了'}${row.name}${added&&row.current>1?` ${row.current}`:''}`;await publishWorkbenchNotice({noticeId:crypto.randomUUID(),tokenId:a.item?.id||`card:${a.cardId}`,tokenName:actor,summary,privateFor,privateSummary:`${requester}调整了状态`,resource:row,delta:added?1:-1,prevValue:old[id]?.current||0});}
 }
 function conditionRows(a:{scene:Record<string,any>;item?:Item;cardId?:string},doc:any):ConditionRow[]{
  const defs=definitionsFor(a.scene),saved=a.cardId?(doc?.dnd_card_web?.selections?.filter((s:any)=>s.entry?.kind==='condition')||(doc?.web_conditions||[]).map((entry:any)=>({entry}))):Object.values(a.item?.metadata['com.obr-suite/workbench/condition-details'] as any||{});
  const ids=a.cardId?documentRuntime(doc,defs).conditions:(a.item?.metadata[STATUS_BUFFS_KEY] as string[]||[]);
  return ids.map(id=>{const original=saved.find((s:any)=>s.entry&&conditionIdentity(s.entry,defs)===id),definition=defs.find(v=>v.id===id),entry=original?.entry||definition?.entry||{id:'suite-condition:'+id,kind:'condition',name:definition?.name||id,english:id,source:'IMPORTED',edition:'both',packId:'imported',revision:'1',entries:[],raw:{_suiteStatusId:id}};return {id,name:entry.name,entry,level:original?.level||1};});
 }
 const changeCondition=conditionCommands({
  read:async id=>{const a=await access(id);return {rows:conditionRows(a,a.cardId?await read(a,true):undefined),write:a.write,receive:!!(a.card?!a.card.locked:a.item?.createdUserId&&a.item.metadata['com.obr-suite/workbench/locked']!==true)};},
  write:async change=>{
   const a=await access(change.itemId);if(!a.write&&!(change.grant&&(a.card?!a.card.locked:a.item?.createdUserId&&a.item.metadata['com.obr-suite/workbench/locked']!==true)))throw Error('角色状态修改权限已改变');
   const doc=a.cardId?await read(a):undefined,rows=conditionRows(a,doc),current=rows.find(row=>row.id===change.conditionId)||null;
   if(!sameValue(current,change.before))throw Error('状态已被其他操作修改，请重试');
   const next=[...rows.filter(row=>row.id!==change.conditionId),...(change.after?[change.after]:[])],defs=definitionsFor(a.scene);
   const nativeRows=(values:ConditionRow[])=>({selections:values.map(row=>({id:'suite-status:'+row.id,entry:row.entry,level:row.level||1,quantity:1}))});
   const sync=await inventories.syncNative(a.cardId?`card:${a.cardId}`:`monster:${a.item!.id}`,nativeRows(rows),nativeRows(next),entry=>conditionIdentity(entry,defs));
   if(change.after&&!defs.some(def=>def.id===change.after!.id)){const custom=Array.isArray(a.scene[SHARED_BUFFS])?a.scene[SHARED_BUFFS] as any[]:[];await OBR.scene.setMetadata({[SHARED_BUFFS]:[...custom,{id:change.after.id,name:change.after.name,entry:change.after.entry,color:'#777777'}]});}
   if(a.cardId){
    const updated=writeRuntime(doc,{...documentRuntime(doc,defs),conditions:next.map(row=>row.id)},defs);
    if(updated.dnd_card_web)updated.dnd_card_web.selections=updated.dnd_card_web.selections.map((selection:any)=>{if(selection.entry?.kind!=='condition')return selection;const row=next.find(row=>conditionIdentity(selection.entry,defs)===row.id);return row?{...selection,entry:row.entry,level:row.level||1}:selection;});
    updated.web_conditions=next.map(row=>row.entry);
    try{await persistDocument(a,doc,updated,sync.ledgerRevision===undefined?undefined:{key:inventories.key,revision:sync.ledgerRevision},change.grant);}
    catch(error){if(sync.ledgerCommitted)throw Object.assign(Error('库存中的状态授予变更已保存；角色状态写入结果需要核对。'),{uncertain:true,diagnostic:{code:'CONDITION_GRANT_PARTIAL',phase:'save-condition-document',ledgerRevision:sync.ledgerRevision,itemId:change.itemId,conditionId:change.conditionId,committed:['inventory-grant'],cause:String(error)}});throw error;}
    try{await setTokens(a,{conditions:next.map(row=>row.id)});}catch(error){console.warn('[workbench] condition projection pending',error);}
   }else{
    await OBR.scene.items.updateItems([a.item!.id],items=>{for(const item of items){if(!a.write&&item.metadata['com.obr-suite/workbench/locked']===true)throw Error('目标怪物已上锁');if(item.metadata[BIND]||item.metadata[SLUG]!==a.item!.metadata[SLUG])throw Error('怪物关联已改变');const oldIds=a.item!.metadata[STATUS_BUFFS_KEY] as string[]||[],liveIds=item.metadata[STATUS_BUFFS_KEY] as string[]||[];if(oldIds.includes(change.conditionId)!==liveIds.includes(change.conditionId))throw Error('怪物状态已改变');item.metadata[STATUS_BUFFS_KEY]=[...liveIds.filter(id=>id!==change.conditionId),...(change.after?[change.conditionId]:[])];const details={...item.metadata['com.obr-suite/workbench/condition-details'] as any};if(change.after)details[change.conditionId]={entry:change.after.entry,level:change.after.level||1};else delete details[change.conditionId];item.metadata['com.obr-suite/workbench/condition-details']=details;}});
   }
  },
  snapshot:async id=>snapshot(id),catalog:async()=>{const list=await catalog();return {cards:list.cards,monsters:list.monsters,sequence:++sequence};},
  notice:async changes=>{for(const change of changes){const a=await access(change.itemId),native=(row:ConditionRow|null)=>({selections:row?[{entry:row.entry,level:row.level||1}]:[]});await conditionNotices(a,native(change.before),native(change.after));}}
 });
 async function command(m:any){
  if(m.type==='condition'){
   if(m.condition?.entry){const a=await access(m.itemId);m.condition={...m.condition,id:conditionIdentity(m.condition.entry,definitionsFor(a.scene)),level:Math.max(1,Math.min(6,Number(m.condition.level)||1))};}
   return changeCondition(m);
  }
  if(m.type==='panelRpc')return panels(m.panel,m.instance,String(m.method),Array.isArray(m.args)?m.args:[]);
  if(m.type==='inventory'){
   if(getState().enabled.inventory===false)throw Error('背包与公共仓库未开启');
   const context=await inventoryContext();await inventories.ensure(context.definitions);
   if(m.scopeKey&&m.scopeKey!==context.publicId)throw Error('公共仓库作用域已切换');
   const beforeInventory=(await inventories.read(true)).data;
   let operation=m.operation;
   if(operation.action==='restore'||operation.historyGrant)throw Error('无效背包操作');
   if(operation.action==='history'){const record=stockHistory.get(operation.reference);if(!record)throw Error('此操作的撤销记录已过期');operation={operationId:operation.operationId,action:'restore',historyGrant:true,changes:record.changes,lockChanges:record.lockChanges};}
   const result=await inventories.command(operation,context.authority);m._committed={kind:'inventory',historyId:operation.operationId};
   if(!result.duplicate&&result.touched.length){const changes=result.touched.map(id=>{const before=beforeInventory.containers[id]?.items||[],after=result.ledger.containers[id].items;const changed=new Set([...before,...after].map(row=>row.id).filter(id=>JSON.stringify(before.find(r=>r.id===id))!==JSON.stringify(after.find(r=>r.id===id))));return {id,before:before.filter(row=>changed.has(row.id)),after:after.filter(row=>changed.has(row.id))};});const lockChanges=result.touched.filter(id=>!!beforeInventory.containers[id]?.locked!==!!result.ledger.containers[id].locked).map(id=>({id,before:!!beforeInventory.containers[id]?.locked,after:!!result.ledger.containers[id].locked}));stockHistory.set(operation.operationId,{changes,lockChanges});if(stockHistory.size>160)stockHistory.delete(stockHistory.keys().next().value!);}

   // The atomic ledger commit is the confirmation. Token/card mirrors are
   // retryable projections and must not hold this user operation hostage.
   scheduleInventoryRepair();
   void OBR.broadcast.sendMessage('com.obr-suite/workbench/inventory-changed',{},{destination:'ALL'}).catch(error=>console.warn('[workbench] inventory invalidation pending',error));
   if(!result.duplicate&&!(context.gm&&result.ledger.silent)){
    const actor=(await observation.read()).player.name;
    for(const id of result.touched){const container=result.ledger.containers[id],old=beforeInventory.containers[id]?.items||[],catalogNow=await catalog(),owner=container.kind==='card'?catalogNow.cards.find(c=>`card:${c.id}`===id):undefined,token=container.kind==='monster'?catalogNow.items.find(i=>`monster:${i.id}`===id):undefined;
     const privateFor=owner?.locked?owner.owner_ids||[]:token?.metadata['com.obr-suite/workbench/locked']?[token.createdUserId]:undefined;
     const identities=new Map<string,{row:any;before:number;after:number}>();
     for(const [list,isAfter] of [[old,false],[container.items,true]] as const)for(const row of list){const key=row.kind==='resource'?row.id:row.coin||JSON.stringify({kind:row.kind,entry:row.entry,name:row.name});const total=identities.get(key)||{row,before:0,after:0};total[isAfter?'after':'before']+=row.quantity;if(isAfter)total.row=row;identities.set(key,total);}
     for(const {row,before,after} of identities.values()){if(before===after)continue;const delta=after-before,resource=row.kind==='resource'?{...row,current:after,max:row.max,type:row.type||'count',icon:'gem'}:{id:row.id,name:row.name,current:after,max:Math.max(1,before,after),type:'number',icon:'gem'};
      const source=result.ledger.containers[operation.from],target=result.ledger.containers[operation.to];const message=source&&target?(source.kind==='public'?`${target.name}拿走了${row.name}`:`${actor}给予了${row.name}给${target.name}`):`${container.name}${delta>0?'获得':'消耗'}了${row.name}`;
      // One public message per transfer; the source delta is the same operation.
      if(operation.action==='transfer'&&id===operation.from)continue;
      await publishWorkbenchNotice({noticeId:crypto.randomUUID(),privateFor,privateSummary:`${actor}${delta>0?'恢复':'消耗'}了什么`,tokenId:id,tokenName:message,resource,delta,prevValue:before});
     }
    }
   }
   return {historyId:operation.operationId,inventory:await inventories.view(context.definitions,context.gm,context.publicId),sequence:++sequence};
  }
  if(m.type==='createCard'){
   if(!getState().enabled.characterCards)throw Error('角色卡模块已关闭');
   if(m.data?.schema_version!=='0.3'||m.data?.dnd_card_web?.schemaVersion!==1||typeof m.data.identity?.character_name!=='string'||JSON.stringify(m.data).length>3_000_000)throw Error('角色格式无效');
   const record=await relay.send({createCard:{room:(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_'),uploader:playerId,data:m.data}});
   if(typeof record.id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(record.id))throw Error('创建返回的角色身份无效');
   const entry={id:record.id,name:m.data.identity.character_name,owner_ids:[playerId],visibility:'public',locked:false};
   const room=await OBR.room.getMetadata();await OBR.room.setMetadata({[DIRECTORY]:[...(Array.isArray(room[DIRECTORY])?room[DIRECTORY] as any[]:[]).filter(c=>c.id!==entry.id),entry]});
   if(await OBR.scene.isReady()){const scene=await OBR.scene.getMetadata();await OBR.scene.setMetadata({[LIST]:[...(Array.isArray(scene[LIST])?scene[LIST] as any[]:[]).filter(c=>c.id!==entry.id),entry]});}
   documents.set(`${OBR.room.id}:card:${record.id}`,m.data);chosen=`card:${record.id}`;
   await OBR.broadcast.sendMessage('com.obr-suite/cc-card-updated',{cardId:record.id},{destination:'ALL'});return {created:entry};
  }
  if(m.type==='rules')return {shared:await shared.write(m),sequence:++sequence};
  if(m.type==='diceRpc'){let target;if(m.itemId&&(['init','player.getSelection','scene.items.getItems'].includes(m.method)||m.method==='broadcast.sendMessage'&&m.args?.[0]==='com.obr-suite/dice-quick-roll'))target=await access(typeof m.key==='string'&&m.key.startsWith(`${OBR.room.id}:card:`)?`card:${m.key.slice(`${OBR.room.id}:card:`.length)}`:m.itemId);return diceRpc(String(m.method),Array.isArray(m.args)?m.args:[],target,access);}
  if(m.type==='console'){
   const role=(await observation.read()).role,enabled=getState().enabled as any,key=String(m.action);
   if(role!=='GM')throw Error('仅 DM 可使用控制台');if(!['settings','announcement','portalEffects'].includes(key)&&!enabled[key])throw Error('该模块已关闭');
   if(key==='portalEffects'){if(!enabled.portals)throw Error('该模块已关闭');await setState({portalEffects:!!m.value});return {consolePatch:{portalEffects:!!m.value},sequence:++sequence};}
   if(key==='transitions'){
    if(!['short','long','text'].includes(m.kind)||m.kind==='text'&&!String(m.text||'').trim())throw Error('请选择转场内容');
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(Error('转场未响应'));},6000);const off=OBR.broadcast.onMessage(BC_TRANSITIONS_STATUS,event=>{const data=event.data as any;if(data?.requestId!==m.requestId)return;clearTimeout(timer);off();data.ok?resolve(data):reject(Error('转场未能启动'));});void OBR.broadcast.sendMessage(BC_TRANSITIONS_RUN,{kind:m.kind,text:String(m.text||'').slice(0,120),targets:'all',preview:!!m.preview,requestId:m.requestId,issuedAt:Date.now()},{destination:'LOCAL'}).catch(e=>{clearTimeout(timer);off();reject(e);});});
   }
   const channels:Record<string,string>={timeStop:'com.obr-suite/timestop-toggle',focus:'com.obr-suite/focus-trigger',musicBoard:'com.obr-suite/music-board:toggle',transitions:'com.obr-suite/transitions/open'};
   if(channels[key])await OBR.broadcast.sendMessage(channels[key],{source:'workbench'},{destination:'LOCAL'});
   else if(key==='announcement')await OBR.modal.open({id:'com.obr-suite/dm-announcement',url:assetUrl('dm-announcement.html'),width:560,height:580});
   else if(key==='settings'){const [width,height]=await Promise.all([OBR.viewport.getWidth(),OBR.viewport.getHeight()]);await OBR.popover.open({id:'com.obr-suite/settings',url:assetUrl('settings.html'),width:640,height:580,anchorReference:'POSITION',anchorPosition:{left:width/2,top:height/2},anchorOrigin:{horizontal:'CENTER',vertical:'CENTER'},transformOrigin:{horizontal:'CENTER',vertical:'CENTER'},hidePaper:true});}
   else throw Error('未知操作');return;
  }
  if(m.type==='roll'){
   if(!getState().enabled.dice)throw Error('投骰模块未开启');let id:string|null=null;if(m.itemId){const a=await access(m.itemId);if(a.key!==m.key)throw Error('角色关联已改变');id=a.item?.id||null;}
   await executeRoll({expression:m.expression,label:m.label,itemId:id,advMode:m.advMode,critMode:!!m.critMode,hidden:!!m.hidden});return;
  }
  const a=await access(typeof m.key==='string'&&m.key.startsWith(`${OBR.room.id}:card:`)?`card:${m.key.slice(`${OBR.room.id}:card:`.length)}`:m.itemId);if((m.key?a.key!==m.key:!['delete','resource','stats','statsLock','lock'].includes(m.type))||!a.write)throw Error('角色关联或修改权限已改变');
  if(m.type==='monsterSave'){
   if(a.cardId||!a.item)throw Error('当前不是怪物卡');
   const data=m.data;if(!data||typeof data.name!=='string'||!data.name.trim()||JSON.stringify(data).length>500_000)throw Error('怪物资料无效');
   const previous=await read(a);if(JSON.stringify(previous)!==JSON.stringify(m.expected))throw Error('怪物资料已经更新，请重新打开编辑');
   const index=a.item.metadata[MONSTER] as {key:string;revision:number}|undefined;
   const key=index?.key||`monster_${(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_')}_${a.item.id.replace(/[^a-zA-Z0-9_-]/g,'_')}`;
   const latest=await relay.send({sharedDocument:{key,operation:'read'}});if(index&&latest.revision!==index.revision&&JSON.stringify(latest.data)!==JSON.stringify(m.expected))throw Error('怪物资料已经更新，请重新打开编辑');
   const saved=await relay.send({sharedDocument:{key,operation:'write',expected:latest.revision,data}});
   monsterOverrides.set(key,saved);documents.set(a.key,data);
   const verify=await access(a.item.id);if(!verify.write||verify.key!==a.key)throw Error('怪物关联或权限已改变');
   await OBR.scene.items.updateItems([a.item.id],items=>{for(const item of items){item.metadata[MONSTER]={key,revision:saved.revision};item.name=data.name;}});
   const stats:Record<string,number>={};if(data.hp?.average!==previous?.hp?.average&&Number.isFinite(data.hp?.average)){stats['max health']=Math.max(0,data.hp.average);stats.health=Math.min(bubble(a.item).health??data.hp.average,data.hp.average);}const ac=(raw:any)=>typeof raw?.ac?.[0]==='number'?raw.ac[0]:raw?.ac?.[0]?.ac;if(ac(data)!==ac(previous)&&Number.isFinite(ac(data)))stats['armor class']=ac(data);if(Object.keys(stats).length)await setTokens(a,{stats});
   return {snapshot:await snapshot(a.item.id)};
  }
  if(m.type==='assignName'){
   const name=String(m.name||'').trim().slice(0,160);if(!name)throw Error('名称不能为空');
   const targets=a.cardId?a.items.filter(i=>i.metadata[BIND]===a.cardId):a.item?[a.item]:[];
   await OBR.scene.items.updateItems(targets.filter(i=>i.type==='IMAGE').map(i=>i.id),drafts=>{for(const item of drafts){const image=item as any;image.text={...image.text,type:image.text?.type||'PLAIN',plainText:String(image.text?.plainText||'').trim()===name?'':name};}});return;
  }
  if(m.type==='delete'){
   if(!a.cardId)throw Error('没有角色卡');const location=documentLocation(a.cardId);await relay.send({deleteCard:{room:location.room,card:location.card}});
   const room=await OBR.room.getMetadata(),deleted=Array.isArray(room[DELETED])?room[DELETED] as string[]:[];
   await OBR.room.setMetadata({[DELETED]:[...new Set([...deleted,a.cardId])],[DIRECTORY]:(room[DIRECTORY] as any[]||[]).filter(c=>c.id!==a.cardId),[ROOM_LIST]:(room[ROOM_LIST] as any[]||[]).filter(c=>c.id!==a.cardId)});
   if(Array.isArray(a.scene[LIST]))await OBR.scene.setMetadata({[LIST]:(a.scene[LIST] as any[]).filter(c=>c.id!==a.cardId)});
   const ids=a.items.filter(i=>i.metadata[BIND]===a.cardId).map(i=>i.id);if(ids.length)await OBR.scene.items.updateItems(ids,rows=>{for(const row of rows)delete row.metadata[BIND];});
   documents.delete(a.key);if(chosen===`card:${a.cardId}`)chosen='';await OBR.broadcast.sendMessage('com.obr-suite/cc-card-updated',{cardId:a.cardId,deleted:true},{destination:'ALL'});return;
  }
  if(m.type==='resource'){
   if(!getState().enabled.resourceTracker)throw Error('资源模块已关闭');
   const existing=a.cardId?await read(a):{},doc=structuredClone(existing),native=doc.dnd_card_web;
   const resources=(!a.cardId&&Array.isArray(a.item?.metadata[RES])?resourceSnapshot(native?.runtime?.resources||doc.web_resources||{},a.item!.metadata[RES] as any[]):structuredClone(native?.runtime?.resources||doc.web_resources||{})),id=String(m.resourceId),beforeResources=structuredClone(resources);
   if(!id||['__proto__','constructor','prototype'].includes(id))throw Error('无效资源');
   if(!sameValue(resources[id]?{...resources[id],id}:null,m.expected??null))throw Error('该资源已改变，请重试');
   if(a.role!=='GM'&&(resources[id]?.locked||!!m.resource?.locked!==!!resources[id]?.locked))throw Error('此资源已上锁，仅 DM 可以修改');
   if(m.resource===null){if(resources[id]?.automatic)throw Error('自动资源不可删除');delete resources[id];}
   else{const r=m.resource;if(!r||!Number.isInteger(r.current)||!Number.isInteger(r.max)||r.current<0||r.max<0||!r.unlimited&&r.current>r.max||r.max>99999||r.current>999999999||r.unlimited&&r.type!=='number'||!['bar','count','number'].includes(r.type||'count'))throw Error('无效资源数值');resources[id]={...resources[id],...r,id,name:String(r.name||id).slice(0,120)};}
   doc.web_resources=resources;if(native){native.runtime.resources=resources;for(const [key,r] of Object.entries(resources) as [string,any][]){if(key.startsWith('spell-slot:')&&native.spellSettings)native.spellSettings.slots[key.split(':')[1]]={max:r.max,used:r.max-r.current};}native.revision++;}
   for(const [key,r] of Object.entries(resources) as [string,any][]){if(key.startsWith('spell-slot:')&&doc.spellcasting?.spell_slots)doc.spellcasting.spell_slots[key.split(':')[1]]={max:r.max,used:r.max-r.current,current:r.current};}
   if(doc.core_stats?.hit_dice)doc.core_stats.hit_dice.current=Object.entries(resources).filter(([id])=>id.startsWith('hit-die:')).reduce((n,[,r]:any)=>n+r.current,0);
   if(a.cardId){await persistDocument(a,existing,doc);m._committed={kind:'document',id:`card:${a.cardId}`};await resourceNotices(a,beforeResources,resources);}m._phase='sync-token';await setTokens(a,{resources:Object.entries(resources).map(([id,r]:[string,any])=>({...r,id}))});if(!a.cardId)await resourceNotices(a,beforeResources,resources);return {snapshot:await snapshot(a.cardId?`card:${a.cardId}`:a.item!.id)};
  }
  if(m.type==='lock'){
   if(!a.cardId){if(!a.item)throw Error('没有怪物卡');await OBR.scene.items.updateItems([a.item.id],rows=>{for(const row of rows)row.metadata['com.obr-suite/workbench/locked']=!!m.locked;});return {snapshot:await snapshot(a.item.id)};}const locked=!!m.locked,update=(list:any[])=>list.map(c=>c.id===a.cardId?{...c,locked,visibility:locked?'owners':'public'}:c);
   if(Array.isArray(a.scene[LIST]))await OBR.scene.setMetadata({[LIST]:update(a.scene[LIST] as any[])});
   if(Array.isArray(a.room[DIRECTORY]))await OBR.room.setMetadata({[DIRECTORY]:update(a.room[DIRECTORY] as any[])});
   if(Array.isArray(a.room[ROOM_LIST]))await OBR.room.setMetadata({[ROOM_LIST]:update(a.room[ROOM_LIST] as any[])});return {snapshot:await snapshot(`card:${a.cardId}`)};
  }
  if(m.type==='statsLock'){if(a.role!=='GM')throw Error('仅 DM 可锁定生命条');await setTokens(a,{stats:{locked:!!m.locked}});return;}
  if(m.type==='stats'){
   const patch={...m.patch},current=a.card?.stats||bubble(a.item);if(!Object.keys(patch).length||Object.keys(patch).some(k=>!fields.includes(k)))throw Error('无效数值');
   for(const k of Object.keys(patch)){const value=typeof patch[k]==='string'?parseStatInput(patch[k],current[k]||0):patch[k];if(!Number.isInteger(value)||Math.abs(value)>99999)throw Error('无效数值');patch[k]=clampStat(k as any,value);}
   if(Object.keys(patch).some(k=>current[k]!==m.expected?.[k]))throw Error('场景数值已改变，请重试');
   const max=patch['max health']??current['max health'];if(typeof max==='number'&&('health' in patch||'max health' in patch))patch.health=Math.min(patch.health??current.health??0,max);
   if(a.cardId){const existing=await read(a),runtime=documentRuntime(existing,definitionsFor(a.scene)),doc=writeRuntime(existing,{...runtime,stats:{...runtime.stats,...patch}},definitionsFor(a.scene));m._phase='save-document';await persistDocument(a,existing,doc);m._committed={kind:'document',id:`card:${a.cardId}`};}
   if(a.cardId)await statNotices(a,current,{...current,...patch});await setTokens(a,{stats:patch});if(!a.cardId)await statNotices(a,current,{...current,...patch});return {snapshot:await snapshot(a.cardId?`card:${a.cardId}`:m.itemId)};
  }
  let deltaDocument:any;if(m.delta){const doc=deltaDocument=await read(a);if(!doc?.dnd_card_web)throw Error('角色增量需要原始资料');m.previous=expandChanges(doc.dnd_card_web,m.delta.native,'before');m.native=expandChanges(doc.dnd_card_web,m.delta.native,'after');m.previousData=expandChanges(doc,m.delta.legacy,'before');m.data=expandChanges(doc,m.delta.legacy,'after');m.observed={...expandChanges(doc,m.delta.legacy,'observed'),dnd_card_web:expandChanges(doc.dnd_card_web,m.delta.native,'observed')};}
  if(!a.cardId||!m.native||m.native.schemaVersion!==1||!m.data||m.data.schema_version!=='0.3'||JSON.stringify(m.native).length>3_000_000)throw Error('角色资料无效');
  const existing=deltaDocument||await read(a),base=structuredClone(existing.dnd_card_web||m.previous||m.native),legacy=structuredClone(existing),currentStats=documentRuntime(existing,definitionsFor(a.scene)).stats;
  if(m.statPatch&&Object.keys(m.statPatch).some(key=>currentStats[key]!==m.expected?.[key]))throw Error('场景数值已改变，请确认后重试');
  base.locked=a.card?.locked;
  m._phase='merge-native';
  const native=m.previous?applyProjectionPatch(base,m.previous,m.native,m.observed?.dnd_card_web||m.previous,'native'):m.native;
  if(a.role!=='GM')for(const [id,r] of Object.entries(base.runtime?.resources||{}) as [string,any][]){const next=native.runtime?.resources?.[id];if(r.locked&&!sameValue(r,next)||!!r.locked!==!!next?.locked)throw Error('此资源已上锁，仅 DM 可以修改');}
  const verify=await access(a.cardId?`card:${a.cardId}`:m.itemId);if(!verify.write||verify.key!==a.key)throw Error('角色关联或权限已改变');
  m._phase='merge-owlbear';
  const merged={...(m.previousData?m.observed?applyProjectionPatch(legacy,m.previousData,m.data,m.observed,'owlbear'):applyPatch(legacy,m.previousData,m.data):{...existing,...m.data}),defenses:existing.defenses,combat:existing.combat,dnd_card_web:native};
  // Persist canonical runtime once, then project it through the existing scene renderers.
  const conditionsChanged=!m.previous||JSON.stringify(m.previous.selections.filter((s:any)=>s.entry?.kind==='condition'))!==JSON.stringify(m.native.selections.filter((s:any)=>s.entry?.kind==='condition'));
  const resourcesChanged=!m.previous||JSON.stringify(m.previous.runtime.resources)!==JSON.stringify(m.native.runtime.resources);
  const selections=native.selections.filter((s:any)=>s.entry?.kind==='condition');
  const custom=Array.isArray(a.scene[SHARED_BUFFS])?a.scene[SHARED_BUFFS] as any[]:[],defs=[...DEFAULT_BUFFS,...custom].filter(d=>d&&typeof d.id==='string'&&typeof d.name==='string');
  const identify=(entry:any)=>conditionIdentity(entry,defs);
  const additions:any[]=[];const conditions=selections.map((s:any)=>{const id=identify(s.entry),found=defs.find(d=>d.id===id);if(found){if(!custom.some(d=>d.id===id))additions.push(found);}else additions.push({id,name:s.entry.name,color:'#777777'});return id;});
  if(conditionsChanged&&additions.length)await OBR.scene.setMetadata({[SHARED_BUFFS]:[...custom.filter(d=>!additions.some(v=>v.id===d.id)),...additions]});
  const resources=Object.entries(native.runtime.resources||{}).filter(([,r])=>r&&typeof r==='object').map(([id,value]:[string,any])=>({id,name:value.name||id,type:value.type||'count',icon:value.icon||'circle',...value}));
  merged.web_resources=structuredClone(native.runtime.resources);
  m._phase='sync-inventory';
  if(nativeInventoryChanged(m.previous||base,native,identify))await inventories.ensure([{id:`card:${a.cardId}`,name:a.card!.name,kind:'card',write:a.write,document:existing}]);
  const inventorySync=await inventories.syncNative(`card:${a.cardId}`,m.previous||base,native,identify);m._inventoryCommitted=inventorySync.ledgerCommitted===true;
  m._phase='save-document';await persistDocument(a,existing,merged,inventorySync.ledgerRevision===undefined?undefined:{key:inventories.key,revision:inventorySync.ledgerRevision});m._committed={kind:'document',id:`card:${a.cardId}`};
  if(resourcesChanged)await resourceNotices(a,base.runtime?.resources||{},native.runtime.resources||{});
  await resourceNotices(a,nativeStockNotices(base),nativeStockNotices(native));
  await spellPreparationNotices(a,base,native);
  await statNotices(a,currentStats,documentRuntime(merged,definitionsFor(a.scene)).stats);
  await conditionNotices(a,base,native);
  if(native.name!==a.card?.name){const rename=(list:any[])=>list.map(c=>c.id===a.cardId?{...c,name:native.name}:c);if(Array.isArray(a.scene[LIST]))await OBR.scene.setMetadata({[LIST]:rename(a.scene[LIST] as any[])});const room=await OBR.room.getMetadata();if(Array.isArray(room[DIRECTORY]))await OBR.room.setMetadata({[DIRECTORY]:rename(room[DIRECTORY] as any[])});}
  m._phase='sync-token';await setTokens(a,{stats:m.statPatch,conditions:conditionsChanged?conditions:undefined,resources:resourcesChanged?resources:undefined});
  if(inventorySync.container&&inventorySync.projection&&inventoryReflected(native,inventorySync.container,inventorySync.projection,identify))void inventories.projected(`card:${a.cardId}`,inventorySync.projection.revision).catch(error=>console.warn('[workbench] inventory receipt pending',error));
  if(conditionsChanged)void OBR.broadcast.sendMessage('com.obr-suite/status/catalog-changed',{},{destination:'ALL'}).catch(error=>console.warn('[workbench] status invalidation pending',error));
  return {snapshot:await snapshot(`card:${a.cardId}`)};
 }
 async function receive(m:any,viaRelay=false){if(m.protocol!==protocol||m.session!==session)return;const route=viaRelay?'relay':'direct';
  if(m.type==='hello'){last='';lastCatalog='';send('ready',{rolls},route);if(viaRelay&&child&&!child.closed)send('ready',{rolls},'direct');if(!viaRelay)void OBR.action.close().catch(()=>{});void refreshSelection();void refresh();void hydrate();return;}
  if(m.type==='ping'){send('pong',{at:Date.now()},route);return;}
  if(m.type==='requestStatus'){const answer=seen.get(m.requestId);if(answer)send('ack',{requestId:m.requestId,...answer},route);else send('requestPending',{requestId:m.requestId,active:activeRequests.has(m.requestId),known:requestRuns.has(m.requestId)},route);return;}
  if(m.type==='cancel'){if(!activeRequests.has(m.requestId)&&!seen.has(m.requestId))cancelledRequests.add(m.requestId);return;}
  if(m.type==='pin'){follow=!m.pinned;if(follow)lastSelection='';void refreshSelection();return;}
  if(m.type==='select'){const generation=++selectionGeneration;try{const a=await access(m.itemId);if(generation!==selectionGeneration)return;chosen=a.cardId?`card:${a.cardId}`:m.itemId;lastSelection=JSON.stringify((await observation.read()).selection);last='';void refreshSelection();}catch(e){send('error',{message:String(e)});}return;}
  if(!['stats','statsLock','save','roll','lock','console','diceRpc','delete','resource','rules','assignName','createCard','panelRpc','monsterSave','inventory','condition'].includes(m.type)||typeof m.requestId!=='string'||m.requestId.length>100)return;
  if(requestRuns.has(m.requestId))return;
  delete m._committed;delete m._inventoryCommitted;
  const receivedAt=performance.now();
  const run=async()=>{let answer=seen.get(m.requestId);if(!answer){const began=performance.now(),steps:{phase:string;ms:number}[]=[];let phase='authorize',phaseStart=began;
   Object.defineProperty(m,'_phase',{configurable:true,get:()=>phase,set:(next:string)=>{const now=performance.now();steps.push({phase,ms:Math.round((now-phaseStart)*10)/10});phase=next;phaseStart=now;}});
   const writes=!['diceRpc','roll','panelRpc'].includes(m.type);if(writes){mutation++;epoch++;}try{
   if(cancelledRequests.delete(m.requestId)||typeof m.expiresAt==='number'&&Date.now()>m.expiresAt)throw Error('操作在执行前已取消或过期；未修改数据');
   activeRequests.add(m.requestId);send('requestPending',{requestId:m.requestId,active:true},route);m._phase='authorize';answer={ok:true,result:await command(m)};
  }catch(error){const e=error as any;answer={ok:false,uncertain:!!e?.uncertain,message:e?.message||String(error),diagnostic:{version:devManifest.version,at:new Date().toISOString(),requestId:m.requestId,requestType:m.type,phase:m._phase,httpStatus:e?.status,...e?.diagnostic,stack:typeof e?.stack==='string'?e.stack.split('\n').slice(0,6).join('\n'):undefined}};
   if(m._committed){
    // A committed document/ledger cannot become a failed mutation merely because
    // a renderer, notification, or refresh timed out. Retry projections only.
    const diagnostic={...answer.diagnostic,code:'COMMITTED_PROJECTION_PENDING',committed:true};
    const result:any={warning:'资料已保存；场景显示或播报暂未完成。此次修改不会重复执行。',diagnostic};
    try{if(m._committed.kind==='document')result.snapshot=await snapshot(m._committed.id);else{const context=await inventoryContext();result.historyId=m._committed.historyId;result.inventory=await inventories.view(context.definitions,context.gm,context.publicId);result.sequence=++sequence;}}catch{}
    answer={ok:true,result};void hydrate();scheduleInventoryRepair();
   }else if(m._inventoryCommitted){answer.uncertain=true;answer.diagnostic={...answer.diagnostic,code:'PARTIAL_INVENTORY_COMMIT',inventoryCommitted:true};}
  }finally{activeRequests.delete(m.requestId);if(writes){mutation--;epoch++;}}steps.push({phase,ms:Math.round((performance.now()-phaseStart)*10)/10});answer.timing={transport:route,version:devManifest.version,queueMs:Math.round(began-receivedAt),hostMs:Math.round(performance.now()-began),steps};seen.set(m.requestId,answer);if(seen.size>256)seen.delete(seen.keys().next().value!);}send('ack',{requestId:m.requestId,...answer},route);if(!['diceRpc','roll','panelRpc'].includes(m.type)){void refreshSelection();void refresh();}};
  const task=['diceRpc','roll','panelRpc','console'].includes(m.type)||m.type==='inventory'&&['silent','containerLock'].includes(m.operation?.action)?run():(queue=queue.then(run).catch(()=>{}));requestRuns.set(m.requestId,task);void task.finally(()=>{requestRuns.delete(m.requestId);});
 }
 window.addEventListener('message',e=>{if(e.origin!==origin||e.data?.protocol!==protocol||!e.source)return;
  if(e.data.type==='discover'){try{const source=e.source as Window;if(source!==window&&source.parent===parent)source.postMessage({protocol,type:'background',nonce:e.data.nonce,session,clientKey:credentials.clientKey},origin);}catch{}return;}
  if(e.data.session!==session)return;
  // Reloading the host keeps the browser's WindowProxy alive. The existing
  // workbench still knows it, so its next ping restores the direct bridge
  // without waiting for a stale-window timeout or relying on the old plugin.
  if(e.data.type==='ping'&&(!child||child.closed)){child=e.source as Window;last='';lastCatalog='';void refreshSelection();void refresh();void hydrate();}
  if(e.data.type==='hello'){if(child&&!child.closed&&child!==e.source)return;child=e.source as Window;}if(e.source===child)void receive(e.data);
 });
 for(const name of DICE_EVENTS)OBR.broadcast.onMessage(name,event=>send('diceEvent',{event:name,data:event}));
 OBR.player.onChange(player=>send('diceEvent',{event:'player',data:player}));
 let changeScheduled=false;
 const changed=()=>{if(changeScheduled)return;changeScheduled=true;queueMicrotask(()=>{changeScheduled=false;void refreshSelection();void refresh();void hydrate();});};
 observation.onChange(changed);OBR.scene.onReadyChange(()=>{chosen='';selectionGeneration++;lastSelection='';previousSceneCards=[];invalidateCards();changed();});
 OBR.broadcast.onMessage('com.obr-suite/cc-card-updated',event=>{const data=event.data as any,id=data?.cardId;if(id){if(!invalidateCard(id,data?.revision))return;void hydrate(id);}else{invalidateCards();void hydrate();}changed();});OBR.broadcast.onMessage('com.obr-suite/workbench/inventory-changed',event=>{if(event.connectionId!==playerConnection)inventories.invalidate();changed();});onStateChange(changed);rollListeners.add(()=>send('rolls',{rolls}));
 const connection=await OBR.player.getConnectionId();OBR.broadcast.onMessage('com.obr-suite/workbench-compose',event=>{if(event.connectionId===connection&&typeof(event.data as any)?.expression==='string')send('compose',{compose:{...(event.data as object),id:crypto.randomUUID()}});});
 setInterval(()=>send('pong',{at:Date.now()}),10000);
 setInterval(()=>{changed();scheduleInventoryRepair();},4000);
}
