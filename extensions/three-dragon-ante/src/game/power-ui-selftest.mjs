// Actual rules, UI, renderer, audio and CSS; only delivery and browser time are controlled.
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const base=import.meta.dirname,out=mkdtempSync(join(tmpdir(),'tda-power-ui-'));
const files=['ui.ts','power-sequence.ts','power-presentation.ts','power-presentation.css','audio.ts','stage/index.ts','rules/prompts.ts'];
const hashes=()=>Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(join(base,f))).digest('hex')]));
const beforeHashes=hashes();
const runtime=process.env.CODEX_NODE_MODULES||'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=await import(pathToFileURL(join(runtime,'playwright/index.mjs')));
const entry=`import{mountTableUI}from ${JSON.stringify(resolve(base,'ui.ts'))};
import{createTutorialGame,tutorialMove}from ${JSON.stringify(resolve(base,'tutorial.ts'))};
import{applyAction,projectSeat,projectPublic,card,checkInvariants}from ${JSON.stringify(resolve(base,'rules/index.ts'))};
import{cardHint}from ${JSON.stringify(resolve(base,'rules/prompts.ts'))};
let state,viewer='you',surface,current,autoAck=false;const sent=[];
function projection(receipt){return{actionReceiptVersion:1,table:{version:1,id:'power-table',hostPlayerId:'you',hostConnectionId:'local',hostName:'You',stage:'playing',seats:state.seats.map(s=>({playerId:s.id,seatId:s.id,name:s.name})),revision:state.revision},selfPlayerId:viewer,isHost:viewer==='you',connected:true,pending:false,game:viewer==='spectator'?projectPublic(state):projectSeat(state,viewer),...(receipt?{actionReceipt:receipt}:{})};}
function set(v){current=v;surface.update(v)}
function reset(lesson='powers',who='you',language='zh'){surface?.destroy();state=createTutorialGame(lesson,'power-fixture-'+crypto.randomUUID());viewer=who;sent.length=0;autoAck=false;window.soundCalls=[];window.underlayEvents=[];surface=mountTableUI(document.querySelector('#app'),{language,send:c=>{sent.push(structuredClone(c));if(autoAck&&c.type==='action'){autoAck=false;apply(c.action);}}});set(projection());for(const id of ['table-stage','turn','title'])for(const type of ['pointerdown','pointerup','click','keydown','keyup'])document.getElementById(id).addEventListener(type,e=>underlayEvents.push({id,type,key:e.key}));}
function apply(move,ack=true){const result=applyAction(state,move);if(!result.ok)throw Error(result.error.code);state=result.state;if(checkInvariants(state).length)throw Error('invalid fixture action');set(projection(ack?{source:'host',actionId:move.id,tableId:'power-table',gameId:state.id,revision:state.revision,ok:true}:undefined));return move;}
window.h={reset,set,get surface(){return surface},get state(){return state},get view(){return current},sent,cardHint,
autoAckNext(){autoAck=true},
play(id){return apply({...tutorialMove(state,'powers',crypto.randomUUID()),...(id?{cardId:id}:{})})},
applySent(ack=true){return apply(sent.at(-1).action,ack)},ack(){const move=sent.at(-1).action;set(projection({source:'host',actionId:move.id,tableId:'power-table',gameId:state.id,revision:state.revision,ok:true}))},
choose(){return apply(tutorialMove(state,'powers',crypto.randomUUID()))},repush(){set({...current})},
injectEvents(events){set({...current,game:{...current.game,revision:current.game.revision+1,events:[...current.game.events,...events]}})},
};reset();`;
await build({input:'fixture',plugins:[{name:'fixture',resolveId(id,importer){if(id==='fixture')return '\0fixture.ts';if(id.endsWith('.css'))return '\0css';if(id==='./stage'&&importer?.replaceAll('\\','/').endsWith('/game/ui.ts'))return '\0stage.ts';if(id==='./audio'&&importer?.replaceAll('\\','/').endsWith('/game/ui.ts'))return '\0audio.ts'},load(id){if(id==='\0fixture.ts')return entry;if(id==='\0css')return '';if(id==='\0stage.ts')return `import{mountTableStage as real}from ${JSON.stringify(resolve(base,'stage/index.ts'))};export function mountTableStage(...args){const s=real(...args),update=s.update;window.stage=s;window.stageModel=null;s.update=m=>{window.stageModel=structuredClone(m);update(m)};return s}`;if(id==='\0audio.ts')return `import{mountTableAudio as real}from ${JSON.stringify(resolve(base,'audio.ts'))};export function mountTableAudio(...args){const a=real(...args),play=a.play;window.soundCalls??=[];a.play=(kind,key)=>{window.soundCalls.push({kind,key,time:performance.now()});return play(kind,key)};return a}`}}],output:{file:join(out,'app.js'),format:'esm',codeSplitting:false},logLevel:'silent'});
const css=['style.css','tutorial.css','onboarding/style.css','stage-ui.css','power-presentation.css'].map(f=>readFileSync(join(base,f),'utf8')).join('\n');
const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(join(out,'app.js')))}else{res.setHeader('content-type','text/html');res.end(`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>`)}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:960},hasTouch:true}),errors=[],checks=[];page.on('pageerror',e=>errors.push(String(e)));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)};
const overlay=()=>page.locator('.power-overlay').isVisible();
async function reset(lesson='powers',who='you',lang='zh'){await page.evaluate(v=>h.reset(...v),[lesson,who,lang]);await page.clock.runFor(600);}
async function resize(width,height){await page.setViewportSize({width,height});await page.waitForTimeout(80);await page.clock.runFor(600);}
async function dismiss(){await page.locator('.power-card-space').click();}
try{
 await page.clock.install({time:new Date('2026-09-09T12:00:00Z')});await page.clock.pauseAt(new Date('2026-09-09T12:00:01Z'));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.h,{},{polling:100});await page.clock.runFor(600);
 check('initial snapshot never replays historical effects or sound',!await overlay()&&await page.evaluate(()=>soundCalls.length===0));
 await page.locator('#title').click();
 const oldMoney=await page.evaluate(()=>h.view.game.stakes);
 await page.evaluate(()=>h.play('black-3'));
 check('real Black Dragon power starts fullscreen introduction',await overlay()&&await page.locator('.power-description').textContent()===await page.evaluate(()=>h.cardHint('black','zh')));
 check('authority applies instantly while the displayed money stays before the effect',await page.evaluate(old=>h.view.game.stakes===old-3&&stageModel.view.stakes===old,oldMoney));
 check('card rotation spans 24 degrees over exactly 1500ms',await page.evaluate(()=>{const a=document.querySelector('.power-card').getAnimations()[0];const f=a?.effect.getKeyframes();return a?.effect.getTiming().duration===1500&&f[0].transform==='rotateY(-12deg)'&&f.at(-1).transform==='rotateY(12deg)'}));
 check('intro card glows and uses the original SVG, without raster assets',await page.evaluate(()=>getComputedStyle(document.querySelector('.power-card')).boxShadow!=='none'&&!!document.querySelector('.power-card svg')&&!document.querySelector('.power-overlay img')));
 check('coin cue waits until the automatic power finishes presenting',await page.evaluate(()=>!soundCalls.some(c=>c.kind==='coin')));
 await page.screenshot({path:join(out,'black-power-wide.png')});await page.clock.runFor(1600);
 check('introduction still blocks game actions after the old 1500ms deadline',await overlay()&&await page.evaluate(()=>h.surface.presentationBusy()&&stageModel.legalDropZone===null));
 await page.clock.runFor(5000);
 check('reading for several seconds does not apply displayed money or coin sound',await overlay()&&await page.evaluate(old=>stageModel.view.stakes===old&&!soundCalls.some(c=>c.kind==='coin'),oldMoney));
 await page.evaluate(()=>underlayEvents.length=0);const clickPoint=await page.evaluate(()=>stage.getAnchor({cardId:'white-5'}));
 await page.mouse.click(clickPoint.x,clickPoint.y);
 check('fresh screen click confirms the introduction and applies displayed money and coin sound once',!await overlay()&&await page.evaluate(()=>stageModel.view.stakes===h.view.game.stakes&&soundCalls.filter(c=>c.kind==='coin').length===1));
 check('confirmation click over an actual public card never reaches the underlying table or submits an action',await page.evaluate(()=>underlayEvents.length===0&&h.sent.length===0&&document.querySelector('#card-preview').dataset.pinned!=='true'));
 const soundCount=await page.evaluate(()=>soundCalls.length);await page.evaluate(()=>h.repush());await page.clock.runFor(1500);
 check('same revision does not replay effects or any sound',!await overlay()&&await page.evaluate(n=>soundCalls.length===n,soundCount));
 await reset('buy');await page.evaluate(()=>h.play('gold-2'));
 check('drawing a card waits for its power introduction before the draw sound',await overlay()&&await page.evaluate(()=>stageModel.view.deckCount>h.view.game.deckCount&&!soundCalls.some(c=>c.kind==='draw')&&soundCalls.filter(c=>c.kind==='flip').length===1));
 await page.clock.runFor(4000);check('draw sound and displayed hand wait indefinitely for confirmation',await overlay()&&await page.evaluate(()=>stageModel.view.deckCount>h.view.game.deckCount&&!soundCalls.some(c=>c.kind==='draw')));await dismiss();check('draw sound occurs once when confirmation reveals the received cards',await page.evaluate(()=>stageModel.view.deckCount===h.view.game.deckCount&&soundCalls.filter(c=>c.kind==='draw').length===1));
 await reset();await page.locator('#table-stage').focus();await page.keyboard.press('Space');await page.keyboard.press('Enter');
 check('real keyboard play waits for a matching authoritative receipt',await page.evaluate(()=>h.sent.length===1&&h.surface.waitingForReceipt()));
 await page.evaluate(()=>h.applySent(false));check('projection before ACK presents the power and retains the pending action',await overlay()&&await page.evaluate(()=>h.surface.waitingForReceipt()));
 await page.evaluate(()=>h.ack());check('matching ACK resolves immediately during the introduction without replay',await overlay()&&await page.evaluate(()=>!h.surface.waitingForReceipt()&&stage.diagnostics().pendingCardId===null));await page.clock.runFor(5000);check('receipt update neither dismisses nor duplicates the waiting introduction',await overlay());await dismiss();check('one confirmation after ACK empties the introduction queue',!await overlay());
 await reset();const dragPoints=await page.evaluate(()=>({from:stage.getAnchor({cardId:'black-3'}),to:stage.getAnchor({zone:'flight',seatId:'you'})}));
 check('drag fixture uses the real own hand and own flight raycast',await page.evaluate(p=>stage.hitTest(p.from.x,p.from.y)?.cardId==='black-3'&&stage.hitTest(p.to.x,p.to.y)?.seatId==='you',dragPoints));
 await page.evaluate(()=>h.autoAckNext());await page.mouse.move(dragPoints.from.x,dragPoints.from.y);await page.mouse.down();await page.mouse.move(dragPoints.to.x,dragPoints.to.y,{steps:10});await page.clock.runFor(20);await page.mouse.up();
 check('real drag release applies its action and starts an introduction without its trailing click confirming it',await overlay()&&await page.evaluate(()=>h.sent.length===1&&h.sent[0].action.cardId==='black-3'&&!h.surface.waitingForReceipt()));
 await page.clock.runFor(5000);check('drag-started introduction still requires a distinct new pointer gesture',await overlay());await dismiss();check('distinct click confirms the drag-started introduction without a second rules action',!await overlay()&&await page.evaluate(()=>h.sent.length===1));
 await reset();const oldGesture=await page.evaluate(()=>stage.getAnchor({cardId:'black-3'}));await page.mouse.move(oldGesture.x,oldGesture.y);await page.mouse.down();await page.evaluate(()=>h.play('black-3'));await page.mouse.up();
 check('pointerup from a gesture begun before the overlay is not a confirmation',await overlay()&&await page.evaluate(()=>h.sent.length===0));await dismiss();
 await reset();await page.evaluate(()=>h.play('black-3'));const threshold=await page.locator('.power-card-space').boundingBox(),tx=Math.round(threshold.x+threshold.width/2),ty=Math.round(threshold.y+threshold.height/2);
 await page.mouse.move(tx,ty);await page.mouse.down();await page.mouse.move(tx+8,ty);await page.mouse.up();check('exactly eight pixels of movement is not a tap confirmation',await overlay());
 await page.mouse.move(tx,ty);await page.mouse.down();await page.mouse.move(tx+24,ty);await page.mouse.move(tx,ty);await page.mouse.up();check('moving away and returning to the press position still counts as a drag',await overlay());
 await page.mouse.move(tx,ty);await page.mouse.down();await page.mouse.move(tx+7,ty);await page.mouse.up();check('a fresh small seven-pixel tap gesture confirms normally',!await overlay());
 await reset('kobold');await page.evaluate(()=>h.play('kobold'));
 check('choice is authoritative immediately but native options stay disabled and hidden during intro',await page.evaluate(()=>h.view.game.phase==='choice'&&getComputedStyle(document.querySelector('#turn')).visibility==='hidden'&&[...document.querySelectorAll('.choices button[data-option]')].every(b=>b.disabled)));
 await page.clock.runFor(4500);check('native choice remains hidden and disabled until the player confirms',await overlay()&&await page.evaluate(()=>getComputedStyle(document.querySelector('#turn')).visibility==='hidden'&&[...document.querySelectorAll('.choices button[data-option]')].every(b=>b.disabled)));
 await page.evaluate(()=>underlayEvents.length=0);await page.keyboard.press('Enter');
 check('Enter confirms and reveals native choice while its public source stays lit',!await overlay()&&await page.evaluate(()=>getComputedStyle(document.querySelector('#turn')).visibility==='visible'&&[...document.querySelectorAll('.choices button[data-option]')].some(b=>!b.disabled)&&stageModel.activeEffectCardIds.includes('kobold')));
 check('Enter confirmation does not activate a newly revealed option or underlying keyboard play',await page.evaluate(()=>h.sent.length===0&&!underlayEvents.some(e=>e.type==='keydown'||e.type==='click')));
 await page.clock.runFor(500);const publicPoint=await page.evaluate(()=>stage.getAnchor({cardId:'kobold'}));await page.mouse.move(publicPoint.x,publicPoint.y);
 check('actual public source can be hovered while its choice is pending',await page.locator('#card-preview').isVisible()&&await page.locator('#preview-content h2').textContent()==='狗头人');
 await page.evaluate(()=>h.choose());await page.clock.runFor(1700);
 check('source glow clears when its pending choice is complete',await page.evaluate(()=>!stageModel.activeEffectCardIds.includes('kobold')));
 await reset('powers','spectator');await page.evaluate(()=>h.play('black-3'));await page.clock.runFor(100);
 check('spectator receives the same public effect introduction and names its triggerer',await overlay()&&await page.locator('.power-player').textContent()==='You正在触发效果');
 await page.clock.runFor(5000);check('spectator introduction also waits for an explicit click',await overlay());await dismiss();check('spectator confirmation closes only its presentation without sending any command',!await overlay()&&await page.evaluate(()=>h.sent.length===0));await reset('silver-seer','you','en');await page.evaluate(()=>h.play('silver-seer'));await page.clock.runFor(300);
 check('complete long card effect is shown without clamping',await page.evaluate(()=>document.querySelector('.power-description').textContent===h.cardHint('silver-seer','en')&&getComputedStyle(document.querySelector('.power-description')).webkitLineClamp==='none'));
 await resize(390,780);await page.screenshot({path:join(out,'seer-power-narrow.png')});
 check('narrow screen retains card and complete scrollable effect within viewport',await page.evaluate(()=>{const r=document.querySelector('.power-copy').getBoundingClientRect(),c=document.querySelector('.power-card').getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight&&r.left>=0&&c.left>=0&&getComputedStyle(document.querySelector('.power-copy')).overflowY==='auto'}));
 await resize(390,480);check('short-screen fixture creates real description overflow without changing its CSS',await page.locator('.power-copy').evaluate(e=>e.scrollHeight>e.clientHeight));
 const copy=await page.locator('.power-copy').boundingBox();await page.mouse.move(copy.x+copy.width/2,copy.y+copy.height/2);await page.mouse.wheel(0,330);await page.waitForTimeout(80);await page.clock.runFor(300);
 check('real wheel scroll reads the long effect without dismissing it',await overlay()&&await page.locator('.power-copy').evaluate(e=>e.scrollTop>0));
 await page.locator('.power-copy').evaluate(e=>e.scrollTop=0);const touchSession=await page.context().newCDPSession(page),touchX=Math.round(copy.x+copy.width/2),touchY=Math.round(copy.y+copy.height-55);
 await touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchX,y:touchY}]});for(const delta of [25,65,110,160]){await touchSession.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchX,y:touchY-delta}]});await page.clock.runFor(20);}await touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(80);await page.clock.runFor(120);await touchSession.detach();
 check('actual touchscreen scrolling moves the long description and keeps the overlay open',await overlay()&&await page.locator('.power-copy').evaluate(e=>e.scrollTop>0));
 await page.mouse.move(copy.x+copy.width/2,copy.y+copy.height/2);await page.mouse.down();await page.mouse.move(copy.x+copy.width/2,copy.y+copy.height/2-35,{steps:3});await page.mouse.up();
 check('a moved pointer gesture over the description is not a confirmation',await overlay());
 await page.clock.runFor(5000);check('long narrow description remains available after several seconds of scrolling',await overlay());await page.keyboard.press('Space');check('Space confirms the long description without sending a rules action',!await overlay()&&await page.evaluate(()=>h.sent.length===0));
 await page.clock.resume();await resize(1440,960);await page.waitForTimeout(250);
 await page.waitForFunction(()=>{const p=stage.getAnchor({cardId:'silver-seer'});return stage.diagnostics().animations===0&&p&&stage.hitTest(p.x,p.y)?.cardId==='silver-seer'},{},{polling:100});
 const seer=await page.evaluate(()=>stage.getAnchor({cardId:'silver-seer'}));await page.mouse.move(seer.x,seer.y);
 await page.mouse.click(seer.x,seer.y);
 await page.waitForFunction(()=>document.querySelector('#card-preview').dataset.pinned==='true',{},{polling:100});
 await resize(390,780);await page.evaluate(()=>document.querySelector('#card-preview').scrollTop=120);const scroll=await page.locator('#card-preview').evaluate(e=>e.scrollTop);await page.evaluate(()=>h.repush());
 check('pinned complete description keeps its scroll position across room refreshes',scroll>0&&await page.locator('#card-preview').evaluate(e=>e.scrollTop)===scroll);
 const white=await page.evaluate(()=>stage.getAnchor({cardId:'white-8'}));await page.mouse.move(white.x,white.y);
 check('pinning one description still allows hovering a different visible card',await page.locator('#preview-content h2').textContent()==='White Dragon');
 await page.mouse.move(2,2);
 check('leaving the other card restores the pinned description',await page.locator('#preview-content h2').textContent()==='Silver Seer');
 await resize(1440,960);await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+200));await page.emulateMedia({reducedMotion:'reduce'});await reset();await page.evaluate(()=>h.play('black-3'));
 check('reduced motion keeps readable introduction but removes rotation',await overlay()&&await page.locator('.power-card').evaluate(e=>e.getAnimations().length===0));await page.clock.runFor(6000);check('reduced motion waits for confirmation instead of using a timer',await overlay());const touchPoint=await page.locator('.power-card-space').boundingBox();await page.touchscreen.tap(touchPoint.x+touchPoint.width/2,touchPoint.y+touchPoint.height/2);check('a fresh touchscreen tap confirms under reduced motion without rules input',!await overlay()&&await page.evaluate(()=>h.sent.length===0));
 // Public event delivery is controlled to exercise multiple triggers in one revision.
 await reset();await page.evaluate(()=>h.injectEvents([{code:'POWER_TRIGGERED',seatId:'you',cardIds:['black-3']},{code:'POWER_TRIGGERED',seatId:'jade',cardIds:['white-5']} ]));
 await page.clock.runFor(5000);check('first public trigger waits without advancing the queue',await overlay()&&await page.locator('.power-card-name').textContent()==='黑龙');await dismiss();check('one click advances exactly one queued trigger',await overlay()&&await page.locator('.power-card-name').textContent()==='白龙');await page.clock.runFor(5000);check('second trigger gets its own unlimited reading time',await overlay()&&await page.locator('.power-card-name').textContent()==='白龙');await dismiss();check('second independent click empties the queue without a fullscreen mask or action',!await overlay()&&await page.evaluate(()=>h.sent.length===0));
 for(const reason of ['disconnect','gap','identity','suspend','failed','destroy','hidden']){
  await reset();await page.evaluate(()=>h.play('black-3'));check(`${reason}: fixture has active presentation`,await overlay());
  await page.evaluate(reason=>{if(reason==='disconnect')h.set({...h.view,connected:false});if(reason==='gap')h.set({...h.view,game:{...h.view.game,revision:h.view.game.revision+2}});if(reason==='identity')h.set({...h.view,table:{...h.view.table,id:'new-table'}});if(reason==='suspend')h.surface.suspend();if(reason==='failed')h.surface.failed();if(reason==='destroy')h.surface.destroy();if(reason==='hidden'){Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}},reason);
  check(`${reason}: presentation and animation are removed immediately`,await page.locator('.power-overlay:visible').count()===0);await page.clock.runFor(1600);check(`${reason}: no late queued coin cue`,await page.evaluate(()=>!soundCalls.some(c=>c.kind==='coin')));
  if(reason==='hidden')await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});
 }
 await reset();await page.evaluate(()=>{h.set({...h.view,connected:false});h.play('black-3')});check('reconnection applies fresh state without replaying missed effects',!await overlay()&&await page.evaluate(()=>soundCalls.length===0));
 check('no browser exceptions',errors.length===0);assert.deepEqual(hashes(),beforeHashes,'tested product files stayed fixed');
 writeFileSync(join(out,'result.json'),JSON.stringify({checks,errors,sourceHashes:beforeHashes},null,2));console.log(JSON.stringify({checks:checks.length,out}));
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),checks,errors,sourceHashes:beforeHashes},null,2));await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});console.error('Evidence: '+out);throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
