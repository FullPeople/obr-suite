// Node-only contract tests. No browser launch, server listen, network or product mutations.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import ts from 'typescript';
import {createIdleObservationPlugin,replaceBoundary,PROBE_SCHEMA as BUILD_SCHEMA} from './dice-idle-lifecycle-build.mjs';
import {fixtureHTML,installIdleCounters,probeOptions,waitForCondition,assertIdle,PROBE_SCHEMA} from './dice-idle-lifecycle-browser.mjs';
const fixtureSource=readFileSync('tools/workbench-dice3d-sdk-probe.mjs','utf8'),origin='http://127.0.0.1:5239';

function fakeHost(){
 const frames=new Map(),listeners=new Map();
 const document={querySelector:selector=>frames.get(selector.slice(1)),createElement:()=>{const f={contentWindow:{messages:[],postMessage(message){this.messages.push(message);}},remove(){frames.delete(f.id);f.removed=true;}};return f;},body:{append:f=>frames.set(f.id,f)}};
 const window={sendRemote:async()=>{}};
 const context=vm.createContext({window,document,location:{origin,search:'?name=Host'},URL,URLSearchParams,Map,Set,btoa:s=>Buffer.from(s).toString('base64'),addEventListener:(name,fn)=>listeners.set(name,fn)});
 const html=fixtureHTML(fixtureSource,origin),script=html.match(/<script>([\s\S]*)<\/script>/)[1];
 new vm.Script(script).runInContext(context);
 const sender={messages:[],postMessage(message){this.messages.push(message);}};
 const send=(id,data={},source=sender)=>listeners.get('message')({origin,source,data:{id,data,nonce:'n'}});
 return{frames,window,send,sender,context};
}

