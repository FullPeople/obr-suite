import OBR, {buildShape, buildLight, buildWall, buildLine, type Item, type Light} from "@owlbear-rodeo/sdk";
import {CARD_BIND_KEY, CARD_LIST_KEY, VISION_KEY, readVisionCards, resolveVisionSource, type VisionContext} from "../src/modules/fullFog/dynfog/light/visionPolicy";
import {Patcher} from "../src/modules/fullFog/dynfog/reconcile/Patcher";
import {Reconciler} from "../src/modules/fullFog/dynfog/reconcile/Reconciler";
import {LightActor} from "../src/modules/fullFog/dynfog/reconcile/actors/LightActor";
import {LightReactor, SelfLightReactor} from "../src/modules/fullFog/dynfog/reconcile/reactors/LightReactor";
import {LightOcclusion} from "../src/modules/fullFog/dynfog/light/occlusion";
import {OpeningReactor} from "../src/modules/fullFog/dynfog/reconcile/reactors/OpeningReactor";
import {WallReactor} from "../src/modules/fullFog/dynfog/reconcile/reactors/WallReactor";
import {LIGHT_KEY, CTX_LIGHT_ADD, CTX_LIGHT_SETTINGS} from "../src/modules/fullFog/dynfog/ids";
import * as runtime from "../src/modules/fullFog/dynfog/runtime";
import {setupDynfog, teardownDynfog, applyDynfogSettings} from "../src/modules/fullFog/dynfog";

