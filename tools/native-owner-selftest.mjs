// Production policies/controllers executed in a Node VM with a synthetic SDK boundary.
// No browser, live Owlbear room, HTTP service or player data is used.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(path.join(root,p),'utf8');
const checks=[];
async function check(name,run){await run();checks.push({name,passed:true});console.log('PASS '+name);}
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function declaration(file,name){const source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);let found;const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node.getText(source);ts.forEachChild(node,visit);};visit(source);assert.ok(found,`${file}:${name}`);return found.replace(/^export /,'');}
function scope(source,bindings={}){const context=vm.createContext({console,structuredClone,Map,Set,Promise,...bindings});vm.runInContext(compile(source),context);return context;}
const policy=read('src/modules/characterCards/native-owner.ts').replaceAll('export ','');
const rules=scope(policy);const BIND='com.character-cards/boundCardId',LIST='com.character-cards/list',ROOM_LIST='com.character-cards/list-room',DIRECTORY='com.obr-suite/workbench/cards',HP='com.obr-suite/bubbles/data',LEGACY='com.owlbear-rodeo-bubbles/data',RES='com.obr-suite/resources/data',RUNTIME_BASELINE='baseline';
const token=(owner='me',id='one',locked=true)=>({id,type:'IMAGE',createdUserId:owner,locked,name:id,metadata:{[BIND]:'hero',[HP]:{locked:true,health:20,'max health':30}}});
for(const visibility of [undefined,'public','owners','dm','unknown'])for(const locked of [undefined,false,true])for(const nativeLocked of [false,true]){
 const item=token('me','one',nativeLocked),entry={id:'hero',visibility,locked,owner_ids:['stale']};
 assert.equal(rules.canReadNativePopup(item,'hero',entry,'me',false,true),true);
 assert.equal(rules.canReadNativeCard(entry,['me'],'me',false),true);
 assert.equal(rules.canReadNativeCard(entry,[],'gm',true),true);
}
await check('native owner and GM read every lock state; native item.locked is not a card visibility lock',()=>{});
await check('nonowner visibility is separate from writes; no-owner popup never opens',()=>{
 for(const locked of [true,false]){assert.equal(rules.canReadNativePopup(token('other'),'hero',{locked,visibility:'public',owner_ids:['me']},'me',false,false),!locked);assert.equal(rules.canReadNativePopup(token(''),'hero',{locked:false,visibility:'public'},'me',false,false),false);}
 assert.equal(rules.canReadNativePopup(token('other'),'hero',{visibility:'owners',owner_ids:['me']},'me',false,false),false);
 assert.equal(rules.canReadNativeCard({locked:true,owner_ids:['me']},[],'me',false),false);
 assert.equal(rules.ownsNativeToken(token(''),''),false);
});
// Exercise actual host catalog/access/command, without copying their logic into a test substitute.
let version=0,writes=[],world,readHook;
const sdk={room:{id:'room',setMetadata:async()=>{}},scene:{items:{updateItems:async(ids,apply)=>{const drafts=structuredClone(world.items.filter(i=>ids.includes(i.id)));apply(drafts);writes.push(...drafts);for(const d of drafts)world.items[world.items.findIndex(i=>i.id===d.id)]=d;}}}};
const RUNTIME_PROJECTION_AUTHORITY='_suiteRuntimeProjectionAuthority';
const hostSource=policy+'\n'+['runtimeProjectionRights','stampRuntimeProjectionAuthority'].map(n=>declaration('src/workbench/runtime-authority.ts',n)).join('\n')+'\n'+['hasMonsterComponent','targetReadIdentity','inventoryContext','catalog','access','cacheAccess','command','writeRuntimeProjection'].map(n=>declaration('src/workbench/background.ts',n)).join('\n');
const QQ_CARDS='com.obr-suite/qq-cards';let qqAccount;
const host=scope(hostSource,{QQ_CARDS,qqSession:()=>qqAccount?{accountId:qqAccount}:undefined,WORKBENCH_DEV:true,shared:{read:async()=>({key:'synthetic-profile'})},inventories:{read:async()=>({data:{containers:{'card:cloud':{items:[]}}}})},OBR:sdk,BIND,LIST,ROOM_LIST,DIRECTORY,HP,LEGACY,RES,RUNTIME_BASELINE,SLUG:'slug',DELETED:'deleted',MONSTER:'monster',fields:['health','max health','temporary health','armor class'],STATUS_BUFFS_KEY:'buffs',SHARED_BUFFS:'shared-buffs',playerId:'me',origin:'https://example.test',accessHistory:new Map(),observation:{authorityVersion:()=>0,refreshAuthority:async()=>world,read:async()=>world,peek:()=>world,version:()=>version,sceneEpoch:()=>1},documentCacheVersion:0,catalogCache:undefined,documents:new Map(),cardLocations:new Map(),directoryWrite:true,previousSceneCards:[],getState:()=>({enabled:{},allowPlayerMonsters:false}),sameValue:(a,b)=>JSON.stringify(a)===JSON.stringify(b),conditionRows:()=>[],documentRevision:d=>d?._suiteRevision||0,bubble:i=>i?.metadata[HP]||{},documentRuntime:d=>d.runtime,tokenRuntime:(m,value)=>m.runtime||value,definitionsFor:()=>[],read:async a=>readHook?readHook(a):({}),accessEpoch:0,accessSignature:'',role:'PLAYER'});
function reset({role='PLAYER',owner='me',locked=true,visibility='owners',items}={}){writes=[];version++;host.catalogCache=undefined;world={ready:true,role,player:{id:'me',name:'Me',role},party:[],items:items||[token(owner)],scene:{[LIST]:[{id:'hero',name:'Hero',owner_ids:['stale'],visibility,locked}]},room:{[DIRECTORY]:[{id:'hero',name:'Hero',owner_ids:['stale'],visibility,locked}],'com.obr-suite/workbench/card-editors':{hero:['stale']}}};}
await check('host ignores stale editor/importer grants; native owner sees locked card and keeps existing write right',async()=>{reset();let data=await host.catalog();assert.equal(data.cards.length,1);assert.equal(data.cards[0].write,true);assert.deepEqual([...data.cards[0].owner_ids],['me']);world.room['com.obr-suite/workbench/card-editors']={hero:[]};version++;assert.equal((await host.catalog()).cards[0].write,true);});
await check('locked nonowner and no-owner cards are absent even with matching legacy assignment',async()=>{for(const owner of ['other','']){reset({owner});world.room['com.obr-suite/workbench/card-editors']={hero:['me']};world.scene[LIST][0].owner_ids=['me'];assert.equal((await host.catalog()).cards.length,0);await assert.rejects(()=>host.access('card:hero'));}});
await check('no current scene token never revives historical grants; public off-scene cards remain readonly',async()=>{reset({items:[]});assert.equal((await host.catalog()).cards.length,0);reset({items:[],locked:false,visibility:'public'});assert.equal((await host.access('card:hero')).write,false);});
await check('unlocked nonowner read succeeds; host rejects HP, resource, delete and full-card writes',async()=>{reset({owner:'other',locked:false,visibility:'public'});assert.equal((await host.access('card:hero')).write,false);assert.ok(await host.command({type:'readCard',itemId:'card:hero'}));for(const type of ['stats','resource','delete','save'])await assert.rejects(()=>host.command({type,itemId:'card:hero',key:'room:card:hero'}),/权限/);assert.equal(writes.length,0);});
await check('QQ room grants use the logged-in cloud owner and unlock members independently of native token ownership',async()=>{
 reset({items:[]});world.room[QQ_CARDS]=[{id:'cloud',name:'Cloud',qqRoom:{id:'grant',capability:'synthetic'},qqOwner:'account-owner',locked:true,owner_ids:['foreign']}];qqAccount='account-owner';
 let cloud=(await host.catalog()).cards.find(card=>card.id==='cloud');assert.ok(cloud);assert.equal(cloud.own,true);assert.equal(cloud.write,true);
 qqAccount='another-account';assert.equal((await host.catalog()).cards.some(card=>card.id==='cloud'),false);
 world.room[QQ_CARDS][0].locked=false;version++;cloud=(await host.catalog()).cards.find(card=>card.id==='cloud');assert.ok(cloud);assert.equal(cloud.own,false);assert.equal(cloud.write,true);
 assert.equal((await host.access('card:cloud')).write,true);qqAccount=undefined;world.room[QQ_CARDS][0].locked=true;version++;assert.equal((await host.catalog()).cards.some(card=>card.id==='cloud'),false);
});
await check('QQ original-card backpacks never enter the legacy inventory projection ledger',async()=>{
 reset({items:[]});world.room[QQ_CARDS]=[{id:'cloud',name:'Cloud',qqRoom:{id:'grant',capability:'synthetic'},qqOwner:'account-owner',locked:false}];qqAccount='account-owner';
 const context=await host.inventoryContext();assert.equal(context.definitions.some(def=>def.id==='card:cloud'),false);assert.equal(context.authority.write.has('card:cloud'),false);qqAccount=undefined;
});
await check('permission guide console is GM-only and independent of disabled music module',async()=>{
 const opened=[];sdk.modal={open:async options=>opened.push(options)};host.hasReadPlayerPermissions=()=>true;host.PLAYER_PERMISSION_MODAL_ID='permissions-test';host.assetUrl=name=>'/suite-dev/'+name;
 reset({role:'GM'});assert.equal((await host.command({type:'console',action:'playerPermissions',statusOnly:true})).seen,true);assert.equal(opened.length,0);assert.equal((await host.command({type:'console',action:'playerPermissions'})).navigate,'permissions');assert.equal(opened.length,0);
 reset({role:'PLAYER'});await assert.rejects(()=>host.command({type:'console',action:'playerPermissions',statusOnly:true}),/仅 DM/);await assert.rejects(()=>host.command({type:'console',action:'playerPermissions'}),/仅 DM/);assert.equal(opened.length,0);
});
await check('retired assignment request rejects for both player and GM without changing OWNER',async()=>{for(const role of ['PLAYER','GM']){reset({role});await assert.rejects(()=>host.command({type:'assignOwners',itemId:'card:hero',ownerIds:['other']}),/Set Owner/);assert.equal(world.items[0].createdUserId,'me');assert.equal(writes.length,0);}});
await check('owner transfer revokes cached access immediately; slow read rechecks before returning data',async()=>{reset();readHook=async()=>{world.items[0].createdUserId='other';version++;return {secret:true};};await assert.rejects(()=>host.command({type:'readCard',itemId:'card:hero'}),/权限/);readHook=undefined;assert.equal((await host.catalog()).cards.length,0);});
await check('multi-bound card name writes touch only the native owned token, not another player token',async()=>{reset({items:[token('other','foreign'),token('me','own')]});assert.equal((await host.access('card:hero')).item.id,'own');await host.command({type:'assignName',itemId:'card:hero',key:'room:card:hero',name:'New Name'});assert.deepEqual(writes.map(i=>i.id),['own']);assert.equal(world.items[0].text,undefined);});
await check('card tab targets the native owned binding regardless of item order and becomes readonly after transfer',async()=>{
 reset({locked:false,visibility:'public',items:[token('other','foreign'),token('me','own')]});
 world.items[1].metadata[HP].health=12;
 let row=(await host.catalog()).cards[0];
 assert.equal(row.itemId,'own');assert.equal(row.stats.health,12);
 assert.equal((await host.access(row.itemId)).write,true);
 world.items[1].createdUserId='other';version++;
 row=(await host.catalog()).cards[0];
 assert.equal(row.itemId,'foreign');assert.equal(row.write,false);
 assert.equal((await host.access(row.itemId)).write,false);
 assert.equal(writes.length,0);
});
await check('explicit foreign token access is readonly; shared-card delete cannot remove another owner token',async()=>{reset({items:[token('other','foreign'),token('me','own')]});assert.equal((await host.access('foreign')).write,false);assert.equal((await host.access('own')).write,true);await assert.rejects(()=>host.command({type:'delete',itemId:'card:hero'}),/仅 DM/);assert.equal(writes.length,0);});
host.RUNTIME_PROJECTION_AUTHORITY=RUNTIME_PROJECTION_AUTHORITY;
await check('runtime projection excludes foreign tokens and rechecks owner inside SDK update callback',async()=>{reset({items:[token('me','own'),token('other','foreign')]});const doc={_suiteRevision:2,runtime:{stats:{health:19},resources:{},conditions:[]}};await host.writeRuntimeProjection('hero',doc,world.items,[]);assert.deepEqual(writes.map(i=>i.id),['own']);writes=[];const update=sdk.scene.items.updateItems;sdk.scene.items.updateItems=async(ids,apply)=>{world.items[0].createdUserId='other';return update(ids,apply);};const before=JSON.stringify(world.items);await host.writeRuntimeProjection('hero',{...doc,_suiteRevision:3},world.items,[]);assert.equal(world.items[0].metadata[RUNTIME_BASELINE].revision,2);sdk.scene.items.updateItems=update;});
await check('GM peer cannot broaden player stats or resources projection to another owner',async()=>{
 reset({role:'GM',items:[token('me','own'),token('other','foreign')]});
 const before={runtime:{stats:{health:20,'max health':30},resources:{points:{id:'points',current:3}},conditions:[]}},doc=structuredClone(before);
 doc._suiteRevision=5;doc.runtime.stats.health=19;doc.runtime.resources.points.current=2;
 host.stampRuntimeProjectionAuthority(before,doc,'me',false,false,[]);
 for(const item of world.items){item.metadata.runtime=structuredClone(before.runtime);item.metadata[RES]=Object.values(before.runtime.resources);}
 await host.writeRuntimeProjection('hero',doc,world.items,[]);
 assert.equal(world.items[0].metadata[HP].health,19);assert.equal(world.items[0].metadata[RES][0].current,2);
 assert.equal(world.items[1].metadata[HP].health,20);assert.equal(world.items[1].metadata[RES][0].current,3);
 assert.equal(world.items[1].metadata[RUNTIME_BASELINE].value.stats.health,20);
 // A fresh GM peer/refreshed browser sees the persisted scope, not a local grant.
 writes=[];const reopened=JSON.parse(JSON.stringify(doc));await host.writeRuntimeProjection('hero',reopened,world.items,[]);
 assert.equal(world.items[1].metadata[HP].health,20);
 const displayEdit=structuredClone(doc);displayEdit.name='Changed';displayEdit[RUNTIME_PROJECTION_AUTHORITY]={version:1,stats:{playerId:'attacker',allBindings:true}};
 host.stampRuntimeProjectionAuthority(doc,displayEdit,'gm',true,false,[]);
 assert.deepEqual(displayEdit[RUNTIME_PROJECTION_AUTHORITY],doc[RUNTIME_PROJECTION_AUTHORITY]);
 const gmEdit=structuredClone(doc);gmEdit.runtime.stats.health=18;
 host.stampRuntimeProjectionAuthority(doc,gmEdit,'gm',true,false,[]);await host.writeRuntimeProjection('hero',gmEdit,world.items,[]);
 assert.equal(world.items[1].metadata[HP].health,18);assert.equal(world.items[1].metadata[RES][0].current,3);
});
await check('explicit public condition grant does not authorize foreign HP/resource projection',()=>{
 const before={runtime:{stats:{health:20},resources:{},conditions:[]}},next=structuredClone(before);
 next.runtime.stats.health=19;next.runtime.conditions=['restrained'];host.stampRuntimeProjectionAuthority(before,next,'me',false,true,[]);
 assert.deepEqual(JSON.parse(JSON.stringify(host.runtimeProjectionRights(next,{createdUserId:'other'}))),{stats:false,resources:true,conditions:true});
 for(const invalid of [null,{version:2},{version:1,stats:null},{version:1,stats:{allBindings:true}}])assert.equal(host.runtimeProjectionRights({[RUNTIME_PROJECTION_AUTHORITY]:invalid},{createdUserId:'other'}).stats,false);
});
// Actual old-popup gate and viewer context use the same policy, not metadata owner lists.
const pop=scope(policy+'\n'+declaration('src/modules/characterCards/index.ts','mayShow'),{cards:new Map(),ccRole:'PLAYER',ccMyId:'me',BIND_META:BIND,BUBBLES_META_KEY:HP,EXTERNAL_BUBBLES_META_KEY:LEGACY});
await check('actual popup selection gate honors native OWNER over mismatched metadata owner_ids',()=>{pop.cards.set('hero',{id:'hero',visibility:'owners',locked:true,owner_ids:['other']});assert.equal(pop.mayShow(token(),'hero'),true);assert.equal(pop.mayShow(token('other'),'hero'),false);});
const info=scope(policy+'\n'+['canNameItem','targetContext'].map(n=>declaration('src/modules/characterCards/info-page.ts',n)).join('\n'),{OBR:{scene:{getMetadata:async()=>world.scene,items:{getItems:async()=>world.items}}},cachedIsGM:false,playerId:'me',renderedTarget:{cardId:'hero',itemId:'one'},readBuffIds:()=>[],BUBBLES_META_KEY:HP,EXTERNAL_BUBBLES_META_KEY:LEGACY});
await check('actual viewer allows native-owner locked view and denies nonowner name/buff write capability',async()=>{reset();const own={cardId:'hero',itemId:'one'};assert.equal((await info.targetContext(own)).allowed,true);assert.equal(own.canName,true);reset({owner:'other',locked:false,visibility:'public'});world.items[0].metadata[HP].locked=false;const other={cardId:'hero',itemId:'one'};assert.equal((await info.targetContext(other)).allowed,true);assert.equal(other.canName,false);assert.equal(info.canNameItem(world.items[0]),false);});
const listeners={},on=k=>fn=>{listeners[k]=fn;return()=>{};};
const guard=scope(declaration('src/modules/resourceTracker/interaction.ts','createInteractionGuard'),{window:{addEventListener(){},removeEventListener(){}},OBR:{player:{onChange:on('player'),getRole:async()=>'PLAYER'},scene:{onReadyChange:on('ready'),isReady:async()=>true}}});
await check('shared editor read lease cannot become a write lease; in-flight draft owner transfer invalidates write',async()=>{let writable=false;const g=guard.createInteractionGuard(()=>'one',()=>true,()=>{},item=>writable&&(!item||item.createdUserId==='me'));await Promise.resolve();await Promise.resolve();assert.ok(g.capture(false,false));assert.equal(g.capture(),null);writable=true;const lease=g.capture();assert.ok(lease.current(token()));assert.equal(lease.current(token('other')),false);writable=false;assert.equal(lease.current(),false);g.dispose();});
const panel=scope(policy+'\n'+['canSeeCard','canWriteCard','writeIsCurrent','applyNativeItems','refreshNativeItems'].map(n=>declaration('src/modules/characterCards/panel-page.ts',n)).join('\n'),{nativeItems:[],nativeItemsRequest:0,panelAlive:true,panelClosing:false,profileReady:true,metadataLoaded:true,sceneReady:true,sceneEpoch:1,roomId:'room',myPlayerId:'me',isGM:false,cards:[],panelWrites:new Set(),render:()=>{},OBR:{scene:{items:{getItems:async()=>[]}}}});
await check('actual full-card panel preserves readonly discovery but blocks refresh/group/delete writes',()=>{const card={id:'hero',visibility:'public',locked:false,owner_ids:['me']};panel.cards=[card];panel.nativeItems=[token('other')];assert.equal(panel.canSeeCard(card,false,'me'),true);for(const kind of ['refresh','group','delete']){const op={kind,cardId:'hero',epoch:1,room:'room',player:'me',gm:false,controller:new AbortController()};assert.equal(panel.writeIsCurrent(op),false);}panel.nativeItems=[token('me')];assert.equal(panel.canWriteCard(card,false,'me'),true);card.locked=true;assert.equal(panel.canSeeCard(card,false,'me'),true);});
await check('panel owner change aborts pending writes and older native reads cannot restore access',async()=>{let resolve;panel.OBR.scene.items.getItems=()=>new Promise(r=>resolve=r);const pending=panel.refreshNativeItems();const op={kind:'refresh',cardId:'hero',epoch:1,room:'room',player:'me',gm:false,controller:new AbortController()};panel.panelWrites.add(op);panel.applyNativeItems([token('other')]);assert.equal(op.controller.signal.aborted,true);resolve([token('me')]);await pending;assert.equal(panel.canWriteCard(panel.cards[0],false,'me'),false);panel.panelWrites.clear();});
await check('native owner still cannot mutate a DM-locked resource or change the GM-only stats display lock',async()=>{reset();host.getState=()=>({enabled:{resourceTracker:true},allowPlayerMonsters:false});const resource={id:'r',name:'R',current:2,max:5,type:'count',locked:true};readHook=async()=>({web_resources:{r:resource}});await assert.rejects(()=>host.command({type:'resource',itemId:'card:hero',key:'room:card:hero',resourceId:'r',expected:resource,resource:{...resource,current:1}}),/仅 DM/);await assert.rejects(()=>host.command({type:'statsLock',itemId:'card:hero',locked:false}),/仅 DM/);readHook=undefined;assert.equal(writes.length,0);});
let modalWrites=0,modalItem=token('me');
const modal=scope(policy+'\n'+['canEditCardToken','applyEditorMessage'].map(n=>declaration('src/modules/resourceTracker/index.ts',n)).join('\n'),{role:'PLAYER',playerId:'me',localMessage:()=>true,editor:{session:'s',itemId:'one',cardId:'hero',resourceId:'r',saving:false},sessionCurrent:()=>true,commitResourceEdit:async(_id,_rid,_resource,guard)=>{if(guard(modalItem)){modalWrites++;return true;}return false;},closeModal:async()=>{},OBR:{notification:{show:async()=>{}}},getLocalLang:()=> 'en',console:{warn(){}}});
await check('actual resource modal save/delete reject owner transfer after opening',async()=>{modalItem=token('other');for(const remove of [false,true])await modal.applyEditorMessage({connectionId:'local',data:{session:'s',itemId:'one',resourceId:'r',resource:{id:'r'}}},remove);assert.equal(modalWrites,0);modalItem=token('me');delete modalItem.metadata[BIND];await modal.applyEditorMessage({connectionId:'local',data:{session:'s',itemId:'one',resource:{id:'r'}}},false);assert.equal(modalWrites,0);modalItem=token('me');await modal.applyEditorMessage({connectionId:'local',data:{session:'s',itemId:'one',resource:{id:'r'}}},false);assert.equal(modalWrites,1);modal.role='GM';modalItem=token('other');await modal.applyEditorMessage({connectionId:'local',data:{session:'s',itemId:'one',resource:{id:'r'}}},false);assert.equal(modalWrites,2);});
await check('resource lock and GM-only stat-lock guards remain in production host',()=>{const s=read('src/workbench/background.ts');assert.match(s,/resources\[id\]\?\.locked/);assert.match(s,/if\(m.type==='statsLock'\)\{if\(a.role!=='GM'\)/);});
const out=path.join(root,'.local-evidence/native-owner');mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'results.json'),JSON.stringify({liveRoomVerified:false,checks},null,2));console.log(`${checks.length} production policy/controller checks passed`);
