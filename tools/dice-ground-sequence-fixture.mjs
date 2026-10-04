/** Browser-side CI instrumentation. No pixel reads, GPU timers, finish, or captures
 * occur in this module. Measured drawFrame includes runtime key/build/compile cost. */
export function installSequenceFixture(r,T,installGroundLiveProbe,trust){
 if(T.REVISION!=='186')throw Error('Runtime audit requires Three r186');
 const config=globalThis.__diceSequenceConfig||{};
 globalThis.__diceProfileRenderer=r;globalThis.__diceProfileThree=T;
 const profile={frames:[],rolls:[],events:[],config};globalThis.__diceSequenceProfile=profile;
 const originalEmit=r.emit;
 r.emit=function(event,detail){profile.events.push({event,detail,observedAt:performance.timeOrigin+performance.now()});return originalEmit.call(this,event,detail);};
 const originalAdd=r.add;
 r.add=function(...args){const answer=originalAdd.apply(this,args),active=this.active.at(-1);profile.rolls.push({roll:args[0],queuedStart:args[1],cue:active.cue,initialBirths:active.births});return answer;};
 const originalFrame=r.drawFrame;
 r.drawFrame=function(...args){
  const began=performance.now(),at=performance.timeOrigin+began;
  try{return originalFrame.apply(this,args);}
  finally{profile.frames.push({at,finishedAt:performance.timeOrigin+performance.now(),wholeJsMs:performance.now()-began,probeFrame:globalThis.__diceGroundLiveProbe?.stats.frames,activeRolls:this.active.length,drawCalls:this.gl.info.render.calls,triangles:this.gl.info.render.triangles});}
 };
 if(config.fixedClock){const originalWake=r.wake;r.wake=function(){if(!globalThis.__diceSequenceConfig.fixedClock)return originalWake.call(this);};}
 globalThis.__diceGroundLiveProbe=installGroundLiveProbe({r,T,enabled:!!config.enabled,minBodies:config.minBodies??20,stableFrames:config.stableFrames??3,trust});
}

/** A small host that uses the real installed SDK messaging protocol. Physics,
 * transport/controller, mesh construction, cues, and playback are real product code. */
export function fixtureHTML(origin,{single=false}={}){
 const base=origin+'/suite-dev/';
 return `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>body{margin:0;background:#55606b}#overlay{position:absolute;inset:0;width:100vw;height:100vh;border:0;pointer-events:none}#background{display:none}</style></head><body><script>
 const base=${JSON.stringify(base)},single=${JSON.stringify(single)},name=new URLSearchParams(location.search).get('name'),client='fixture-'+name,subscribers=new Set();
 window.fixture={errors:[],sent:[],metadata:{'com.obr-suite/dice/3d-theme':'ink_sketch'},ids:[]};
 function frame(file,id){const f=document.createElement('iframe');f.id=id;const u=new URL(file,base);u.searchParams.set('obrref',btoa(location.origin+' fixture-room'));f.src=u;f.onload=()=>f.contentWindow.postMessage({id:'OBR_READY',data:{ref:'fixture-'+id,userId:'user-'+name}},new URL(base).origin);document.body.append(f);}
 window.deliver=packet=>{for(const w of subscribers)w.postMessage({id:'OBR_BROADCAST_MESSAGE_'+packet.channel,data:{data:packet.data,connectionId:packet.source}},new URL(base).origin);};
 addEventListener('message',async e=>{if(e.origin!==new URL(base).origin)return;const m=e.data;if(typeof m?.id!=='string')return;window.fixture.ids.push(m.id);let data={};
 if(m.id==='OBR_PLAYER_GET_CONNECTION_ID')data={connectionId:client};
 else if(m.id==='OBR_PLAYER_GET_ID')data={id:'user-'+name};
 else if(m.id==='OBR_PLAYER_GET_NAME')data={name};
 else if(m.id==='OBR_PLAYER_GET_COLOR')data={color:name==='Host'?'#28b1fa':'#e9a055'};
 else if(m.id==='OBR_PLAYER_GET_ROLE')data={role:name==='Host'?'GM':'PLAYER'};
 else if(m.id==='OBR_PARTY_GET_PLAYERS')data={players:(single?[]:['Host','Player'].filter(n=>n!==name)).map(n=>({id:'user-'+n,connectionId:'fixture-'+n,name:n,role:n==='Host'?'GM':'PLAYER',color:n==='Host'?'#28b1fa':'#e9a055',syncView:false,metadata:{}}))};
 else if(m.id.endsWith('_GET_METADATA'))data={metadata:window.fixture.metadata};
 else if(m.id==='OBR_PLAYER_GET_SELECTION')data={selection:[]};else if(m.id==='OBR_SCENE_IS_READY')data={ready:true};
 else if(m.id==='OBR_VIEWPORT_GET_WIDTH')data={width:innerWidth};else if(m.id==='OBR_VIEWPORT_GET_HEIGHT')data={height:innerHeight};
 else if(m.id==='OBR_SCENE_ITEMS_GET_ITEMS'||m.id==='OBR_SCENE_ITEMS_GET_ALL_ITEMS')data={items:[]};
 else if(m.id==='OBR_PLAYER_SET_METADATA')window.fixture.metadata={...window.fixture.metadata,...m.data.metadata};
 else if(m.id==='OBR_BROADCAST_SUBSCRIBE')subscribers.add(e.source);
 else if(m.id==='OBR_BROADCAST_SEND_MESSAGE'){const packet={channel:m.data.channel,data:m.data.data,source:client,destination:m.data.options?.destination||'ALL'};window.fixture.sent.push(packet);if(packet.destination!=='REMOTE')window.deliver(packet);if(packet.destination!=='LOCAL')await window.sendRemote(packet);}
 else if(m.id==='OBR_MODAL_OPEN'){window.fixture.modal=m.data;frame(m.data.url,'overlay');}
 else if(m.id==='OBR_POPOVER_OPEN')window.fixture.historyOpened=m.data;
 else if(m.id==='OBR_NOTIFICATION_SHOW')window.fixture.errors.push(m.data);
 if(m.nonce)e.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data},e.origin);
 });frame('extensions/workbench-dice3d/sdk-verify.html','background');</script></body></html>`;
}
