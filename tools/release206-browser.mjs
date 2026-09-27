import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(resolve('../web/package.json'))('@playwright/test');
const origin='https://obr.dnd.center',out='D:/Temp/DND-card-release206-storage/release206';mkdirSync(out,{recursive:true});
const live=process.argv.includes('--live'),browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']}),errors=[],checks=[];
try{
 for(const mode of ['card','suite'])for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:960},serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://5e.kiwee.top/**',r=>r.fulfill({json:{}}));await context.route('https://homebrew.kiwee.top/**',r=>r.fulfill({json:{}}));
  if(!live)await context.route(origin+'/**',r=>{const path=decodeURIComponent(new URL(r.request().url()).pathname),prefix=mode==='card'?'/card/':'/suite-dev/workbench/';if(!path.startsWith(prefix))return r.continue();const file=resolve(mode==='card'?'../web/dist-standalone':'dist-workbench-dev/workbench',path.slice(prefix.length)||'index.html');if(!existsSync(file))return r.fulfill({status:404});return r.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8'})[extname(file)]||'application/octet-stream',body:readFileSync(file)});});
  await page.goto(origin+(mode==='card'?'/card/':'/suite-dev/workbench/#suite=notice205&bridge='+encodeURIComponent(origin)),{timeout:60000});const notice=page.locator('.announcement');await notice.waitFor();assert((await notice.innerText()).includes(mode==='card'?'0.1.11':'1.0.206-dev'));
  const notes=await page.locator('.announcement-issues').innerText();assert(notes.includes('自定义条目的中文名和英文名'));assert.equal(notes.includes('分配玩家'),mode==='suite');assert.equal(notes.includes('HTTP/2'),mode==='suite');assert.equal(notes.includes('落牌动画'),mode==='suite');
  await page.screenshot({path:out+'/'+(live?'live':'candidate')+'-'+mode+'-'+(mobile?'mobile':'desktop')+'.png'});await page.getByRole('button',{name:'我知道了',exact:true}).click();await page.locator('.app-shell').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const protocol=await page.evaluate(async()=>{const url='/http2-205-deployment.json?probe='+Date.now();await (await fetch(url)).arrayBuffer();return performance.getEntriesByType('resource').findLast(r=>r.name.includes(url))?.nextHopProtocol;});assert.equal(protocol,'h2');checks.push({mode,mobile,protocol,live});await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(out+'/'+(live?'live':'candidate')+'-ui.json',JSON.stringify({checks,errors,scope:'Production bundles; Wiki responses empty synthetic fixtures; Owlbear room not connected.'},null,2));console.log(JSON.stringify(checks));
}finally{await browser.close();}
