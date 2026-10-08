// Execute the production modal controller with deterministic DOM/SDK boundaries.
// Geometry, images, paint, role events and storage failures are controlled here;
// actual browser layout and live Owlbear behavior require the browser companion.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8').replaceAll('\r\n','\n');
const source=read('src/player-permission-notice.ts').replace(/^import .*;\n/gm,'').replaceAll('export ','');
const guide=read('src/announcement-important.ts').replace(/^import .*;\n/gm,'').replaceAll('export ','');
const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function element(){const handlers=new Map();return {handlers,textContent:'',disabled:false,clientHeight:400,scrollHeight:1600,scrollTop:0,images:[{complete:false},{complete:false},{complete:false}],classList:{add(){},toggle(){}},setAttribute(){},firstElementChild:{},querySelectorAll(){return this.images;},addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(fn);},removeEventListener(name,fn){handlers.get(name)?.delete(fn);},async emit(name,data={}){for(const fn of [...handlers.get(name)||[]])await fn(data);}};}
function fixture(dev=true,acknowledge){
 const ids=Object.fromEntries(['body','btn-close','credit','ann-lang-zh','ann-lang-en'].map(id=>[id,element()]));
 const win=element(),doc=Object.assign(element(),{visibilityState:'visible',body:element(),getElementById:id=>ids[id],querySelector:()=>element()});
 const storage=new Map(),writes=[],closed=[],paint=new Set();let role='GM',roleEvent,failStorage=false,resolveRole;
 const sdk={player:{getRole:async()=>role,onChange:fn=>{roleEvent=fn;return()=>{roleEvent=undefined;};}},modal:{close:async id=>closed.push(id)}};
 let resize;
 const context=vm.createContext({console,WORKBENCH_DEV:dev,OBR:sdk,document:doc,window:win,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(failStorage)throw Error('denied');writes.push([key,value]);storage.set(key,value);}},assetUrl:name=>`/${dev?'suite-dev':'suite'}/${name}`,ResizeObserver:class{constructor(fn){resize=fn;}observe(){}disconnect(){}},afterVisiblePaint:fn=>{paint.add(fn);return()=>paint.delete(fn);}});
 vm.runInContext(compile(guide+'\n'+source+'\nglobalThis.api={mountPlayerPermissionNotice,hasReadPlayerPermissions,PLAYER_PERMISSION_SEEN_KEY,PLAYER_PERMISSION_MODAL_ID,renderAnnouncementImportant};'),context);
 context.api.mountPlayerPermissionNotice('zh',acknowledge);
 return {ids,doc,win,sdk,storage,writes,closed,api:context.api,resize:()=>resize(),paint:()=>{for(const fn of [...paint])fn();paint.clear();},images:()=>ids.body.images.forEach(image=>image.complete=true),bottom:()=>{ids.body.scrollTop=ids.body.scrollHeight-ids.body.clientHeight;resize();},role:value=>{role=value;roleEvent?.({role});},failStorage:()=>failStorage=true,deferRole:()=>{sdk.player.getRole=()=>new Promise(resolve=>resolveRole=resolve);return value=>resolveRole(value);}};
}
let count=0;async function check(name,run){await run();console.log('PASS',++count,name);}
await check('guide keeps original body and release guide stays collapsed',()=>{const f=fixture();assert.match(f.ids.body.innerHTML,/Owner Only/);assert.match(f.ids.body.innerHTML,/Set Owner/);assert.equal((f.ids.body.innerHTML.match(/owner-step[123]\.png/g)||[]).length,3);assert(f.api.renderAnnouncementImportant('zh').includes('<details class="announcement-important"><summary>'));assert.equal(f.ids['btn-close'].textContent,'我真的知道了');});
await check('opening or synthetic premature acknowledgment never marks read',async()=>{const f=fixture();await flush();await f.ids['btn-close'].emit('click');assert.equal(f.writes.length,0);assert.equal(f.ids['btn-close'].disabled,true);});
await check('bottom before visible paint or before images settle stays blocked',async()=>{const f=fixture();await flush();f.bottom();await f.ids['btn-close'].emit('click');assert.equal(f.writes.length,0);f.paint();assert.equal(f.ids['btn-close'].disabled,true);f.images();f.resize();assert.equal(f.ids['btn-close'].disabled,false);});
await check('bottom alone and closing/unmounting never acknowledge',async()=>{const f=fixture();await flush();f.images();f.paint();f.bottom();assert.equal(f.ids['btn-close'].disabled,false);assert.equal(f.writes.length,0);await f.win.emit('pagehide');await f.ids['btn-close'].emit('click');assert.equal(f.writes.length,0);});
await check('explicit bottom acknowledgment writes only permission key and closes dedicated modal',async()=>{const f=fixture();await flush();f.images();f.paint();f.bottom();f.storage.set('obr-suite/workbench/announce-seen-version','release');await f.ids['btn-close'].emit('click');assert.deepEqual(f.writes,[[f.api.PLAYER_PERMISSION_SEEN_KEY,'1']]);assert.deepEqual(f.closed,[f.api.PLAYER_PERMISSION_MODAL_ID]);assert.equal(f.storage.get('obr-suite/workbench/announce-seen-version'),'release');assert.equal(f.api.hasReadPlayerPermissions(),true);});
await check('short/no-scroll content arms after paint and image layout settles',async()=>{const f=fixture();await flush();f.ids.body.scrollHeight=200;f.images();f.paint();assert.equal(f.ids['btn-close'].disabled,false);await f.ids['btn-close'].emit('click');assert.equal(f.writes.length,1);});
await check('late content growth and scroll-away revoke eligibility immediately',async()=>{const f=fixture();await flush();f.images();f.paint();f.bottom();f.ids.body.scrollHeight+=700;await f.ids['btn-close'].emit('click');assert.equal(f.writes.length,0);f.resize();assert.equal(f.ids['btn-close'].disabled,true);f.bottom();f.ids.body.scrollTop=0;await f.ids.body.emit('scroll');assert.equal(f.ids['btn-close'].disabled,true);});
await check('language change starts at top and requires a new painted bottom',async()=>{const f=fixture();await flush();f.images();f.paint();f.bottom();await f.ids['ann-lang-en'].emit('click');assert.equal(f.ids.body.scrollTop,0);assert.equal(f.ids['btn-close'].disabled,true);assert.equal(f.ids['btn-close'].textContent,'I really understand');});
await check('players and hidden documents cannot acknowledge',async()=>{const f=fixture();await flush();f.images();f.paint();f.bottom();f.role('PLAYER');await f.ids['btn-close'].emit('click');assert.equal(f.writes.length,0);f.role('GM');f.doc.visibilityState='hidden';await f.doc.emit('visibilitychange');await f.ids['btn-close'].emit('click');assert.equal(f.writes.length,0);assert.equal(f.ids['btn-close'].disabled,true);});
await check('role revocation during final role verification cancels acknowledgment',async()=>{const f=fixture();await flush();f.images();f.paint();f.bottom();const resolve=f.deferRole();const click=f.ids['btn-close'].emit('click');f.role('PLAYER');resolve('GM');await click;assert.equal(f.writes.length,0);});
await check('storage failure keeps notice open and entry unread',async()=>{const f=fixture();await flush();f.images();f.paint();f.bottom();f.failStorage();await f.ids['btn-close'].emit('click');assert.equal(f.writes.length,0);assert.equal(f.closed.length,0);assert.equal(f.api.hasReadPlayerPermissions(),false);assert.match(f.ids.credit.textContent,/请重试/);});
await check('stable/dev acknowledgment scopes stay separate',()=>{const stable=fixture(false),dev=fixture(true);assert.notEqual(stable.api.PLAYER_PERMISSION_SEEN_KEY,dev.api.PLAYER_PERMISSION_SEEN_KEY);assert.notEqual(stable.api.PLAYER_PERMISSION_MODAL_ID,dev.api.PLAYER_PERMISSION_MODAL_ID);});
await check('Back/Forward restore rechecks role and visible paint without marking read',async()=>{const f=fixture();await flush();f.images();f.paint();f.bottom();await f.win.emit('pagehide',{persisted:true});assert.equal(f.ids['btn-close'].disabled,true);await f.win.emit('pageshow',{persisted:true});await flush();assert.equal(f.ids['btn-close'].disabled,true);f.paint();assert.equal(f.ids['btn-close'].disabled,false);assert.equal(f.writes.length,0);await f.ids['btn-close'].emit('click');assert.equal(f.writes.length,1);});

