import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const base=import.meta.dirname,out=mkdtempSync(join(tmpdir(),'tda-presentation-'));
const paths=['index.ts','layout.ts','types.ts'];
const pins=()=>Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(join(base,p))).digest('hex')]));
const beforePins=pins(),checks=[],errors=[];
const mutant=process.argv.find(a=>a.startsWith('--mutant='))?.slice(9);
const mutations={
 lower:['handAdjustment || revealInPlace ? 0 :','handAdjustment || revealInPlace ? .45 :','hover lowering uses no arc or bounce'],
 origin:['if (animate) for (const [id, placement] of desired)','if (false) for (const [id, placement] of desired)','opponent ante comes from its actual anonymous mesh'],
 landing:['hit?.seatId === seat.id && hit.zone === legal','true','an illegal own flight never receives an ante landing ring'],
 payment:['!cue.paid && flashing >= FLASH_MS','!cue.paid && flashing >= 0','observed payment starts only after both maximum flashes'],
};
if(mutant)assert.ok(mutations[mutant],'known mutation');let applied=false;
const runtime=process.env.CODEX_NODE_MODULES||'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=await import(pathToFileURL(join(runtime,'playwright/index.mjs')));
const entry=`import{mountTableStage}from ${JSON.stringify(resolve(base,'index.ts'))};import{createTutorialGame,tutorialMove}from ${JSON.stringify(resolve(base,'../tutorial.ts'))};import{applyAction,projectSeat,projectPublic,card,checkInvariants}from ${JSON.stringify(resolve(base,'../rules/index.ts'))};import{placements}from ${JSON.stringify(resolve(base,'layout.ts'))};
let state,self='jade',surface,model;let canvas=document.querySelector('canvas');
function current(){const view=projectSeat(state,self),action=view.actions[0];return{view,language:'en',connected:true,legalDropZone:action&&action.kind!=='choose'?action.kind==='ante'?'ante':'flight':null};}
function reset(lesson='ante-tie',seat='jade'){if(surface){surface.destroy();const fresh=document.createElement('canvas');canvas.replaceWith(fresh);canvas=fresh;}self=seat;state=createTutorialGame(lesson,crypto.randomUUID());window.__phases=[];surface=mountTableStage(canvas,{onRevealPhase:phase=>window.__phases.push(phase)});model=current();surface.update(model)}reset();
window.h={placements,get surface(){return surface},get model(){return model},get state(){return state},reset,next(){const action=tutorialMove(state,state.id.split(':')[1],crypto.randomUUID()),result=applyAction(state,action);if(!result.ok)throw Error(result.error.code);state=result.state;model={...model,...current()};surface.update(model);return action},update(values){model={...model,...values};surface.update(model)},spectator(){model={...model,view:projectPublic(state),legalDropZone:null};surface.update(model)},check:()=>checkInvariants(state)};`;
const replaceOnce=(code,from,to)=>{assert.equal(code.split(from).length-1,1,'unique valid transform anchor');return code.replace(from,to)};
const probeSource=`window.__stageProbe=()=>({frames,revision:model.view?.revision,phase:revealCue?{start:revealCue.start,elapsed:performance.now()-revealCue.start,allTied:revealCue.data.allTied,ids:revealCue.data.cards.map(c=>c.placement.cardId),max:Math.max(...revealCue.data.cards.map(c=>c.placement.card.strength)),flashes:revealCue.labels.filter(n=>n.visible).length,cardGlows:revealCue.highlights.filter(n=>n.visible).length,flipped:revealCue.flipped,paid:revealCue.paid,queue:revealQueue.length}:null,transfer:transferGroup.children.map(c=>c.userData.payment??null),landing:landing.visible,zones:zoneGroup.children.filter(c=>c.userData.hit).map(c=>({...c.userData.hit,highlight:c.userData.highlight})),visuals:[...visuals].map(([id,v])=>({id,zone:v.placement.zone,seatId:v.placement.seatId,visible:v.group.visible,face:v.faceKey,pose:copyPose(v.group)})),motions:[...motions.values()].map(m=>({id:[...visuals].find(([,v])=>v.group===m.object)?.[0],from:m.from,to:m.to,arc:m.arc,bounce:m.bounce,duration:m.duration,payment:m.object.userData.payment}))});window.__stageFrames=[];return handle;`;
await build({input:'fixture',plugins:[{name:'fixture',resolveId(id){if(id==='fixture')return '\0fixture.ts';if(id.endsWith('.css'))return '\0css';},load(id){if(id==='\0fixture.ts')return entry;if(id==='\0css')return '';},transform(code,id){if(!id.replaceAll('\\','/').endsWith('/stage/index.ts'))return;code=code.replaceAll('\r\n','\n');if(mutant){code=replaceOnce(code,...mutations[mutant].slice(0,2));applied=true;}code=replaceOnce(code,'return handle;',probeSource);return replaceOnce(code,'renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); frames++;','renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); frames++; if(window.__stageProbe && window.__stageFrames.length<500)window.__stageFrames.push(window.__stageProbe());');}}],output:{file:join(out,'fixture.js'),format:'esm',codeSplitting:false},logLevel:'silent'});
if(mutant)assert.ok(applied,'mutation compiled before browser assertions');
const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(join(out,'fixture.js')))}else{res.setHeader('content-type','text/html');res.end('<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%}</style><canvas></canvas><script type="module" src="/fixture.js"></script>')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1000,height:760}});page.on('pageerror',e=>errors.push(String(e)));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)};
const probe=()=>page.evaluate(()=>window.__stageProbe());
const settle=()=>page.waitForFunction(()=>h.surface.diagnostics().animations===0);
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.h?.surface.diagnostics().frames>0);
 check('only the current own legal ante slot is highlighted',(await probe()).zones.filter(z=>z.highlight).every(z=>z.zone==='ante'&&z.seatId==='jade')&&(await probe()).zones.filter(z=>z.highlight).length===1);
 check('stakes has an anchor but no card region',(await probe()).zones.every(z=>z.zone!=='stakes')&&await page.evaluate(()=>!!h.surface.getAnchor({zone:'stakes'})));
 const own=await page.evaluate(()=>h.model.view.hand[0].id);await page.evaluate(id=>h.update({selectedCardIds:[id]}),own);await settle();const lowered=await page.evaluate(()=>{h.update({selectedCardIds:[]});return window.__stageProbe()});
 check('hover lowering uses no arc or bounce',lowered.motions.some(m=>m.id===own&&m.arc===0&&m.bounce===false&&m.duration<=200));await settle();
 await page.evaluate(id=>{const a=h.surface.getAnchor({cardId:id}),z=h.surface.getAnchor({zone:'flight',seatId:'jade'});h.surface.setDrag({cardId:id,...a});h.surface.setDrag({cardId:id,...z})},own);
 check('an illegal own flight never receives an ante landing ring',!(await probe()).landing);
 await page.evaluate(id=>h.surface.setDrag({cardId:id,...h.surface.getAnchor({zone:'ante',seatId:'jade'})}),own);
 check('actual own legal ante ray target receives its landing ring',(await probe()).landing);
 const cancelled=await page.evaluate(()=>{h.surface.setDrag(null);return window.__stageProbe()});check('cancel lowers the dragged card without an arc or bounce',cancelled.motions.some(m=>m.id===own&&m.arc===0&&!m.bounce));await settle();
 await page.evaluate(()=>h.update({legalDropZone:null}));check('locked model shows no highlighted destination',(await probe()).zones.every(z=>!z.highlight));
 const backs=(await probe()).visuals.filter(v=>v.zone==='hand'&&v.seatId==='you').map(v=>v.pose);const committed=await page.evaluate(()=>{h.next();return window.__stageProbe()});
 const ante=committed.motions.find(m=>m.id==='ante:you');check('opponent ante comes from its actual anonymous mesh',ante&&backs.some(p=>JSON.stringify(p)===JSON.stringify(ante.from)));await settle();
 await page.evaluate(()=>h.next());await settle();await page.clock.install();await page.clock.pauseAt(new Date());await page.evaluate(()=>{window.__stageFrames=[];h.next()});
 const afterReveal=await probe();check('public reveal starts one finite independent presentation',!!afterReveal.phase&&afterReveal.phase.ids.length===3&&afterReveal.phase.max===10);
 check('real rules charge tied highest price instead of untied leader strength',await page.evaluate(()=>h.state.stakes===30&&h.state.seats.every(s=>s.gold===20)&&h.check().length===0));
 await page.clock.runFor(300);await page.screenshot({path:join(out,'reveal-in-place.png')});
 await page.evaluate(()=>h.next());check('next authoritative play does not interrupt the active reveal',!!(await probe()).phase&&(await probe()).revision===4);
 await page.clock.runFor(340);await page.screenshot({path:join(out,'highest-cards-first-flash.png')});await page.clock.runFor(1260);await page.clock.resume();await settle();const frames=await page.evaluate(()=>window.__stageFrames);writeFileSync(join(out,'reveal-frames.json'),JSON.stringify(frames,null,2));const flashes=frames.filter(f=>f.phase?.flashes>0);let transitions=0,was=false;for(const f of frames){const now=!!f.phase?.flashes;if(now&&!was)transitions++;was=now;}
 check('both tied maximum values flash exactly twice',transitions===2&&flashes.every(f=>f.phase.flashes===2&&f.phase.cardGlows===2));
 check('observed payment starts only after both maximum flashes',frames.filter(f=>f.transfer.some(t=>t)).length>0&&frames.filter(f=>f.phase&&f.transfer.some(t=>t)).every(f=>f.phase.elapsed>=1250));
 check('paid reveal emits each presentation phase once then clears',await page.evaluate(()=>JSON.stringify(window.__phases)===JSON.stringify(['placing','revealing','price','payment',null])));
 check('revealed antes retain original seat slots after a subsequent play',await page.evaluate(()=>h.placements(h.model.view).filter(p=>p.zone==='ante').every(p=>p.seatId===h.model.view.anteOrigins.find(o=>o.cardId===p.cardId)?.seatId)));
 await page.screenshot({path:join(out,'revealed-antes-retained.png')});
 const idle=(await probe()).frames;await page.waitForTimeout(220);check('reveal queue and coin motions stop rendering when done',(await probe()).frames===idle);
 await page.evaluate(()=>h.reset('powers','jade'));const playBacks=(await probe()).visuals.filter(v=>v.zone==='hand'&&v.seatId==='you').map(v=>v.pose);const playedFrame=await page.evaluate(()=>{h.next();return window.__stageProbe()});
 const played=playedFrame.motions.find(m=>m.id==='black-3');check('opponent public play starts on an existing anonymous hand mesh',played&&playBacks.some(p=>JSON.stringify(p)===JSON.stringify(played.from)));await settle();
 await page.evaluate(()=>h.reset('ante-all-tied','jade'));await page.evaluate(()=>h.next());await settle();await page.evaluate(()=>h.next());await settle();await page.clock.pauseAt(await page.evaluate(()=>Date.now()));await page.evaluate(()=>{window.__stageFrames=[];h.next()});
 check('all-tied engine projection remains uncharged and returns to ante',await page.evaluate(()=>h.state.stage==='ante'&&h.state.stakes===0&&h.state.ante.length===0&&h.check().length===0));
 check('all-tied public event still reveals all cards at their former slots',(await probe()).phase?.allTied&&(await probe()).phase.ids.length===3);
 await page.clock.runFor(1300);await page.screenshot({path:join(out,'all-tied-discard.png')});await page.clock.runFor(500);await page.clock.resume();await settle();
 check('all-tied banner uses discard instead of payment',await page.evaluate(()=>JSON.stringify(window.__phases)===JSON.stringify(['placing','revealing','price','discard',null])));
 check('all-tied reveal never manufactures a payment',await page.evaluate(()=>window.__stageFrames.every(f=>f.transfer.length===0)));
 await page.evaluate(()=>h.update({animate:false}));check('snapshot/reconnect never replays old ante log',!(await probe()).phase);
 await page.evaluate(()=>{h.reset('ante-tie','jade');h.next();h.next();h.next();h.surface.suspend()});const suspended=(await probe()).frames;await page.waitForTimeout(150);check('suspension clears the cue and its finite render work',!(await probe()).phase&&(await probe()).frames===suspended);await page.evaluate(()=>h.surface.resume());await settle();
 await page.evaluate(()=>{h.reset('ante-tie','jade');h.next();h.next();h.next();h.spectator()});check('viewer identity change cancels the old presentation',!(await probe()).phase);await settle();
 await page.evaluate(()=>{h.reset('ante-tie','jade');h.update({reducedMotion:true});h.next();h.next();h.next()});check('reduced motion does not schedule flashes or payment flight',!(await probe()).phase&&(await probe()).transfer.length===0);
 await page.evaluate(()=>h.surface.destroy());check('destroy releases presentation resources',await page.evaluate(()=>h.surface.diagnostics().meshes===0&&h.surface.diagnostics().textures===0&&h.surface.diagnostics().animations===0));
 check('no browser application errors',errors.length===0);assert.deepEqual(pins(),beforePins,'source remained fixed');
 if(mutant)throw Error('mutant survived');writeFileSync(join(out,'result.json'),JSON.stringify({checks,pins:beforePins,errors,revealFrames:frames,scope:'Real Three.js browser scene; test-only read probes, actual engine actions. ANGLE SwiftShader is not native Owlbear UAT.'},null,2));console.log(`${checks.length} PASS ${out}`);
}catch(error){if(mutant&&applied&&error instanceof assert.AssertionError&&error.message===mutations[mutant][2]){writeFileSync(join(out,'mutation.json'),JSON.stringify({mutant,applied,killedBy:error.message,checks,pins:beforePins},null,2));console.log(`KILL ${mutant} ${out}`)}else{writeFileSync(join(out,'failure.json'),JSON.stringify({checks,pins:beforePins,errors,error:String(error),stack:error.stack,probe:await probe().catch(()=>null)},null,2));await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw new Error(out,{cause:error});}}
finally{await browser.close();await new Promise(r=>server.close(r));}
