// Restricted production panel dispatcher; SDK/storage are synthetic, no live room.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../src/workbench/panel-rpc.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function panelBridge','function panelBridge');
const listeners=new Map(),calls=[],events=[],hostStorage=new Map();let role='GM',failStorage=false;
const api={room:{id:'test-room'},player:{getRole:async()=>role,getId:async()=>'test-gm',getConnectionId:async()=>'test-connection',onChange:fn=>{listeners.set('player',fn);return()=>listeners.delete('player');}},scene:{isReady:async()=>true,onReadyChange:fn=>{listeners.set('sceneReady',fn);return()=>listeners.delete('sceneReady');}},party:{},broadcast:{onMessage:(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name);}}};
const context=vm.createContext({console,OBR:api,TEXT_EFFECT_REQUEST:'com.obr-suite/text-effects/request',TEXT_EFFECT_STATUS:'com.obr-suite/text-effects/status',requestTextEffect:async value=>{calls.push(value);return {ok:true};},localStorage:{getItem:key=>hostStorage.get(key)||null},markPlayerPermissionsRead:()=>{if(failStorage)throw Error('host storage denied');hostStorage.set('obr-suite/workbench/player-permissions-seen','1');},setupServerAdmission(){},tableWorkbench:()=>async(...args)=>calls.push(args),getState:()=>({enabled:{}})});
context.events=events;vm.runInContext(ts.transpileModule(source+'\nglobalThis.bridge=panelBridge((...args)=>events.push(args));',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
const request=(method,args=[])=>context.bridge('permissions','notice-1',method,args);let count=0;
async function check(name,fn){await fn();console.log('PASS',++count,name);}
await check('GM init and fresh role read succeed',async()=>{assert.equal((await request('init')).playerId,'test-gm');assert.equal(await request('player.getRole'),'GM');});
await check('only player-role subscriptions are permitted',async()=>{await request('subscribe',['player']);assert.equal(listeners.size,1);listeners.get('player')({role:'PLAYER'});assert.equal(events.at(-1)[1].data.role,'PLAYER');for(const event of ['party','items','sceneMetadata','roomMetadata','broadcast'])await assert.rejects(()=>request('subscribe',[event]),/无效权限说明操作/);});
await check('scene, personal metadata, preferences and broadcasts cannot be written',async()=>{for(const method of ['player.setMetadata','scene.setMetadata','room.setMetadata','preferences.write','broadcast.sendMessage','popover.open'])await assert.rejects(()=>request(method,[{}]),/无效权限说明操作/);assert.equal(calls.length,0);});
await check('explicit acknowledgment commits only the host seen key and propagates save failures',async()=>{assert.equal(hostStorage.size,0);failStorage=true;await assert.rejects(()=>request('permissions.acknowledge'),/host storage denied/);assert.equal(hostStorage.size,0);failStorage=false;assert.equal((await request('permissions.acknowledge')).seen,true);assert.equal(hostStorage.get('obr-suite/workbench/player-permissions-seen'),'1');await assert.rejects(()=>request('permissions.acknowledge',[true]),/无效权限确认/);});
await check('player and revoked GM cannot initialize or read the guide',async()=>{role='PLAYER';for(const method of ['init','player.getRole','subscribe','permissions.acknowledge'])await assert.rejects(()=>request(method,['player']),/仅 DM/);});
await check('disposal remains allowed after role revocation and removes listeners',async()=>{await request('dispose');assert.equal(listeners.size,0);});
await check('text presentation panel can read readiness and role, and only submit the checked local request',async()=>{
 const text=(method,args=[])=>context.bridge('textEffects','effect-1',method,args);assert.equal((await text('init')).playerId,'test-gm');assert.equal(await text('player.getRole'),'PLAYER');assert.equal(await text('player.getConnectionId'),'test-connection');assert.equal(await text('scene.isReady'),true);
 await text('subscribe',['player']);await text('subscribe',['sceneReady']);await text('subscribe',['broadcast',context.TEXT_EFFECT_STATUS]);
 await text('broadcast.sendMessage',[context.TEXT_EFFECT_REQUEST,{action:'play',preview:true},{destination:'LOCAL'}]);assert.equal(calls.length,1);
 for(const args of [[context.TEXT_EFFECT_REQUEST,{}, {destination:'REMOTE'}],['com.obr-suite/text-effects/play',{}, {destination:'LOCAL'}]])await assert.rejects(()=>text('broadcast.sendMessage',args),/无效文字演出操作/);
 for(const method of ['scene.setMetadata','room.setMetadata','player.setMetadata','preferences.write','popover.open','scene.items.addItems'])await assert.rejects(()=>text(method,[{}]),/无效文字演出操作/);
 for(const name of ['roomMetadata','items','party'])await assert.rejects(()=>text('subscribe',[name]),/无效文字演出订阅/);assert.equal(calls.length,1);await text('dispose');assert.equal(listeners.size,0);
});
console.log(`Permission panel: ${count} scenarios passed.`);
