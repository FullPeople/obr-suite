// Diagnostic transforms only. No production source is rewritten on disk.
export const tailMutableFiles=new Set([
 'tools/dice-latency-build.mjs','tools/dice-latency-browser.mjs',
 'tools/dice-tail-trace.mjs','tools/dice-tail-trace.test.mjs',
 'tools/dice-tail-source-guard.mjs','.github/workflows/dice-tail-trace.yml',
 'tools/dice-tail-trace-README.md',
 '.github/workflows/dice-tail-paired.yml','tools/dice-tail-paired-config.json',
 'tools/dice-tail-paired-summary.mjs',
 'tools/dice-ready-tail-slot.test.ts','tools/dice-ready-tail-slot-selftest.mjs',
]);
export const protectedTailInventory=tree=>tree.split('\0').filter(Boolean).filter(entry=>!tailMutableFiles.has(entry.slice(entry.indexOf('\t')+1)));
const emit=(event,id,state='{}')=>`(globalThis as any).__diceTailEvent?.(${JSON.stringify(event)},${id},${state});`;
export const tailSourceFiles=[
 'extensions/workbench-dice3d/src/controller.ts','src/workbench/dice-broadcast.ts',
 'src/workbench/dice3d.ts','extensions/workbench-dice3d/src/overlay.ts',
 'extensions/workbench-dice3d/src/renderer.ts',
];
export function instrumentTail(code,id){
 const file=id.replaceAll('\\','/');if(code.includes('/* dice-tail-instrumented */'))throw Error('Tail trace boundary already instrumented: '+file);let touched=false;
 const once=(from,to)=>{const count=code.split(from).length-1;if(count!==1)throw Error(`Tail trace boundary ${file}: expected 1, got ${count}: ${from.slice(0,100)}`);code=code.replace(from,to);touched=true;};
 if(file.endsWith('/extensions/workbench-dice3d/src/controller.ts')){
  if(code.includes('private async sendTail(out:Outgoing,signature:string|undefined,generation:number)')){
   const guard='if(!out.uploading||out.started||out.wait.size||generation!==this.preparationGeneration||signature!==this.tailSignature(out))return;';
   once(guard,guard+emit('tail-slot-decision','out.roll.request.id','{current:this.outgoing.get(out.roll.request.id)===out,live:!this.disposed,generationValid:generation===this.preparationGeneration,preparationVerified:generation===this.preparationGeneration,authority:out.roll.request.authority===this.transport.id&&this.authority()===this.transport.id,sessionVerified:signature!==undefined&&signature===this.tailSignature(out),allReady:out.wait.size===0,wait:out.wait.size,uploading:out.uploading}'));
   once('row.uploading=false;row.at=now();',`row.uploading=false;${emit('uploading-false','row.roll.request.id','{wait:row.wait.size,uploading:row.uploading,current:this.outgoing.get(row.roll.request.id)===row,live:!this.disposed}')}row.at=now();`);
  }
  once('this.assertLive();\n    if(!this.ready)',`this.assertLive();${emit('source-submit','options?.id','{live:!this.disposed}')}\n    if(!this.ready)`);
  once('this.accepted.set(request.id,now());',emit('authority-request-accepted','request.id','{live:!this.disposed,authority:this.authority()===this.transport.id,count:request.count}')+'this.accepted.set(request.id,now());');
  once('private postWorker(packet:any){if(!this.disposed)this.worker.postMessage(packet)}',`private postWorker(packet:any){if(!this.disposed){if(packet.request)${emit('worker-post','packet.request.id','{count:packet.request.count,live:!this.disposed}')}this.worker.postMessage(packet)}}`);
  once('this.worker.onmessage=e=>{void this.onWorker(e.data)',`this.worker.onmessage=e=>{if(e.data?.id)${emit('worker-response','e.data.id','{live:!this.disposed,matchingPending:this.pending?.id===e.data.id,physicsMs:e.data.roll?.physicsMs}')}void this.onWorker(e.data)`);
  once('const sha=await hash(bytes);this.assertLive();const chunks=split(bytes);',emit('encode-complete','roll.request.id','{bytes:bytes.length,live:!this.disposed}')+'const sha=await hash(bytes);this.assertLive();'+emit('authority-sha-complete','roll.request.id','{bytes:bytes.length,live:!this.disposed}')+'const chunks=split(bytes);');
  once('out.uploading=false;out.at=now();',`out.uploading=false;${emit('uploading-false','out.roll.request.id','{wait:out.wait.size,uploading:out.uploading,current:this.outgoing.get(out.roll.request.id)===out,live:!this.disposed}')}out.at=now();`);
  once("if(p?.type==='prepared'){",`if(p?.type==='prepared'){${emit('controller-prepared','p.id','{live:!this.disposed,hasOutgoing:this.outgoing.has(p.id),hasInbound:this.inbound.has(p.id)}')}`);
  once('out.wait.delete(this.transport.id);',`out.wait.delete(this.transport.id);${emit('authority-wait-change','p.id','{wait:out.wait.size,uploading:out.uploading,current:this.outgoing.get(p.id)===out,live:!this.disposed}')}`);
  once('out.wait.delete(source);this.log(\'peer-prepared\'',`out.wait.delete(source);${emit('authority-wait-change','p.id','{wait:out.wait.size,uploading:out.uploading,current:this.outgoing.get(p.id)===out,live:!this.disposed,memberVerified:out.members.includes(source),hashVerified:out.hash===p.hash}')}this.log('peer-prepared'`);
  once('private async maybeStart(out:Outgoing){',`private async maybeStart(out:Outgoing){${emit('authority-start-gate','out.roll.request.id','{wait:out.wait.size,uploading:out.uploading,started:out.started,current:this.outgoing.get(out.roll.request.id)===out,live:!this.disposed}')}`);
  once('start=Math.max(now()+lead,...this.settledAt.values());wire.start=start;dispatched=true;',`start=Math.max(now()+lead,...this.settledAt.values());wire.start=start;dispatched=true;${emit('authority-start-planned','reservationId','{planned:start,leadMs:lead,wait:rows[0].wait.size,uploading:rows[0].uploading,live:!this.disposed,current:this.outgoing.get(rows[0].roll.request.id)===rows[0]}')}`);
  once('this.stopTransport=transport.listen((p,s)=>{const receivedAt=now();',`this.stopTransport=transport.listen((p,s)=>{const receivedAt=now();${emit('transport-receive','p?.id??p?.request?.id','{type:p?.type,index:p?.index,fragmentBase64Chars:p?.data?.length,live:!this.disposed}')} `);
  once('if(fresh)inbound.at=now();',`if(fresh)inbound.at=now();${emit('peer-chunk-accepted','p.id','{index:p.index,total:inbound.assembly.total,missing:inbound.assembly.missing().length,current:this.inbound.get(p.id)===inbound,live:!this.disposed}')}`);
  once('inbound.processing=true;const bytes=await inbound.assembly.finish();this.assertLive();let roll=await decodeRoll(bytes) as Roll;this.assertLive();',`inbound.processing=true;${emit('peer-all-chunks','p.id','{total:inbound.assembly.total,missing:0,current:this.inbound.get(p.id)===inbound,live:!this.disposed}')}const bytes=await inbound.assembly.finish();this.assertLive();${emit('peer-sha-complete','p.id','{bytes:bytes.length,live:!this.disposed,current:this.inbound.get(p.id)===inbound}')}let roll=await decodeRoll(bytes) as Roll;this.assertLive();${emit('peer-decode-complete','p.id','{count:roll.kinds.length,live:!this.disposed,current:this.inbound.get(p.id)===inbound}')}`);
  once('this.rolls.set(p.id,roll);this.addRecord(roll);this.postLocal({type:\'prepare\',roll});',emit('peer-permission-verified','p.id','{live:!this.disposed,current:this.inbound.get(p.id)===inbound,authority:source===this.authority(),identityVerified:roll.request.id===p.id&&roll.request.authority===source}')+'this.rolls.set(p.id,roll);this.addRecord(roll);this.postLocal({type:\'prepare\',roll});');
  once("case 'chunks-done':{const inbound=this.inbound.get(p.id);",`case 'chunks-done':{const inbound=this.inbound.get(p.id);${emit('peer-trailer','p.id','{missing:inbound?.assembly.missing().length,prepared:inbound?.prepared,processing:inbound?.processing,sourceVerified:inbound?.source===source,live:!this.disposed}')}`);
  once('let localStart=p.start-peer.offset;',emit('peer-start-verified','p.id','{live:!this.disposed,current:this.inbound.get(p.id)===inbound,prepared:inbound.prepared,hashVerified:inbound.assembly.sha===p.hash,sourceVerified:inbound.source===source,clockVerified:peer.rtt>=0}')+'let localStart=p.start-peer.offset;');
  once('this.retainUntilExit(roll,localStart);',emit('peer-start-planned','p.id','{planned:localStart,live:!this.disposed}')+'this.retainUntilExit(roll,localStart);');
 }
 if(file.endsWith('/src/workbench/dice-broadcast.ts')){
  const from="=>queue.send(()=>{beforeDispatch?.();return OBR.broadcast.sendMessage(channel,data,options);},valid,controlTypes.has(data?.type)?'control':'normal');";
  once(from,`=>{const id=data?.id??data?.request?.id,operation=((globalThis as any).__diceTailSendSequence=((globalThis as any).__diceTailSendSequence??0)+1),enqueuedType=data?.type;const state=()=>({operation,enqueuedType,type:data?.type,index:data?.index,bytes:new TextEncoder().encode(JSON.stringify(data)).length,total:data?.total,repair:data?.type==='chunk'&&!!data?.to,priority:controlTypes.has(data?.type)?'control':'normal',generationValid:valid()});${emit('send-enqueue','id','state()')}return queue.send(()=>{beforeDispatch?.();${emit('send-dispatch','id','state()')}const result=OBR.broadcast.sendMessage(channel,data,options);void result.then(()=>{try{${emit('send-sdk-ack','id','state()')}}catch{}},()=>{try{${emit('send-sdk-error','id','state()')}}catch{}});return result;},valid,controlTypes.has(data?.type)?'control':'normal');};`);
 }
 if(file.endsWith('/src/workbench/dice3d.ts')){
  once("const options={id,recipe:true,kind:'mixed',count,theme:theme(observed.player.metadata),modifier:compat?.modifier??0,",emit('suite-request-valid','id','{generationValid:own===generation,count}')+"const options={id,recipe:true,kind:'mixed',count,theme:theme(observed.player.metadata),modifier:compat?.modifier??0,");
 }
 if(file.endsWith('/extensions/workbench-dice3d/src/overlay.ts')){
  once("bus.postMessage({type:'prepared',id:p.roll.request.id})",emit('overlay-cache-prepared','p.roll.request.id','{prepared:prepared.has(p.roll.request.id),count:p.roll.kinds.length}')+"bus.postMessage({type:'prepared',id:p.roll.request.id})");
  once("else if(p.type==='start'){const roll=prepared.get(p.id);",`else if(p.type==='start'){${emit('overlay-start','p.id','{prepared:prepared.has(p.id),planned:p.at}')}const roll=prepared.get(p.id);`);
  once('}prepared.delete(p.id)}',`}${emit('overlay-add-complete','p.id','{prepared:prepared.has(p.id),planned:p.at}')}prepared.delete(p.id)}`);
 }
 if(file.endsWith('/extensions/workbench-dice3d/src/renderer.ts')){
  once('private frame(){',`private frame(){for(const a of this.active)${emit('renderer-raf-call','a.roll.request.id','{planned:a.start}')}`);
  once("a.released=true;this.emit('render-release'","a.released=true;(globalThis as any).__diceTailEvent?.('renderer-release',a.roll.request.id,{planned:a.start},time);this.emit('render-release'");
 }
 return touched?'/* dice-tail-instrumented */\n'+code:undefined;
}
export function tailEvent(event,id,state={},originAt){
 if(typeof id!=='string'||!id)return;
 const allowed=new Set(['type','enqueuedType','operation','index','total','bytes','fragmentBase64Chars','physicsMs','count','wait','uploading','current','live','started','prepared','processing','missing','authority','matchingPending','generationValid','identityVerified','memberVerified','hashVerified','sourceVerified','clockVerified','sessionVerified','preparationVerified','allReady','planned','leadMs','priority','repair','glReturnMs','readbackSpanMs','visibleDice','opaquePixels','glError']);
 const clean={};for(const [key,value]of Object.entries(state))if(allowed.has(key)&&['string','number','boolean'].includes(typeof value))clean[key]=value;
 const events=globalThis.__diceTailTrace??=[];events.push({event,id,at:originAt??performance.timeOrigin+performance.now(),state:clean});
 if(events.length>30000)throw Error('Tail trace exceeded bounded event budget');
}

