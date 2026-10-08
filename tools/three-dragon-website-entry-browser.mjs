// Actual standard-build HTML, real browser links and close clicks. The remote
// website document and parent receiver are fixtures; gameplay is not exercised.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=join(root,'.local-evidence/three-dragon-website-browser');mkdirSync(out,{recursive:true});
const origin='https://suite-fixture.invalid',website='https://dnd.center/3-dragon/';
const entries=new Map([['/suite/three-dragon-ante.html','dist/three-dragon-ante.html'],['/suite-dev/three-dragon-ante.html','dist-workbench-dev/three-dragon-ante.html'],['/suite-dev/workbench-panels/table.html','dist-workbench-dev/workbench-panels/table.html']].map(([url,file])=>[url,readFileSync(join(root,file),'utf8')]));
const parent='<!doctype html><meta charset="utf-8"><button id="parent-settings">父宿主设置</button><iframe title="Suite website link" style="display:block;width:100%;height:600px;border:0" src="/suite-dev/workbench-panels/table.html"></iframe><script>window.received=[];addEventListener("message",event=>{const frame=document.querySelector("iframe");if(event.origin!==location.origin||event.source!==frame?.contentWindow||event.data?.channel!=="workbench-panel-frame/v1")return;received.push(event.data);if(event.data.close)frame.remove();});</script>';
const checks=[],errors=[],requests=[];
if(process.argv.includes('--prepare-only')){console.log('Prepared '+entries.size+' standard-build website entry fixtures; browser not launched');process.exit(0);}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||process.env.CHROME_PATH||undefined,headless:true});
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:960}});
  await context.route('**/*',route=>{const url=route.request().url();requests.push(url);if(url===website)return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Website destination fixture</title>'});if(url.startsWith(origin)){const path=new URL(url).pathname,html=path==='/parent.html'?parent:entries.get(path);if(html)return route.fulfill({contentType:'text/html',body:html});}return route.fulfill({status:404,body:''});});
  for(const path of entries.keys()){
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+path);
   const opened=context.waitForEvent('page');await page.getByRole('link',{name:'打开线上三龙牌',exact:true}).click();const destination=await opened;await destination.waitForLoadState('domcontentloaded');
   assert.equal(destination.url(),website);assert.equal(page.url(),origin+path);assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.locator('#return').isVisible(),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await destination.close();await page.close();checks.push(`${width}px ${path}: new website tab without replacing the host`);
  }
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/parent.html');await page.frameLocator('iframe').getByRole('button',{name:'返回 Suite 工作区'}).click();await page.locator('iframe').waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>window.received),[{channel:'workbench-panel-frame/v1',close:true}]);await page.getByRole('button',{name:'父宿主设置'}).click();await page.screenshot({path:join(out,`return-${width}.png`)});checks.push(`${width}px parent remains usable after same-origin close`);await context.close();
 }
 assert.deepEqual(errors,[]);assert.equal(requests.some(url=>url.includes('/three-dragon-api/')||url.includes('owlbear.rodeo')),false);
 writeFileSync(join(out,'results.json'),JSON.stringify({passed:true,checks,errors,apiOrOwlbearRequests:0,scope:'Actual standard-build entries and browser interaction; destination and parent close receiver are fixtures. No live room/gameplay acceptance.'},null,2)+'\n');console.log(`${checks.length} public website browser checks passed`);
}finally{await browser.close();}
