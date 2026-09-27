import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(resolve('../web/package.json'))('@playwright/test');
const origin='https://obr.dnd.center',out='D:/Temp/DND-card-release208-storage/release208';mkdirSync(out,{recursive:true});
const live=process.argv.includes('--live'),browser=await chromium.launch({...(process.env.COMPAT_BROWSER?{executablePath:process.env.COMPAT_BROWSER}:{channel:'msedge'}),headless:true,args:['--no-proxy-server']}),errors=[],checks=[];
try{
 for(const mode of ['card','suite'])for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:960},serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://5e.kiwee.top/**',r=>r.fulfill({json:{}}));await context.route('https://homebrew.kiwee.top/**',r=>r.fulfill({json:{}}));
  if(!live)await context.route(origin+'/**',r=>{const path=decodeURIComponent(new URL(r.request().url()).pathname),prefix=mode==='card'?'/card/':'/suite-dev/workbench/';if(!path.startsWith(prefix))return r.continue();const file=resolve(mode==='card'?'../web/dist-standalone':'dist-workbench-dev/workbench',path.slice(prefix.length)||'index.html');if(!existsSync(file))return r.fulfill({status:404});return r.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8'})[extname(file)]||'application/octet-stream',body:readFileSync(file)});});
  await page.goto(origin+(mode==='card'?'/card/':'/suite-dev/workbench/#suite=notice205&bridge='+encodeURIComponent(origin)),{timeout:60000});const notice=page.locator('.announcement');await notice.waitFor();assert((await notice.innerText()).includes(mode==='card'?'0.1.13':'1.0.208-dev'));
  const current=page.locator('.announcement-current');assert((await current.innerText()).includes('武器'));assert.equal((await current.innerText()).includes('三龙牌'),mode==='suite');
  const history=page.locator('.announcement-history');assert.equal(await history.evaluate(el=>el.open),false);assert.equal(await history.locator('summary').innerText(),'2026-09-27-一');
  await history.locator('summary').click();assert((await history.innerText()).includes('导出指定角色或多卡备份'));await history.locator('summary').click();
  await page.screenshot({path:out+'/'+(live?'live':'candidate')+'-'+mode+'-'+(mobile?'mobile':'desktop')+'.png'});await page.getByRole('button',{name:'我知道了',exact:true}).click();await page.locator('.app-shell').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const protocol=await page.evaluate(async()=>{const url='/http2-205-deployment.json?probe='+Date.now();await (await fetch(url)).arrayBuffer();return performance.getEntriesByType('resource').findLast(r=>r.name.includes(url))?.nextHopProtocol;});assert.equal(protocol,'h2');checks.push({mode,mobile,protocol,live});await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(out+'/'+(live?'live':'candidate')+'-ui.json',JSON.stringify({checks,errors,scope:'Production bundles; Wiki responses empty synthetic fixtures; Owlbear room not connected.'},null,2));console.log(JSON.stringify(checks));
}finally{await browser.close();}