export function validateTailCase(row,{sourceMode='baseline'}={}){
 const assert=(value,message)=>{if(!value)throw Error(`Tail case ${row.name}: ${message}`)};
 const forClient=index=>row.clients[index].tailEvents;
 const all=row.clients.flatMap((c,index)=>c.tailEvents.map(e=>({...e,client:index}))).sort((a,b)=>a.at-b.at);
 const first=(events,event,type)=>{const found=events.find(e=>e.event===event&&(!type||e.state.type===type));assert(found,`missing ${event}${type?' '+type:''}`);return found;};
 const authority=all.find(e=>e.event==='authority-request-accepted')?.client;assert(authority===0||authority===1,'one authority accepted request');
 const peer=1-authority,a=forClient(authority),p=forClient(peer);
 const chain=(events,stages)=>{let prev=-Infinity;for(const [name,type]of stages){const e=first(events,name,type);assert(e.at>=prev,`causal order ${name} ${type??''}`);prev=e.at;}};
 for(const event of all){assert(Number.isFinite(event.at),'finite origin timestamp');for(const key of ['live','current','generationValid','identityVerified','memberVerified','hashVerified','sourceVerified','clockVerified'])if(key in event.state)assert(event.state[key]===true,`${event.event} ${key} must be true`);}
 chain(a,[['authority-request-accepted'],['worker-post'],['worker-response'],['encode-complete'],['authority-sha-complete'],['send-enqueue','offer'],['send-dispatch','offer'],['send-sdk-ack','offer']]);
 chain(p,[['peer-all-chunks'],['peer-sha-complete'],['peer-decode-complete'],['peer-permission-verified'],['overlay-cache-prepared'],['controller-prepared'],['send-enqueue','ready'],['send-dispatch','ready'],['send-sdk-ack','ready']]);
 const start=first(a,'send-dispatch','start'),gate=first(a,'authority-start-planned'),waitZero=a.find(e=>e.event==='authority-wait-change'&&e.state.wait===0);
 const startACK=first(a,'send-sdk-ack','start'),startEnqueue=a.find(e=>e.event==='send-enqueue'&&e.state.type==='start');
 const operationEnqueue=a.find(e=>e.event==='send-enqueue'&&e.state.operation===start.state.operation),promotedTailSlot=operationEnqueue?.state.type==='chunks-done';
 assert(operationEnqueue&&operationEnqueue.at<=start.at,'actual start operation has one source enqueue');
 assert(startACK.state.operation===start.state.operation&&startACK.at>=start.at,'SDK ACK belongs to original dispatched operation');
 assert(a.filter(e=>e.event==='send-dispatch'&&e.state.type==='start').length===1,'one actual start operation per roll');
 assert(waitZero&&start.at>=waitZero.at,'authority start after all-ready barrier');
 assert(gate.state.wait===0&&gate.state.uploading===false&&gate.state.current&&gate.state.live,'valid authority barrier at arming');
 if(promotedTailSlot){
  assert(sourceMode==='candidate'&&row.name!=='tail-drop-last-1d6','tail replacement limited to candidate normal cases');
  assert(!startEnqueue&&!a.some(e=>e.event==='send-dispatch'&&e.state.type==='chunks-done'),'same tail operation becomes the sole start, without another start enqueue or trailer dispatch');
  assert(start.state.enqueuedType==='chunks-done'&&startACK.state.enqueuedType==='chunks-done','operation retains original enqueued type through ACK');
  const decision=first(a,'tail-slot-decision');assert(decision.at>=waitZero.at&&decision.at<=gate.at,'final tail decision made after readiness at actual dispatch');
  for(const key of ['current','live','generationValid','authority','sessionVerified','preparationVerified','allReady'])assert(decision.state[key]===true,'tail slot '+key+' verified at dispatch');
  assert(decision.state.wait===0,'tail promotion sees zero outstanding readiness');
  chain(a,[['tail-slot-decision'],['uploading-false'],['authority-start-planned'],['send-dispatch','start'],['send-sdk-ack','start']]);
 }else{
  const uploading=first(a,'uploading-false');assert(start.at>=uploading.at,'legacy start follows completed upload');
  chain(a,[['send-enqueue','chunks-done'],['send-dispatch','chunks-done'],['send-sdk-ack','chunks-done'],['uploading-false'],['send-enqueue','start'],['authority-start-planned'],['send-dispatch','start'],['send-sdk-ack','start']]);
  // Safety-valid fallback remains observable; the paired summary requires all
  // three normal candidate promotions after collecting the bounded 12 cases.
 }
 chain(p,[['peer-start-verified'],['peer-start-planned'],['overlay-start'],['overlay-add-complete'],['renderer-raf-call'],['renderer-gl-return']]);
 for(const events of [a,p]){const prepared=first(events,'overlay-cache-prepared'),overlayStart=first(events,'overlay-start'),added=first(events,'overlay-add-complete');assert(prepared.at<=gate.at,'every client prepared before authority arming');assert(overlayStart.state.prepared&&added.state.prepared,'overlay start consumes prepared cache');}
 for(const client of row.clients){assert(client.visibleAttribution==='single-active-roll','independent visible attribution');assert(client.visibleEvidence.length>=2,'moving readback evidence');assert(client.visibleEvidence.every(e=>e.visibleDice>0&&e.opaquePixels>0&&e.glError===0&&e.completedAt>=e.submittedAt&&e.readbackSpanMs>=0),'completed visible readback');assert(client.renderCosts.every(e=>e.glReturnMs>=0&&e.readbackSpanMs>=0&&e.renderCpuMs>=e.glReturnMs),'split GL/readback timing');}
 const trailer=p.find(e=>e.event==='peer-trailer');
 if(!promotedTailSlot)assert(trailer,'unpromoted path retains actual trailer delivery');
 else assert(!trailer,'promoted path does not also deliver trailer');
 if(row.name==='tail-drop-last-1d6'){
  assert(row.injections?.lastChunk===1,'exactly one last fragment actually dropped');assert(trailer.state.missing===1&&!trailer.state.prepared&&!trailer.state.processing,'trailer sees one absent fragment and unprepared receiver');
  const missing=first(p,'send-enqueue','missing'),repair=a.find(e=>e.event==='send-dispatch'&&e.state.type==='chunk'&&e.state.repair),allChunks=first(p,'peer-all-chunks');
  assert(missing.at>=trailer.at&&repair&&repair.at>=missing.at&&allChunks.at>=repair.at,'trailer-triggered NACK and actual targeted repair');
  assert(first(p,'send-enqueue','ready').at>=allChunks.at&&start.at>=allChunks.at,'no readiness or playback before repaired complete trajectory');
 }
 const lastChunk=all.filter(e=>e.client===authority&&e.event==='send-dispatch'&&e.state.type==='chunk'&&!e.state.repair).at(-1);
 const ready=first(p,'send-dispatch','ready'),trailerAck=a.find(e=>e.event==='send-sdk-ack'&&e.state.type==='chunks-done'),trailerDispatch=a.find(e=>e.event==='send-dispatch'&&e.state.type==='chunks-done'),lastChunkACK=a.filter(e=>e.event==='send-sdk-ack'&&e.state.type==='chunk'&&!e.state.repair).at(-1);
 const clientFrames=row.clients.map((client,index)=>{const events=forClient(index),release=first(events,'renderer-release'),raf=events.filter(e=>e.event==='renderer-raf-call'&&e.at<=release.at).at(-1),gl=events.find(e=>e.event==='renderer-gl-return'&&e.at>=release.at),visible=client.visibleEvidence[0];assert(raf&&gl,'release callback and GL boundaries');assert(visible.completedAt>=release.at,'visible readback follows release');return{client:index,prestartBlankFrames:events.filter(e=>e.event==='renderer-gl-return'&&e.state.visibleDice===0&&e.at<release.state.planned).length,addCompleteMs:first(events,'overlay-add-complete').at-row.submittedAt,firstRafAfterAddMs:first(events,'renderer-raf-call').at-row.submittedAt,releaseMs:release.at-row.submittedAt,releaseRafCallMs:raf.at-row.submittedAt,releaseGlReturnMs:gl.at-row.submittedAt,firstVisibleReadbackGlReturnMs:visible.submittedAt-row.submittedAt,firstVisibleReadbackMs:visible.completedAt-row.submittedAt,firstVisibleReadbackSpanMs:visible.readbackSpanMs};});
 return {authority,peer,sourceMode,promotedTailSlot,startOperation:{operation:start.state.operation,enqueuedType:operationEnqueue.state.type,enqueueAt:operationEnqueue.at,dispatchAt:start.at,ackAt:startACK.at},clientFrames,eventCount:all.length,preparedOnBothClients:true,validGenerationAndPermissions:true,missingTailRecovered:row.name==='tail-drop-last-1d6',waitZeroWhileUploading:waitZero.state.uploading,measuredMs:{submitToAuthority:first(a,'authority-request-accepted').at-row.submittedAt,workerPhysicsMs:first(a,'worker-response').state.physicsMs,workerRoundTrip:first(a,'worker-response').at-first(a,'worker-post').at,workerResponseToEncode:first(a,'encode-complete').at-first(a,'worker-response').at,encodeToHash:first(a,'authority-sha-complete').at-first(a,'encode-complete').at,lastChunkDispatchToPeerAllChunks:first(p,'peer-all-chunks').at-lastChunk.at,peerAllChunksToSHA:first(p,'peer-sha-complete').at-first(p,'peer-all-chunks').at,peerSHAToDecode:first(p,'peer-decode-complete').at-first(p,'peer-sha-complete').at,decodeToPermission:first(p,'peer-permission-verified').at-first(p,'peer-decode-complete').at,permissionToPrepared:first(p,'overlay-cache-prepared').at-first(p,'peer-permission-verified').at,readyQueue:ready.at-first(p,'send-enqueue','ready').at,readySDK:first(p,'send-sdk-ack','ready').at-ready.at,waitZeroToTrailerEnqueue:first(a,'send-enqueue','chunks-done').at-waitZero.at,waitZeroToTrailerDispatch:trailerDispatch?trailerDispatch.at-waitZero.at:null,waitZeroToTrailerACK:trailerAck?trailerAck.at-waitZero.at:null,waitZeroToStartEnqueue:startEnqueue?startEnqueue.at-waitZero.at:null,startQueue:startEnqueue?start.at-startEnqueue.at:null,waitZeroToStartDispatch:start.at-waitZero.at,lastChunkACKToStartDispatch:start.at-lastChunkACK.at,startOperationQueue:start.at-operationEnqueue.at,startSDK:first(a,'send-sdk-ack','start').at-start.at,plannedLead:gate.state.planned-start.at},timeline:all};
}
