import {locateSceneItem} from './locate';
import {QQ_CARDS,qqSession,qqRequest} from '../modules/characterCards/qq-account';
import {uploadRoomCard,cloudRevisionOffset,roomCloudDocument} from './cloud-upload';
import {workbenchStartup} from './startup-presentation';
import {nativeCardOwners,ownsNativeToken,canReadNativeCard} from "../modules/characterCards/native-owner";
import {resourceWidgetPresentation,updateResourceWidgetPresentation,quickbarAttackPresentation,hiddenResourcePresentation} from './resource-presentation';
import {createGroupRolls} from './group-rolls';
import {classSummary} from './class-summary';
import {withRequestTimeout} from '../request-timeout';
import {sharedEntry,OPEN_WIKI_CHANNEL} from './shared-entry';
import {RUNTIME_BASELINE,DOCUMENT_REVISION,documentRevision,documentRuntime,tokenRuntime,mergeTokenRuntime,writeRuntime,mergeMonsterMetadata,runtimeProjectionRights,stampRuntimeProjectionAuthority,assertCharacterArmorPatch,type RuntimeBaseline} from './runtime-authority';
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
import {getRollHistory,canForwardDiceHistory,rollListeners,executeRoll,setupWorkbenchDice} from './dice';
import {BUBBLES_META_KEY as HP,EXTERNAL_BUBBLES_META_KEY as LEGACY} from '../utils/statEdit';
import {getState,onStateChange,setState} from '../state';
import {sharedDocuments} from './shared';
import {clampStat,parseStatInput} from '../utils/statEdit';
import {BC_TRANSITIONS_RUN,BC_TRANSITIONS_STATUS} from '../modules/transitions/protocol';
import {TIME_STOP_META,readTimeStop} from '../modules/timeStopProtocol';
import {assetUrl} from '../asset-base';
import {ANNOUNCEMENT_MODAL_ID} from '../announcement-source';
import {hasReadPlayerPermissions,PLAYER_PERMISSION_MODAL_ID} from '../player-permission-notice';
import {DEFAULT_BUFFS,STATUS_BUFFS_KEY} from '../modules/statusTracker/types';
const BIND='com.character-cards/boundCardId',SLUG='com.bestiary/slug',LIST='com.character-cards/list',ROOM_LIST='com.character-cards/list-room',RES='com.obr-suite/resources/data',SHARED_BUFFS='com.obr-suite/workbench/status-catalog',DIRECTORY='com.obr-suite/workbench/cards';
const MONSTER='com.obr-suite/workbench/monster';
const monsterOverrides=new Map<string,{revision:number;data:any}>();
const DELETED='com.obr-suite/workbench/deleted-cards';
const fields=['health','max health','temporary health','armor class'];
export function setupWorkbench(){if(WORKBENCH_DEV){setupWorkbenchNotices();void setupWorkbenchDice().catch(error=>{console.error('[workbench] dice startup failed',error);void OBR.notification.show(String(error),'ERROR');});return start();}return Promise.resolve();}
async function start(){
 const observation=workbenchObservation();
 const [playerId,playerConnection]=await Promise.all([OBR.player.getId(),OBR.player.getConnectionId()]),origin=location.origin,storageKey=`workbench:v2:${OBR.room.id}:${playerId}`;
 let credentials:{hostKey:string;clientKey:string};try{credentials=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{credentials=null as any;}
 if(!credentials?.hostKey||!credentials?.clientKey){credentials={hostKey:crypto.randomUUID()+crypto.randomUUID(),clientKey:crypto.randomUUID()+crypto.randomUUID()};localStorage.setItem(storageKey,JSON.stringify(credentials));}
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credentials.hostKey));const session=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
 let child:Window|null=null,relayActive=false,relayPeerSeen=0,directPeerSeen=0,directClientInstance='',chosen='',lastSelection='',last='',refreshing=false,again=false,follow=true,lastCatalog='';
 let previousSceneCards:string[]=[];let directoryWrite=false;
 let mutation=0,epoch=0,sequence=0,documentCacheVersion=0,clientSelection=0;let clientInstance='',warmClientInstance='';let followRevision=0,mapFollowing=false,mapReturn='';const selectionIntents=new Map<string,number>();
 let accessEpoch=0,accessSignature='',lastAccessEpoch=0,lastDirectory='';
 const accessHistory=new Map<number,any>();
 const warmInFlight=new Set<string>(),warmAgain=new Set<string>();
 const warmCards=new Set<string>(),warmSnapshots=new Map<string,{document:any;state:string;epoch:number}>();
 let catalogCache: {signature:string;value:any}|undefined,lastDocument:any;
 const cloudPermissions=new Map<string,{scope:string;own:boolean;write:boolean;locked:boolean;name?:string}>();let cloudPermissionVersion=0;
 function cloudPermissionScope(card:any){return JSON.stringify([qqSession()?.token||'',card.qqRoom?.capability,card.locked,card.qqEditors||[]]);}
 function rememberCloudPermission(card:any,info:any,scope:string){if(scope!==cloudPermissionScope(card))return;const next={scope,own:info.owner===true,write:info.write===true,locked:info.locked!==false,name:typeof info.name==='string'?info.name:undefined};if(!sameValue(cloudPermissions.get(card.id),next)){cloudPermissions.set(card.id,next);cloudPermissionVersion++;while(cloudPermissions.size>128)cloudPermissions.delete(cloudPermissions.keys().next().value!);}}
 const stockHistory=new Map<string,{changes:{id:string;before:any[];after:any[]}[];lockChanges?:{id:string;before:boolean;after:boolean}[]}>();
 let queue=Promise.resolve(),groupQueue=Promise.resolve();const seen=new Map<string,any>(),documents=new Map<string,any>(),documentTimes=new Map<string,number>();
 function cacheDocument(key:string,value:any){if(documents.get(key)!==value)documentCacheVersion++;documents.set(key,value);return documents;}
 const cardReads=new Map<string,Promise<any>>(),cardEtags=new Map<string,string>(),cardLocations=new Map<string,CardLocation|Error>();
 const monsterSceneDocuments=new Map<string,any>();
 const cardInvalidations=new Map<string,number>();
 const cardReadControllers=new Map<string,AbortController>(),cardNotifiedRevisions=new Map<string,number>();
 const cardReadFailures=new Map<string,{error:Error;retryAt:number}>(),selectionFailures=new Map<string,string>();
 const activeRequests=new Set<string>(),cancelledRequests=new Set<string>(),requestRuns=new Map<string,Promise<void>>();
 const relay=new Relay(new URL('relay',assetUrl('')).href,session,'host',credentials.hostKey,m=>{relayActive=true;relayPeerSeen=Date.now();void receive(m,true);},credentials.clientKey,undefined,(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_'));
 const shared=sharedDocuments(relay);
 const inventories=inventoryDocuments(relay,OBR.room.id||'default',async definitions=>{await observation.refreshAuthority();for(const definition of definitions){if(definition.kind==='public')continue;const current=await access(definition.id);if(definition.write&&!current.write)throw Object.assign(Error('背包权限已改变'),{status:403});}});
 const hostStarted=Date.now();
 // View signatures mean delivered-or-in-flight, not permanently delivered.
 // If a relay view POST fails, release only that publication's deduplication
 // marker. The normal refresh/hello then rebuilds it with current permissions;
 // commands and acknowledgements are never replayed by this recovery lane.
 let viewPublication=0;
 const viewPublications=new Map<string,number>();
 const send=(type:string,extra:Record<string,unknown>={},route?:'relay'|'direct')=>{
  const data={protocol,session,hostStarted,type,...extra};
  const retryable=['selection','access','directory','catalog','cacheSnapshot','selectionError'].includes(type);
  const state=extra.state as {key?:string;itemId?:string}|undefined;
  const publicationKey=type==='cacheSnapshot'?`${type}:${state?.key||''}:${state?.itemId||''}`:type;
  const publication=retryable?++viewPublication:0,viewer=warmClientInstance;
  if(retryable){viewPublications.delete(publicationKey);viewPublications.set(publicationKey,publication);while(viewPublications.size>128)viewPublications.delete(viewPublications.keys().next().value!);}
  const failed=()=>{
   if(!retryable||viewer!==warmClientInstance||viewPublications.get(publicationKey)!==publication)return;
   viewPublications.delete(publicationKey);
   if(type==='selection'){last='';lastDocument=undefined;}
   else if(type==='access')lastAccessEpoch=0;
   else if(type==='directory')lastDirectory='';
   else if(type==='catalog')lastCatalog='';
   else if(type==='selectionError')selectionFailures.delete(String(extra.targetId||''));
   else{const signature=JSON.stringify(extra.state),epoch=(extra.access as {epoch?:number}|undefined)?.epoch;for(const [id,snapshot] of warmSnapshots)if(snapshot.document===extra.document&&snapshot.state===signature&&snapshot.epoch===epoch)warmSnapshots.delete(id);}
  };
  if(route!=='relay'&&child&&!child.closed)try{child.postMessage(data,origin);}catch{failed();}
  if(route==='relay'||route!=='direct'&&(!child||child.closed||directClientInstance!==warmClientInstance||Date.now()-directPeerSeen>15000)&&relayActive&&Date.now()-relayPeerSeen<45000)void relay.send(data).catch(failed);
 };
 OBR.broadcast.onMessage(OPEN_WIKI_CHANNEL,event=>{if(event.connectionId!==playerConnection)return;try{const entry=sharedEntry((event.data as any)?.entry);send('showWiki',{entry,id:crypto.randomUUID()});}catch{}});
 OBR.broadcast.onMessage('com.obr-suite/workbench/open-page',event=>{if(event.connectionId!==playerConnection)return;const page=(event.data as any)?.page;if(['settings','announcement','features','music','textEffects','console'].includes(page))send('navigate',{page});});
 const selectCloudCard=async(id:string,document?:unknown)=>{await observation.refreshAuthority();const a=await access('card:'+id);if(!a.card?.qqRoom)throw Error('云端卡已移出房间');if(document){cacheDocument(`${OBR.room.id}:card:${id}`,document);documentTimes.set(`${OBR.room.id}:card:${id}`,Date.now());}chosen='card:'+id;follow=false;selectionGeneration++;last='';await refreshSelection();send('navigate',{page:'sheet'});};
 const panels=panelBridge(send,relay,selectCloudCard);
 OBR.broadcast.onMessage('com.obr-suite/workbench/open-cloud-card',event=>{if(event.connectionId===playerConnection&&typeof(event.data as any)?.id==='string')void selectCloudCard((event.data as any).id);});
 const bubble=(item:Item|undefined)=>((item?.metadata[HP]??item?.metadata[LEGACY]??{}) as Record<string,any>);
 const documentLocation=(id:string)=>{const value=cardLocations.get(id);if(value instanceof Error)throw value;return value||cardLocation(origin,OBR.room.id||'default',id);};
 const definitionsFor=(scene:Record<string,unknown>)=>[...DEFAULT_BUFFS,...(Array.isArray(scene[SHARED_BUFFS])?scene[SHARED_BUFFS] as any[]:[])];
 async function loadCard(cardId:string,key:string,fresh=false){
  const cached=documents.get(key),qqEntries=(await observation.read()).room[QQ_CARDS];
  const cloud=Array.isArray(qqEntries)?qqEntries.find((row:any)=>row.id===cardId):undefined;
  if(cloud?.qqRoom){
   if(!fresh&&cached&&Date.now()-(documentTimes.get(key)||0)<5000)return cached;
   const flight=cardReads.get(key);if(flight)return flight;
   const scope=cloudPermissionScope(cloud);
   const task=(async()=>{const result=await qqRequest('room-cards/'+cloud.qqRoom.id+(cached?'?since='+(documentRevision(cached)-cloudRevisionOffset(cloud)):''),'GET',undefined,cloud.qqRoom),latest=documents.get(key);rememberCloudPermission(cloud,result,scope);if(result.unchanged&&cached){documentTimes.set(key,Date.now());return cached;}const document=roomCloudDocument(result.document,cloud);if(latest&&documentRevision(latest)>documentRevision(document))return latest;cacheDocument(key,document);documentTimes.set(key,Date.now());return document;})();
   cardReads.set(key,task);try{return await task;}finally{if(cardReads.get(key)===task)cardReads.delete(key);}
  }
  if(!fresh&&cached&&documentTimes.has(key))return cached;
  // Reuse an in-flight read. Ten observers must not fetch ten copies of the portrait.
  const flight=cardReads.get(key);if(flight)return flight;
  // A stable HTTP failure is not dirtiness. Only an explicit retry, location
  // change or card invalidation should refetch a missing/denied document.
  const failed=cardReadFailures.get(key);if(failed&&Date.now()<failed.retryAt)throw failed.error;
  const task=(async()=>{for(;;){const generation=cardInvalidations.get(key)||0,etag=cardEtags.get(key),controller=new AbortController();cardReadControllers.set(key,controller);const timeout=setTimeout(()=>controller.abort(),45000);
  try{const r=await fetch(documentLocation(cardId).url,{headers:etag?{'If-None-Match':etag}:{},cache:'no-store',signal:controller.signal});
  // A remote commit can arrive while this GET still carries an older response.
  // All readers share the next GET; completing the old one must not erase dirtiness.
  if(generation!==(cardInvalidations.get(key)||0)){await r.body?.cancel().catch(()=>{});continue;}
  if(r.status===304&&documents.has(key)){if(documentRevision(documents.get(key))<(cardNotifiedRevisions.get(key)||0)){cardEtags.delete(key);continue;}cardReadFailures.delete(key);documentTimes.set(key,Date.now());return documents.get(key);}if(!r.ok)throw Object.assign(Error(`角色读取失败（${r.status}）`),{status:r.status});const doc=await r.json(),latest=documents.get(key);
  if(generation!==(cardInvalidations.get(key)||0))continue;
  // A GET begun before a write may finish afterwards. Never poison the cache with it.
  if(latest&&documentRevision(latest)>documentRevision(doc)){cardReadFailures.delete(key);return latest;}
  cardReadFailures.delete(key);const nextEtag=r.headers.get('etag');if(nextEtag)cardEtags.set(key,nextEtag);cacheDocument(key,doc);documentTimes.set(key,Date.now());return doc;
  }catch(error){if(generation===(cardInvalidations.get(key)||0)){
   const status=Number.isInteger((error as any)?.status)?(error as any).status:0;
   documentTimes.delete(key);const invalidLocation=(error as any)?.diagnostic?.code==='INVALID_CARD_LOCATION';
   const safe=Object.assign(Error(invalidLocation?'角色资料地址不受支持；请刷新目录后核对':status===404?'角色资料暂不可用（404）；请刷新目录或重新读取后核对':status===403?'角色资料读取被拒绝（403）；请核对当前连接和权限':status?`角色读取失败（${status}）；可重新读取`:'角色读取超时或连接中断；可重新读取'),{status,retryable:true,diagnostic:{code:invalidLocation?'INVALID_CARD_LOCATION':'CARD_READ_FAILED',status,httpStatus:status,operation:'readCard',phase:'read-card',at:new Date().toISOString(),version:devManifest.version,requestId:crypto.randomUUID()}});
   cardReadFailures.set(key,{error:safe,retryAt:[400,403,404,410,422].includes(status)?Infinity:Date.now()+15000});while(cardReadFailures.size>256)cardReadFailures.delete(cardReadFailures.keys().next().value!);throw safe;
  }}finally{clearTimeout(timeout);if(cardReadControllers.get(key)===controller)cardReadControllers.delete(key);}
  }})();cardReads.set(key,task);try{return await task;}finally{if(cardReads.get(key)===task)cardReads.delete(key);}
 }
 function invalidateCard(cardId:string,revision?:number){const key=`${OBR.room.id}:card:${cardId}`;
  if(Number.isSafeInteger(revision)){
   if(documents.has(key)&&documentRevision(documents.get(key))>=revision!||revision!<=(cardNotifiedRevisions.get(key)??-1))return false;
   cardNotifiedRevisions.set(key,revision!);
  }
  cardReadFailures.delete(key);cardInvalidations.set(key,(cardInvalidations.get(key)||0)+1);documentTimes.delete(key);cardEtags.delete(key);cardReadControllers.get(key)?.abort();return true;
 }
 function invalidateCards(){for(const key of new Set([...documents.keys(),...cardReads.keys(),...cardReadFailures.keys()])){cardReadFailures.delete(key);cardInvalidations.set(key,(cardInvalidations.get(key)||0)+1);documentTimes.delete(key);cardEtags.delete(key);cardReadControllers.get(key)?.abort();}}
 async function reconcileRuntime(cardId:string,key:string,items:Item[],scene:Record<string,unknown>,doc:any,write:boolean){
  if(!write||!(await access(`card:${cardId}`)).write)return doc;
  const originalAuthority=observation.authorityVersion('card:'+cardId);
  const requestGuard=async()=>{await observation.refreshAuthority();if(originalAuthority!==observation.authorityVersion('card:'+cardId)||!(await access(`card:${cardId}`)).write)throw Object.assign(Error('角色修改权限已改变'),{status:403});};
  // The catalog may have been produced before another card's slow download.
  // Scene observations must be read now, not replayed from that old catalog.
  ({items,scene}=await observation.read());
  const currentRole=(await observation.read()).role;
  const tokens=items.filter(i=>i.metadata[BIND]===cardId&&(currentRole==='GM'||ownsNativeToken(i,playerId))),defs=definitionsFor(scene);let runtime=documentRuntime(doc,defs);
  for(const token of tokens)runtime=mergeTokenRuntime(runtime,tokenRuntime(token.metadata,documentRuntime(doc,defs)),token.metadata[RUNTIME_BASELINE] as RuntimeBaseline|undefined,cardId,documentRevision(doc));
  if(!sameValue(runtime,documentRuntime(doc,defs))){const next=writeRuntime(doc,runtime,defs);if(write){
   // Clearing a token state also retires the matching inventory grant before any
   // pending repair can reapply it. No ordinary runtime state becomes stock.
   let guard: {key:string;revision:number}|undefined;
   if(!(await access(`card:${cardId}`)).card?.qqRoom&&doc.dnd_card_web&&!sameValue(documentRuntime(doc,defs).conditions,runtime.conditions)){const synced=await inventories.syncNative(`card:${cardId}`,doc.dnd_card_web,next.dnd_card_web,entry=>conditionIdentity(entry,defs),requestGuard);if(synced.ledgerRevision!==undefined)guard={key:inventories.key,revision:synced.ledgerRevision};}
   const liveObservation=await observation.read(),liveTokens=liveObservation.items.filter(i=>i.metadata[BIND]===cardId&&(liveObservation.role==='GM'||ownsNativeToken(i,playerId)));
   const tokenObservation=(rows:Item[])=>rows.map(i=>({id:i.id,runtime:tokenRuntime(i.metadata,documentRuntime(doc,defs)),baseline:i.metadata[RUNTIME_BASELINE]}));
   if(!sameValue(tokenObservation(tokens),tokenObservation(liveTokens)))return doc;
   await persistDocument({key,cardId} as any,doc,next,guard,false,requestGuard);doc=next;
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
  const value=documentRuntime(doc,defs),revision=documentRevision(doc);
  const role=(await observation.read()).role;
  const projection=(item:Item)=>{const rights=runtimeProjectionRights(doc,item),current=tokenRuntime(item.metadata,value),next={stats:rights.stats?value.stats:current.stats,resources:rights.resources?value.resources:current.resources,conditions:rights.conditions?value.conditions:current.conditions};return {rights,next,stamp:{version:1,cardId,revision,value:next} as RuntimeBaseline};};
  const pending=tokens.filter(item=>role==='GM'||ownsNativeToken(item,playerId)).filter(item=>{const {rights,next,stamp}=projection(item);return Object.values(rights).some(Boolean)&&(!sameValue(item.metadata[RUNTIME_BASELINE],stamp)||!sameValue(tokenRuntime(item.metadata,value),next));});if(!pending.length)return;
  await OBR.scene.items.updateItems(pending.map(i=>i.id),drafts=>{for(const item of drafts){const observed=pending.find(i=>i.id===item.id),previous=item.metadata[RUNTIME_BASELINE] as RuntimeBaseline|undefined;
   if(observation.peek().role!=='GM'&&!ownsNativeToken(item,playerId))continue;
   if(item.metadata[BIND]!==cardId||!observed||previous?.cardId===cardId&&previous.revision>revision)continue;
   // A genuine scene edit after the read is handled by the next reconciliation.
   if(!sameValue(tokenRuntime(item.metadata,value),tokenRuntime(observed.metadata,value))||!sameValue(item.metadata[RUNTIME_BASELINE],observed.metadata[RUNTIME_BASELINE]))continue;
   const {rights,stamp}=projection(item);
   if(rights.stats){item.metadata[HP]={...bubble(item),...value.stats};if(item.metadata[LEGACY])item.metadata[LEGACY]={...item.metadata[LEGACY] as object,...value.stats};}
   if(rights.resources)item.metadata[RES]=structuredClone(Object.values(value.resources));
   if(rights.conditions)item.metadata[STATUS_BUFFS_KEY]=[...value.conditions];item.metadata[RUNTIME_BASELINE]=structuredClone(stamp);
  }});
 }
 async function catalog(){
  const {ready,scene,room,items,role,party,player}=await observation.read();
  if(player.id!==playerId||player.connectionId&&player.connectionId!==playerConnection)throw Object.assign(Error('账号或枭熊连接已改变；请从当前房间重新打开工作台'),{status:403});
  const signature=`${observation.version()}:${qqSession()?.accountId||''}:${cloudPermissionVersion}:${documentCacheVersion}:${getState().allowPlayerMonsters}:${getState().enabled.bestiary}:${getState().enabled.hpBar}`;
  // Movement does not rebuild the sheet projection, but callers such as dice
  // initialization still need the newest complete SDK item objects.
  if(catalogCache?.signature===signature)return {...catalogCache.value,items} as CatalogValue;
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
  const entries=new Map<string,any>();for(const c of [...bound,...directory,...roomList,...sceneList,...(Array.isArray(room[QQ_CARDS])?room[QQ_CARDS] as any[]:[])])if(typeof c?.id==='string'&&!deleted.includes(c.id))entries.set(c.id,{...entries.get(c.id),...c,...(c.visibility&&!Object.prototype.hasOwnProperty.call(c,'locked')?{locked:undefined}:{})});
  const all=[...entries.values()];
  // Retain a room directory independently of scene tokens, including inferred legacy ownership.
  for(const c of all){c.name=c.name||c.title||items.find(i=>i.metadata[BIND]===c.id)?.name||c.id;if(!Array.isArray(c.owner_ids)||!c.owner_ids.length){const owners=[...new Set(items.filter(i=>i.metadata[BIND]===c.id).map(i=>i.createdUserId))];if(owners.length)c.owner_ids=owners;}}
  // Legacy uploads retain their original room URL when moved between scenes.
  for(const c of all){
   // The durable directory already wins recovery writes below. Its document
   // location must also win reads/deletes over a stale scene mirror.
   const recorded=directory.find(row=>row.id===c.id),url=typeof recorded?.url==='string'?recorded.url:c.url,previous=cardLocations.get(c.id);
   if(typeof url!=='string'){if(previous){cardLocations.delete(c.id);invalidateCard(c.id);}continue;}
   let next:CardLocation|Error;try{next=cardLocation(origin,OBR.room.id||'default',c.id,url);}catch(error){next=error instanceof Error?error:Error('角色资料地址无效');}
   cardLocations.set(c.id,next);const identity=(value:CardLocation|Error)=>value instanceof Error?value.message:value.url;if(previous&&identity(previous)!==identity(next))invalidateCard(c.id);
  }
  // Recovery may fill missing directory entries, but an old scene snapshot
  // must not overwrite an existing room entry on every room-change event.
  // Rename/lock/import commands update the directory explicitly.
  const compact=all.filter(c=>!c.qqRoom).map(c=>({...c,...directory.find(row=>row.id===c.id)})).map(({id,name,owner_ids,locked,visibility,url})=>({id,name,owner_ids,locked,visibility,url}));
  if(role==='GM'&&!directoryWrite&&!sameValue(directory,compact)){directoryWrite=true;void OBR.room.setMetadata({[DIRECTORY]:compact}).catch(error=>console.warn('[workbench] directory recovery pending',error)).finally(()=>{directoryWrite=false;});}
  const cards=all.map(c=>{const tokens=items.filter(i=>i.metadata[BIND]===c.id);
   // Native Set Owner is authoritative. Do not revive stale importer/editor
   // grants when ownership changes or when a token leaves the scene.
   const owner_ids=c.qqRoom?(c.owner_ids||[]):nativeCardOwners(tokens,c.id);
   // The card tab targets this item. Prefer the current player's own binding
   // so another owner's earlier token cannot make their own card read-only.
   const primaryToken=tokens.find(token=>ownsNativeToken(token,playerId))||tokens[0];
   const verified=cloudPermissions.get(c.id),authority=verified?.scope===cloudPermissionScope(c)?verified:undefined;
   const own=c.qqRoom?authority?.own??qqSession()?.accountId===c.qqOwner:!!playerId&&owner_ids.includes(playerId),locked=c.qqRoom&&authority?authority.locked:c.locked??!!(c.visibility&&c.visibility!=='public');
   const projectedRevision=Math.max(0,...tokens.map(token=>{const baseline=token.metadata[RUNTIME_BASELINE] as RuntimeBaseline|undefined;return baseline&&baseline.cardId===c.id?baseline.revision:0;}));if(projectedRevision>documentRevision(documents.get(`${OBR.room.id}:card:${c.id}`)))invalidateCard(c.id,projectedRevision);
   return {...c,cloudRoom:!!c.qqRoom,owner_ids,name:authority?.name||c.name||c.title||primaryToken?.name||c.id,own,write:c.qqRoom?authority?.write??(own||!locked||!!qqSession()?.accountId&&(c.qqEditors||[]).includes(qqSession()!.accountId)):role==='GM'||own,locked,inScene:tokens.length>0,itemId:primaryToken?.id||`card:${c.id}`,classSummary:undefined as ReturnType<typeof classSummary>|undefined,resourceWidgets:undefined as ReturnType<typeof resourceWidgetPresentation>|undefined,resourceAttacks:undefined as ReturnType<typeof quickbarAttackPresentation>,resourceHidden:[] as string[],documentRevision:0,passive:undefined as number|undefined,coins:{} as Record<string,number>,player:party.filter(p=>owner_ids.includes(p.id)).map(p=>p.name).join('、'),conditions:conditionRows({item:primaryToken,scene},undefined),resources:primaryToken?.metadata[RES]||[],stats:bubble(primaryToken)};
  }).filter(c=>c.qqRoom?true:canReadNativeCard(c,c.owner_ids,playerId,role==='GM')).sort((a,b)=>Number(b.write)-Number(a.write)||Number(b.inScene)-Number(a.inScene)||String(a.name).localeCompare(String(b.name),'zh'));
  for(const c of cards){const doc=documents.get(`${OBR.room.id}:card:${c.id}`);if(!doc)continue;const canonical=documentRuntime(doc,definitionsFor(scene));c.classSummary=classSummary(doc);c.documentRevision=documentRevision(doc);c.passive=doc.core_stats?.passive_perception;c.coins=documentCoins(doc);const defs=definitionsFor(scene);c.conditions=conditionRows({cardId:c.id,scene} as any,doc);(c as any).player=doc.dnd_card_web?.player||doc.identity?.player_name||party.filter(p=>c.owner_ids?.includes(p.id)).map(p=>p.name).join('、');c.stats={...c.stats,...canonical.stats};c.resources=Object.values(canonical.resources);c.resourceWidgets=resourceWidgetPresentation(doc,c.resources);c.resourceAttacks=quickbarAttackPresentation(doc);c.resourceHidden=hiddenResourcePresentation(doc,c.resources);}
  const ownerRolesKey='com.obr-suite/workbench/owner-roles',ownerRoles={...room[ownerRolesKey] as Record<string,string>,[playerId]:role};for(const p of party)ownerRoles[p.id]=p.role;if(role==='GM'&&!sameValue(ownerRoles,room[ownerRolesKey]))void OBR.room.setMetadata({[ownerRolesKey]:ownerRoles});
  const monsters=items.filter(item=>ownerRoles[item.createdUserId]==='PLAYER'&&hasMonsterComponent(item)&&(role==='GM'||item.createdUserId===playerId||getState().allowPlayerMonsters&&item.metadata['com.obr-suite/workbench/locked']!==true)).map(item=>{
   const raw=item.metadata[SLUG]?(monsterOverrides.get((item.metadata[MONSTER] as any)?.key)?.data||(scene['com.bestiary/monsters'] as any)?.[String(item.metadata[SLUG])]||documents.get(`${OBR.room.id}:token:${item.id}:${item.metadata[SLUG]}`)):undefined,stats=bubble(item);
   return {id:item.id,targetId:`monster:${item.id}`,kind:'monster',name:item.name||raw?.name||'怪物',write:role==='GM'||item.createdUserId===playerId,locked:item.metadata['com.obr-suite/workbench/locked']===true,inScene:true,itemId:item.id,resources:(Array.isArray(item.metadata[RES])?item.metadata[RES]:[]) as any[],stats:{health:raw?.hp?.average,'max health':raw?.hp?.average,'temporary health':0,'armor class':typeof raw?.ac?.[0]==='number'?raw.ac[0]:raw?.ac?.[0]?.ac,...stats},passive:raw?.passive??(raw?.wis?10+Math.floor((raw.wis-10)/2):undefined),coins:{},conditions:conditionRows({item,scene} as any,undefined),player:party.find(p=>p.id===item.createdUserId)?.name,resourceWidgets:resourceWidgetPresentation(raw,Array.isArray(item.metadata[RES])?item.metadata[RES] as any[]:[])};
  });
  const value={cards,monsters,items,scene,room,role,all};catalogCache={signature,value};return value;
 }
 function cacheAccess(list:CatalogValue){
  const settings=getState(),enabled=settings.enabled;
  const cards=list.cards.map(({id,itemId,write,locked})=>({id,itemId,grantVersion:observation.authorityVersion('card:'+id),itemIds:list.items.filter(item=>item.metadata[BIND]===id).map(item=>item.id),write,locked}));
  // The overview lists player-owned monsters only. Cache grants additionally
  // cover every readable scene token, using the same access rules as selection.
  const monsters=list.items.filter(item=>hasMonsterComponent(item)&&(list.role==='GM'||item.createdUserId===playerId||settings.allowPlayerMonsters&&item.metadata['com.obr-suite/workbench/locked']!==true)).map(item=>({id:item.id,itemId:item.id,targetId:`monster:${item.id}`,kind:item.metadata[SLUG]?'monster':'token',grantVersion:observation.authorityVersion('monster:'+item.id),key:`${OBR.room.id}:token:${item.id}:${item.metadata[SLUG]||''}`,write:list.role==='GM'||item.createdUserId===playerId,locked:item.metadata['com.obr-suite/workbench/locked']===true}));
  const value={authorityVersion:observation.authorityVersion(),room:OBR.room.id||'default',scope:JSON.stringify([OBR.room.id,playerId,observation.sceneEpoch()]),role:list.role,enabled,cards,monsters};
  const signature=JSON.stringify(value);if(signature!==accessSignature){accessSignature=signature;accessEpoch++;}
  const result={...value,epoch:accessEpoch};accessHistory.set(accessEpoch,result);while(accessHistory.size>256)accessHistory.delete(accessHistory.keys().next().value!);return result;
 }
 function publicQQ(){const session=qqSession();return session?{id:session.accountId,nickname:session.nickname,avatar:session.avatar}:null;}
 function publishAccess(list:CatalogValue){const access=cacheAccess(list);for(const id of warmCards)if(!(id.startsWith('card:')?access.cards.some(card=>id===`card:${card.id}`):access.monsters.some(card=>id===card.itemId||id===card.targetId)||access.cards.some(card=>card.itemIds.includes(id)))){warmCards.delete(id);warmSnapshots.delete(id);}if(access.epoch!==lastAccessEpoch){lastAccessEpoch=access.epoch;send('access',{access});}
  // Card tabs and permissions must not wait for the shared rules or inventory
  // ledger. The full catalog supplies those independent sections afterwards.
  const directory={qqAccount:publicQQ(),cards:list.cards.map(({id,name,cloudRoom,owner_ids,write,locked,inScene,itemId,resources,stats,passive,coins,conditions,documentRevision,player,classSummary,resourceWidgets,resourceAttacks,resourceHidden})=>({id,name,cloudRoom,owner_ids,write,locked,inScene,itemId,resources,stats,passive,coins,conditions,documentRevision,player,classSummary,resourceWidgets,resourceAttacks,resourceHidden})),monsters:list.monsters,role:list.role,enabled:access.enabled};
  const signature=JSON.stringify(directory);if(signature!==lastDirectory){lastDirectory=signature;send('directory',{sequence:++sequence,access,...directory});}return access;}
 function warmCard(id:string){warmCards.delete(id);warmCards.add(id);while(warmCards.size>24){const old=warmCards.values().next().value!;warmCards.delete(old);warmSnapshots.delete(old);}}
 // While following a multi-bound card, retain the selected native token.
 // A canonical background card refresh must not switch its monster alternative
 // back to the first binding. Explicit card-tab choices still use the primary.
 function warmSnapshotTarget(id:string){
  if(id.startsWith('monster:'))return id;
  const items=observation.peek().items||[],cardId=id.startsWith('card:')?id.slice(5):items.find(item=>item.id===id)?.metadata[BIND];
  if(cardId&&chosen===`card:${cardId}`)return chosen;
  if(cardId&&mapFollowing&&!chosen.startsWith('card:')&&!chosen.startsWith('monster:')&&items.find(item=>item.id===chosen)?.metadata[BIND]===cardId)return chosen;
  return id;
 }
 async function pushWarmSnapshot(id:string){if(!warmCards.has(id)||!relayActive&&(!child||child.closed))return;if(warmInFlight.has(id)){warmAgain.add(id);return;}warmInFlight.add(id);try{
  const target=warmSnapshotTarget(id),next=await snapshot(target);if(!warmCards.has(id)||warmSnapshotTarget(id)!==target)return;const old=warmSnapshots.get(id),state=JSON.stringify(next.state);
  if(!old||old.document!==next.document||old.state!==state||old.epoch!==next.access.epoch){warmSnapshots.set(id,{document:next.document,state,epoch:next.access.epoch});send('cacheSnapshot',next);}
 }catch{/* A later access directory removes denied entries; never publish failed reads. */}finally{warmInFlight.delete(id);if(warmAgain.delete(id))void pushWarmSnapshot(id);}}
 type CatalogValue={cards:any[];monsters:any[];items:Item[];scene:Record<string,unknown>;room:Record<string,unknown>;role:"GM"|"PLAYER";all:any[]};
 // A retained HP payload is not an active component after explicit removal.
 // Character HP alone never creates a second monster target; a bestiary link does.
 function hasMonsterComponent(item:Item|undefined){
  if(!item)return false;const meta=item.metadata;
  if(typeof meta[SLUG]==='string'&&meta[SLUG])return getState().enabled.bestiary!==false;
  if(meta[BIND]||getState().enabled.hpBar===false||meta['com.obr-suite/hp-bar/enabled']===false)return false;
  if(meta['com.obr-suite/hp-bar/enabled']===true)return true;
  const stats=bubble(item);return fields.some(field=>typeof stats[field]==='number'&&Number.isFinite(stats[field]));
 }
 function targetReadIdentity(a:{key:string;cardId:string;card?:{qqRoom?:{id:string};qqCardId?:string;qqRevisionOffset?:number};item?:Item;scene:Record<string,unknown>}){
  if(a.cardId)return a.card?.qqRoom?JSON.stringify([a.key,a.card.qqRoom.id,a.card.qqCardId,cloudRevisionOffset(a.card)]):a.key;
  const meta=a.item?.metadata;return JSON.stringify([a.key,meta?.[BIND],meta?.[MONSTER],meta?.['com.obr-suite/hp-bar/enabled'],a.item?.createdUserId,meta?.['com.obr-suite/workbench/locked'],meta?.[SLUG]?(a.scene['com.bestiary/monsters'] as any)?.[String(meta[SLUG])]:undefined]);
 }
 async function access(id:string,existing?:Awaited<ReturnType<typeof catalog>>){
  const data=existing||await catalog(),monster=id.startsWith('monster:'),itemId=monster?id.slice(8):id,item=data.items.find(i=>i.id===itemId),cardId=id.startsWith('card:')?id.slice(5):monster?'':String(item?.metadata[BIND]||''),card=data.cards.find(c=>c.id===cardId);
  if(cardId&&!card)throw Object.assign(Error('没有此角色卡的查看权限'),{status:403});if(!card&&!item)throw Object.assign(Error('未找到角色卡或棋子'),{status:404});
  if(!card&&!hasMonsterComponent(item))throw Error('棋子没有角色、怪物或生命条组件');
  if(!card&&data.role!=='GM'&&item?.createdUserId!==playerId&&(!getState().allowPlayerMonsters||item?.metadata['com.obr-suite/workbench/locked']===true))throw Object.assign(Error('没有此怪物的阅读权限'),{status:403});
  const token=item||data.items.find(i=>i.metadata[BIND]===cardId&&ownsNativeToken(i,playerId))||data.items.find(i=>i.metadata[BIND]===cardId),slug=String(token?.metadata[SLUG]||'');
  return {...data,item:token,cardId,card,slug,targetId:cardId?`card:${cardId}`:`monster:${token!.id}`,write:card?card.write&&(!!card.qqRoom||!item||data.role==='GM'||ownsNativeToken(item,playerId)):(data.role==='GM'||ownsNativeToken(token,playerId)),key:cardId?`${OBR.room.id}:card:${cardId}`:`${OBR.room.id}:token:${token!.id}:${slug}`};
 }
 async function read(a:Awaited<ReturnType<typeof access>>,fresh=false){
  const key=a.key;if(a.cardId)return loadCard(a.cardId,key,fresh);const override=(a.slug?a.item?.metadata[MONSTER]:undefined) as {key:string;revision:number}|undefined;if(override?.key){let cached=monsterOverrides.get(override.key);if(fresh||!cached||cached.revision<override.revision){cached=await relay.send({sharedDocument:{key:override.key,operation:'read'}});monsterOverrides.set(override.key,cached!);}if(cached?.data){monsterSceneDocuments.delete(key);cacheDocument(key,cached.data);return cached.data;}}
  // A scene-owned definition can arrive or be replaced after the library read.
  // Cache against its observed identity; a removed override must not stay alive.
  const sceneDocument=a.slug?(a.scene['com.bestiary/monsters'] as any)?.[a.slug]:undefined;
  if(!a.cardId&&!fresh&&documents.get(key)&&monsterSceneDocuments.has(key)&&monsterSceneDocuments.get(key)===sceneDocument)return documents.get(key);let doc:any=null;
  if(a.slug){doc=sceneDocument;if(!doc){const data=await import('../modules/bestiary/data');doc=data.getRawMonster(a.slug);if(!doc){doc=await data.loadMonsterBySlug(a.slug);}}}
  monsterSceneDocuments.set(key,sceneDocument);cacheDocument(key,doc);return doc;
 }
 function live(a:Awaited<ReturnType<typeof access>>){const ids=a.item?.metadata[STATUS_BUFFS_KEY];const custom=a.scene[SHARED_BUFFS];const defs=[...DEFAULT_BUFFS,...(Array.isArray(custom)?custom:[])].filter(d=>d&&typeof d.id==='string');return {conditions:Array.isArray(ids)?ids.map(id=>defs.find(v=>v.id===id)||{id,name:id}):undefined,resources:Array.isArray(a.item?.metadata[RES])?a.item!.metadata[RES]:[]};}
 async function snapshot(id:string,existing?:Awaited<ReturnType<typeof catalog>>){
  let a=await access(id,existing);const sceneEpoch=observation.sceneEpoch(),identity=targetReadIdentity(a),doc=await read(a);a=await access(id);if(targetReadIdentity(a)!==identity||sceneEpoch!==observation.sceneEpoch())throw Error('角色关联或场景已改变');
  const b=bubble(a.item),canonical=a.cardId?documentRuntime(doc,definitionsFor(a.scene)):undefined;
  return {sequence:++sequence,clientInstance,clientSelection,access:publishAccess(a),state:{key:a.key,targetId:a.targetId,itemId:a.item?.id||`card:${a.cardId}`,name:doc?.identity?.character_name||doc?.name||a.card?.name||a.item?.name,cardId:a.cardId,slug:a.slug,kind:a.cardId?'character':a.slug?'monster':'token',cloudRoom:!!a.card?.qqRoom,documentRevision:a.cardId?documentRevision(doc):undefined,projectionPending:!!a.cardId&&a.items.some(item=>item.metadata[BIND]===a.cardId&&(item.metadata[RUNTIME_BASELINE] as RuntimeBaseline|undefined)?.revision!==documentRevision(doc)),stats:canonical?{...a.card?.stats,...canonical.stats}:Object.fromEntries(fields.filter(k=>typeof b[k]==='number').map(k=>[k,b[k]])),write:a.write,role:a.role,pinned:!follow,tokenPortrait:tokenPortrait(a.item),locked:a.card?.locked??a.item?.metadata['com.obr-suite/workbench/locked']===true,statsLocked:b.locked!==false,...live(a),conditions:conditionRows(a,doc),resources:canonical?Object.values(canonical.resources):live(a).resources},document:doc};
 }
 async function persistDocument(a:Awaited<ReturnType<typeof access>>,existing:any,data:any,inventoryGuard?:{key:string;revision:number},conditionGrant=false,requestGuard?:()=>void|Promise<void>){
  await requestGuard?.();await observation.refreshAuthority();
  const sceneEpoch=observation.sceneEpoch(),authorityVersion=observation.authorityVersion('card:'+a.cardId);
  const permission=await access(`card:${a.cardId}`);if(!permission.write&&!(conditionGrant&&permission.card&&!permission.card.locked))throw Error('角色修改权限已改变');
  stampRuntimeProjectionAuthority(existing,data,playerId,permission.role==='GM',conditionGrant,definitionsFor(permission.scene));
  data[DOCUMENT_REVISION]=documentRevision(existing)+1;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(existing))),expected=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const location=documentLocation(a.cardId);
  const beforeSend=async()=>{await requestGuard?.();await observation.refreshAuthority();const live=await access(`card:${a.cardId}`);if(sceneEpoch!==observation.sceneEpoch()||authorityVersion!==observation.authorityVersion('card:'+a.cardId)||live.key!==a.key||(!live.write&&!(conditionGrant&&live.card&&!live.card.locked)))throw Object.assign(Error('角色修改权限已改变'),{status:403});};
  if(permission.card?.qqRoom){
    await beforeSend();
    const cloudDocument=structuredClone(data);if(cloudDocument.dnd_card_web)cloudDocument.dnd_card_web.id=existing.dnd_card_web.id;
    const scope=cloudPermissionScope(permission.card);
    try{const result=await qqRequest('room-cards/'+permission.card.qqRoom.id,'PUT',{document:cloudDocument,revision:documentRevision(existing)-cloudRevisionOffset(permission.card)},permission.card.qqRoom);rememberCloudPermission(permission.card,result,scope);cardCommitted(a,roomCloudDocument(result.document,permission.card));return;}
    catch(error){const failure=error as any;if(failure.status&&failure.status<500)throw error;documentTimes.delete(a.key);
     try{const confirmed=await qqRequest('room-cards/'+permission.card.qqRoom.id,'GET',undefined,permission.card.qqRoom);if(confirmed.revision+cloudRevisionOffset(permission.card)===documentRevision(existing)+1&&sameValue(confirmed.character,cloudDocument.dnd_card_web)){cardCommitted(a,roomCloudDocument(confirmed.document,permission.card));return;}}catch{}
     throw Object.assign(Error('云端原卡写回结果暂时无法确认，本机草稿保留。请核对云端版本后再操作。'),{uncertain:true,diagnostic:{code:'ROOM_WRITE_UNKNOWN'}});
    }
  }
  try{await relay.send({saveCard:{room:location.room,card:location.card,logicalCard:a.cardId,inventoryRoom:(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_'),expected,changes:documentChanges(existing,data).map(({path,after,remove})=>({path,after,remove})),inventoryGuard}},beforeSend);}
  catch(error){documentTimes.delete(a.key);const e=error as any;if(e.notSent||e.status&&e.status<500)throw error;
   // A lost HTTP response is not evidence of a failed write. Read back once;
   // never replay the mutation, and never report a rollback while it is unknown.
   try{const committed=await withRequestTimeout(20000,undefined,async signal=>{const response=await fetch(location.url,{cache:'no-store',signal});return response.ok?response.json():undefined;});if(committed&&sameValue(committed,data)){cardCommitted(a,committed);return;}}catch{}
   throw Object.assign(Error('角色保存结果暂时无法确认；本地改动已保留，请恢复连接后核对。'),{uncertain:true,diagnostic:{code:'WRITE_RESULT_UNKNOWN',documentRevision:data[DOCUMENT_REVISION]}});
  }
  cardCommitted(a,data);
 }
 function cardCommitted(a:{key:string;cardId:string},data:any){
  cacheDocument(a.key,data);documentTimes.set(a.key,Date.now());
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
  const definitions:InventoryDefinition[]=[{id:publicId,name:'公共仓库',kind:'public',write:data.role==='GM'||!ledger.data.containers[publicId]?.locked},...data.cards.filter(c=>!c.qqRoom).filter(c=>ledger.data.containers[`card:${c.id}`]||documents.has(`${OBR.room.id}:card:${c.id}`)).map(c=>({id:`card:${c.id}`,name:c.name,kind:'card' as const,write:c.write,document:documents.get(`${OBR.room.id}:card:${c.id}`)}))];
  for(const item of data.items.filter(i=>hasMonsterComponent(i)&&(data.role==='GM'||i.createdUserId===playerId)))definitions.push({id:`monster:${item.id}`,name:item.name,kind:'monster',write:true});
  return {definitions,publicId,gm:data.role==='GM',authority:{gm:data.role==='GM',read:new Set(definitions.map(d=>d.id)),write:new Set(definitions.filter(d=>d.write).map(d=>d.id)),give:new Set(definitions.filter(d=>d.kind!=='monster'||d.write).map(d=>d.id))}};
 }
 async function inventoryMirror(id:string,container:any,conditionIds:string[]=[],conditionEntries:any[]=[]){
  if(!id.startsWith('card:')&&!id.startsWith('monster:'))return;
  const current=await inventories.read(true),pending=current.data.projections?.[id];if(!pending)return;container=current.data.containers[id];conditionIds=pending.conditions;conditionEntries=pending.entries||[];
  const a=await access(id);if(a.card?.qqRoom)return;const oldConditions=a.cardId?(await read(a,true))?.dnd_card_web?.selections?.filter((s:any)=>s.entry.kind==='condition')||[]:[];
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
 let statusCatalogQueue=Promise.resolve();
 function publishStatusDefinitions(additions:any[]){if(!additions.length)return;statusCatalogQueue=statusCatalogQueue.catch(()=>{}).then(async()=>{const scene=await OBR.scene.getMetadata(),custom=Array.isArray(scene[SHARED_BUFFS])?scene[SHARED_BUFFS] as any[]:[];const next=[...custom.filter(d=>!additions.some(v=>v.id===d.id)),...additions];if(!sameValue(custom,next))await OBR.scene.setMetadata({[SHARED_BUFFS]:next});}).catch(error=>console.warn('[workbench] status catalog projection pending',error));}
 const canOpen=(a:Awaited<ReturnType<typeof access>>)=>a.cardId?getState().enabled.characterCards!==false:a.slug?getState().enabled.bestiary!==false:getState().enabled.hpBar!==false;
 // A token can acquire or change its binding after the selection event. Keep
 // the binding in the identity so that this same selected token is retried.
 const selectionIdentity=(selection:string[],items:Item[])=>JSON.stringify(selection.map(id=>{const item=items.find(item=>item.id===id);return [id,item?.metadata[BIND],item?.metadata[SLUG],hasMonsterComponent(item),item?.createdUserId,item?.metadata['com.obr-suite/workbench/locked']];}));
 let selectionGeneration=0,selecting=false,selectAgain=false;
 const followMessage=(type:string,extra:Record<string,unknown>={})=>send(type,{followRevision,clientInstance,clientSelection,...extra});
 function finishMapFollow(restore=true){if(!mapFollowing)return;if(restore)chosen=mapReturn;mapFollowing=false;mapReturn='';followMessage('followEnd',{itemId:chosen,restore});}

 function selectionFailure(id:string,error:unknown,issuedAccess?:ReturnType<typeof cacheAccess>){
  const e=error as any,status=Number.isInteger(e?.status)?e.status:0;
  const bound=observation.peek().items?.find(item=>item.id===id)?.metadata[BIND],targetId=id.startsWith('card:')||id.startsWith('monster:')?id:typeof bound==='string'?`card:${bound}`:id;
  const signature=JSON.stringify([clientInstance,clientSelection,followRevision,selectionGeneration,issuedAccess?.room,issuedAccess?.scope,issuedAccess?.epoch,status]);if(selectionFailures.get(targetId)===signature)return;selectionFailures.set(targetId,signature);while(selectionFailures.size>64)selectionFailures.delete(selectionFailures.keys().next().value!);
  const message=status===404?'角色资料暂不可用（404）；请刷新目录或重新读取后核对':status===403?'当前角色的查看权限或连接已改变；请刷新目录后核对':status?`角色读取失败（${status}）；可重新读取`:'角色读取未完成；请核对连接后重新读取';
  send('selectionError',{access:issuedAccess,sequence:++sequence,clientInstance,clientSelection,followRevision,targetId,...(!id.startsWith('card:')?{itemId:id.replace(/^monster:/,'')}:{}),message,status,retryable:true,diagnostic:{code:'CARD_READ_FAILED',at:new Date().toISOString(),operation:'select',phase:'read-card',status,httpStatus:status,version:devManifest.version,requestId:crypto.randomUUID(),connection:child&&!child.closed?'direct':relayActive?'relay':'offline'}});
 }
 async function refreshSelection(){
  if(!relayActive&&(!child||child.closed))return;
  if(selecting){selectAgain=true;return;}selecting=true;
  let issuedAccess:ReturnType<typeof cacheAccess>|undefined;
  try{const list=await catalog();issuedAccess=publishAccess(list);const selection=(await observation.read()).selection,signature=selectionIdentity(selection,list.items);
   // Establish the manual/default card before map following captures its return target.
   if(!chosen)chosen=getState().enabled.characterCards!==false&&list.cards[0]?`card:${list.cards[0].id}`:'';
   if(follow&&signature!==lastSelection){selectionGeneration++;followRevision++;
    if(selection.length===1){try{const a=await access(selection[0],list);if(canOpen(a)){
     if(!mapFollowing)mapReturn=chosen;mapFollowing=true;lastSelection=signature;chosen=a.cardId?selection[0]:a.targetId;
     followMessage('navigate',{itemId:chosen,id:crypto.randomUUID(),followSelection:true});
    }else finishMapFollow();}catch{finishMapFollow();}}
    else{lastSelection=signature;if(selection.length>1){if(!mapFollowing)mapReturn=chosen;mapFollowing=true;followMessage('followSelection');}else finishMapFollow();}
   }
   if(follow&&selection.length>1)return;
   if(chosen)try{if(!canOpen(await access(chosen,list))){chosen='';lastSelection='';}}catch{chosen='';lastSelection='';}
   if(!chosen)chosen=getState().enabled.characterCards!==false&&list.cards[0]?`card:${list.cards[0].id}`:'';
   if(!chosen){send('selection',{sequence:++sequence,message:'暂无可查看的角色卡'});return;}
   const id=chosen,generation=selectionGeneration,readScene=observation.sceneEpoch(),readAuthority=observation.authorityVersion(id),readAccess=issuedAccess;warmCard(id);
   // A slow first download must not hold the selection gate: a later click on
   // another (already cached) card can finish immediately and wins the generation.
   void snapshot(id,list).then(next=>{if(id!==chosen||generation!==selectionGeneration)return;
    selectionFailures.delete(next.state.targetId);const signatureNext=JSON.stringify(next.state);if(signatureNext!==last||next.document!==lastDocument){last=signatureNext;lastDocument=next.document;send('selection',{...next,followRevision});}
   }).catch(error=>{if(id===chosen&&generation===selectionGeneration&&readScene===observation.sceneEpoch()&&readAuthority===observation.authorityVersion(id))selectionFailure(id,error,readAccess);});
  }catch(error){if(chosen)selectionFailure(chosen,error,issuedAccess);else send('error',{message:'角色目录读取未完成；请核对连接后刷新目录'});}finally{selecting=false;if(selectAgain){selectAgain=false;void refreshSelection();}}
 }
 type HydrationJob={key:string;card:Awaited<ReturnType<typeof catalog>>['cards'][number];list:Awaited<ReturnType<typeof catalog>>;started:boolean;promise:Promise<void>;resolve:()=>void};
 const cardHydrations=new Map<string,HydrationJob>(),hydrationQueue:HydrationJob[]=[];let backgroundHydrations=0;
 function pumpHydrations(){while(backgroundHydrations<2&&hydrationQueue.length){const job=hydrationQueue.shift()!;if(!job.started)startHydration(job,true);}}
 function startHydration(job:HydrationJob,background:boolean){if(job.started)return;job.started=true;if(background)backgroundHydrations++;
  void (async()=>{const before=documents.get(job.key);try{for(;;){const generation=cardInvalidations.get(job.key)||0,{card:c,list}=job;
    // The selected card bypasses unrelated downloads. Other cards retain a
    // bounded background queue, and unchanged scene events reuse cached reads.
    // Invalidation events keep documents fresh. A slow fallback audit recovers
    // missed legacy broadcasts without re-downloading the selected portrait every four seconds.
    const ttl=120000;
    let doc=await loadCard(c.id,job.key,!documentTimes.has(job.key)||Date.now()-(documentTimes.get(job.key)||0)>ttl);
    if(!mutation)doc=await reconcileRuntime(c.id,job.key,list.items,list.scene,doc,c.write);
    if(generation!==(cardInvalidations.get(job.key)||0))continue;
    if(!sameValue(before,doc)){void refresh();if(chosen===`card:${c.id}`)void refreshSelection();}void pushWarmSnapshot(`card:${c.id}`);break;
   }}catch{}finally{cardHydrations.delete(job.key);job.resolve();if(background)backgroundHydrations--;pumpHydrations();}})();
 }
 function scheduleHydration(card:HydrationJob['card'],list:HydrationJob['list'],priority:boolean){const key=`${OBR.room.id}:card:${card.id}`,existing=cardHydrations.get(key);
  if(existing){existing.card=card;existing.list=list;if(priority&&!existing.started)startHydration(existing,false);return existing.promise;}
  let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r),job:HydrationJob={key,card,list,started:false,promise,resolve};cardHydrations.set(key,job);
  if(priority)startHydration(job,false);else{hydrationQueue.push(job);pumpHydrations();}return promise;
 }
 async function hydrate(cardId?:string){let list:CatalogValue;try{list=await catalog();}catch{return;}publishAccess(list);for(const card of list.cards.slice(0,24))if(warmCards.size<24)warmCard(`card:${card.id}`);await Promise.all(list.cards.filter(c=>(!cardId||c.id===cardId)&&(!c.qqRoom||chosen===`card:${c.id}`||!documents.has(`${OBR.room.id}:card:${c.id}`))).map(c=>scheduleHydration(c,list,chosen===`card:${c.id}`)));}
 async function refresh(){if(!relayActive&&(!child||child.closed))return;if(refreshing){again=true;return;}refreshing=true;
  try{
   const observedVersion=observation.version(),startedEpoch=epoch;
   const list=await catalog();const access=publishAccess(list);const [rules,observed,inventoryContextNow]=await Promise.all([shared.read(),observation.read(),inventoryContext(list)]),inventory=await inventories.view(inventoryContextNow.definitions,inventoryContextNow.gm,inventoryContextNow.publicId);for(const card of list.cards){const container=inventory.containers[`card:${card.id}`];if(container)card.coins=Object.fromEntries(container.items.filter(row=>row.kind==='currency').map(row=>[row.coin!,row.quantity]));}const personalQQ=qqSession();const data={qqAccount:personalQQ?{id:personalQQ.accountId,nickname:personalQQ.nickname,avatar:personalQQ.avatar}:null,cards:list.cards.map(({id,name,cloudRoom,owner_ids,write,locked,inScene,itemId,resources,stats,passive,coins,conditions,documentRevision,player,classSummary,resourceWidgets,resourceAttacks,resourceHidden})=>({id,name,cloudRoom,owner_ids,write,locked,inScene,itemId,resources,stats,passive,coins,conditions,documentRevision,player,classSummary,resourceWidgets,resourceAttacks,resourceHidden})),monsters:list.monsters,role:list.role,shared:rules,inventory,settings:getState(),enabled:getState().enabled,visibility:{wiki:getState().enabled.search!==false&&(list.role==='GM'||!getState().searchGmOnly),monsters:getState().enabled.bestiary!==false&&(list.role==='GM'||getState().allowPlayerMonsters)},console:{timeStop:readTimeStop(list.scene[TIME_STOP_META]).active,portalEffects:getState().portalEffects!==false,players:[observed.player,...observed.party.filter(p=>p.id!==observed.player.id)]}};
   if(observation.version()!==observedVersion||epoch!==startedEpoch){again=true;return;}
   const signature=JSON.stringify(data);if(signature!==lastCatalog){lastCatalog=signature;send('catalog',{sequence:++sequence,access,...data});}
  }catch(error){console.warn('[workbench] catalog refresh',error);}finally{refreshing=false;if(again){again=false;void refresh();}}
 }
 function assertMonsterWrite(a:Awaited<ReturnType<typeof access>>,item:Item,grant=false){
  if(observation.peek().role!=='GM'&&!ownsNativeToken(item,playerId)&&!(grant&&item.createdUserId&&item.metadata['com.obr-suite/workbench/locked']!==true))throw Error('怪物修改权限已改变');
  if(item.metadata[BIND]!==a.item?.metadata[BIND]||item.metadata[SLUG]!==a.item?.metadata[SLUG]||!hasMonsterComponent(item))throw Error('怪物关联已改变');
 }
 async function setTokens(a:Awaited<ReturnType<typeof access>>,patch:any,requestGuard?:()=>void|Promise<void>,assertIntent?:()=>void){
  await requestGuard?.();
  if(a.cardId){
   const doc=await read(a);
   void projectRuntime(a.cardId,doc).catch(error=>console.warn('[workbench] runtime projection pending',error));
   // Locking is metadata-owned, so its SDK write still determines success.
   if(patch.stats&&'locked' in patch.stats){const ids=a.items.filter(i=>i.metadata[BIND]===a.cardId).map(i=>i.id);await requestGuard?.();await OBR.scene.items.updateItems(ids,drafts=>{assertIntent?.();if(observation.peek().role!=='GM')throw Error('仅 DM 可锁定生命条');for(const item of drafts)if(item.metadata[BIND]===a.cardId)item.metadata[HP]={...bubble(item),locked:patch.stats.locked};});}
   return;
  }
  const ids=a.cardId?a.items.filter(i=>i.metadata[BIND]===a.cardId).map(i=>i.id):a.item?[a.item.id]:[];if(!ids.length)return;
  await requestGuard?.();await OBR.scene.items.updateItems(ids,items=>{assertIntent?.();for(const item of items){if(a.cardId&&item.metadata[BIND]!==a.cardId)continue;assertMonsterWrite(a,item);
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
   await publishWorkbenchNotice({noticeId:crypto.randomUUID(),privateFor,privateSummary:`${actor}${delta>0?'恢复':'消耗'}了什么`,tokenId:a.item?.id||`card:${a.cardId}`,tokenName:a.card?.name||a.item?.name||'',entry:next?.entry||previous?.entry,resource,delta,prevValue:previous?.current||0});
  }
 }
 function nativeStockNotices(c:any){const values:Record<string,any>={};for(const row of c?.selections||[]){if(row.entry?.kind!=='item')continue;const id='item:'+row.entry.id;const r=values[id]||={id,name:row.entry.name,entry:row.entry,current:0,max:0,type:'number'};r.current+=row.quantity||0;r.max=r.current;}for(const [coin,current] of Object.entries(c?.inventory?.coins||{}))values['coin:'+coin]={name:({cp:'铜币',sp:'银币',ep:'琥珀金币',gp:'金币',pp:'铂金币'} as Record<string,string>)[coin]||coin,current,max:current,type:'number'};return values;}
 async function spellPreparationNotices(a:Awaited<ReturnType<typeof access>>,before:any,after:any){
  const prepared=(card:any):Set<string>=>new Set(card?.spellSettings?.mode==='prepared'?card.spellSettings.prepared||[]:[]);
  const old=prepared(before),next=prepared(after);if([...old].every(id=>next.has(id))&&old.size===next.size)return;
  if(a.role==='GM'&&(await inventories.read()).data.silent)return;
  const privateFor=a.card?.locked?(a.card.owner_ids||[]):undefined,requester=(await observation.read()).player.name,actor=a.card?.name||after.name||requester;
  for(const id of new Set([...old,...next])){
   if(old.has(id)===next.has(id))continue;
   const row=(after.selections||[]).find((s:any)=>s.id===id)||(before.selections||[]).find((s:any)=>s.id===id);if(row?.entry?.kind!=='spell')continue;
   const added=next.has(id),name=row.entry.name,summary=`${actor}${added?'预备了':'取消预备了'}${name}`;
   await publishWorkbenchNotice({noticeId:crypto.randomUUID(),tokenId:a.item?.id||`card:${a.cardId}`,tokenName:actor,entry:row.entry,summary,privateFor,privateSummary:`${requester}${added?'预备':'取消预备'}了法术`,resource:{id,name,current:added?1:0,max:1,type:'count',icon:'spellbook'},delta:added?1:-1,prevValue:added?0:1});
  }
 }
 async function statNotices(a:Awaited<ReturnType<typeof access>>,before:Record<string,any>,after:Record<string,any>){
  const names:Record<string,string>={health:'生命值','temporary health':'临时生命','max health':'生命值上限','armor class':'护甲等级'};
  // Monster HP is scene state, not a public resource announcement. This also
  // covers temporary HP and max HP, through both the stats and save routes.
  if(!a.cardId){delete names.health;delete names['temporary health'];delete names['max health'];}
  const values=(stats:Record<string,any>)=>Object.fromEntries(Object.entries(names).filter(([key])=>typeof stats[key]==='number').map(([key,name])=>[key,{id:key,name,current:stats[key],max:stats['max health']||stats[key]||0,type:'number'}]));
  await resourceNotices(a,values(before),values(after));
 }
 async function conditionNotices(a:Awaited<ReturnType<typeof access>>,before:any,after:any){
  const values=(card:any)=>Object.fromEntries((card?.selections||[]).filter((row:any)=>row.entry?.kind==='condition').map((row:any)=>[conditionIdentity(row.entry,definitionsFor(a.scene)),{id:row.entry.id,name:row.entry.name,entry:row.entry,current:row.level||1,max:6,type:'number'}]));
  const old=values(before),next=values(after);if(sameValue(old,next))return;
  if(a.role==='GM'&&(await inventories.read()).data.silent)return;
  const actor=a.card?.name||a.item?.name||after.name||'',requester=(await observation.read()).player.name,privateFor=a.card?.locked?(a.card.owner_ids||[]):a.item?.metadata['com.obr-suite/workbench/locked']?[a.item.createdUserId]:undefined;
  for(const id of new Set([...Object.keys(old),...Object.keys(next)])){if(sameValue(old[id],next[id]))continue;const row=next[id]||old[id],added=!!next[id],summary=`${actor}${added?'获得了':'移除了'}${row.name}${added&&row.current>1?` ${row.current}`:''}`;await publishWorkbenchNotice({noticeId:crypto.randomUUID(),tokenId:a.item?.id||`card:${a.cardId}`,tokenName:actor,entry:row.entry,summary,privateFor,privateSummary:`${requester}调整了状态`,resource:row,delta:added?1:-1,prevValue:old[id]?.current||0});}
 }
 function conditionRows(a:{scene:Record<string,any>;item?:Item;cardId?:string},doc:any):ConditionRow[]{
  const defs=definitionsFor(a.scene),saved=a.cardId?(doc?.dnd_card_web?.selections?.filter((s:any)=>s.entry?.kind==='condition')||(doc?.web_conditions||[]).map((entry:any)=>({entry}))):Object.values(a.item?.metadata['com.obr-suite/workbench/condition-details'] as any||{});
  const ids=a.cardId?documentRuntime(doc,defs).conditions:(Array.isArray(a.item?.metadata[STATUS_BUFFS_KEY])?a.item!.metadata[STATUS_BUFFS_KEY] as string[]:[]);
  return ids.map(id=>{const original=saved.find((s:any)=>s.entry&&conditionIdentity(s.entry,defs)===id),definition=defs.find(v=>v.id===id),entry=original?.entry||definition?.entry||{id:'suite-condition:'+id,kind:'condition',name:definition?.name||id,english:id,source:'IMPORTED',edition:'both',packId:'imported',revision:'1',entries:[],raw:{_suiteStatusId:id}};return {id,name:entry.name,entry,level:original?.level||1};});
 }
 const changeCondition=conditionCommands({
  read:async id=>{const a=await access(id);return {rows:conditionRows(a,a.cardId?await read(a):undefined),write:a.write,receive:!!(a.card?!a.card.locked:a.item?.createdUserId&&a.item.metadata['com.obr-suite/workbench/locked']!==true)};},
  write:async(change,requestGuard)=>{
   await requestGuard?.();const a=await access(change.itemId);if(!a.write&&!(change.grant&&(a.card?!a.card.locked:a.item?.createdUserId&&a.item.metadata['com.obr-suite/workbench/locked']!==true)))throw Error('角色状态修改权限已改变');
   const doc=a.cardId?await read(a):undefined,rows=conditionRows(a,doc),current=rows.find(row=>row.id===change.conditionId)||null;
   if(!sameValue(current,change.before))throw Error('状态已被其他操作修改，请重试');
   const next=[...rows.filter(row=>row.id!==change.conditionId),...(change.after?[change.after]:[])],defs=definitionsFor(a.scene);
   const nativeRows=(values:ConditionRow[])=>({selections:values.map(row=>({id:'suite-status:'+row.id,entry:row.entry,level:row.level||1,quantity:1}))});
   const sync=a.card?.qqRoom?{ledgerRevision:undefined,ledgerCommitted:false}:await inventories.syncNative(a.cardId?`card:${a.cardId}`:`monster:${a.item!.id}`,nativeRows(rows),nativeRows(next),entry=>conditionIdentity(entry,defs),requestGuard);
   if(change.after&&!defs.some(def=>def.id===change.after!.id))defs.push({id:change.after.id,name:change.after.name,entry:change.after.entry,color:'#777777'});
   if(a.cardId){
    const updated=writeRuntime(doc,{...documentRuntime(doc,defs),conditions:next.map(row=>row.id)},defs);
    if(updated.dnd_card_web)updated.dnd_card_web.selections=updated.dnd_card_web.selections.map((selection:any)=>{if(selection.entry?.kind!=='condition')return selection;const row=next.find(row=>conditionIdentity(selection.entry,defs)===row.id);return row?{...selection,entry:row.entry,level:row.level||1}:selection;});
    updated.web_conditions=next.map(row=>row.entry);
    try{await persistDocument(a,doc,updated,sync.ledgerRevision===undefined?undefined:{key:inventories.key,revision:sync.ledgerRevision},change.grant,requestGuard);}
    catch(error){if(sync.ledgerCommitted)throw Object.assign(Error('库存中的状态授予变更已保存；角色状态写入结果需要核对。'),{uncertain:true,diagnostic:{code:'CONDITION_GRANT_PARTIAL',phase:'save-condition-document',ledgerRevision:sync.ledgerRevision,itemId:change.itemId,conditionId:change.conditionId,committed:['inventory-grant'],cause:String(error)}});throw error;}
    if(change.after)publishStatusDefinitions(defs.filter(def=>def.id===change.after!.id));
    try{await setTokens(a,{conditions:next.map(row=>row.id)});}catch(error){console.warn('[workbench] condition projection pending',error);}
   }else{
    await requestGuard?.();await OBR.scene.items.updateItems([a.item!.id],items=>{(requestGuard as any)?.assertCurrent?.();for(const item of items){assertMonsterWrite(a,item,change.grant&&!a.write);const oldIds=a.item!.metadata[STATUS_BUFFS_KEY] as string[]||[],liveIds=item.metadata[STATUS_BUFFS_KEY] as string[]||[];if(oldIds.includes(change.conditionId)!==liveIds.includes(change.conditionId))throw Error('怪物状态已改变');item.metadata[STATUS_BUFFS_KEY]=[...liveIds.filter(id=>id!==change.conditionId),...(change.after?[change.conditionId]:[])];const details={...item.metadata['com.obr-suite/workbench/condition-details'] as any};if(change.after)details[change.conditionId]={entry:change.after.entry,level:change.after.level||1};else delete details[change.conditionId];item.metadata['com.obr-suite/workbench/condition-details']=details;}});
    if(change.after)publishStatusDefinitions(defs.filter(def=>def.id===change.after!.id));
   }
  },
  snapshot:async id=>snapshot(id),catalog:async()=>{const list=await catalog();return {cards:list.cards,monsters:list.monsters,sequence:++sequence};},
  notice:async changes=>{for(const change of changes){const a=await access(change.itemId),native=(row:ConditionRow|null)=>({selections:row?[{entry:row.entry,level:row.level||1}]:[]});await conditionNotices(a,native(change.before),native(change.after));}}
 });
 const groups=createGroupRolls({observation,send,
  resolveTarget:async id=>{let a=await access(id);if(!a.write||!a.item)throw Error('群体目标不存在或没有修改权限');const key=a.key,document=await read(a);a=await access(id);if(a.key!==key||!a.write||!a.item)throw Error('群体目标权限已改变');return {item:a.item,document,key:a.key};},
  applyDelta:async(id,change)=>{
   const a=await access(id);if(a.key!==change.key||!a.write||!a.item)throw Error('群体目标关联或修改权限已改变');
   const doc=await read(a),stats=a.cardId?documentRuntime(doc,definitionsFor(a.scene)).stats:bubble(a.item);
   const hp=Number(stats.health||0),temp=Number(stats['temporary health']||0),max=Number(stats['max health']??99999),value=change.value;
   const field=change.field||'health';if(!['health','max health','armor class'].includes(field))throw Error('无效群体数值字段');
   const current=Number(stats[field]||0),patch:Record<string,number>=field!=='health'?{[field]:Math.max(field==='max health'?1:0,change.mode==='damage'?current-value:change.mode==='heal'?current+value:value)}:change.mode==='damage'?{health:Math.max(0,hp-Math.max(0,value-temp)),'temporary health':Math.max(0,temp-value)}:{health:Math.min(max,change.mode==='heal'?hp+value:value)};
   const operation:any={type:'stats',itemId:id,key:a.key,patch,expected:stats};
   try{return await command(operation);}catch(error){if(!operation._committed)throw error;void refreshSelection();void refresh();return {committed:true,warning:'生命值已保存，投影或播报仍在恢复'};}
  }
 });
 async function command(m:any){
  if(m.type==='qqLibrary'){await OBR.modal.open({id:'com.obr-suite/qq-card-library',url:assetUrl('cc-qq.html'),width:1280,height:850});return;}
  if(m.type==='groupRoll'){const result=await groups.handle(m);if(m.action==='close')finishMapFollow();return result;}
  if(m.type==='refreshCatalog'){await observation.refreshCatalog();const list=await catalog();return {catalog:{cards:list.cards,monsters:list.monsters,sequence:++sequence},access:publishAccess(list)};}
  if(m.type==='readCard'){const a=await access(m.itemId),sceneEpoch=observation.sceneEpoch(),identity=targetReadIdentity(a),document=await read(a),latest=await access(m.itemId);if(targetReadIdentity(latest)!==identity||sceneEpoch!==observation.sceneEpoch())throw Error('角色关联或权限已改变');return {document};}
  if(m.type==='assignOwners')throw Error('请使用枭熊棋子的 Set Owner 设置所属玩家');
  if(m.type==='refreshCard'){const a=await access(m.itemId);if(a.cardId){invalidateCard(a.cardId);await read(a,true);}return {snapshot:await snapshot(m.itemId)};}
  if(m.type==='showEntry'){const entry=sharedEntry(m.entry),actor=(await observation.read()).player.name;await publishWorkbenchNotice({noticeId:m.requestId,tokenId:'',tokenName:actor,entry,shared:true,summary:`${actor}展示了 ${entry.name}`,resource:{id:entry.id,name:entry.name,current:0,max:0,type:'number',icon:'gem'},delta:0,prevValue:0});return;}

  if(m.type==='condition'){
   if(m.condition?.entry){const a=await access(m.itemId);m.condition={...m.condition,id:conditionIdentity(m.condition.entry,definitionsFor(a.scene)),level:Math.max(1,Math.min(6,Number(m.condition.level)||1))};}
   return changeCondition(m,m._beforeMutation);
  }
  if(m.type==='cloudUpload'){
   const a=await access(m.itemId),roomId=OBR.room.id,sceneEpoch=observation.sceneEpoch();
   if(m.accountId!==qqSession()?.accountId)throw Error('QQ 账号已改变，请重新打开云端设置。');
   if(!a.cardId||!a.card||!a.write)throw Error('只有有编辑权限的角色卡可以上传云端。');
   if(a.card.qqRoom)return {snapshot:await snapshot(m.itemId)};
   const guard=async()=>{await m._beforeMutation?.();const current=await access(m.itemId);if(OBR.room.id!==roomId||observation.sceneEpoch()!==sceneEpoch||current.key!==a.key||!current.write||current.card?.qqRoom)throw Error('房间、角色关联或上传权限已改变，请重新读取。');};
   const result=await uploadRoomCard({roomId,cardId:a.cardId,playerId,native:m.native,read:()=>read(a,true),guard,session:qqSession,request:qqRequest,storage:localStorage,getMetadata:()=>OBR.room.getMetadata(),setMetadata:update=>OBR.room.setMetadata(update),registryKey:QQ_CARDS});
   m._committed={kind:'document',id:a.targetId};catalogCache=undefined;cardCommitted(a,result.document);
   return {snapshot:await snapshot(m.itemId)};
  }
  if(m.type==='cloudInfo'||m.type==='cloudEditors'){
   const a=await access(m.itemId);if(!a.card?.qqRoom)throw Error('当前卡不是云端卡');const actor=qqSession()?.accountId,roomId=OBR.room.id,scope=cloudPermissionScope(a.card);
   let info=await qqRequest('room-cards/'+a.card.qqRoom.id,'GET',undefined,a.card.qqRoom);
   if(m.type==='cloudEditors'){if(!info.owner)throw Error('只有 QQ 卡主可以管理编辑者');if(typeof m.accountId!=='string'||! /^[a-f0-9-]{36}$/.test(m.accountId))throw Error('请输入对方的账号 ID');await m._beforeMutation?.();await qqRequest('cards/'+info.cardId+'/editors'+(m.remove?'/'+m.accountId:''),m.remove?'DELETE':'POST',m.remove?{}:{accountId:m.accountId});info=await qqRequest('room-cards/'+a.card.qqRoom.id,'GET',undefined,a.card.qqRoom);}
   if(actor!==qqSession()?.accountId||roomId!==OBR.room.id)throw Error('账号或房间已改变，请重试');
   rememberCloudPermission(a.card,info,scope);void refreshSelection();void refresh();
   if(info.owner){const room=await OBR.room.getMetadata(),rows=Array.isArray(room[QQ_CARDS])?room[QQ_CARDS] as any[]:[];if(rows.find(row=>row.id===a.cardId)?.qqCardId!==info.cardId||!sameValue(rows.find(row=>row.id===a.cardId)?.qqEditors||[],info.editors||[]))await OBR.room.setMetadata({[QQ_CARDS]:rows.map(row=>row.id===a.cardId?{...row,qqCardId:info.cardId,qqEditors:info.editors||[]}:row)});}
   const {character,document,...basic}=info;return basic;
  }
  if(m.type==='panelRpc')return panels(m.panel,m.instance,String(m.method),Array.isArray(m.args)?m.args:[]);
  if(m.type==='inventory'){
   if(getState().enabled.inventory===false)throw Error('背包与公共仓库未开启');
   const context=await inventoryContext();await inventories.ensure(context.definitions,m._beforeMutation);
   if(m.scopeKey&&m.scopeKey!==context.publicId)throw Error('公共仓库作用域已切换');
   const beforeInventory=(await inventories.read(true)).data;
   let operation=m.operation;
   if(operation.action==='restore'||operation.historyGrant)throw Error('无效背包操作');
   if(operation.action==='history'){const record=stockHistory.get(operation.reference);if(!record)throw Error('此操作的撤销记录已过期');operation={operationId:operation.operationId,action:'restore',historyGrant:true,changes:record.changes,lockChanges:record.lockChanges};}
   const result=await inventories.command(operation,context.authority,m._beforeMutation);m._committed={kind:'inventory',historyId:operation.operationId};
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
      await publishWorkbenchNotice({noticeId:crypto.randomUUID(),privateFor,privateSummary:`${actor}${delta>0?'恢复':'消耗'}了什么`,tokenId:id,tokenName:message,entry:row.entry,resource,delta,prevValue:before});
     }
    }
   }
   return {historyId:operation.operationId,inventory:await inventories.view(context.definitions,context.gm,context.publicId),sequence:++sequence};
  }
  if(m.type==='locate'){
   await observation.refreshAuthority();const a=await access(m.itemId),identity=targetReadIdentity(a),sceneEpoch=observation.sceneEpoch();
   if(!a.item)throw Error('角色未在当前场景中绑定');
   await locateSceneItem(OBR,a.item.id,async()=>{await observation.refreshAuthority();const live=await access(m.itemId);if(sceneEpoch!==observation.sceneEpoch()||targetReadIdentity(live)!==identity||live.item?.id!==a.item!.id)throw Error('角色关联、场景或查看权限已改变');});return {located:true};
  }
  if(m.type==='spawnMonster'){
   const settings=getState();if((await OBR.player.getRole())!=='GM'||!settings.enabled.bestiary||!await OBR.scene.isReady())throw Error('仅 DM 可在已加载的场景中添加怪物');
   const entry=m.entry,raw=entry?.raw;
   if(entry?.kind!=='monster'||typeof entry.id!=='string'||typeof entry.name!=='string'||!raw||Array.isArray(raw)||JSON.stringify(entry).length>500_000)throw Error('怪物资料无效');
   const sceneEpoch=observation.sceneEpoch(),assertCurrent=async()=>{if(sceneEpoch!==observation.sceneEpoch()||(await OBR.player.getRole())!=='GM'||!getState().enabled.bestiary||!await OBR.scene.isReady())throw Error('场景或添加怪物权限已改变');};
   const {parseMon,makeSlug}=await import('../modules/bestiary/data'),{spawnMonster}=await import('../modules/bestiary/spawn');
   const data={...raw,name:entry.name,ENG_name:entry.english||raw.ENG_name||entry.name,source:entry.source||raw.source||'CUSTOM',entries:entry.entries},monster=parseMon(data);if(!monster)throw Error('怪物资料无法解析');
   const [width,height,position,scale]=await Promise.all([OBR.viewport.getWidth(),OBR.viewport.getHeight(),OBR.viewport.getPosition(),OBR.viewport.getScale()]);
   await assertCurrent();await spawnMonster(monster,{x:(-position.x+width/2)/scale,y:(-position.y+height/2)/scale},{raw:data,slug:`wiki:${makeSlug(monster.source,monster.engName)}:${entry.id}`,assertCurrent});return {spawned:true};
  }
  if(m.type==='createCard'){
   if(!getState().enabled.characterCards)throw Error('角色卡模块已关闭');
   if(m.data?.schema_version!=='0.3'||m.data?.dnd_card_web?.schemaVersion!==1||typeof m.data.identity?.character_name!=='string'||JSON.stringify(m.data).length>3_000_000)throw Error('角色格式无效');
   const record=await relay.send({createCard:{room:(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_'),uploader:playerId,data:m.data}});
   if(typeof record.id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(record.id))throw Error('创建返回的角色身份无效');
   const entry={id:record.id,name:m.data.identity.character_name,owner_ids:[playerId],visibility:'public',locked:false};
   const room=await OBR.room.getMetadata();await OBR.room.setMetadata({[DIRECTORY]:[...(Array.isArray(room[DIRECTORY])?room[DIRECTORY] as any[]:[]).filter(c=>c.id!==entry.id),entry]});
   if(await OBR.scene.isReady()){const scene=await OBR.scene.getMetadata();await OBR.scene.setMetadata({[LIST]:[...(Array.isArray(scene[LIST])?scene[LIST] as any[]:[]).filter(c=>c.id!==entry.id),entry]});}
   cacheDocument(`${OBR.room.id}:card:${record.id}`,m.data);if(m.select!==false)chosen=`card:${record.id}`;
   await OBR.broadcast.sendMessage('com.obr-suite/cc-card-updated',{cardId:record.id},{destination:'ALL'});return {created:entry};
  }
  if(m.type==='rules')return {shared:await shared.write(m),sequence:++sequence};
  if(m.type==='diceRpc'){let target;if(m.itemId&&(['init','player.getSelection','scene.items.getItems'].includes(m.method)||m.method==='broadcast.sendMessage'&&m.args?.[0]==='com.obr-suite/dice-quick-roll'))target=await access(typeof m.key==='string'&&m.key.startsWith(`${OBR.room.id}:card:`)?`card:${m.key.slice(`${OBR.room.id}:card:`.length)}`:m.itemId);return diceRpc(String(m.method),Array.isArray(m.args)?m.args:[],target,access);}
  if(m.type==='console'){
   const role=(await observation.read()).role,enabled=getState().enabled as any,key=String(m.action);
   if(role!=='GM')throw Error('仅 DM 可使用控制台');if(!['settings','announcement','playerPermissions','portalEffects'].includes(key)&&!enabled[key])throw Error('该模块已关闭');
   if(key==='playerPermissions'){if(m.statusOnly)return {seen:hasReadPlayerPermissions()};if(WORKBENCH_DEV)return {navigate:'permissions'};await OBR.modal.open({id:PLAYER_PERMISSION_MODAL_ID,url:assetUrl('dm-announcement.html')+'?permissions=1',width:560,height:580});return;}
   if(key==='portalEffects'){if(!enabled.portals)throw Error('该模块已关闭');await setState({portalEffects:!!m.value});return {consolePatch:{portalEffects:!!m.value},sequence:++sequence};}
   if(key==='transitions'){
    if(!['short','long','text'].includes(m.kind)||m.kind==='text'&&!String(m.text||'').trim())throw Error('请选择转场内容');
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(Error('转场未响应'));},6000);const off=OBR.broadcast.onMessage(BC_TRANSITIONS_STATUS,event=>{const data=event.data as any;if(data?.requestId!==m.requestId)return;clearTimeout(timer);off();data.ok?resolve(data):reject(Error('转场未能启动'));});void OBR.broadcast.sendMessage(BC_TRANSITIONS_RUN,{kind:m.kind,text:String(m.text||'').slice(0,120),targets:'all',preview:!!m.preview,requestId:m.requestId,issuedAt:Date.now()},{destination:'LOCAL'}).catch(e=>{clearTimeout(timer);off();reject(e);});});
   }
   if(WORKBENCH_DEV&&key==='musicBoard')return {navigate:'music'};
   const channels:Record<string,string>={timeStop:'com.obr-suite/timestop-toggle',focus:'com.obr-suite/focus-trigger',musicBoard:'com.obr-suite/music-board:toggle',transitions:'com.obr-suite/transitions/open'};
   if(channels[key])await OBR.broadcast.sendMessage(channels[key],{source:'workbench'},{destination:'LOCAL'});
   else if(WORKBENCH_DEV&&['announcement','settings'].includes(key))return {navigate:key};
   else if(key==='announcement')await OBR.modal.open({id:ANNOUNCEMENT_MODAL_ID,url:assetUrl('dm-announcement.html'),width:560,height:580});
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
   const identity=targetReadIdentity(a),sceneEpoch=observation.sceneEpoch(),previous=await read(a);if(JSON.stringify(previous)!==JSON.stringify(m.expected))throw Error('怪物资料已经更新，请重新打开编辑');
   const index=a.item.metadata[MONSTER] as {key:string;revision:number}|undefined;
   const key=index?.key||`monster_${(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_')}_${a.item.id.replace(/[^a-zA-Z0-9_-]/g,'_')}`;
   const latest=await relay.send({sharedDocument:{key,operation:'read'}});if(index&&latest.revision!==index.revision&&JSON.stringify(latest.data)!==JSON.stringify(m.expected))throw Error('怪物资料已经更新，请重新打开编辑');
   const permission=await access(a.targetId);if(!permission.write||targetReadIdentity(permission)!==identity||sceneEpoch!==observation.sceneEpoch())throw Error('怪物关联或权限已改变');
   const saved=await relay.send({sharedDocument:{key,operation:'write',expected:latest.revision,data}},m._beforeMutation);
   if(index)m._committed={kind:'token',id:a.targetId};else m._partialCommitted={kind:'monster-document',key,revision:saved.revision};
   monsterOverrides.set(key,saved);cacheDocument(a.key,data);
   const verify=await access(a.targetId);if(!verify.write||targetReadIdentity(verify)!==identity||sceneEpoch!==observation.sceneEpoch())throw Error('怪物关联或权限已改变');
   await m._beforeMutation?.();await OBR.scene.items.updateItems([a.item.id],items=>{m._assertAuthority?.();for(const item of items){assertMonsterWrite(a,item);if(!sameValue(item.metadata[MONSTER],index))throw Error('怪物资料已改变');item.metadata[MONSTER]={key,revision:saved.revision};item.name=data.name;}});m._committed={kind:'token',id:a.targetId};delete m._partialCommitted;
   const stats:Record<string,number>={};if(data.hp?.average!==previous?.hp?.average&&Number.isFinite(data.hp?.average)){stats['max health']=Math.max(0,data.hp.average);stats.health=Math.min(bubble(a.item).health??data.hp.average,data.hp.average);}const ac=(raw:any)=>typeof raw?.ac?.[0]==='number'?raw.ac[0]:raw?.ac?.[0]?.ac;if(ac(data)!==ac(previous)&&Number.isFinite(ac(data)))stats['armor class']=ac(data);if(Object.keys(stats).length)await setTokens(a,{stats});
   return {snapshot:await snapshot(a.targetId)};
  }
  if(m.type==='assignName'){
   const name=String(m.name||'').trim().slice(0,160);if(!name)throw Error('名称不能为空');
   const targets=a.cardId?a.items.filter(i=>i.metadata[BIND]===a.cardId):a.item?[a.item]:[];
   await m._beforeMutation?.();await OBR.scene.items.updateItems(targets.filter(i=>i.type==='IMAGE'&&(a.role==='GM'||ownsNativeToken(i,playerId))).map(i=>i.id),drafts=>{m._assertAuthority?.();for(const item of drafts){if(observation.peek().role!=='GM'&&!ownsNativeToken(item,playerId)||a.cardId&&item.metadata[BIND]!==a.cardId)continue;const image=item as any;image.text={...image.text,type:image.text?.type||'PLAIN',plainText:String(image.text?.plainText||'').trim()===name?'':name};}});return;
  }
  if(m.type==='delete'){
   if(a.card?.qqRoom){
    await m._beforeMutation?.();await qqRequest('room-cards/'+a.card.qqRoom.id,'DELETE',{},a.card.qqRoom);
    const room=await OBR.room.getMetadata();await OBR.room.setMetadata({[QQ_CARDS]:(room[QQ_CARDS] as any[]).filter(c=>c.id!==a.cardId),...(Object.hasOwn(a.card,'qqRevisionOffset')?{[DELETED]:[...new Set([...(Array.isArray(room[DELETED])?room[DELETED] as string[]:[]),a.cardId])]}:{})});
    documents.delete(a.key);documentCacheVersion++;return {deleted:a.cardId};
   }
   if(!a.cardId)throw Error('没有角色卡');if(a.role!=='GM'&&a.items.some(item=>item.metadata[BIND]===a.cardId&&!ownsNativeToken(item,playerId)))throw Error('此卡还绑定其他所属玩家的棋子，仅 DM 可删除');const location=documentLocation(a.cardId);
   try{await relay.send({deleteCard:{room:location.room,card:location.card}},m._beforeMutation);}catch(error){const e=error as any;if(e?.notSent||e?.status&&e.status<500)throw error;throw Object.assign(Error('删除结果尚未确认；请先刷新目录并核对，勿重复提交'),{uncertain:true,status:e?.status,diagnostic:{code:'DELETE_RESULT_UNKNOWN',operation:'delete',phase:'delete-document'}});}
   // The durable delete (including idempotent storage 404) has completed.
   // Later SDK projection failures must never turn this receipt into zero writes.
   m._committed={kind:'delete',id:a.targetId};m._phase='delete-directory';
   documents.delete(a.key);documentCacheVersion++;invalidateCard(a.cardId);
   await m._beforeMutation?.();
   const room=await OBR.room.getMetadata(),deleted=Array.isArray(room[DELETED])?room[DELETED] as string[]:[];
   await m._beforeMutation?.();await OBR.room.setMetadata({[DELETED]:[...new Set([...deleted,a.cardId])],[DIRECTORY]:(room[DIRECTORY] as any[]||[]).filter(c=>c.id!==a.cardId),[ROOM_LIST]:(room[ROOM_LIST] as any[]||[]).filter(c=>c.id!==a.cardId)});
   const scene=await OBR.scene.getMetadata();m._assertAuthority?.();if(Array.isArray(scene[LIST]))await OBR.scene.setMetadata({[LIST]:(scene[LIST] as any[]).filter(c=>c.id!==a.cardId)});
   const ids=a.items.filter(i=>i.metadata[BIND]===a.cardId).map(i=>i.id);m._assertAuthority?.();if(ids.length)await OBR.scene.items.updateItems(ids,rows=>{m._assertAuthority?.();for(const row of rows)if(row.metadata[BIND]===a.cardId&&(observation.peek().role==='GM'||ownsNativeToken(row,playerId)))delete row.metadata[BIND];});
   documents.delete(a.key);documentCacheVersion++;if(chosen===`card:${a.cardId}`)chosen='';await OBR.broadcast.sendMessage('com.obr-suite/cc-card-updated',{cardId:a.cardId,deleted:true},{destination:'ALL'});return {deleted:true,cleanupPending:false};
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
   if(m.presentation!==undefined&&!a.cardId)throw Error('此目标没有角色展示布局');
   if(a.cardId&&(m.presentation!==undefined||m.resource===null))updateResourceWidgetPresentation(doc,id,m.resource===null?null:m.presentation);
   doc.web_resources=resources;if(native){native.runtime.resources=resources;for(const [key,r] of Object.entries(resources) as [string,any][]){if(key.startsWith('spell-slot:')&&native.spellSettings)native.spellSettings.slots[key.split(':')[1]]={max:r.max,used:r.max-r.current};}native.revision++;}
   for(const [key,r] of Object.entries(resources) as [string,any][]){if(key.startsWith('spell-slot:')&&doc.spellcasting?.spell_slots)doc.spellcasting.spell_slots[key.split(':')[1]]={max:r.max,used:r.max-r.current,current:r.current};}
   if(doc.core_stats?.hit_dice)doc.core_stats.hit_dice.current=Object.entries(resources).filter(([id])=>id.startsWith('hit-die:')).reduce((n,[,r]:any)=>n+r.current,0);
   if(a.cardId){await persistDocument(a,existing,doc,undefined,false,m._beforeMutation);m._committed={kind:'document',id:`card:${a.cardId}`};await resourceNotices(a,beforeResources,resources);}m._phase='sync-token';await setTokens(a,{resources:Object.entries(resources).map(([id,r]:[string,any])=>({...r,id}))},a.cardId?undefined:m._beforeMutation,a.cardId?undefined:m._assertAuthority);if(!a.cardId){m._committed={kind:'token',id:a.targetId};await resourceNotices(a,beforeResources,resources);}return {snapshot:await snapshot(a.targetId)};
  }
  if(m.type==='lock'&&a.card?.qqRoom){
    await m._beforeMutation?.();const result=await qqRequest('room-cards/'+a.card.qqRoom.id+'/lock','PUT',{locked:!!m.locked},a.card.qqRoom);
    const room=await OBR.room.getMetadata();await OBR.room.setMetadata({[QQ_CARDS]:(room[QQ_CARDS] as any[]).map(c=>c.id===a.cardId?{...c,locked:result.locked,visibility:result.locked?'owners':'public'}:c)});
    return {snapshot:await snapshot('card:'+a.cardId)};
  }
  if(m.type==='lock'){
   if(!a.cardId){if(!a.item)throw Error('没有怪物卡');await m._beforeMutation?.();await OBR.scene.items.updateItems([a.item.id],rows=>{m._assertAuthority?.();for(const row of rows){assertMonsterWrite(a,row);row.metadata['com.obr-suite/workbench/locked']=!!m.locked;}});return {snapshot:await snapshot(a.targetId)};}const locked=!!m.locked,update=(list:any[])=>list.map(c=>c.id===a.cardId?{...c,locked,visibility:locked?'owners':'public'}:c);
   const scene=await OBR.scene.getMetadata();await observation.refreshAuthority();m._assertAuthority?.();
   if(Array.isArray(scene[LIST])){await OBR.scene.setMetadata({[LIST]:update(scene[LIST] as any[])});m._committed={kind:'document',id:`card:${a.cardId}`};}
   const room=await OBR.room.getMetadata();await observation.refreshAuthority();m._assertAuthority?.();
   await OBR.room.setMetadata({...Array.isArray(room[DIRECTORY])?{[DIRECTORY]:update(room[DIRECTORY] as any[])}:{},...Array.isArray(room[ROOM_LIST])?{[ROOM_LIST]:update(room[ROOM_LIST] as any[])}:{}});return {snapshot:await snapshot(`card:${a.cardId}`)};
  }
  if(m.type==='statsLock'){if(a.role!=='GM')throw Error('仅 DM 可锁定生命条');await setTokens(a,{stats:{locked:!!m.locked}},m._beforeMutation,m._assertAuthority);return;}
  if(m.type==='stats'){
   const patch={...m.patch},current=a.card?.stats||bubble(a.item);if(!Object.keys(patch).length||Object.keys(patch).some(k=>!fields.includes(k)))throw Error('无效数值');
   assertCharacterArmorPatch(a.cardId,patch);
   for(const k of Object.keys(patch)){const value=typeof patch[k]==='string'?parseStatInput(patch[k],current[k]||0):patch[k];if(!Number.isInteger(value)||Math.abs(value)>99999)throw Error('无效数值');patch[k]=clampStat(k as any,value);}
   if(Object.keys(patch).some(k=>current[k]!==m.expected?.[k]))throw Error('场景数值已改变，请重试');
   const max=patch['max health']??current['max health'];if(typeof max==='number'&&('health' in patch||'max health' in patch))patch.health=Math.min(patch.health??current.health??0,max);
   if(a.cardId){const existing=await read(a),runtime=documentRuntime(existing,definitionsFor(a.scene)),doc=writeRuntime(existing,{...runtime,stats:{...runtime.stats,...patch}},definitionsFor(a.scene));m._phase='save-document';await persistDocument(a,existing,doc,undefined,false,m._beforeMutation);m._committed={kind:'document',id:`card:${a.cardId}`};}
   if(a.cardId)await statNotices(a,current,{...current,...patch});await setTokens(a,{stats:patch},a.cardId?undefined:m._beforeMutation,a.cardId?undefined:m._assertAuthority);if(!a.cardId){m._committed={kind:'token',id:a.targetId};await statNotices(a,current,{...current,...patch});}return {snapshot:await snapshot(a.cardId?`card:${a.cardId}`:m.itemId)};
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
  // Status definitions are projected only after the character commit below.
  const resources=Object.entries(native.runtime.resources||{}).filter(([,r])=>r&&typeof r==='object').map(([id,value]:[string,any])=>({id,name:value.name||id,type:value.type||'count',icon:value.icon||'circle',...value}));
  merged.web_resources=structuredClone(native.runtime.resources);
  m._phase='sync-inventory';
  if(!a.card?.qqRoom&&nativeInventoryChanged(m.previous||base,native,identify))await inventories.ensure([{id:`card:${a.cardId}`,name:a.card!.name,kind:'card',write:a.write,document:existing}],m._beforeMutation);
  const inventorySync=a.card?.qqRoom?{ledgerRevision:undefined,ledgerCommitted:false,container:undefined,projection:undefined}:await inventories.syncNative(`card:${a.cardId}`,m.previous||base,native,identify,m._beforeMutation);m._inventoryCommitted=inventorySync.ledgerCommitted===true;
  m._phase='save-document';await persistDocument(a,existing,merged,inventorySync.ledgerRevision===undefined?undefined:{key:inventories.key,revision:inventorySync.ledgerRevision},false,m._beforeMutation);m._committed={kind:'document',id:`card:${a.cardId}`};
  if(conditionsChanged)publishStatusDefinitions(additions);
  if(resourcesChanged)await resourceNotices(a,base.runtime?.resources||{},native.runtime.resources||{});
  await resourceNotices(a,nativeStockNotices(base),nativeStockNotices(native));
  await spellPreparationNotices(a,base,native);
  await statNotices(a,currentStats,documentRuntime(merged,definitionsFor(a.scene)).stats);
  await conditionNotices(a,base,native);
  if(native.name!==a.card?.name){const rename=(list:any[])=>list.map(c=>c.id===a.cardId?{...c,name:native.name}:c);if(Array.isArray(a.scene[LIST]))await OBR.scene.setMetadata({[LIST]:rename(a.scene[LIST] as any[])});const room=await OBR.room.getMetadata();const field=a.card?.qqRoom?QQ_CARDS:DIRECTORY;if(Array.isArray(room[field]))await OBR.room.setMetadata({[field]:rename(room[field] as any[])});}
  m._phase='sync-token';await setTokens(a,{stats:m.statPatch,conditions:conditionsChanged?conditions:undefined,resources:resourcesChanged?resources:undefined});
  if(inventorySync.container&&inventorySync.projection&&inventoryReflected(native,inventorySync.container,inventorySync.projection,identify))void inventories.projected(`card:${a.cardId}`,inventorySync.projection.revision).catch(error=>console.warn('[workbench] inventory receipt pending',error));
  if(conditionsChanged)void OBR.broadcast.sendMessage('com.obr-suite/status/catalog-changed',{},{destination:'ALL'}).catch(error=>console.warn('[workbench] status invalidation pending',error));
  return {snapshot:await snapshot(`card:${a.cardId}`)};
 }
 async function receive(m:any,viaRelay=false){if(m.protocol!==protocol||m.session!==session)return;const route=viaRelay?'relay':'direct';
  if(m.type==='cardChanged'){if(typeof m.cardId==='string'&&invalidateCard(m.cardId,m.revision)){void hydrate(m.cardId);void refreshSelection();void refresh();}return;}
  if(m.type==='startup'){workbenchStartup.update(m.clientInstance,m.startupPhase);return;}
  if(m.type==='hello'){workbenchStartup.hello(typeof m.clientInstance==='string'?m.clientInstance:'legacy',m.startupPhase,viaRelay?undefined:child||undefined,m.clientStarted);last='';lastCatalog='';lastDirectory='';lastAccessEpoch=0;const instance=typeof m.clientInstance==='string'?m.clientInstance:'legacy';if(instance!==warmClientInstance){warmClientInstance=instance;warmSnapshots.clear();}send('ready',{qqAccount:publicQQ(),rolls:getRollHistory(),groupRoll:groups.snapshot(),groupRevision:groups.revision()},route);if(viaRelay&&child&&!child.closed)send('ready',{qqAccount:publicQQ(),rolls:getRollHistory(),groupRoll:groups.snapshot(),groupRevision:groups.revision()},'direct');if(!viaRelay)void OBR.action.close().catch(()=>{});void refreshSelection();void refresh();void hydrate();return;}
  if(m.type==='ping'){workbenchStartup.update(m.clientInstance,m.startupPhase);send('pong',{at:Date.now()},route);return;}
  if(m.type==='requestStatus'){const answer=seen.get(m.requestId);if(answer)send('ack',{requestId:m.requestId,...answer},route);else send('requestPending',{requestId:m.requestId,active:activeRequests.has(m.requestId),known:requestRuns.has(m.requestId)},route);return;}
  if(m.type==='cancel'){if(!seen.has(m.requestId))cancelledRequests.add(m.requestId);return;}
  if(m.type==='pin'){follow=!m.pinned;if(!follow){finishMapFollow(false);if(typeof m.itemId==='string'&&m.itemId.length<=200){chosen=m.itemId;selectionGeneration++;last='';}}if(follow)lastSelection='';void refreshSelection();return;}
  if(m.type==='select'){if(Number.isSafeInteger(m.clientSelection)){const instance=typeof m.clientInstance==='string'?m.clientInstance:'legacy';if(m.clientSelection<(selectionIntents.get(instance)||0))return;selectionIntents.delete(instance);selectionIntents.set(instance,m.clientSelection);while(selectionIntents.size>8)selectionIntents.delete(selectionIntents.keys().next().value!);clientInstance=instance==='legacy'?'':instance;clientSelection=m.clientSelection;}const generation=++selectionGeneration;finishMapFollow(false);let issuedAccess:ReturnType<typeof cacheAccess>|undefined;const readScene=observation.sceneEpoch();try{const list=await catalog();issuedAccess=publishAccess(list);const a=await access(m.itemId,list);if(generation!==selectionGeneration)return;chosen=a.targetId;const observed=await observation.read();lastSelection=selectionIdentity(observed.selection,observed.items);last='';void refreshSelection();}catch(e){if(generation===selectionGeneration&&readScene===observation.sceneEpoch())selectionFailure(m.itemId,e,issuedAccess);}return;}
  if(!['locate','spawnMonster','groupRoll','assignOwners','readCard','refreshCard','refreshCatalog','showEntry','stats','statsLock','save','roll','lock','console','diceRpc','delete','resource','rules','assignName','createCard','panelRpc','cloudInfo','cloudEditors','cloudUpload','monsterSave','inventory','condition'].includes(m.type)||typeof m.requestId!=='string'||m.requestId.length>100)return;
  if(requestRuns.has(m.requestId))return;
  delete m._committed;delete m._partialCommitted;delete m._inventoryCommitted;delete m._beforeMutation;delete m._assertAuthority;
  const targetMutation=['save','stats','statsLock','resource','delete','assignName','lock','cloudEditors','cloudUpload','monsterSave','condition','inventory'].includes(m.type);
  const commandTargets=[...new Set((m.type==='inventory'?[m.operation?.container,m.operation?.from,m.operation?.to,...(m.operation?.action==='history'?stockHistory.get(m.operation.reference)?.changes.map(change=>change.id)||[]:[])]:m.type==='condition'?changeCondition.targets(m):[typeof m.key==='string'&&m.key.startsWith(`${OBR.room.id}:card:`)?`card:${m.key.slice(`${OBR.room.id}:card:`.length)}`:m.itemId]).filter((id):id is string=>typeof id==='string'&&!id.startsWith('public:')))];
  const receivedAuthority=commandTargets.map(id=>observation.authorityVersion(id)),receivedScene=observation.sceneEpoch(),receivedRole=observation.peek().role;
  const grantFor=(access:any,id:string)=>access.cards.find((card:any)=>id===`card:${card.id}`||card.itemIds.includes(id))||access.monsters.find((item:any)=>id===item.itemId||id===item.targetId);
  const grantIdentity=(grant:any)=>JSON.stringify(grant?{write:grant.write,locked:grant.locked,grantVersion:grant.grantVersion}:null);
  const assertAuthority=()=>{if(cancelledRequests.has(m.requestId)||typeof m.expiresAt==='number'&&Date.now()>m.expiresAt)throw Object.assign(Error('操作在发送前已取消或过期'),{status:403});if(targetMutation&&(receivedScene!==observation.sceneEpoch()||receivedRole!==observation.peek().role||commandTargets.some((id,index)=>receivedAuthority[index]!==observation.authorityVersion(id))))throw Object.assign(Error('角色修改权限已改变'),{status:403});};
  const beforeMutation=async()=>{if(!targetMutation)return;await observation.refreshAuthority();assertAuthority();const current=publishAccess(await catalog()),issued=accessHistory.get(m.accessEpoch);if(receivedScene!==observation.sceneEpoch()||receivedRole!==current.role||commandTargets.some((id,index)=>receivedAuthority[index]!==observation.authorityVersion(id))||Number.isSafeInteger(m.accessEpoch)&&(!issued||m.accessScope!==current.scope||m.accessRoom!==current.room||issued.role!==current.role||JSON.stringify(issued.enabled)!==JSON.stringify(current.enabled)||commandTargets.some(id=>grantIdentity(grantFor(issued,id))!==grantIdentity(grantFor(current,id)))))throw Object.assign(Error('角色修改权限已改变，请重新确认当前角色'),{status:403});};
  Object.assign(beforeMutation,{assertCurrent:assertAuthority});
  const receivedAt=performance.now();
  const run=async()=>{let answer=seen.get(m.requestId);if(!answer){const began=performance.now(),steps:{phase:string;ms:number}[]=[];let phase='authorize',phaseStart=began;
   Object.defineProperty(m,'_phase',{configurable:true,get:()=>phase,set:(next:string)=>{const now=performance.now();steps.push({phase,ms:Math.round((now-phaseStart)*10)/10});phase=next;phaseStart=now;}});
   const writes=!['locate','readCard','refreshCard','refreshCatalog','diceRpc','roll','panelRpc','cloudInfo','showEntry'].includes(m.type);if(writes){mutation++;epoch++;}try{
   if(cancelledRequests.delete(m.requestId)||typeof m.expiresAt==='number'&&Date.now()>m.expiresAt)throw Error('操作在执行前已取消或过期；未修改数据');
   await beforeMutation();Object.defineProperty(m,'_beforeMutation',{value:beforeMutation,configurable:true});Object.defineProperty(m,'_assertAuthority',{value:assertAuthority,configurable:true});
   activeRequests.add(m.requestId);send('requestPending',{requestId:m.requestId,active:true},route);m._phase='authorize';answer={ok:true,result:await command(m)};
  }catch(error){const e=error as any;answer={ok:false,uncertain:!!e?.uncertain,message:e?.message||String(error),diagnostic:{version:devManifest.version,at:new Date().toISOString(),requestId:m.requestId,requestType:m.type,phase:m._phase,httpStatus:e?.status,...e?.diagnostic,stack:typeof e?.stack==='string'?e.stack.split('\n').slice(0,6).join('\n'):undefined}};
   if(['delete','readCard','refreshCard','refreshCatalog'].includes(m.type))answer.diagnostic={code:e?.diagnostic?.code||'REQUEST_FAILED',operation:m.type,phase:m._phase,status:Number.isInteger(e?.status)?e.status:0,httpStatus:Number.isInteger(e?.status)?e.status:0,version:devManifest.version,at:new Date().toISOString(),requestId:m.requestId,uncertain:!!e?.uncertain,notSent:!!e?.notSent,connection:route};
   if(m._partialCommitted){answer.uncertain=true;answer.message='怪物资料已写入，但棋子关联未确认；请重新读取后核对，勿重复提交。';answer.diagnostic={...answer.diagnostic,code:'MONSTER_DOCUMENT_LINK_PENDING',committed:m._partialCommitted};}
   if(m._committed?.kind==='delete'){answer={ok:true,result:{deleted:true,cleanupPending:true,warning:'角色资料已删除；目录或棋子关联清理尚未完成，请刷新目录核对。',diagnostic:{code:'DELETE_CLEANUP_PENDING',operation:'delete',phase:m._phase,at:new Date().toISOString(),version:devManifest.version,requestId:m.requestId,committed:true}}};}
   else if(m._committed){
    // A committed document/ledger cannot become a failed mutation merely because
    // a renderer, notification, or refresh timed out. Retry projections only.
    const diagnostic={...answer.diagnostic,code:'COMMITTED_PROJECTION_PENDING',committed:true};
    const result:any={warning:'资料已保存；场景显示或播报暂未完成。此次修改不会重复执行。',diagnostic};
    try{if(m._committed.kind==='document'||m._committed.kind==='token')result.snapshot=await snapshot(m._committed.id);else{const context=await inventoryContext();result.historyId=m._committed.historyId;result.inventory=await inventories.view(context.definitions,context.gm,context.publicId);result.sequence=++sequence;}}catch{}
    answer={ok:true,result};void hydrate();scheduleInventoryRepair();
   }else if(m._inventoryCommitted){answer.uncertain=true;answer.diagnostic={...answer.diagnostic,code:'PARTIAL_INVENTORY_COMMIT',inventoryCommitted:true};}
  }finally{activeRequests.delete(m.requestId);if(writes){mutation--;epoch++;}}steps.push({phase,ms:Math.round((performance.now()-phaseStart)*10)/10});answer.timing={transport:route,version:devManifest.version,queueMs:Math.round(began-receivedAt),hostMs:Math.round(performance.now()-began),steps};seen.set(m.requestId,answer);if(seen.size>256)seen.delete(seen.keys().next().value!);}send('ack',{requestId:m.requestId,...answer},route);if(!['locate','readCard','refreshCard','refreshCatalog','diceRpc','roll','panelRpc','cloudInfo','showEntry'].includes(m.type)){void refreshSelection();void refresh();}};
  const task=m.type==='groupRoll'?(groupQueue=groupQueue.then(run).catch(()=>{})):['locate','readCard','refreshCard','refreshCatalog','diceRpc','roll','panelRpc','console','cloudInfo','showEntry'].includes(m.type)||m.type==='inventory'&&['silent','containerLock'].includes(m.operation?.action)?run():(queue=queue.then(run).catch(()=>{}));requestRuns.set(m.requestId,task);void task.finally(()=>{requestRuns.delete(m.requestId);cancelledRequests.delete(m.requestId);});
 }
 window.addEventListener('message',e=>{if(e.origin!==origin||e.data?.protocol!==protocol||!e.source)return;
  if(e.data.type==='discover'){try{const source=e.source as Window;if(source!==window&&source.parent===parent)source.postMessage({protocol,type:'background',nonce:e.data.nonce,session,clientKey:credentials.clientKey},origin);}catch{}return;}
  if(e.data.session!==session)return;
  // Reloading the host keeps the browser's WindowProxy alive. The existing
  // workbench still knows it, so its next ping restores the direct bridge
  // without waiting for a stale-window timeout or relying on the old plugin.
  if(e.data.type==='ping'&&(!child||child.closed)){child=e.source as Window;workbenchStartup.hello(typeof e.data.clientInstance==='string'?e.data.clientInstance:'legacy',e.data.startupPhase,child,e.data.clientStarted);last='';lastCatalog='';void refreshSelection();void refresh();void hydrate();}
  if(e.data.type==='hello'){if(child&&!child.closed&&child!==e.source)return;child=e.source as Window;}if(e.source===child){directPeerSeen=Date.now();directClientInstance=typeof e.data.clientInstance==='string'?e.data.clientInstance:'legacy';void receive(e.data);}
 });
 for(const name of DICE_EVENTS)OBR.broadcast.onMessage(name,event=>{if(name==='com.obr-suite/dice-roll'&&!canForwardDiceHistory(event))return;send('diceEvent',{event:name,data:event});});
 OBR.player.onChange(player=>send('diceEvent',{event:'player',data:player}));
 let changeScheduled=false;
 const changed=()=>{if(changeScheduled)return;changeScheduled=true;queueMicrotask(()=>{changeScheduled=false;void refreshSelection();void refresh();void hydrate();for(const id of warmCards)if(!id.startsWith('card:'))void pushWarmSnapshot(id);});};
 observation.onChange(change=>{if(change==='selection')void refreshSelection();else changed();});OBR.scene.onReadyChange(()=>{followRevision++;finishMapFollow(false);chosen='';selectionGeneration++;lastSelection='';previousSceneCards=[];invalidateCards();changed();});
 OBR.broadcast.onMessage('com.obr-suite/cc-card-updated',event=>{const data=event.data as any,id=data?.cardId;if(id){if(!invalidateCard(id,data?.revision))return;void hydrate(id);}else{invalidateCards();void hydrate();}changed();});OBR.broadcast.onMessage('com.obr-suite/workbench/inventory-changed',event=>{if(event.connectionId!==playerConnection)inventories.invalidate();changed();});window.addEventListener('qq-account-changed',changed);onStateChange(changed);rollListeners.add(()=>send('rolls',{rolls:getRollHistory()}));
 const connection=await OBR.player.getConnectionId();OBR.broadcast.onMessage('com.obr-suite/workbench-compose',event=>{if(event.connectionId===connection&&typeof(event.data as any)?.expression==='string')send('compose',{compose:{...(event.data as object),id:crypto.randomUUID()}});});
 // Reuse the transport heartbeat to inspect an actual closed WindowProxy.
 // A navigation keeps that proxy alive and must keep pending notices blocked.
 setInterval(()=>{workbenchStartup.releaseClosedWindow();send('pong',{at:Date.now()});},10000);
 // Recover missed SDK ownership events without requiring a DM card switch.
 setInterval(()=>{if(child&&!child.closed||relayActive&&Date.now()-relayPeerSeen<45000)void observation.refreshAuthority().catch(()=>{});},4000);
 setInterval(()=>{changed();scheduleInventoryRepair();},4000);
}