let passed = 0;
function check(value: unknown, label: string): asserts value { if (!value) throw Error(`ASSERTION: ${label}`); passed++; }
const equal = (actual: unknown, expected: unknown, label: string) => check(JSON.stringify(actual) === JSON.stringify(expected), `${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
const clone = <T>(value:T):T => structuredClone(value);
function deferred<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(yes=>resolve=yes); return {promise,resolve}; }
const settle = async () => { for (let i=0;i<40;i++) await Promise.resolve(); };
function event<T>() { const callbacks=new Set<(value:T)=>void>(); return {on:(callback:(value:T)=>void)=>{callbacks.add(callback);return ()=>callbacks.delete(callback);},emit:(value:T)=>{for(const callback of callbacks) callback(value);},clear:()=>callbacks.clear()}; }
const ready = event<boolean>(), itemsChanged = event<Item[]>(), partyChanged = event<any[]>(), metadataChanged = event<any>(), playerChanged = event<any>();
let local = new Map<string,Item>(), scene:Item[]=[], online:any[]=[], metadata:Record<string,unknown>={}, myRole:"PLAYER"|"GM"="PLAYER", myId="p1";
let calls:{kind:string;items:Item[];ids:string[]}[]=[], reads=0;
let beforeAdd:(()=>Promise<void>)|undefined;
let readItems:()=>Promise<Item[]> = async()=>clone(scene);
const menus = new Map<string,any>();
(OBR.player as any).messageBus.userId="sdk-builder-user";
(OBR.scene as any).isReady=async()=>true;
(OBR.scene as any).onReadyChange=ready.on;
(OBR.scene.items as any).onChange=itemsChanged.on;
(OBR.scene.items as any).getItems=()=>{reads++;return readItems();};
(OBR.scene as any).getMetadata=async()=>clone(metadata);
(OBR.scene as any).onMetadataChange=metadataChanged.on;
(OBR.player as any).getId=async()=>myId;
(OBR.player as any).getRole=async()=>myRole;
(OBR.player as any).onChange=playerChanged.on;
(OBR.party as any).getPlayers=async()=>clone(online);
(OBR.party as any).onChange=partyChanged.on;
(OBR.scene.grid as any).getDpi=async()=>150;
(OBR.scene.grid as any).onChange=()=>()=>{};
(OBR.tool as any).getActiveTool=async()=>"";
for (const method of ["create","createMode","remove","removeMode","setMetadata"]) (OBR.tool as any)[method]=async()=>{};
(OBR.tool as any).onToolChange=()=>()=>{};
(OBR.broadcast as any).onMessage=()=>()=>{};
(OBR.contextMenu as any).create=async(menu:any)=>{menus.set(menu.id,menu);};
(OBR.contextMenu as any).remove=async(id:string)=>{menus.delete(id);};
(OBR.scene.local as any).addItems=async(items:Item[])=>{
  // Capture at the actual SDK boundary, before it could render an item.
  const submitted=clone(items); calls.push({kind:"add",items:submitted,ids:submitted.map(i=>i.id)});
  const wait=beforeAdd; beforeAdd=undefined; if(wait) await wait();
  for(const item of submitted) local.set(item.id,item);
};
(OBR.scene.local as any).updateItems=async(ids:string[],update:(items:Item[])=>void)=>{
  const found=ids.flatMap(id=>local.has(id)?[clone(local.get(id)!)]:[]); update(found);
  calls.push({kind:"update",items:clone(found),ids:[...ids]}); for(const item of found)local.set(item.id,item);
};
(OBR.scene.local as any).deleteItems=async(ids:string[])=>{calls.push({kind:"delete",items:[],ids:[...ids]});for(const id of ids)local.delete(id);};
function token(id:string,owner="p1",extra:Partial<Item>={}):Item {
  return {...buildShape().shapeType("CIRCLE").build(),id,createdUserId:owner,layer:"CHARACTER",metadata:{[LIGHT_KEY]:{lightType:"PRIMARY"}},lastModified:"2026-09-08T00:00:00Z",...extra} as Item;
}
function reset() {
  local.clear();scene=[];calls=[];reads=0;beforeAdd=undefined;readItems=async()=>clone(scene);
  ready.clear();itemsChanged.clear();partyChanged.clear();metadataChanged.clear();playerChanged.clear();menus.clear();
  myRole="PLAYER";myId="p1";online=[{id:"p1",role:"PLAYER",name:"One"},{id:"p2",role:"PLAYER",name:"Two"},{id:"gm",role:"GM",name:"GM"}];metadata={};
  runtime.clearSceneVision();runtime.setRole(myRole);runtime.setPlayerId(myId);runtime.setVisionParty(online);runtime.setShareVisionEnabled(false);runtime.setLightOcclusionEnabled(true);
}
function source(item:Item,extra:Partial<VisionContext>={}, ancestors:Item[]=[]){const map=new Map(ancestors.map(i=>[i.id,i]));return resolveVisionSource(item,{playerId:"p1",playerIds:new Set(["p1","p2"]),cards:new Map(),...extra},id=>map.get(id!)??null);}
function flags(item:Item,extra:Partial<VisionContext>={},ancestors:Item[]=[]){const s=source(item,extra,ancestors);return [s.visible,s.personal,s.team];}
reset();
equal(flags(token("self")),[true,true,true],"own ordinary token");
equal(flags(token("other","p2")),[true,false,true],"other real player token shares automatically");
equal(flags(token("mount","p2",{layer:"MOUNT"})),[true,false,true],"player mount");
equal(flags(token("gm-created","gm")),[true,false,false],"GM creator is not a player owner");
equal(flags(token("offline","offline")),[true,false,false],"offline creator not pooled");
equal(flags(token("map","p2",{layer:"MAP"})),[true,false,false],"player map is not a vision owner");
equal(flags(token("npc","p2",{metadata:{["com.bestiary/slug"]:"orc"}})),[true,false,false],"bestiary NPC excluded");
const cards=readVisionCards([{id:"c",owner_ids:["p2"],visibility:"public"}]);
const bound=token("assigned","gm",{metadata:{[LIGHT_KEY]:{},[CARD_BIND_KEY]:"c"}});
equal(flags(bound,{cards}),[true,false,true],"GM-created token uses player card owner");
equal(flags({...bound,createdUserId:"p1"},{cards}),[true,false,true],"bound card wins over creator");
equal(flags(bound),[true,false,false],"missing bound card does not fall back");
equal(flags(bound,{cards:readVisionCards([{id:"c",owner_ids:["p1","p2"],visibility:"owners"}])}),[true,true,true],"private card details do not disable party vision");
equal(flags(bound,{cards:readVisionCards([{id:"c",owner_ids:["p1"],visibility:"dm"}])}),[true,false,false],"DM card never player view");
equal(flags({...bound,metadata:{...bound.metadata,[VISION_KEY]:{mode:"owners",ownerIds:["p1"]}}},{cards}),[true,true,true],"explicit owner overrides card");
equal(flags(token("legacy-team","p2",{metadata:{[VISION_KEY]:{mode:"team"}}})),[true,false,true],"legacy party choice uses automatic player ownership");
equal(flags(token("legacy-team-gm","gm",{metadata:{[VISION_KEY]:{mode:"team"}}})),[true,false,false],"merged automatic source needs a player owner");
equal(flags(token("explicit-gm","p1",{metadata:{[VISION_KEY]:{mode:"gm"}}})),[true,false,false],"explicit GM overrides inferred owner");
equal(flags(token("bad","p1",{metadata:{[VISION_KEY]:null}})),[true,false,false],"malformed explicit ownership fails closed");
const parent=token("parent","p2",{metadata:{[CARD_BIND_KEY]:"c"}}), child=token("child","gm",{layer:"ATTACHMENT",attachedTo:"parent"});
equal(flags(child,{cards},[parent]),[true,false,true],"attached light inherits card");
equal(flags(child,{cards},[{...parent,visible:false}]),[false,false,true],"hidden ancestor overrides team");
equal(flags(child,{cards}),[false,false,false],"missing ancestor fails closed");
equal(flags({...child,attachedTo:"child"},{cards},[child]),[false,false,false],"attachment cycles fail closed");

async function engine(tokens:Item[]){scene=tokens;const rec=new Reconciler();const occ=new LightOcclusion(rec);rec.onAfterReconcile(()=>occ.run());rec.register(new OpeningReactor(rec));rec.register(new WallReactor(rec));rec.register(new LightReactor(rec),new SelfLightReactor(rec));await settle();await rec.patcher.submitChanges();return rec;}
const rendered=(id:string)=>[...local.values()].filter(item=>item.type==="LIGHT"&&item.attachedTo===id) as Light[];
const main=(id:string)=>rendered(id)[0];
reset();
let rec=await engine([token("mine"),token("ally","p2"),token("npc","gm"),token("aux","gm",{metadata:{[LIGHT_KEY]:{lightType:"AUXILIARY"}}})]);
check(main("mine").visible&&main("mine").lightType==="PRIMARY","personal primary visible on first add");
check(main("ally").lightType==="SECONDARY"&&main("npc").lightType==="SECONDARY"&&main("aux").lightType==="SECONDARY","foreign PRIMARY and AUX become illumination only");
check(calls.filter(c=>c.kind==="add").flatMap(c=>c.items).filter(i=>i.attachedTo!=="mine").every(i=>(i as Light).lightType==="SECONDARY"),"first submitted foreign lights never reveal");
const beforeReads=reads, oldIds=[...local.keys()];runtime.setShareVisionEnabled(true);rec.refreshAccess();await rec.patcher.submitChanges();
check(main("ally").lightType==="PRIMARY"&&main("npc").lightType==="SECONDARY","sharing grants only authorized party");
equal(reads,beforeReads,"sharing does not reread scene");equal([...local.keys()],oldIds,"sharing preserves actor IDs");
runtime.setShareVisionEnabled(false);rec.refreshAccess();await rec.patcher.submitChanges();
check(main("ally").lightType==="SECONDARY","turning sharing off revokes ally");
runtime.setLightOcclusionEnabled(false);rec.refreshAccess();await rec.patcher.submitChanges();check(main("npc").lightType==="SECONDARY","occlusion OFF does not grant NPC vision");
runtime.setShareVisionEnabled(true);runtime.setVisionParty(online.filter(p=>p.id!=="p2"));rec.refreshAccess();await rec.patcher.submitChanges();check(main("ally").lightType==="SECONDARY","offline ally loses shared vision");
runtime.setVisionParty(online);rec.refreshAccess();await rec.patcher.submitChanges();check(main("ally").lightType==="PRIMARY","reconnected ally restores vision");
await rec.delete();check(local.size===0,"teardown removes local actors");

reset();
rec=await engine([
 token("ambient","gm",{metadata:{[LIGHT_KEY]:{ambient:true}}}),
 token("private-ambient","gm",{metadata:{[LIGHT_KEY]:{ambient:true},[VISION_KEY]:{mode:"gm"}}}),
 token("private-card-ambient","gm",{metadata:{[LIGHT_KEY]:{ambient:true},[CARD_BIND_KEY]:"missing"}}),
 token("team","p2",{metadata:{[LIGHT_KEY]:{},[VISION_KEY]:{mode:"team"}}}),
 token("hidden","p1",{visible:false}),
 token("npc-cone","gm",{metadata:{[LIGHT_KEY]:{outerAngle:90}}}),
]);
check(main("ambient").visible&&main("ambient").lightType==="PRIMARY","automatic ambient keeps public revealing exception");
check(main("private-ambient").lightType==="SECONDARY"&&main("private-card-ambient").lightType==="SECONDARY","explicit/private restrictions outrank ambient");
check(!main("team").visible&&main("team").lightType==="SECONDARY","explicit team needs sharing ON");
check(!main("hidden").visible,"hidden own token reveals nothing");
check(rendered("npc-cone").length===2&&rendered("npc-cone").every(l=>!l.visible),"no cone self-light leak without authorized origin");
runtime.setShareVisionEnabled(true);rec.refreshAccess();await rec.patcher.submitChanges();check(main("team").lightType==="PRIMARY","team source enabled with sharing");
runtime.setPlayerId("");rec.refreshAccess();await rec.patcher.submitChanges();check(main("team").lightType==="SECONDARY","unknown current identity cannot borrow team view");
await rec.delete();

reset();
runtime.setVisionCards({[CARD_LIST_KEY]:[{id:"c",owner_ids:["p1"],visibility:"public"}]});
rec=await engine([parent,child]);check(main("child").lightType==="PRIMARY","inherited owner works in pipeline");
itemsChanged.emit([child]);await rec.patcher.submitChanges();check(!main("child").visible,"removed ancestor immediately revokes, never previous snapshot");
await rec.delete();

// Late registration must run access hooks before the add boundary.
reset();
const barrier=buildLine().layer("FOG").startPosition({x:300,y:-500}).endPosition({x:300,y:500}).build();
rec=await engine([barrier,token("wall-own","p1",{position:{x:0,y:0}}),token("wall-ally","p2",{position:{x:600,y:0}}),token("wall-npc","gm",{position:{x:750,y:0}})]);
check(!main("wall-ally").visible&&!main("wall-npc").visible,"foreign illumination behind wall remains hidden");
runtime.setShareVisionEnabled(true);rec.refreshAccess();await rec.patcher.submitChanges();
check(main("wall-ally").visible&&main("wall-ally").lightType==="PRIMARY"&&main("wall-npc").visible&&main("wall-npc").lightType==="SECONDARY","shared ally beyond wall is a revealing origin, nearby NPC illumination stays secondary");
await rec.delete();
reset();rec=await engine([token("aux-own","p1",{metadata:{[LIGHT_KEY]:{lightType:"AUXILIARY"}}}),token("aux-foreign","gm")]);
check(main("aux-own").visible&&main("aux-own").lightType==="AUXILIARY"&&!main("aux-foreign").visible,"authorized AUX reveals itself but does not activate secondary lights");await rec.delete();

reset(); scene=[token("late")]; rec=new Reconciler();await settle();
const occ=new LightOcclusion(rec);rec.onAfterReconcile(()=>occ.run());rec.register(new LightReactor(rec));await rec.patcher.submitChanges();
check(main("late").visible&&main("late").lightType==="PRIMARY","late registered actor receives authorization before first add");
const id=main("late").id;ready.emit(true);await settle();equal(main("late").id,id,"duplicate ready does not orphan actors");await rec.delete();

// Safety update folds into a new item; guards also handle an older queued grant.
reset();let patcher=new Patcher();patcher.setReady(true);
const light=buildLight().visible(true).build();patcher.addItems(light);patcher.updateItems([light.id,item=>{item.visible=false;}]);await patcher.submitChanges();
check(calls[0].kind==="add"&&!calls[0].items[0].visible&&calls.length===1,"same-batch denial is folded into initial add");
const blocker=deferred<void>();beforeAdd=()=>blocker.promise;patcher.addItems(buildWall().build());const blocked=patcher.submitChanges();await settle();
let allow=true;const queued=buildLight().visible(true).build();patcher.protectItem(queued.id,item=>{item.visible=allow;});patcher.addItems(queued);const grant=patcher.submitChanges();allow=false;blocker.resolve();await blocked;await grant;
check(!local.get(queued.id)!.visible,"queued old grant uses newest authorization");
calls=[];const wall=buildWall().build();patcher.addItems(wall);patcher.updateItems([wall.id,()=>{}],["existing-wall",()=>{}]);patcher.deleteItems("old-wall");patcher.restrictItems(light.id);await patcher.submitChanges();
equal(calls.map(c=>c.kind),["update","add","update","delete"],"revoke light first, walls still grow then shrink");

reset();patcher=new Patcher();patcher.setReady(true);const hold=deferred<void>();beforeAdd=()=>hold.promise;
patcher.addItems(buildWall().build());const first=patcher.submitChanges();await settle();const stale=buildLight().build();patcher.addItems(stale);const second=patcher.submitChanges();patcher.setReady(false);patcher.setReady(true);hold.resolve();await first;await second;
check(!calls.some(call=>call.ids.includes(stale.id)),"old queued scene batch never reaches new scene");

// Old scene snapshots and post-disposal callbacks cannot introduce old sources.
reset();const oldRead=deferred<Item[]>();readItems=()=>oldRead.promise;rec=new Reconciler();const o=new LightOcclusion(rec);rec.onAfterReconcile(()=>o.run());rec.register(new LightReactor(rec));await settle();
ready.emit(false);scene=[token("new")];readItems=async()=>clone(scene);ready.emit(true);await settle();oldRead.resolve([token("old")]);await settle();await rec.patcher.submitChanges();
check(main("new")?.visible&&!main("old"),"late old scene read cannot replace new scene sources");
const pending=deferred<Item[]>();readItems=()=>pending.promise;rec.refresh();await rec.delete();pending.resolve([token("after-delete")]);await settle();check(!main("after-delete"),"disposed reconciler ignores pending scene read");

// Direct ownership events remain newer than already-pending runtime requests.
reset();const cardRead=deferred<Record<string,unknown>>();(OBR.scene as any).getMetadata=()=>cardRead.promise;
const reading=runtime.refreshRuntime();runtime.setVisionCards({[CARD_LIST_KEY]:[{id:"c",owner_ids:["p2"],visibility:"public"}]});runtime.setVisionParty(online.filter(p=>p.id!=="p2"));
cardRead.resolve({[CARD_LIST_KEY]:[{id:"c",owner_ids:["p1"],visibility:"public"}]});await reading;
equal(runtime.getVisionContext().cards.get("c")?.ownerIds,["p2"],"late card read cannot undo reassignment");check(!runtime.getVisionContext().playerIds.has("p2"),"late party read cannot undo disconnect");
const sceneRead=deferred<Record<string,unknown>>();(OBR.scene as any).getMetadata=()=>sceneRead.promise;const oldRuntime=runtime.refreshRuntime();runtime.clearSceneVision();sceneRead.resolve({[CARD_LIST_KEY]:[{id:"old",owner_ids:["p1"]}]});await oldRuntime;check(!runtime.getVisionContext().cards.has("old"),"old-scene runtime metadata ignored");
(OBR.scene as any).getMetadata=async()=>clone(metadata);

reset();runtime.setVisionCards({[CARD_LIST_KEY]:[{id:"same",owner_ids:["p2"],visibility:"public"}]});
const sameRead=deferred<Record<string,unknown>>();(OBR.scene as any).getMetadata=()=>sameRead.promise;const readingSame=runtime.refreshRuntime();
runtime.setVisionCards({[CARD_LIST_KEY]:[{id:"same",owner_ids:["p2"],visibility:"public"}]});
sameRead.resolve({[CARD_LIST_KEY]:[{id:"same",owner_ids:["p1"],visibility:"public"}]});await readingSame;
equal(runtime.getVisionContext().cards.get("same")?.ownerIds,["p2"],"same-value newer event also fences stale read");
(OBR.scene as any).getMetadata=async()=>clone(metadata);
reset();const startup=deferred<boolean>();(OBR.scene as any).isReady=()=>startup.promise;rec=new Reconciler();rec.register(new LightReactor(rec));ready.emit(false);startup.resolve(true);await settle();equal(reads,0,"initial ready response cannot override a newer false event");await rec.delete();(OBR.scene as any).isReady=async()=>true;

// Real setup entry on stable AND authoring must install the access policy.
for(const authoring of [false,true]){
 reset();scene=[token("entry-own"),token("entry-ally","p2")];
 const options={authoring,shareVision:false,lightOcclusion:false,playerOpenings:false,alwaysShowOverlay:false};
 await setupDynfog(options);await settle();check(main("entry-own").lightType==="PRIMARY"&&main("entry-ally").lightType==="SECONDARY",`${authoring?"dev":"stable"} setup enforces personal view`);
 await applyDynfogSettings({...options,shareVision:true});await settle();check(main("entry-ally").lightType==="PRIMARY",`${authoring?"dev":"stable"} setup sharing works`);
 myRole="GM";playerChanged.emit({id:myId,role:myRole});await settle();check(menus.has(CTX_LIGHT_ADD)&&menus.has(CTX_LIGHT_SETTINGS),`${authoring?"dev":"stable"} GM basic light menus`);
 await teardownDynfog();check(local.size===0&&menus.size===0,`${authoring?"dev":"stable"} teardown cleans actors and menus`);
}
console.log(`Vision self-test: ${passed} assertions passed`);