test('imported probes are inert and options reject unbounded or fractional inputs',()=>{
 assert.equal(BUILD_SCHEMA,PROBE_SCHEMA);assert.equal(probeOptions({}).rounds,10);
 for(const name of ['DICE_IDLE_PORT','DICE_IDLE_ROUNDS','DICE_IDLE_CYCLES','DICE_IDLE_WAIT_MS'])for(const value of ['NaN','Infinity','-1','1.5',''])assert.throws(()=>probeOptions({[name]:value}));
 assert.throws(()=>probeOptions({DICE_IDLE_WAIT_MS:'2147483648'}));assert.throws(()=>probeOptions({DICE_IDLE_PORT:'65536'}));
});
test('template transforms fail closed when source boundaries drift',()=>{
 assert.throws(()=>fixtureHTML('no template',origin));
 assert.throws(()=>fixtureHTML(fixtureSource.replace('window.fixture.sent.push(packet);','changed();'),origin));
 assert.throws(()=>replaceBoundary('aa','a','b'));
});
test('fixture loads paired SDK page and keeps only bounded host diagnostics',async()=>{
 const h=fakeHost();assert(String(h.frames.get('background').src).startsWith(origin+'/suite-dev/extensions/workbench-dice3d/sdk-verify.html?'));
 const payload={poses:new Float32Array(1024)};
 for(let i=0;i<100;i++)await h.send('OBR_BROADCAST_SEND_MESSAGE',{channel:'unused',data:payload,options:{destination:'REMOTE'}});
 assert.equal(h.window.fixture.sentCount,100);assert(!('sent' in h.window.fixture));assert(!('ids' in h.window.fixture));
 for(let i=0;i<40;i++)await h.send('OBR_NOTIFICATION_SHOW',{message:String(i)});
 assert.equal(h.window.fixture.errorCount,40);assert.equal(h.window.fixture.errors.length,32);
});
test('fixture models per-channel subscribe/unsubscribe without retaining removed iframe windows',async()=>{
 const h=fakeHost();
 await h.send('OBR_BROADCAST_SUBSCRIBE',{channel:'A'});await h.send('OBR_BROADCAST_SUBSCRIBE',{channel:'A'});
 h.window.deliver({channel:'B',data:1,source:'peer'});assert.equal(h.sender.messages.filter(m=>m.id==='OBR_BROADCAST_MESSAGE_B').length,0);
 await h.send('OBR_BROADCAST_UNSUBSCRIBE',{channel:'A'});assert.equal(h.window.fixtureSnapshot().subscriptions,1);
 h.window.deliver({channel:'A',data:1,source:'peer'});assert.equal(h.sender.messages.filter(m=>m.id==='OBR_BROADCAST_MESSAGE_A').length,1);
 await h.send('OBR_BROADCAST_UNSUBSCRIBE',{channel:'A'});assert.equal(h.window.fixtureSnapshot().subscriberWindows,0);
 await h.send('OBR_MODAL_OPEN',{id:'dice',url:'/suite-dev/dice3d/overlay.html'});const first=h.frames.get('overlay');
 await h.send('OBR_BROADCAST_SUBSCRIBE',{channel:'A'},first.contentWindow);
 await h.send('OBR_MODAL_OPEN',{id:'dice',url:'/suite-dev/dice3d/overlay.html'});assert.equal(first.removed,true);assert.equal(first.onload,null);assert.equal(h.window.fixtureSnapshot().subscriberWindows,0);
 await h.send('OBR_MODAL_CLOSE',{id:'other'});assert(h.frames.has('overlay'));
 await h.send('OBR_MODAL_CLOSE',{id:'dice'});assert(!h.frames.has('overlay'));assert.equal(h.window.fixture.modal,null);
});
test('timer instrumentation preserves callback receiver, arguments and cancellation',()=>{
 let next=1,rafFn;const timers=new Map(),nativeThis={native:true};let received;
 class Worker{terminate(){this.terminations=(this.terminations||0)+1;}}
 const window={Worker,requestAnimationFrame(fn){rafFn=fn;return 7;},setInterval(fn,ms,...args){const id=next++;timers.set(id,{fn,args});return id;},clearInterval(id){timers.delete(id);},clearTimeout(id){timers.delete(id);}};
 const context=vm.createContext({window,document:{visibilityState:'visible'},Reflect,Map,WeakSet,Number});
 vm.runInContext(`(${installIdleCounters.toString()})()`,context);
 const id=window.setInterval(function(...args){received={self:this,args};},20,'a',2),t=timers.get(id);t.fn.apply(nativeThis,t.args);
 assert.equal(received.self,nativeThis);assert.deepEqual(received.args,['a',2]);assert.equal(window.__idleCounters().intervalCallbacks,1);
 window.clearTimeout(id);assert.equal(window.__idleCounters().intervalPeriods.length,0);
 window.requestAnimationFrame(function(value){received={self:this,value};});rafFn.call(nativeThis,42);assert.equal(received.self,nativeThis);assert.equal(received.value,42);assert.equal(window.__idleCounters().rafCallbacks,1);
 const w=new window.Worker();w.terminate();w.terminate();assert.equal(window.__idleCounters().workerCreates,1);assert.equal(window.__idleCounters().workerTerminateCalls,1);assert.equal(w.terminations,2);
});
test('all diagnostic product transforms still match and emit valid TypeScript syntax',()=>{
 const plugin=createIdleObservationPlugin();
 for(const file of ['src/workbench/dice3d-verify.ts','src/workbench/dice3d.ts','extensions/workbench-dice3d/src/renderer.ts','extensions/workbench-dice3d/src/overlay.ts','extensions/workbench-dice3d/src/physics.worker.ts']){
  const source=readFileSync(file,'utf8'),changed=plugin.transform(source,resolve(file));assert.notEqual(changed,source,file);
  const result=ts.transpileModule(changed,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},reportDiagnostics:true});
  assert.deepEqual(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error),[],file);
  assert(!changed.includes('__diceIdleRenderer='),'do not add a renderer strong root');
 }
 assert.throws(()=>plugin.transform('this.gl.render(this.scene,this.camera);',resolve('extensions/workbench-dice3d/src/renderer.ts')));
});
test('verifier retains only bounded scalar log/result records, never repeated states',()=>{
 const file='src/workbench/dice3d-verify.ts',changed=createIdleObservationPlugin().transform(readFileSync(file,'utf8'),resolve(file));
 const chunk=changed.slice(changed.indexOf('local.onmessage='),changed.indexOf('(window as any).suiteHostProbe='));
 const events=[],results=[],resultListeners=new Set(),local={};
 vm.runInNewContext(ts.transpileModule(chunk,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{events,results,resultListeners,local});
 const large=new Float32Array(1024);
 for(let i=0;i<1000;i++)local.onmessage({data:{type:'state',state:{ready:true,large}}});assert.equal(events.length,0);
 for(let i=0;i<100;i++)local.onmessage({data:{type:'log',event:'render-complete',detail:{roll:String(i),large}}});
 assert.equal(events.length,64);assert.equal(events.at(-1).detail.roll,'99');assert(!('large' in events.at(-1).detail));
 for(let i=0;i<100;i++)for(const listener of resultListeners)listener({rollId:String(i),large},false);
 assert.equal(results.length,32);assert.equal(results.at(-1).rollId,'99');assert(!('large' in results.at(-1)));
});
test('worker snapshot distinguishes addressable WASM capacity and live logical bodies',()=>{
 const file='extensions/workbench-dice3d/src/physics.worker.ts',changed=createIdleObservationPlugin().transform(readFileSync(file,'utf8'),resolve(file));
 const chunk=changed.slice(changed.lastIndexOf('(globalThis as any).__diceWorkerSnapshot'));
 const context=vm.createContext({J:{HEAP8:new Uint8Array(4096)},incumbents:new Map([['a',[1,2]]]),incumbentBounds:new Map(),incumbentKinds:new Map(),incumbentGroups:new Map(),ruleRestPoses:new Map()});
 vm.runInContext(ts.transpileModule(chunk,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 const s=context.__diceWorkerSnapshot();assert.equal(s.wasmLinearMemoryBytes,4096);assert.equal(s.incumbentBodies,2);assert(!('wasmCommittedBytes' in s));
});
test('idle assertions require visible, genuinely idle endpoints and no render increments',()=>{
 const s={hidden:false,ready:true,active:0,scheduledFrame:false,audio:{active:[]},audioTimer:false,renderCalls:4};assertIdle(s,{...s});
 assert.throws(()=>assertIdle(s,{...s,renderCalls:5}));assert.throws(()=>assertIdle({...s,scheduledFrame:true},s));assert.throws(()=>assertIdle(s,{...s,hidden:true}));
});
test('condition wait handles asynchronous predicates and explicit timeout',async()=>{
 await waitForCondition(async()=>true,'ready',0);await assert.rejects(waitForCondition(async()=>false,'worker never closed',0),/worker never closed/);
});

test('expression is recorded as one bounded single-die or multi-die fixture choice',()=>{assert.equal(probeOptions({}).expression,'1d20+5');assert.equal(probeOptions({DICE_IDLE_EXPRESSION:'9d6'}).expression,'9d6');assert.throws(()=>probeOptions({DICE_IDLE_EXPRESSION:'1000d6'}),/DICE_IDLE_EXPRESSION/);});
