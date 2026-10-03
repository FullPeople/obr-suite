// Run the actual page router and both historical page adapters. Only SDK,
// document and visual mount are controlled; real LOCAL codecs are exercised.
import {build} from 'rolldown';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
const root=resolve('.'),game=join(root,'extensions/three-dragon-ante/src/game'),old=join(root,'src/modules/threeDragonAnte'),out=mkdtempSync(join(tmpdir(),'tda-legacy-exit-'));
for(const mode of ['standalone-pack','suite-pack','suite-stable'])for(const reload of [false,true])for(const owner of [false,true]){
 const stable=mode==='suite-stable',source=stable?old:game,namespace=stable?'stable-legacy':'pack-legacy',member=owner?'host':'peer',seatId=owner?'seat0':'seat1';
 const entry=`import assert from 'node:assert/strict';import{createGame,projectSeat}from ${JSON.stringify(join(source,'rules/index.ts'))};import{localViewParts}from ${JSON.stringify(join(source,'local-view.ts'))};import{TABLE_ROOM_KEY,TABLE_VIEW,TABLE_READY}from ${JSON.stringify(join(source,'protocol.ts'))};
 const listeners=new Map(),windowEvents=new Map(),sent=[],nodes=new Map();let visible,props;const store=new Map();
 const state=createGame({id:'legacy-result',seed:7341,seats:[{id:'seat0',name:'Host'},{id:'seat1',name:'Peer'}]});
 const table={version:1,id:'legacy-table',hostPlayerId:'host',hostConnectionId:'host-connection',hostName:'Host',stage:${reload?"'ended'":"'playing'"},revision:1,seats:[{playerId:'host',seatId:'seat0',name:'Host'},{playerId:'peer',seatId:'seat1',name:'Peer'}]};
 const metadata={[TABLE_ROOM_KEY]:table};
 const element=()=>({querySelector:()=>element(),addEventListener(){},focus(){},replaceChildren(){},append(){}});const app=element();
 globalThis.document={getElementById:id=>id==='table-app'?app:(nodes.get(id)||nodes.set(id,element()).get(id)),documentElement:{},body:element()};
 globalThis.window={addEventListener(type,fn){windowEvents.set(type,fn)}};globalThis.location={pathname:${JSON.stringify(mode==='standalone-pack'?'/three-dragon-ante-dev/index.html':'/suite-dev/workbench-panels/table.html')},search:''};
 globalThis.localStorage={getItem:()=> 'seen',setItem(){}};globalThis.sessionStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 ${reload?`store.set('three-dragon-completed-navigation:${namespace}:legacy-table:${member}','legacy-result');state.stage='ended';state.winners=['seat0'];`:''}
 const interval=globalThis.setInterval;globalThis.setInterval=(...args)=>{const timer=interval(...args);timer.unref();return timer;};
 globalThis.testUI={mountTableUI(_root,p){props=p;return {update(v){visible=structuredClone(v)},language(){},failed(){throw Error('unexpected page failure')},gesture(){},waitingForReceipt:()=>false,draft:()=>null,restore(){},destroy(){},suspend(){},resume(){}};}};
 globalThis.testSDK={onReady:fn=>queueMicrotask(fn),player:{getConnectionId:async()=> 'local-connection'},room:{getMetadata:async()=>metadata},broadcast:{onMessage(name,fn){listeners.set(name,fn);return()=>listeners.delete(name)},async sendMessage(name,data,options){sent.push({name,data,options});}}};
 const until=async(fn,label)=>{const end=Date.now()+2000;while(!fn()){if(Date.now()>end)throw Error('timed out '+label);await new Promise(r=>setTimeout(r,1));}};
 await import(${JSON.stringify(join(game,'page.ts'))});await until(()=>sent.some(m=>m.name===TABLE_READY),'reachable legacy READY');
 let seq=0;const wire=()=>({actionReceiptVersion:1,table:structuredClone(table),selfPlayerId:${JSON.stringify(member)},isHost:${owner},role:'PLAYER',connected:true,pending:false,game:projectSeat(state,${JSON.stringify(seatId)})});
 async function push(){const ready=sent.find(m=>m.name===TABLE_READY).data,previous=visible;for(const part of localViewParts(wire(),ready.clientId,++seq))listeners.get(TABLE_VIEW)({connectionId:'local-connection',data:part});await until(()=>visible!==previous,'LOCAL view');}
 await push();
 ${reload?"assert.equal(visible.game,null,'reloaded ended metadata retains local exit');await props.send({type:'join'});assert.equal(visible.game.id,'legacy-result','reloaded local join reopens archive');":"assert.equal(visible.game.phase,'ante','existing playing route mounted');state.stage='ended';state.winners=['seat0'];table.stage='ended';table.revision++;await push();assert.equal(visible.game.phase,'ended','same mounted page receives game end');"}
 const archive=JSON.stringify(state),summary=JSON.stringify(table),traffic=sent.length;
 await props.send({type:'leave'});assert.equal(visible.game,null,'legacy Leave returns immediately');assert.equal(visible.table.seats.some(s=>s.playerId===${JSON.stringify(member)}),false,'local main screen offers Join');assert.equal(sent.length,traffic,'no rejected Leave or destructive command reaches old host');
 await props.send({type:'leave'});await push();assert.equal(visible.game,null,'repeated leave and normal snapshots stay dismissed');
 await props.send({type:'join'});assert.equal(visible.game.id,'legacy-result');assert.equal(sent.length,traffic,'reentry is local');assert.equal(JSON.stringify(state),archive);assert.equal(JSON.stringify(table),summary,'all historic seats and private cards/history unchanged');
 await props.send({type:'leave'});const next=createGame({id:'next-game',seed:7342,seats:state.seats.map(s=>({id:s.id,name:s.name}))});Object.assign(state,next);table.stage='playing';table.revision++;await push();assert.equal(visible.game.id,'next-game','new shared game is shown normally with legacy membership preserved');
 await props.send({type:'leave'});assert.equal(sent.at(-1).data.command.type,'leave','active game policy remains with controller');
 await props.send({type:'close'});assert.equal(sent.at(-1).data.command.type,'close');windowEvents.get('pagehide')();
 console.log('PASS ${mode} ${owner?'owner':'nonowner'} ${reload?'reload-ended':'playing-to-ended'}: actual router/page/LOCAL codec, immediate local exit, repeated snapshot, reentry, new game, close cleanup and immutable archive');
 `;
 const file=join(out,mode+'-'+reload+'-'+owner+'.mjs');
 await build({input:'fixture',platform:'node',plugins:[{name:'page-boundaries',resolveId(id,importer){if(id==='fixture')return '\0fixture.mjs';if(id==='@owlbear-rodeo/sdk')return '\0sdk.mjs';if(id.endsWith('.css'))return '\0css.mjs';if(id==='./ui'&&importer?.replaceAll('\\','/').match(/\/(legacy-page|page)\.ts$/))return '\0ui.mjs';if((id==='../../state'&&importer?.endsWith('/src/modules/threeDragonAnte/page.ts'))||id==='../locale')return '\0locale.mjs';},load(id){if(id==='\0fixture.mjs')return entry;if(id==='\0sdk.mjs')return 'export default globalThis.testSDK';if(id==='\0ui.mjs')return 'export const mountTableUI=(...args)=>globalThis.testUI.mountTableUI(...args)';if(id==='\0locale.mjs')return "export const getLocalLang=()=> 'zh',onLangChange=()=>()=>{},setLocalLang=()=>{};";if(id==='\0css.mjs')return '';}}],output:{file,format:'esm',codeSplitting:false},logLevel:'warn'});
 execFileSync(process.execPath,[file],{stdio:'inherit'});
}
