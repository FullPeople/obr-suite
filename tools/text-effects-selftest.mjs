// Production controller exercised against three synthetic SDK clients; no live room.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
const files=new Map(['catalog','model','motion','protocol','index'].map(name=>[name,ts.transpileModule(readFileSync(new URL(`../src/modules/textEffects/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText]));
let clock=1000000,sequence=0;
const clients=[],metadata={},packets=[];
const tick=async()=>{for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));};
function client(role){
 const connectionId=`connection-${++sequence}`,listeners=new Map(),sceneListeners=[],opens=[],closes=[],live=new Set(),timers=new Map();
 const state={role,ready:true,readyFailures:0,openBarrier:undefined,metadataBarrier:undefined};
 const api={player:{getConnectionId:async()=>connectionId,getRole:async()=>state.role},party:{getPlayers:async()=>clients.filter(c=>c.connectionId!==connectionId).map(c=>({connectionId:c.connectionId,role:c.state.role}))},
  scene:{isReady:async()=>{if(state.readyFailures){state.readyFailures--;throw Error('readiness failed');}return state.ready;},onReadyChange:fn=>{sceneListeners.push(fn);return()=>sceneListeners.splice(sceneListeners.indexOf(fn),1);},getMetadata:async()=>{await state.metadataBarrier;return {...metadata};},setMetadata:async value=>Object.assign(metadata,value)},
  popover:{open:async()=>{},close:async()=>{}},viewport:{getWidth:async()=>1200,getHeight:async()=>800},
  modal:{open:async data=>{opens.push(data);await state.openBarrier;live.add(data.id);},close:async id=>{closes.push(id);live.delete(id);}},
  broadcast:{onMessage:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);return()=>listeners.get(name).splice(listeners.get(name).indexOf(fn),1);},sendMessage:async(name,data,options)=>{packets.push({sender:connectionId,name,data,options});for(const target of clients){if(options.destination==='LOCAL'&&target.connectionId!==connectionId||options.destination==='REMOTE'&&target.connectionId===connectionId)continue;target.deliver(name,data,connectionId);}}},
 };
 const context=vm.createContext({console,Date:{now:()=>clock},crypto:webcrypto,TextEncoder,setTimeout:(fn)=>{const id=Symbol();timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)}),cache=new Map();
 function load(name){if(cache.has(name))return cache.get(name);const module={exports:{}};cache.set(name,module.exports);
  const require=path=>path==='@owlbear-rodeo/sdk'?{__esModule:true,default:api}:path.includes('asset-base')?{assetUrl:file=>'/suite-dev/'+file}:path.includes('transitions/protocol')?{prefersReducedMotion:()=>false}:load(path.replace('./',''));
  const fn=vm.runInContext(`(function(require,module,exports){${files.get(name)}\n})`,context);fn(require,module,module.exports);return module.exports;
 }
 const controller=load('index'),model=load('model'),protocol=load('protocol'),catalog=load('catalog'),motion=load('motion');
 const result={connectionId,state,opens,closes,live,timers,controller,model,protocol,catalog,motion,deliver:(name,data,sender)=>listeners.get(name)?.forEach(fn=>fn({connectionId:sender,data})),scene:ready=>{state.ready=ready;sceneListeners.forEach(fn=>fn(ready));}};clients.push(result);return result;
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
await check('flat default follows the reference and old atmospheric drafts retain text without glow',async()=>{
 const c=gm.model.DEFAULT_CONFIG;assert.equal(c.title,'战斗开始');assert.equal(c.subtitle,'BATTLE START');assert.equal(c.color,'#ffffff');assert.equal(c.decoration,'frame');assert.equal(c.background,'transparent');assert.equal(c.entry,'drop');assert.equal(c.leave,'through');assert.equal(c.glow,0);assert.equal(c.outline,0);assert.equal(gm.model.PRESETS.length,1);
 for(const decoration of ['rays','mist','sparks','rings']){const migrated=gm.model.parseConfig({...config,title:'自定义标题',decoration,glow:50,idle:'glow'});assert.ok(migrated);assert.equal(migrated.title,'自定义标题');assert.equal(migrated.decoration,'none');assert.equal(migrated.glow,0);assert.equal(migrated.idle,'none');}
 const times=gm.model.presentationTimes(c);assert.ok(times.lead>0);assert.ok(times.subtitleStart>times.lead);assert.equal(gm.model.entryTime(c),times.arrival);
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
await check('failed initialization can retry without retaining duplicate room handlers',async()=>{
 const retry=client('PLAYER');retry.state.readyFailures=1;await assert.rejects(()=>retry.controller.setupTextEffects(),/readiness failed/);
 await Promise.all([retry.controller.setupTextEffects(),retry.controller.setupTextEffects()]);
 const original=packets.findLast(v=>v.name===p.PLAY).data,event={...original,id:webcrypto.randomUUID(),order:original.order+1000};
 retry.deliver(p.PLAY,event,gm.connectionId);await tick();assert.equal(retry.opens.length,1);
 const before=retry.closes.length;retry.scene(false);await tick();assert.equal(retry.closes.length,before+1);
});
await check('all reference options validate and legacy drafts migrate without losing content',async()=>{
 const {catalog,model}=gm;
 for(const[key,choices]of [['entry',catalog.ENTRY_EFFECTS],['leave',catalog.EXIT_EFFECTS],['idle',catalog.HOLD_EFFECTS],['decoration',catalog.ORNAMENTS],['flow',catalog.FLOWS],['entryEase',catalog.EASINGS],['entryOrder',catalog.ORDERS]])for(const choice of choices)assert.ok(model.parseConfig({...config,[key]:choice.id}),key+'/'+choice.id);
 const legacy={};for(const key of ['version','title','subtitle','body','font','size','color','accent','outline','outlineColor','glow','spacing','align','position','motion','decoration','background','backgroundColor','opacity','enter','hold','exit'])legacy[key]=config[key];legacy.motion='left';legacy.position='bottom';legacy.align='right';const restored=model.parseConfig(legacy);assert.equal(restored.entry,'slide');assert.equal(restored.entryDirection,'left');assert.equal(restored.anchor,'bottom-right');assert.equal(restored.title,legacy.title);
 for(const bad of [{entry:'missing'},{thirdColor:'true'},{outerOutline:17},{subtitleDelay:Infinity},{glitchColor:'url(x)'},{wrapChars:61},{decorationColor:'#fff'},{scrollFade:0}])assert.equal(model.parseConfig({...config,...bad}),null);
});
await check('motion endpoints, seeded randomness and every easing stay finite and deterministic',async()=>{
 const {catalog,motion}=gm,ctx={size:48,x:80,y:15,index:2,count:7,seed:313,power:1,direction:'left',ease:'auto'};
 for(const[key,choices,fn]of [['entry',catalog.ENTRY_EFFECTS,motion.entrance],['leave',catalog.EXIT_EFFECTS,motion.departure]])for(const choice of choices){for(const ease of catalog.EASINGS)for(const p of [0,.2,.5,.9,1]){const a=fn(choice.id,p,{...ctx,ease:ease.id}),b=fn(choice.id,p,{...ctx,ease:ease.id});assert.equal(JSON.stringify(a),JSON.stringify(b));assert.ok(Object.values(a).filter(v=>typeof v==='number').every(Number.isFinite));}if(key==='entry')assert.equal(JSON.stringify(fn(choice.id,1,ctx)),JSON.stringify(motion.neutral()));else assert.equal(fn(choice.id,1,ctx).opacity,choice.id==='none'?1:0);}
 for(const effect of catalog.HOLD_EFFECTS)for(const t of [0,300,4000])assert.ok(Object.values(motion.holding(effect.id,t,ctx)).filter(v=>typeof v==='number').every(Number.isFinite));
 for(const order of catalog.ORDERS){assert.equal(motion.stagger(0,2,7,order.id,.8),0);assert.equal(motion.stagger(1,2,7,order.id,.8),1);}
});
await check('maximum Chinese config stays under native payload limit and extended timing is shared',async()=>{
 const large={...config,title:'字'.repeat(160),subtitle:'字'.repeat(240),body:'字'.repeat(1800),flow:'char',startDelay:500,endDelay:300,subtitleDelay:200};assert.ok(new TextEncoder().encode(JSON.stringify({requestId:webcrypto.randomUUID(),action:'play',preview:false,config:large})).length<12000);const result=await request(gm,{preview:true,config:large});assert.equal(result.expiresAt,clock+500+gm.model.duration(large)+500);
});
console.log(`Text effects: ${count} scenarios passed; real Owlbear room not exercised.`);
