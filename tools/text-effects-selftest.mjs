// Production controller exercised against three synthetic SDK clients; no live room.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
const files=new Map(['model','protocol','index'].map(name=>[name,ts.transpileModule(readFileSync(new URL(`../src/modules/textEffects/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText]));
let clock=1000000,sequence=0;
const clients=[],metadata={},packets=[];
const tick=async()=>{for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));};
function client(role){
 const connectionId=`connection-${++sequence}`,listeners=new Map(),sceneListeners=[],opens=[],closes=[],live=new Set(),timers=new Map();
 const state={role,ready:true,openBarrier:undefined,metadataBarrier:undefined};
 const api={player:{getConnectionId:async()=>connectionId,getRole:async()=>state.role},party:{getPlayers:async()=>clients.filter(c=>c.connectionId!==connectionId).map(c=>({connectionId:c.connectionId,role:c.state.role}))},
  scene:{isReady:async()=>state.ready,onReadyChange:fn=>{sceneListeners.push(fn);return()=>{};},getMetadata:async()=>{await state.metadataBarrier;return {...metadata};},setMetadata:async value=>Object.assign(metadata,value)},
  popover:{open:async()=>{},close:async()=>{}},viewport:{getWidth:async()=>1200,getHeight:async()=>800},
  modal:{open:async data=>{opens.push(data);await state.openBarrier;live.add(data.id);},close:async id=>{closes.push(id);live.delete(id);}},
  broadcast:{onMessage:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);return()=>{};},sendMessage:async(name,data,options)=>{packets.push({sender:connectionId,name,data,options});for(const target of clients){if(options.destination==='LOCAL'&&target.connectionId!==connectionId||options.destination==='REMOTE'&&target.connectionId===connectionId)continue;target.deliver(name,data,connectionId);}}},
 };
 const context=vm.createContext({console,Date:{now:()=>clock},crypto:webcrypto,TextEncoder,setTimeout:(fn)=>{const id=Symbol();timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)}),cache=new Map();
 function load(name){if(cache.has(name))return cache.get(name);const module={exports:{}};cache.set(name,module.exports);
  const require=path=>path==='@owlbear-rodeo/sdk'?{__esModule:true,default:api}:path.includes('asset-base')?{assetUrl:file=>'/suite-dev/'+file}:path.includes('transitions/protocol')?{prefersReducedMotion:()=>false}:load(path.replace('./',''));
  const fn=vm.runInContext(`(function(require,module,exports){${files.get(name)}\n})`,context);fn(require,module,module.exports);return module.exports;
 }
 const controller=load('index'),model=load('model'),protocol=load('protocol');
 const result={connectionId,state,opens,closes,live,timers,controller,model,protocol,deliver:(name,data,sender)=>listeners.get(name)?.forEach(fn=>fn({connectionId:sender,data})),scene:ready=>{state.ready=ready;sceneListeners.forEach(fn=>fn(ready));}};clients.push(result);return result;
}
const gm=client('GM'),player=client('PLAYER'),other=client('PLAYER');
await Promise.all(clients.map(c=>c.controller.setupTextEffects()));
const config=JSON.parse(JSON.stringify(gm.model.DEFAULT_CONFIG)),p=gm.protocol;
const request=(c,values={})=>c.controller.requestTextEffect({requestId:webcrypto.randomUUID(),action:'play',preview:false,config,...values});
let count=0;
async function check(name,fn){await fn();await tick();console.log('PASS',++count,name);}
await check('all original presets validate and unsafe CSS/NaN/oversized text are rejected',async()=>{
 for(const preset of gm.model.PRESETS)assert.ok(gm.model.parseConfig(preset.config));
 for(const bad of [{color:'url(https://example.test)'},{size:NaN},{enter:-1},{hold:20001},{title:'x'.repeat(161)},{body:'x'.repeat(1801)},{font:'external'},{background:'<script>'}])assert.equal(gm.model.parseConfig({...config,...bad}),null);
 const normalized=gm.model.parseConfig({...config,secret:'not sent'});assert.equal('secret'in normalized,false);
});
await check('preview opens only the requesting client and does not create scene metadata',async()=>{
 const before=packets.length,others=player.opens.length;await request(gm,{preview:true});assert.equal(packets.length,before);assert.equal(player.opens.length,others);assert.deepEqual(metadata,{});assert.equal(gm.live.size,1);
});
await check('GM room play reaches sender and both player clients with bounded shared parameters',async()=>{
 const before=clients.map(c=>c.opens.length),result=await request(gm);await tick();assert.equal(result.preview,false);
 for(const [i,c]of clients.entries()){assert.equal(c.opens.length,before[i]+1);assert.equal(c.live.size,1);assert.equal(c.opens.at(-1).disablePointerEvents,true);}
 const message=packets.findLast(packet=>packet.name===p.PLAY);assert.equal(message.options.destination,'REMOTE');assert.ok(new TextEncoder().encode(JSON.stringify(message.data)).length<12000);assert.equal(Object.keys(metadata).length,1);
});
await check('same request is idempotent; changed data under that identity is rejected',async()=>{
 const value={requestId:webcrypto.randomUUID(),action:'play',preview:false,config},before=packets.filter(v=>v.name===p.PLAY).length;
 const [a,b]=await Promise.all([gm.controller.requestTextEffect(value),gm.controller.requestTextEffect(value)]);assert.equal(a.id,b.id);assert.equal(packets.filter(v=>v.name===p.PLAY).length,before+1);await assert.rejects(()=>gm.controller.requestTextEffect({...value,config:{...config,title:'changed'}}),/已改变/);
});
await check('players can preview locally and cannot broadcast room play or room stop',async()=>{
 const before=packets.length;await assert.rejects(()=>request(player),/只有 DM/);await assert.rejects(()=>request(player,{action:'stop',id:webcrypto.randomUUID()}),/只有 DM/);assert.equal(packets.length,before);await request(player,{preview:true});assert.equal(packets.length,before);assert.equal(player.live.size,1);
});
await check('explicit stop closes sender and all matching remote presentations',async()=>{
 const result=await request(gm);await tick();await request(gm,{action:'stop',id:result.id});await tick();for(const c of clients)assert.equal(c.live.size,0);
});
await check('spoofed, wrong-scene, expired, future, and out-of-order packets cannot play',async()=>{
 const event=packets.findLast(v=>v.name===p.PLAY).data,gate=p.createEventGate(),context={now:clock,readyAt:clock-1,sceneKey:metadata[p.SCENE_KEY],peers:[{connectionId:gm.connectionId,role:'GM'}]};
 assert.equal(gate.accept(event,'intruder',context),null);assert.equal(gate.accept({...event,sceneKey:webcrypto.randomUUID()},gm.connectionId,context),null);assert.equal(gate.accept(event,gm.connectionId,{...context,now:event.expiresAt+1}),null);assert.equal(gate.accept({...event,issuedAt:clock+2000,startsAt:clock+2500,expiresAt:clock+3000+gm.model.duration(config)},gm.connectionId,context),null);
 const newer={...event,id:webcrypto.randomUUID(),order:event.order+5};assert.ok(gate.accept(newer,gm.connectionId,context));assert.equal(gate.accept({...event,id:webcrypto.randomUUID()},gm.connectionId,context),null);assert.equal(gate.accept(newer,gm.connectionId,context),null);
 const before=player.opens.length;player.deliver(p.PLAY,{...event,id:webcrypto.randomUUID(),order:event.order+10},other.connectionId);await tick();assert.equal(player.opens.length,before);
});
await check('an authenticated stop received before delayed play prevents its later appearance',async()=>{
 const original=packets.findLast(v=>v.name===p.PLAY).data,event={...original,id:webcrypto.randomUUID(),order:original.order+100},before=player.opens.length;
 player.deliver(p.STOP,{version:1,id:event.id,sceneKey:event.sceneKey,issuedAt:clock},gm.connectionId);await tick();player.deliver(p.PLAY,event,gm.connectionId);await tick();assert.equal(player.opens.length,before);
});
await check('scene closure clears every presentation and blocks new room requests',async()=>{
 await request(gm,{preview:true});for(const c of clients)c.scene(false);assert.equal(gm.live.size,0);await assert.rejects(()=>request(gm),/请先打开/);for(const c of clients)c.scene(true);
});
await check('late native open acknowledgment is closed after a scene change',async()=>{
 let release;gm.state.openBarrier=new Promise(resolve=>release=resolve);const pending=request(gm,{preview:true});await tick();gm.scene(false);release();await assert.rejects(()=>pending,/更新|场景/);await tick();assert.equal(gm.live.size,0);gm.state.openBarrier=undefined;gm.scene(true);
});
await check('fresh role revocation while metadata is loading prevents any room broadcast',async()=>{
 let release;gm.state.metadataBarrier=new Promise(resolve=>release=resolve);const before=packets.filter(v=>v.name===p.PLAY).length,pending=request(gm);await tick();gm.state.role='PLAYER';release();await assert.rejects(()=>pending,/只有 DM/);assert.equal(packets.filter(v=>v.name===p.PLAY).length,before);gm.state.metadataBarrier=undefined;gm.state.role='GM';
});
await check('oversized and empty invisible requests do not open a presentation',async()=>{
 await assert.rejects(()=>request(gm,{extra:'x'.repeat(12001)}),/配置过长/);await assert.rejects(()=>request(gm,{config:{...config,title:'',subtitle:'',body:'',decoration:'none',background:'transparent'}}),/填写文字/);
});
console.log(`Text effects: ${count} scenarios passed; real Owlbear room not exercised.`);
