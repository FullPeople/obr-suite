import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdtempSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const base=resolve(import.meta.dirname,'../extensions/three-dragon-ante/src/game'),out=mkdtempSync(join(tmpdir(),'tda-pack-'));
const ref=p=>JSON.stringify(join(base,p).replaceAll('\\','/'));
const entry=`import{mountTableUI}from ${ref('ui.ts')};import{createTutorialGame,tutorialMove}from ${ref('tutorial.ts')};
import{applyAction,card,CARDS,projectSeat,projectPublic,checkInvariants}from ${ref('rules/index.ts')};
import{PRINTED_PACK}from ${ref('rules/printed-pack.ts')};import{roundCues,mountRoundPresentation}from ${ref('round-presentation.ts')};
import{freshPublicEvents}from ${ref('power-sequence.ts')};import{mountOnboarding}from ${ref('onboarding/index.ts')};
const w=window as any;let state:any,surface:any,guide:any,viewer='you',lessonId='gambit-tie',revision=0;const sounds:any[]=[],sent:any[]=[];
function view(){return{actionReceiptVersion:1,table:{version:1,id:'pack-table',hostPlayerId:'you',hostConnectionId:'local',hostName:'You',stage:'playing',seats:state.seats.map((s:any)=>({playerId:s.id,seatId:s.id,name:s.name})),revision:state.revision},selfPlayerId:viewer,isHost:viewer==='you',connected:true,pending:false,game:viewer==='spectator'?projectPublic(state):projectSeat(state,viewer)}}
function reset(lesson='gambit-tie',who='you'){surface?.destroy();guide?.destroy();viewer=who;lessonId=lesson;state=createTutorialGame(lesson,'pack-'+(++revision));surface=mountTableUI(document.querySelector('#app')!,{language:'zh',send:c=>sent.push(c)});surface.update(view());return state}
function move(){const a=tutorialMove(state,lessonId,crypto.randomUUID());const result=applyAction(state,a);if(!result.ok)throw Error(result.error.code);state=result.state;surface.update(view());return state}
function finishScore(){for(let i=0;i<30;i++){move();if(state.events.some((e:any)=>e.code==='GAMBIT_SCORED'))return state;}throw Error('no score')}
w.h={reset,move,finishScore,view,card,CARDS,PRINTED_PACK,roundCues,freshPublicEvents,sent,sounds,cardIds:()=>CARDS.map(c=>c.id),surface:()=>surface,
 guide(){guide?.destroy();guide=mountOnboarding(document.body,{language:'zh',onClose(){},onPractice(){}})},
 snapshot(){return state},disconnect(){surface.update({...view(),connected:false})},reconnect(){surface.update(view())},
 round(){const before=view();state.round++;state.active=(state.active+1)%state.seats.length;state.revision++;state.events.push({code:'ROUND_FIXTURE'});surface.update(view());return before},
 end(){state.stage='ended';state.winners=['you'];state.revision++;state.events.push({code:'GAME_ENDED'});surface.update(view())},
 async assets(){const loaded=[];for(const c of CARDS){const image=new Image();image.src=new URL('./art/pack-20260910/cards/'+c.id+'.webp',location.href).href;await image.decode();loaded.push([c.id,image.naturalWidth,image.naturalHeight])}return loaded},
 destroy(){surface?.destroy();guide?.destroy()}}
reset();`;
await build({input:'pack-entry',platform:'browser',plugins:[{name:'test-entry',resolveId(id){if(id==='pack-entry')return '\0pack.ts';if(id.endsWith('.css'))return '\0css'},load(id){if(id==='\0pack.ts')return entry;if(id==='\0css')return ''}}],output:{file:join(out,'app.js'),format:'esm',codeSplitting:false},logLevel:'silent'});
const css=['style.css','tutorial.css','stage-ui.css','power-presentation.css','card-images.css','round-presentation.css','onboarding/style.css'].map(f=>readFileSync(join(base,f),'utf8')).join('\n');
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(readFileSync(join(out,'app.js')))}
 const art=/^\/art\/pack-20260910\/cards\/([a-z0-9-]+)\.webp$/.exec(path);if(art){const file=join(base,'art/pack-20260910/cards',art[1]+'.webp');if(!existsSync(file)){res.statusCode=404;return res.end()}res.setHeader('Content-Type','image/webp');return res.end(readFileSync(file))}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>`)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),checks=[],errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
function check(name,value){assert.ok(value,name);checks.push(name);console.log('PASS '+name)}
async function dismissPowers(){for(let i=0;i<30;i++){if(!await page.locator('.power-overlay').isVisible())return;await page.locator('.power-overlay').press('Enter');}throw Error('power queue did not finish')}
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.h);
 check('initial snapshots do not replay a round or scoring overlay',!await page.locator('.round-overlay').isVisible());
 check('supplied values and exact Green Schemer demand text',await page.evaluate(()=>h.card('blue-overlord').strength===8&&h.card('white-hunter').strength===10&&h.card('white-6').strength===7&&h.PRINTED_PACK['green-schemer'][1].includes('更强的邪恶龙')));
 check('100 unique card identities have a printed family description',await page.evaluate(()=>h.CARDS.length===100&&new Set(h.cardIds()).size===100&&h.CARDS.every(c=>h.PRINTED_PACK[c.family]?.length===2)));
 const initialArt=requests.filter(url=>url.endsWith('.webp'));check('opening a table loads only visible cards, not the whole pack',initialArt.length>0&&initialArt.length<40);
 check('every supplied face decodes with consistent portrait dimensions',(await page.evaluate(()=>h.assets())).every(([,w,h])=>w===768&&h===1357));
 check('no supplied reverse image or AI art requested',!requests.some(url=>/背面|back\.webp|imagegen|ai-image/.test(url)));
 await page.screenshot({path:join(out,'table-pack.png')});
 const scored=await page.evaluate(()=>h.finishScore());check('tied scoring retains immutable public per-card totals',scored.events.some(e=>e.score?.reason==='tied'&&e.score.rows.every(r=>r.cards.reduce((sum,c)=>sum+c.points,0)+r.bonus===r.total)));
 await dismissPowers();await page.waitForFunction(()=>document.querySelector('.round-overlay:not([hidden])')?.getAttribute('data-kind')==='score');
 check('scoring starts before final totals',await page.locator('.score-total').allTextContents().then(values=>values.some(v=>v==='= 0')));
 await page.waitForFunction(()=>Number(document.querySelector('.round-overlay')?.getAttribute('data-step'))===1);
 check('first stage counts precisely the first card for each player',await page.evaluate(()=>[...document.querySelectorAll('.score-row')].every(row=>row.querySelectorAll('.score-card.counted').length===1)));
 await page.locator('.score-card').first().hover();check('scored cards still open full effect inspection',await page.locator('#card-preview').isVisible());
 await page.locator('#close-preview').click();await page.screenshot({path:join(out,'score-addition.png')});
 await page.waitForSelector('.score-result');check('ties explicitly explain the extra round',(await page.locator('.score-result').innerText()).includes('加打一轮'));
 await page.screenshot({path:join(out,'score-tied.png')});
 await page.waitForFunction(()=>document.querySelector('.round-overlay:not([hidden])')?.getAttribute('data-kind')==='round');
 check('new-round banner follows scoring and names the actor',(await page.locator('.round-content').innerText()).includes('新的一轮')&&(await page.locator('.round-content').innerText()).includes('出牌'));
 await page.screenshot({path:join(out,'new-round.png')});
 await page.evaluate(()=>h.disconnect());check('disconnect clears every presentation immediately',!await page.locator('.round-overlay').isVisible());
 await page.evaluate(()=>h.reconnect());check('reconnect does not replay stale scoring',!await page.locator('.round-overlay').isVisible());
 await page.evaluate(()=>h.reset('empty','spectator'));await page.evaluate(()=>h.finishScore());await dismissPowers();
 await page.waitForSelector('.score-result');check('spectators see actual win and gold settlement',(await page.locator('.score-result').innerText()).includes('赢得本轮局'));
 await page.evaluate(()=>h.reset('powers'));await page.evaluate(()=>h.guide());
 for(let i=0;i<4;i++)await page.locator('.tda-guide-next').click();
 check('dedicated buying page gives price discard and refill rules',(await page.locator('.tda-guide-description').innerText()).includes('必须买牌')&&(await page.locator('.tda-guide-results').innerText()).includes('4 张'));
 await page.locator('.tda-guide-next').click();check('guide distinguishes game, gambit, round and pack variant',(await page.locator('.tda-guide-description').innerText()).includes('斗牌')&&(await page.locator('.tda-guide-tip').innerText()).includes('墨绿策划者要求更强'));
 await page.screenshot({path:join(out,'guide-rules.png')});
 await page.evaluate(()=>h.destroy());check('destroy removes every cinematic overlay',await page.locator('.round-overlay,.power-overlay').count()===0);check('no browser runtime errors',errors.length===0);
 writeFileSync(join(out,'result.json'),JSON.stringify({pass:true,checks,errors,initialArtRequests:initialArt.length,output:out},null,2));console.log(out);
}catch(error){await page.screenshot({path:join(out,'failure.png')});writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),checks,errors,output:out},null,2));console.error(out);throw error;}finally{await browser.close();await new Promise(r=>server.close(r))}
