// Native choice buttons on the actual UI; no renderer or rules stubs.
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const base=import.meta.dirname,out=mkdtempSync(join(tmpdir(),'tda-choice-input-'));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const sourceHash=sha(join(base,'ui.ts'));
const only=process.argv.find(v=>v.startsWith('--case='))?.slice(7);
const runtime=process.env.CODEX_NODE_MODULES||'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=await import(pathToFileURL(join(runtime,'playwright/index.mjs')));
const entry=`import{mountTableUI}from ${JSON.stringify(resolve(base,'ui.ts'))};
import{createTutorialGame,tutorialMove}from ${JSON.stringify(resolve(base,'tutorial.ts'))};
import{applyAction,projectSeat,checkInvariants}from ${JSON.stringify(resolve(base,'rules/index.ts'))};
let state=createTutorialGame('kobold','native-choices');
// Move one unused hand card back to the deck before play. All 80 cards and
// gold remain conserved; the actual Kobold rule now offers exactly two cards.
state.deck.push(state.seats[0].hand.pop());
const start=applyAction(state,tutorialMove(state,'kobold','play-kobold'));
if(!start.ok)throw Error(start.error.code);state=start.state;
function view(receipt){return{actionReceiptVersion:1,table:{version:1,id:'choice-table',hostPlayerId:'you',hostConnectionId:'local',hostName:'You',stage:'playing',seats:state.seats.map(s=>({playerId:s.id,seatId:s.id,name:s.name})),revision:state.revision},selfPlayerId:'you',isHost:true,connected:true,pending:false,game:projectSeat(state,'you'),...(receipt?{actionReceipt:receipt}:{})};}
const sent=[],surface=mountTableUI(document.querySelector('#app'),{language:'en',send:command=>{sent.push(structuredClone(command))}});
surface.update(view());
window.h={sent,surface,get view(){return view()},ack(){const move=sent.at(-1)?.action;if(!move)throw Error('NO_CHOICE');const result=applyAction(state,move);if(!result.ok)throw Error(result.error.code);state=result.state;surface.update(view());const pendingWithoutReceipt=surface.waitingForReceipt();surface.update(view({source:'host',actionId:move.id,tableId:'choice-table',gameId:state.id,revision:state.revision,ok:true}));return{pendingWithoutReceipt,pendingAfterReceipt:surface.waitingForReceipt(),revision:state.revision,invariants:checkInvariants(state),move};}};`;
await build({input:'choice-fixture',plugins:[{name:'fixture',resolveId(id){if(id==='choice-fixture')return '\0choice-fixture.ts';if(id.endsWith('.css'))return '\0css';},load(id){if(id==='\0choice-fixture.ts')return entry;if(id==='\0css')return '';}}],output:{file:join(out,'app.js'),format:'esm',codeSplitting:false},logLevel:'silent'});
const css=['style.css','tutorial.css','onboarding/style.css','stage-ui.css','power-presentation.css'].map(f=>readFileSync(join(base,f),'utf8')).join('\n');
const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(join(out,'app.js')));}else{res.setHeader('content-type','text/html');res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>`);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const checks=[],errors=[],cases=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)};
let page;
try{
 for(const renderer of ['dom','webgl'])for(const input of ['mouse','touch','keyboard']){
  const label=renderer+'-'+input;if(only&&only!==label)continue;
  page=await browser.newPage({viewport:{width:390,height:780},hasTouch:input==='touch',isMobile:input==='touch',reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(String(e)));
  if(renderer==='dom')await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(type==='webgl'||type==='webgl2')return null;return original.call(this,type,...args)};});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.h);
  const initial=await page.evaluate(()=>({renderer:document.querySelector('#app').dataset.renderer,choice:h.view.game.actions[0]}));
  check(label+': actual engine supplies the two-card exchange',initial.renderer===renderer&&initial.choice.kind==='choose'&&initial.choice.choice.code==='EXCHANGE_HAND_CARDS'&&initial.choice.choice.min===0&&initial.choice.choice.max===2);
  const options=page.locator('.choices [data-option][data-card]');
  assert.equal(await options.count(),2,'real exchange offers both remaining hand cards');
  const ids=await options.evaluateAll(nodes=>nodes.slice(0,2).map(n=>n.dataset.option));
  for(let i=0;i<2;i++){
   const option=options.nth(i);
   if(input==='touch')await option.tap();else if(input==='mouse')await option.click();else{await option.focus();await page.keyboard.press(i===0?'Space':'Enter');}
   check(label+`: native ${input} selects option ${i+1}`,await option.getAttribute('aria-pressed')==='true');
  }
  check(label+': both selections stay local until confirmation',await page.evaluate(()=>h.sent.length===0&&document.querySelectorAll('.choices [aria-pressed="true"]').length===2));
  check(label+': selecting choices does not open a pinned overlay',await page.locator('#card-preview').getAttribute('data-pinned')!=='true');
  const inspect=page.locator('.choices .inspect-card').first();
  if(input==='touch')await inspect.tap();else await inspect.click();
  check(label+': explicit inspection still pins details without submitting',await page.locator('#card-preview').getAttribute('data-pinned')==='true'&&await page.evaluate(()=>h.sent.length===0));
  if(input==='touch')await page.locator('#close-preview').tap();else await page.locator('#close-preview').click();
  await page.screenshot({path:join(out,label+'.png')});
  const confirm=page.locator('#confirm-action');
  if(input==='touch')await confirm.tap();else if(input==='keyboard'){await confirm.focus();await page.keyboard.press('Enter');}else await confirm.click();
  const submitted=await page.evaluate(()=>({sent:h.sent,pending:h.surface.waitingForReceipt()}));
  check(label+': confirmation submits exactly the chosen real-rule options',submitted.pending&&submitted.sent.length===1&&submitted.sent[0].type==='action'&&submitted.sent[0].action.kind==='choose'&&JSON.stringify(submitted.sent[0].action.optionIds)===JSON.stringify(ids));
  const applied=await page.evaluate(()=>h.ack());
  check(label+': actual rules and identity-matched receipt unlock the choice',applied.pendingWithoutReceipt&&!applied.pendingAfterReceipt&&applied.revision===2&&applied.invariants.length===0);
  cases.push({label,ids,applied});await page.evaluate(()=>h.surface.destroy());await page.close();page=null;
 }
 check('no uncaught application errors',errors.length===0);
 check('product source stayed fixed through the test',sourceHash===sha(join(base,'ui.ts')));
 writeFileSync(join(out,'result.json'),JSON.stringify({sourceHash,compiledHash:sha(join(out,'app.js')),checks,cases,errors,scope:'Actual Chrome native pointer/touch/keyboard UI with real rules. WebGL uses ANGLE SwiftShader, not native Owlbear UAT.'},null,2));
 console.log(`${checks.length} PASS ${out}`);
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({sourceHash,checks,cases,errors,error:String(error),stack:error.stack},null,2));if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw new Error('Choice-input verification failed: '+out,{cause:error});}
finally{await browser.close();await new Promise(r=>server.close(r));}
