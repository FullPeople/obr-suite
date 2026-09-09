// Actual browser Web Audio in same-origin iframes; no Owlbear room or speaker claim.
import assert from 'node:assert/strict';
import { build } from 'rolldown';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const source=resolve('extensions/three-dragon-ante/src/game/audio.ts'),out=mkdtempSync(join(tmpdir(),'tda-sound-'));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),pin=hash(source);
const entry=`import {mountTableAudio,__synthesize} from ${JSON.stringify(source)};
const Native=AudioContext,contexts=[],sources=[];
class ObservedContext extends Native {
 constructor(...args){super(...args);contexts.push(this);}
 createBufferSource(){return observe(super.createBufferSource(),'buffer');}
 createOscillator(){return observe(super.createOscillator(),'oscillator');}
}
function observe(node,kind){const record={kind,started:false,stopped:false,ended:false};sources.push(record);const start=node.start.bind(node),stop=node.stop.bind(node);node.start=(...args)=>{record.started=true;return start(...args);};node.stop=(...args)=>{if(!args.length)record.stopped=true;return stop(...args);};node.addEventListener('ended',()=>record.ended=true);return node;}
window.AudioContext=ObservedContext;
const handles={},changes=[];
function mount(id){handles[id]=mountTableAudio(document.getElementById(id),{onEnabledChange:enabled=>changes.push({id,enabled})});}
mount('a');
window.sound={mount,play:(id,kind,key)=>handles[id].play(kind,key),enabled:id=>handles[id].enabled,set:(id,v)=>handles[id].setEnabled(v),suspend:id=>handles[id].suspend(),resume:id=>handles[id].resume(),destroy:id=>handles[id].destroy(),
 state:()=>({contexts:contexts.map(c=>c.state),sources,changes,stored:localStorage.getItem('three-dragon-ante.sound.v1')}),
 async sample(kind){const context=new OfflineAudioContext(1,16800,48000),gain=context.createGain();gain.gain.value=.22;gain.connect(context.destination);__synthesize(context,gain,kind,()=>{});const rendered=await context.startRendering();return Array.from(rendered.getChannelData(0));}};
`;
await build({input:'sound-entry',plugins:[{name:'actual-service',resolveId(id){if(id==='sound-entry')return'\0entry';},load(id){if(id==='\0entry')return entry;},transform(code,id){if(id.replaceAll('\\','/')===source.replaceAll('\\','/'))return code+'\nexport {synthesize as __synthesize};';}}],output:{file:join(out,'app.js'),format:'esm'},logLevel:'silent'});
const app=readFileSync(join(out,'app.js')),requests=[];
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;requests.push(path);res.setHeader('Cache-Control','no-store');
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>iframe{width:420px;height:220px}</style><iframe id="one" src="/frame"></iframe><iframe id="two" src="/frame"></iframe>');}
 else if(path==='/frame'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><button id="a">Table A</button><button id="b">Table B</button><script type="module" src="/app.js"></script>');}
 else if(path==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(app);}
 else{res.statusCode=404;res.end('Not found');}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`;
const {chromium}=await import(pathToFileURL('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--autoplay-policy=user-gesture-required']});
const checks=[],errors=[],samples={};
const mark=name=>{checks.push(name);console.log(`PASS ${checks.length}: ${name}`);};
function wav(values){const b=Buffer.alloc(44+values.length*2);b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(values.length*2,40);values.forEach((v,i)=>b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*2));return b;}
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 const one=await page.locator('#one').elementHandle(),two=await page.locator('#two').elementHandle();const f=await one.contentFrame(),g=await two.contentFrame();await f.waitForFunction(()=>!!window.sound);await g.waitForFunction(()=>!!window.sound);
 assert.equal(await f.evaluate(()=>window.sound.play('a','draw','before-interaction')),false);await f.evaluate(()=>document.querySelector('#a').click());
 assert.deepEqual((await f.evaluate(()=>window.sound.state())).contexts,[],'Synthetic events never unlock or create a context');
 await f.locator('#a').click();await f.waitForFunction(()=>window.sound.state().contexts[0]==='running');
 assert.equal(await f.evaluate(()=>window.sound.play('a','draw','before-interaction')),false,'Skipped early cue is consumed, not replayed on unlock');
 assert.equal(await f.evaluate(()=>window.sound.play('a','draw','game:1:draw')),true);assert.equal(await f.evaluate(()=>window.sound.play('a','draw','game:1:draw')),false);
 await page.waitForTimeout(240);mark('A trusted iframe interaction unlocks real AudioContext; no early queue or duplicate cue');
 for(const kind of ['draw','flip','coin']){
  const values=await f.evaluate(kind=>window.sound.sample(kind),kind),peak=Math.max(...values.map(Math.abs)),rms=Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length);
  assert.ok(values.every(Number.isFinite));assert.ok(peak>.005&&peak<.15,`${kind} has bounded audible-range energy`);assert.ok(rms>.001);
  assert.ok(values.slice(14400).every(v=>Math.abs(v)<.00001),`${kind} ends before 300ms`);
  const bytes=wav(values);writeFileSync(join(out,`${kind}.wav`),bytes);samples[kind]={peak,rms,sha256:createHash('sha256').update(bytes).digest('hex')};
 }
 assert.equal(new Set(Object.values(samples).map(v=>v.sha256)).size,3);mark('Native OfflineAudioContext renders three distinct finite paper/coin waveforms with quiet peaks');
 await page.waitForTimeout(1100);
 const spam=await f.evaluate(()=>Array.from({length:24},(_,i)=>window.sound.play('a','draw',`burst:${i}`)));
 assert.equal(spam.filter(Boolean).length,3,'One document permits at most three simultaneous voices');
 await page.waitForTimeout(260);
 assert.equal(await f.evaluate(()=>window.sound.play('a','draw','burst:7')),false,'A dropped busy cue does not replay when a voice is free');
 assert.ok((await f.evaluate(()=>window.sound.state())).sources.every(s=>!s.started||s.stopped||s.ended));mark('Burst playback is bounded and native ended events release every source without an idle loop');
 await f.evaluate(()=>window.sound.mount('b'));await f.locator('#b').click();await f.waitForFunction(()=>window.sound.state().contexts[0]==='running');
 assert.equal((await f.evaluate(()=>window.sound.state())).contexts.length,1,'Two local surfaces share one native context');
 assert.equal(await f.evaluate(()=>window.sound.play('a','coin','old-owner')),false);assert.equal(await f.evaluate(()=>window.sound.play('b','coin','new-owner')),true);
 await f.evaluate(()=>window.sound.suspend('b'));assert.ok((await f.evaluate(()=>window.sound.state())).sources.every(s=>!s.started||s.stopped||s.ended));
 assert.equal(await f.evaluate(()=>window.sound.play('b','flip','suspended')),false);await f.evaluate(()=>window.sound.resume('a'));await f.waitForFunction(()=>window.sound.state().contexts[0]==='running');assert.equal(await f.evaluate(()=>window.sound.play('a','flip','suspended')),false);
 mark('Local surface ownership transfers synchronously; suspension stops voices and does not queue them');
 await g.locator('#a').click();await g.waitForFunction(()=>window.sound.state().contexts[0]==='running');await f.waitForFunction(()=>window.sound.state().contexts[0]==='suspended');
 assert.equal(await f.evaluate(()=>window.sound.play('a','coin','remote-claim')),false);assert.equal(await g.evaluate(()=>window.sound.play('a','coin','remote-claim')),true);await page.waitForTimeout(260);
 await f.locator('#a').click();await f.waitForFunction(()=>window.sound.state().contexts[0]==='running');await g.waitForFunction(()=>window.sound.state().contexts[0]==='suspended');
 mark('Same-origin sibling iframe last-interaction channel silences the previous surface');
  await f.evaluate(()=>window.sound.set('a',false));await g.waitForFunction(()=>window.sound.enabled('a')===false);assert.equal(await f.evaluate(()=>window.sound.play('a','draw','muted')),false);
  assert.equal((await f.evaluate(()=>window.sound.state())).stored,'off');assert.ok((await f.evaluate(()=>window.sound.state())).changes.some(v=>v.id==='b'&&v.enabled===false));
  await g.goto(origin+'/frame');await g.waitForFunction(()=>!!window.sound);assert.equal(await g.evaluate(()=>window.sound.enabled('a')),false,'A fresh document reads the persisted mute preference');
  await g.locator('#a').click();assert.deepEqual((await g.evaluate(()=>window.sound.state())).contexts,[],'Muted interaction does not create an unnecessary native context');
 await f.evaluate(()=>window.sound.set('a',true));await g.waitForFunction(()=>window.sound.enabled('a')===true);await f.locator('#a').click();await f.waitForFunction(()=>window.sound.state().contexts[0]==='running');
 assert.equal(await f.evaluate(()=>window.sound.play('a','draw','muted')),false);mark('Mute persists locally, updates other instances/documents, and never replays skipped sounds');
 await page.waitForTimeout(1100);assert.equal(await f.evaluate(()=>window.sound.play('a','coin','before-hidden')),true);
 await f.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await f.evaluate(()=>window.sound.play('a','flip','hidden-cue')),false);
 assert.ok((await f.evaluate(()=>window.sound.state())).sources.every(s=>!s.started||s.stopped||s.ended));
 await f.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await f.waitForFunction(()=>window.sound.state().contexts[0]==='running');assert.equal(await f.evaluate(()=>window.sound.play('a','flip','hidden-cue')),false);
 await f.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));assert.equal(await f.evaluate(()=>window.sound.play('a','draw','hidden-page')),false);await f.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow')));await f.waitForFunction(()=>window.sound.state().contexts[0]==='running');assert.equal(await f.evaluate(()=>window.sound.play('a','draw','hidden-page')),false);
 mark('Visibility and page lifecycle stop current sound immediately; resume only permits future cues');
 await f.evaluate(()=>{window.sound.destroy('b');window.sound.destroy('a');});await f.waitForFunction(()=>window.sound.state().contexts[0]==='closed');const oldCount=(await f.evaluate(()=>window.sound.state())).sources.length;
 await f.locator('#a').click();assert.equal(await f.evaluate(()=>window.sound.play('a','draw','destroyed')),false);await page.waitForTimeout(300);assert.equal((await f.evaluate(()=>window.sound.state())).sources.length,oldCount);await g.evaluate(()=>window.sound.destroy('a'));
 assert.deepEqual(errors,[]);assert.ok(requests.every(path=>['/','/frame','/app.js','/favicon.ico'].includes(path)));assert.equal(hash(source),pin);
 mark('Final destruction closes the native context, removes unlock handlers, and performs no asset requests');
 writeFileSync(join(out,'result.json'),JSON.stringify({checks,samples,sourceSha256:pin,testSha256:hash(resolve('tools/three-dragon-sound-selftest.mjs')),browser:browser.version(),scope:'Actual Edge AudioContext in same-origin iframes under user-gesture-required autoplay policy and native OfflineAudioContext samples. Visibility/page transitions simulated. Initial/reconnect public-event filtering belongs to the UI caller. No physical speaker, Owlbear, cross-origin host policy, or human audio-quality acceptance claim.',sources:['https://developer.chrome.com/blog/autoplay/','https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume']},null,2));console.log(`${checks.length} sound groups PASS. Evidence: ${out}`);
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error.stack),checks,samples,sourceSha256:pin,errors},null,2));console.error(out);throw error;}
finally{await browser.close();await new Promise(done=>server.close(done));}
