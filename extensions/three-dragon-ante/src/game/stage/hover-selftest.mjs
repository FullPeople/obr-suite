import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const base=import.meta.dirname,out=mkdtempSync(join(tmpdir(),'tda-hover-'));
const files=['index.ts','types.ts','layout.ts','../interaction/drag-controller.ts'];
const pins=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(join(base,p))).digest('hex')]));
const sourcePins=pins(),checks=[],errors=[];
const mutant=process.argv.find(a=>a.startsWith('--mutant='))?.slice(9);
const mutations={
 outline:['const zone = hit.object.userData.hit as StageHit | undefined;','const zone = (hit.object.userData.hit ?? hit.object.parent?.userData.hit) as StageHit | undefined;','public face hover works in normal context'],
 reveal:['const targets = [...visuals.values(), ...(revealCue?.cards ?? [])].filter','const targets = [...visuals.values()].filter','public temporary reveal cards are inspectable at their original seat'],
 pending:['.filter(v => v.group.visible && v.placement.key !== drag?.cardId);','.filter(v => v.group.visible && v.placement.key !== drag?.cardId && v.placement.key !== pending?.cardId);','pending face remains inspectable after the projection arrives before ACK'],
 privacy:['placement.cardId && (hit.object === visual.front && visual.faceKey !== "back" || ownAnte)','placement.cardId','temporary card backs do not expose identities before presentation'],
 glow:['publicFace && visual.faceKey !== "back" && active.has(id!)','false','an active public effect keeps its card border lit'],
};
if(mutant)assert.ok(mutations[mutant],'known mutation');let applied=false;
const runtime=process.env.CODEX_NODE_MODULES||'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=await import(pathToFileURL(join(runtime,'playwright/index.mjs')));
const {PNG}=(await import(pathToFileURL(join(runtime,'pngjs/lib/png.js')))).default;
const entry=`import{mountTableStage}from ${JSON.stringify(resolve(base,'index.ts'))};
import{mountDragController}from ${JSON.stringify(resolve(base,'../interaction/drag-controller.ts'))};
import{createTutorialGame,tutorialMove}from ${JSON.stringify(resolve(base,'../tutorial.ts'))};
import{applyAction,projectSeat,projectPublic,checkInvariants}from ${JSON.stringify(resolve(base,'../rules/index.ts'))};
let state,self='you',lesson,model,surface,controller,canvas=document.querySelector('canvas'),mode='normal';
const log={hover:[],inspect:[],drops:[],drag:[]};
function view(){return self?projectSeat(state,self):projectPublic(state)}
function context(){const v=model.view,a=v&&'actions'in v?v.actions[0]:null;return !self?null:{tableId:'t',gameId:state.id,seatId:self,revision:state.revision,kind:mode==='noaction'?null:a?.kind==='choose'?null:a?.kind??null,legalCardIds:a&&a.kind!=='choose'?a.cardIds:[],locked:mode==='locked'||mode==='pending',scopeId:'hover-test'}}
function reset(id='powers',seat='you'){controller?.destroy();if(surface){surface.destroy();const fresh=document.createElement('canvas');canvas.replaceWith(fresh);canvas=fresh}lesson=id;self=seat;state=createTutorialGame(id,crypto.randomUUID());mode='normal';model={view:view(),language:'en',connected:true};surface=mountTableStage(canvas);surface.update(model);controller=mountDragController(canvas,{context,hitTest:(x,y)=>surface.hitTest(x,y),hover:id=>log.hover.push(id),inspect:(id,pinned)=>log.inspect.push({id,pinned}),drag:value=>{log.drag.push(value);surface.setDrag(value)},cancel:()=>surface.setDrag(null),drop:intent=>{log.drops.push(intent);return false}});for(const a of Object.values(log))a.length=0;}
reset();window.h={get surface(){return surface},get model(){return model},get state(){return state},log,reset,context,
mode(value){mode=value;controller.refresh()},update(values){model={...model,...values};surface.update(model);controller.refresh()},
next(){const action=tutorialMove(state,lesson,crypto.randomUUID()),result=applyAction(state,action);if(!result.ok)throw Error(result.error.code);state=result.state;model={...model,view:view()};surface.update(model);controller.refresh();return action},
empty(){const v=structuredClone(model.view);v.hand=[];v.actions=[];v.seats.find(s=>s.id===self).handCount=0;this.update({view:v,animate:false})},
clear(){for(const a of Object.values(log))a.length=0},destroy(){controller.destroy();surface.destroy()},check:()=>checkInvariants(state)};`;
const once=(code,from,to)=>{assert.equal(code.split(from).length-1,1,'unique transform anchor');return code.replace(from,to)};
// Read actual mesh state only. Pointer routing, raycasting, animation and rules
// remain the production implementations; no hitTest or renderer replacement.
const probe=`window.__hoverRay=(x,y)=>{setRay(x,y);return ray.intersectObjects([...visuals.values()].map(v=>v.group).concat([zoneGroup]),true).slice(0,8).map(h=>({distance:h.distance,visible:h.object.visible,type:h.object.type,visual:[...visuals.values()].map(v=>({id:v.placement.cardId,front:h.object===v.front,body:h.object===v.body,back:h.object===v.back})).filter(v=>v.front||v.body||v.back),data:h.object.userData}))};window.__hoverProbe=()=>({phase:revealPhase,frames,animations:motions.size,values:[...visuals.values(),...(revealCue?.cards??[])].map(v=>({id:v.placement.cardId,key:v.placement.key,seat:v.placement.seatId,zone:v.placement.zone,face:v.faceKey,visible:v.group.visible,glow:v.effectGlow.visible,cue:!!revealCue?.cards.includes(v),anchor:(()=>{scene.updateMatrixWorld(true);const p=v.group.getWorldPosition(new THREE.Vector3()).project(camera),r=canvas.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()}))});return handle;`;
await build({input:'fixture',plugins:[{name:'fixture',resolveId(id){if(id==='fixture')return '\0fixture.ts';if(id.endsWith('.css'))return '\0css'},load(id){if(id==='\0fixture.ts')return entry;if(id==='\0css')return ''},transform(code,id){if(!id.replaceAll('\\','/').endsWith('/stage/index.ts'))return;code=code.replaceAll('\r\n','\n');if(mutant){code=once(code,...mutations[mutant].slice(0,2));applied=true}return once(code,'return handle;',probe)}}],output:{file:join(out,'fixture.js'),format:'esm',codeSplitting:false},logLevel:'silent'});
if(mutant)assert.ok(applied,'mutation compiled');
const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(join(out,'fixture.js')))}else{res.setHeader('content-type','text/html');res.end('<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%;touch-action:none}</style><canvas></canvas><script type="module" src="/fixture.js"></script>')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1100,height:820},hasTouch:true});page.on('pageerror',e=>errors.push(String(e)));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)};
const snapshot=()=>page.evaluate(()=>window.__hoverProbe());
const settle=()=>page.waitForFunction(()=>h.surface.diagnostics().animations===0);
const anchor=id=>page.evaluate(id=>h.surface.getAnchor({cardId:id}),id);
const hit=point=>page.evaluate(p=>h.surface.hitTest(p.x,p.y),point);
async function hoverCard(id){await page.mouse.move(1,1);await page.evaluate(()=>h.clear());const p=await anchor(id);await page.mouse.move(p.x,p.y);return page.evaluate(({id,p})=>{window.__debug={p,log:structuredClone(h.log),hit:h.surface.hitTest(p.x,p.y),ray:window.__hoverRay(p.x,p.y)};return h.log.hover.includes(id)},{id,p})}
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.h?.surface.diagnostics().frames>0);await settle();
 for(const mode of ['normal','locked','pending','noaction']){
  await page.evaluate(mode=>h.mode(mode),mode);
  check('public face hover works in '+mode+' context',await hoverCard('white-5'));
  const a=await anchor('white-5');await page.mouse.click(a.x,a.y);
  check('public face click inspects without a rule submission in '+mode,await page.evaluate(()=>h.log.inspect.some(v=>v.id==='white-5'&&v.pinned)&&h.log.drops.length===0&&h.log.drag.length===0));
 }
 await page.evaluate(()=>h.empty());check('public face hover works with an empty own hand',await hoverCard('white-5'));
 await page.evaluate(()=>h.reset('powers','jade'));check('opponent-turn projection has no rule action',await page.evaluate(()=>h.model.view.actions.length===0));
 check('opponent turn does not block public card inspection',await hoverCard('red-3'));
 await page.evaluate(()=>h.reset('powers',null));check('spectator context is actually null',await page.evaluate(()=>h.context()===null));
 check('spectator can hover a public card',await hoverCard('white-5'));
 const touch=await anchor('white-5');await page.touchscreen.tap(touch.x,touch.y);check('spectator touch inspects the public card without submitting',await page.evaluate(()=>h.log.inspect.some(v=>v.id==='white-5')&&h.log.drops.length===0));
 const backs=(await snapshot()).values.filter(v=>v.zone==='hand');
 check('opponent backs expose neither a card ID nor a face texture',backs.length>0&&backs.every(v=>!v.id&&v.face==='back'));
 const backHit=await hit(backs[0].anchor);check('actual ray at an opponent back cannot yield a private card',!backHit||backHit.kind==='zone');
 await page.evaluate(()=>h.reset('powers','you'));await page.evaluate(()=>h.mode('locked'));
 const privateId=await page.evaluate(()=>h.model.view.hand[0].id);
 await page.evaluate(privateId=>h.update({activeEffectCardIds:['white-5',privateId,'not-a-card']}),privateId);await settle();
 check('an active public effect keeps its card border lit',(await snapshot()).values.some(v=>v.id==='white-5'&&v.glow));
 check('active IDs never reveal or highlight a private hand',(await snapshot()).values.filter(v=>v.glow).every(v=>v.id==='white-5')&&!(await page.evaluate(()=>h.surface.diagnostics().faceCardIds.includes('not-a-card'))));
 const on=PNG.sync.read(await page.screenshot({path:join(out,'effect-on.png')}));
 const idle=(await snapshot()).frames;await page.waitForTimeout(220);check('waiting for a choice with a lit card has no continuing RAF',(await snapshot()).frames===idle);
 await page.evaluate(()=>h.update({activeEffectCardIds:[]}));await page.waitForTimeout(70);const off=PNG.sync.read(await page.screenshot({path:join(out,'effect-off.png')}));
 let changed=0;for(let i=0;i<on.data.length;i+=4)if(Math.abs(on.data[i]-off.data[i])+Math.abs(on.data[i+1]-off.data[i+1])+Math.abs(on.data[i+2]-off.data[i+2])>35)changed++;
 check('public effect border changes actual rendered pixels',changed>30);
 check('removing the effect ID clears its static border',(await snapshot()).values.every(v=>!v.glow));
 await page.evaluate(()=>{h.mode('normal');const id=h.model.view.hand[0].id,a=h.surface.getAnchor({cardId:id}),z=h.surface.getAnchor({zone:'flight',seatId:'you'});h.surface.setDrag({cardId:id,...a});h.surface.setDrag({cardId:id,...z});h.surface.releaseDrag({pending:true,zone:'flight'});h.mode('pending');h.next()});await settle();
 const pendingId=await page.evaluate(()=>h.surface.diagnostics().pendingCardId);
 check('pending face remains inspectable after the projection arrives before ACK',pendingId==='black-3'&&(await hit(await anchor(pendingId)))?.cardId===pendingId);
 check('another public card remains hoverable while a card waits for ACK',await hoverCard('white-5'));
 await page.evaluate(()=>h.surface.resolvePending(true));await settle();
 await page.evaluate(()=>h.reset('ante-tie','jade'));await page.evaluate(()=>h.next());await settle();await page.evaluate(()=>h.next());await settle();
 await page.clock.install();await page.clock.pauseAt(new Date());await page.evaluate(()=>h.next());
 const cueBacks=(await snapshot()).values.filter(v=>v.cue&&v.seat!=='jade');
 check('temporary card backs do not expose identities before presentation',(await Promise.all(cueBacks.map(v=>hit(v.anchor)))).every(h=>!h||h.kind==='zone'));
 await page.clock.runFor(650);const cue=(await snapshot()).values.filter(v=>v.cue);
 check('public temporary reveal cards are inspectable at their original seat',(await Promise.all(cue.map(async v=>{const h=await hit(await anchor(v.id));return h?.kind==='card'&&h.cardId===v.id&&h.seatId===v.seat}))).every(Boolean));
 check('revealed temporary card receives real pointer hover',await hoverCard('red-10'));
 await page.evaluate(()=>h.update({activeEffectCardIds:['red-10']}));check('active reveal source receives the static effect border',(await snapshot()).values.some(v=>v.cue&&v.id==='red-10'&&v.glow));
 await page.screenshot({path:join(out,'reveal-hover-effect.png')});await page.evaluate(()=>h.next());
 check('next authoritative state keeps the currently displayed reveal inspectable',(await hit(await anchor('red-10')))?.cardId==='red-10');
 await page.clock.runFor(1500);await page.clock.resume();await settle();
 check('settled origin card stays inspectable with its seat',(await hit(await anchor('red-10')))?.seatId==='you');
 await page.setViewportSize({width:420,height:820});await page.waitForTimeout(80);
 check('public ante remains hoverable at narrow viewport',await hoverCard('red-10'));
 await page.screenshot({path:join(out,'narrow-public-hover.png')});await page.setViewportSize({width:1100,height:820});
 await page.evaluate(()=>h.reset('ante-all-tied','jade'));await page.evaluate(()=>h.next());await settle();await page.evaluate(()=>h.next());await settle();await page.clock.pauseAt(await page.evaluate(()=>Date.now()));await page.evaluate(()=>h.next());await page.clock.runFor(650);
 check('all-tied discarded public card is inspectable while still presented at its slot',(await hit(await anchor('gold-6')))?.cardId==='gold-6'&&(await hit(await anchor('gold-6')))?.seatId==='you');
 await page.evaluate(()=>h.surface.suspend());const paused=(await snapshot()).frames;await page.clock.runFor(2000);await page.clock.resume();
 check('suspension removes temporary hit targets and stops frames',!(await snapshot()).values.some(v=>v.cue)&&(await snapshot()).frames===paused&&await page.evaluate(()=>h.surface.hitTest(500,400)===null));
 await page.evaluate(()=>{h.surface.resume();h.destroy()});const dead=await page.evaluate(()=>h.surface.diagnostics());await page.waitForTimeout(100);
 check('destroy clears GPU resources, hits and late frame work',dead.meshes===0&&dead.textures===0&&await page.evaluate(f=>h.surface.diagnostics().frames===f&&h.surface.hitTest(500,400)===null,dead.frames));
 check('no browser errors',errors.length===0);assert.deepEqual(pins(),sourcePins,'source stayed fixed');
 if(mutant)throw Error('mutant survived');writeFileSync(join(out,'result.json'),JSON.stringify({checks,count:checks.length,pins:sourcePins,changedPixels:changed,errors,scope:'Actual Three.js WebGL, real pointer mouse/touch, production drag controller and rule projections. Empty-hand projection is an explicit shape fixture. ANGLE SwiftShader is not native Owlbear UAT.'},null,2));console.log(`${checks.length} PASS ${out}`);
}catch(error){if(mutant&&applied&&error instanceof assert.AssertionError&&error.message===mutations[mutant][2]){writeFileSync(join(out,'mutation.json'),JSON.stringify({mutant,applied,killedBy:error.message,checks,pins:sourcePins},null,2));console.log(`KILL ${mutant} ${out}`)}else{writeFileSync(join(out,'failure.json'),JSON.stringify({checks,errors,error:String(error),stack:error.stack,probe:await snapshot().catch(()=>null),debug:await page.evaluate(()=>window.__debug).catch(()=>null)},null,2));await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw new Error(out,{cause:error})}}
finally{await browser.close();await new Promise(r=>server.close(r))}
