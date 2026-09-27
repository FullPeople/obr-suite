import {build} from 'rolldown';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname,dirname} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const root=resolve('.'),base=join(root,'extensions/three-dragon-ante/src/game'),out=mkdtempSync(join(tmpdir(),'time-dragon-browser-'));
const {chromium}=createRequire(join(process.env.DND_CARD_WEB_ROOT||'F:/CodexWork/2026-09-27/feedback/web','package.json'))('@playwright/test');
const entry=`import {mountTableUI} from ${JSON.stringify(join(base,'ui.ts'))};
import {createGame,applyAction,projectSeat,checkInvariants} from ${JSON.stringify(join(base,'rules/index.ts'))};
import {timeDragonPosition} from ${JSON.stringify(join(root,'tools/fixtures/three-dragon-time-dragon.ts'))};
import ${JSON.stringify(join(base,'style.css'))};
let game=null;const seats=[{id:'you',name:'你'},{id:'two',name:'玩家二'},{id:'three',name:'玩家三'}],sent=[];
function view(receipt){return {actionReceiptVersion:1,table:{version:1,id:'browser-fate',hostPlayerId:'you',hostConnectionId:'fixture',hostName:'你',stage:game?'playing':'lobby',seats:seats.map(s=>({playerId:s.id,seatId:s.id,name:s.name})),revision:game?.revision||0,...(game?{variant:game.variant}:{})},selfPlayerId:'you',isHost:true,connected:true,pending:false,game:game?projectSeat(game,'you'):null,...(receipt?{actionReceipt:receipt}:{})};}
const surface=mountTableUI(document.querySelector('#app'),{language:'zh',send:command=>{sent.push(structuredClone(command));queueMicrotask(()=>{
 if(command.type==='start'){game=createGame({id:'browser-game',seats,seed:42,...command.options});surface.update(view());}
 if(command.type==='action'){const result=applyAction(game,command.action);if(!result.ok)throw Error(result.error.code);game=result.state;surface.update(view({source:'host',actionId:command.action.id,tableId:'browser-fate',gameId:game.id,revision:game.revision,ok:true}));}
});}});surface.update(view());window.h={surface,sent,get game(){return game},position(){game=timeDragonPosition(9,8);surface.update(view());},invariants(){return checkInvariants(game)}};`;
await build({input:'time-dragon-browser-fixture',plugins:[{name:'fixture',resolveId(id,importer){if(id==='time-dragon-browser-fixture')return '\0fixture.ts';if(id.endsWith('.css'))return '\0css:'+resolve(importer?dirname(importer):root,id)+'.js';},load(id){if(id==='\0fixture.ts')return entry;if(id.startsWith('\0css:'))return `const style=document.createElement('style');style.textContent=${JSON.stringify(readFileSync(id.slice(5,-3),'utf8'))};document.head.append(style);`;}}],output:{file:join(out,'app.js'),format:'esm',codeSplitting:false},logLevel:'warn'});
const server=createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(join(out,'app.js')));return;}
 if(pathname.startsWith('/art/')){const file=resolve(base,pathname.slice(1));if(file.startsWith(base)&&existsSync(file)){res.setHeader('Content-Type',extname(file)==='.png'?'image/png':'image/webp');res.end(readFileSync(file));return;}res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),checks=[],errors=[];
try{
 for(const mode of ['desktop-webgl','mobile-dom']){
  const context=await browser.newContext({viewport:mode==='desktop-webgl'?{width:1440,height:960}:{width:390,height:844},hasTouch:mode==='mobile-dom',isMobile:mode==='mobile-dom',reducedMotion:'reduce'}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  if(mode==='mobile-dom')await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'||type==='webgl2'?null:get.call(this,type,...args);};});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#deck-choice').waitFor();
  await page.locator('#deck-choice').selectOption('selected-specials-v1');
  if(mode==='desktop-webgl')await page.waitForFunction(()=>document.querySelector('#app').dataset.renderer==='webgl');
  await page.locator('.special-option input:checked').first().uncheck();
  const scroll=page.locator('.board-scroll'),last=page.locator('.special-option').last();
  const box=await scroll.boundingBox();assert.ok(box);
  const topBefore=await scroll.evaluate(el=>el.scrollTop);
  await page.mouse.move(box.x+box.width/2,box.y+Math.min(100,box.height/2));
  await page.mouse.wheel(0,5000);
  await page.waitForFunction(before=>document.querySelector('.board-scroll').scrollTop>before,topBefore);
  await last.locator('input').check();assert.equal(await last.locator('input').isChecked(),true);
  await last.locator('img').evaluate(img=>img.decode());
  const lastBox=await last.boundingBox();assert.ok(lastBox&&lastBox.y>=box.y&&lastBox.y+lastBox.height<=box.y+box.height+1,'last special card can be reached');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(out,mode+'-specials-scroll.png'),fullPage:true,animations:'disabled'});
  await page.locator('#deck-choice').selectOption('wheel-of-fate-v1');
  assert.match(await page.locator('.setup-summary').innerText(),/命运之轮的轮转使用/);
  assert.match(await page.locator('.setup-extra-card').innerText(),/传说巨龙 · 善良 · 力量 12/);
  await page.locator('.setup-extra-card img').evaluate(img=>img.decode());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(out,mode+'-setup.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'开始游戏',exact:true}).click();await page.waitForFunction(()=>h.game?.variant.deckId==='wheel-of-fate-v1');
  assert.equal(await page.evaluate(()=>h.game.deck.length+h.game.seats.reduce((sum,s)=>sum+s.hand.length,0)),81);
  await page.evaluate(()=>h.position());await page.waitForFunction(()=>!h.surface.presentationBusy());
  if(mode==='desktop-webgl'){await page.waitForFunction(()=>document.querySelector('#app').dataset.renderer==='webgl');await page.locator('#table-stage').focus();}
  else await page.locator('#hand [data-card="time-dragon"]').first().focus();
  await page.keyboard.press('Space');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>h.game.seats[0].flight.some(item=>item.cardId==='time-dragon'));
  await page.locator('.power-overlay:not([hidden])').waitFor();assert.match(await page.locator('.power-overlay h2').innerText(),/时光龙/);
  assert.match(await page.locator('.power-description').innerText(),/获得弃牌堆里的所有牌/);
  await page.locator('.power-overlay img').evaluate(img=>img.decode());
  const result=await page.evaluate(()=>({hand:h.game.seats[0].hand.length,discard:h.game.discard.length,invariants:h.invariants(),pending:h.surface.waitingForReceipt(),renderer:document.querySelector('#app').dataset.renderer,plays:h.sent.filter(c=>c.type==='action').length}));
  assert.equal(result.hand,10);assert.equal(result.discard,6);assert.deepEqual(result.invariants,[]);assert.equal(result.pending,false);assert.equal(result.plays,1);
  await page.screenshot({path:join(out,mode+'-power.png'),fullPage:true,animations:'disabled'});checks.push({mode,...result});await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(join(out,'results.json'),JSON.stringify({passed:true,checks,errors,hostTransport:'simulated; actual UI, rules, image loading and WebGL'},null,2));console.log(JSON.stringify({passed:true,checks,errors,out}));
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),checks,errors},null,2));console.error('Evidence: '+out);throw error;}
finally{await browser.close();await new Promise(done=>server.close(done));}