// Execute the real host dispatcher in a separate storage realm, as with a
// detached workbench and a storage-partitioned Owlbear extension iframe.
function permissionHost(){
 const hostStorage=new Map();let role='GM',fail=false;
 const panel=read('src/workbench/panel-rpc.ts').replace(/^import .*;\n/gm,'').replaceAll('export ','');
 const context=vm.createContext({console,WORKBENCH_DEV:true,OBR:{room:{id:'partitioned'},player:{getRole:async()=>role},party:{},scene:{}},localStorage:{getItem:key=>hostStorage.get(key)||null,setItem:(key,value)=>{if(fail)throw Error('host storage unavailable');hostStorage.set(key,value);}},setupServerAdmission(){},tableWorkbench:()=>()=>{},getState:()=>({enabled:{}})});
 vm.runInContext(compile(source+'\n'+panel+'\nglobalThis.host={request:panelBridge(()=>{}),seen:hasReadPlayerPermissions};'),context);
 return {ack:()=>context.host.request('permissions','notice-1','permissions.acknowledge',[]),seen:()=>context.host.seen(),storage:hostStorage,setRole:value=>role=value,fail:value=>fail=value};
}
await check('partitioned iframe acknowledges the authoritative host bucket only after the real read gate',async()=>{
 const host=permissionHost(),f=fixture(true,host.ack);await flush();await f.ids['btn-close'].emit('click');assert.equal(host.seen(),false);f.images();f.paint();f.bottom();assert.equal(host.seen(),false);await f.ids['btn-close'].emit('click');assert.equal(host.seen(),true);assert.equal(f.storage.size,0);assert.equal(f.closed.length,1);
});
await check('host save failure leaves the guide open and unread, then an explicit retry succeeds',async()=>{
 const host=permissionHost(),f=fixture(true,host.ack);await flush();f.images();f.paint();f.bottom();host.fail(true);await f.ids['btn-close'].emit('click');assert.equal(host.seen(),false);assert.equal(f.closed.length,0);assert.match(f.ids.credit.textContent,/请重试/);host.fail(false);await f.ids['btn-close'].emit('click');assert.equal(host.seen(),true);assert.equal(f.closed.length,1);
});
await check('host rejects acknowledgment after role revocation even before the iframe learns it',async()=>{
 const host=permissionHost(),f=fixture(true,host.ack);await flush();f.images();f.paint();f.bottom();host.setRole('PLAYER');await f.ids['btn-close'].emit('click');assert.equal(host.seen(),false);assert.equal(f.closed.length,0);assert.equal(f.storage.size,0);
});
console.log(`Permission notice controller: ${count} scenarios passed; DOM/SDK boundaries simulated.`);
