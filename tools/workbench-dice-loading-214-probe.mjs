import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,join} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const deps=createRequire(process.env.DND_WEB_PACKAGE||'U:/code/DND-card-cloud-feedback-20260930-7f00bead/package.json');
const {chromium}=deps('@playwright/test'),out=resolve(process.env.DND_DICE_EVIDENCE||'D:/Desktop/DND-card-web/.local-evidence/dice-layer-20261001');
const panels=resolve(process.env.DND_DICE_PANELS||join(out,'panels')),root=resolve(import.meta.dirname,'..'),origin='http://127.0.0.1:5217';
mkdirSync(out,{recursive:true});
const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{const path=new URL(req.url,origin).pathname;
 if(path==='/fixture'){res.setHeader('Content-Type',mime['.html']);res.end(`<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script>
window.loadingState={ready:true,done:10,total:10,physics:true,overlay:true};window.calls=[];window.initDelay=0;window.omitInitial=false;
addEventListener('message',async e=>{if(e.source!==document.querySelector('iframe')?.contentWindow)return;const m=e.data;if(m.channel!=='workbench-dice-frame/v1'||!m.id)return;calls.push(m.method);let result;
if(m.method==='init'){await new Promise(r=>setTimeout(r,initDelay));result={roomId:'test',...(!omitInitial?{diceLoading:loadingState}:{}),reads:{'player.getId':'gm','player.getConnectionId':'loading-gm','player.getRole':'GM','player.getName':'测试主持人','player.getColor':'#123456','player.getMetadata':{},'player.getSelection':[],'party.getPlayers':[],'scene.items.getItems':[]}};}
else if(m.method==='dice3d.status')result=loadingState;
else if(m.method==='dice3d.retry'){loadingState={ready:false,done:0,total:10,phase:'重新加载'};result=loadingState;}
else if(m.method==='scene.items.getItems')result=[];
e.source.postMessage({channel:m.channel,id:m.id,result},location.origin);});
window.openPanel=name=>{document.querySelector('iframe')?.remove();const f=document.createElement('iframe');f.width='560';f.height='600';f.src='/panels/'+name+'.html';document.body.append(f);};
</script></body></html>`);return;}
 const base=path.startsWith('/panels/')?panels:join(root,'public'),file=resolve(base,path.replace(/^\/panels\/|^\/suite-dev\//,''));
 try{if(!file.startsWith(base+'/')&&!file.startsWith(base+'\\'))throw Error('path');res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(5217,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
try{const page=await browser.newPage({viewport:{width:800,height:740}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.loadingPaints=0;window.loadingShows=0;function measure(){const cover=document.getElementById('dice3d-loading');if(cover&&!cover.hidden&&getComputedStyle(cover).display!=='none')window.loadingPaints++;requestAnimationFrame(measure);}requestAnimationFrame(measure);new MutationObserver(records=>{for(const r of records)if(r.target.id==='dice3d-loading'&&r.attributeName==='hidden'&&!r.target.hidden)window.loadingShows++;}).observe(document,{subtree:true,attributes:true,attributeFilter:['hidden']});});
 await page.goto(origin+'/fixture');
 async function open(panel,options={}){await page.evaluate(({panel,options})=>{Object.assign(window,options);openPanel(panel);},{panel,options});const frame=await new Promise(resolve=>{const present=page.frames().find(f=>f.url().includes('/panels/'));if(present)resolve(present);else page.once('framenavigated',resolve);});await frame.waitForFunction(()=>document.getElementById('dice3d-loading'));return frame;}
 for(const panel of ['quick','index']){
  for(let cycle=0;cycle<5;cycle++){const frame=await open(panel,{loadingState:{ready:true,done:10,total:10,overlay:true,physics:true},initDelay:0,omitInitial:false});await frame.waitForFunction(()=>document.body.dataset.bridgeReady==='true');await frame.waitForTimeout(80);assert.equal(await frame.evaluate(()=>window.loadingPaints),0);assert.equal(await frame.evaluate(()=>window.loadingShows),0);assert.equal(await frame.locator('#dice3d-loading').isVisible(),false);assert.equal(await frame.evaluate(()=>document.querySelector('.popup,.panel').inert),false);}checks.push(panel+': five warm reopenings, zero visible progress frames');
  let frame=await open(panel,{loadingState:{ready:true},initDelay:350});assert.equal(await frame.evaluate(()=>document.querySelector('.popup,.panel').inert),true);await frame.press('body','Enter');await frame.waitForFunction(()=>document.body.dataset.bridgeReady==='true');assert.equal(await frame.evaluate(()=>window.loadingPaints),0);checks.push(panel+': delayed ready handshake stays gated without false progress');
  frame=await open(panel,{loadingState:{ready:true},initDelay:0,omitInitial:true});await frame.waitForFunction(()=>document.body.dataset.bridgeReady==='true');assert.equal(await frame.evaluate(()=>window.loadingPaints),0);checks.push(panel+': legacy init uses authoritative status fallback without flash');
  frame=await open(panel,{loadingState:{ready:false,done:1,total:10,bytes:1000,phase:'下载资源'},omitInitial:false});await frame.waitForFunction(()=>document.body.dataset.bridgeReady==='true');assert.equal(await frame.locator('#dice3d-loading').isVisible(),true);assert.equal(await frame.evaluate(()=>document.querySelector('.popup,.panel').inert),true);await frame.press('body','Enter');assert.equal(await page.evaluate(()=>calls.filter(x=>x==='dice3d.submit'||x==='broadcast.sendMessage').length),0);
  await page.evaluate(()=>loadingState={ready:false,done:5,total:10,phase:'下载资源',bytes:1048576});await frame.waitForFunction(()=>document.querySelector('#dice3d-loading progress').value===50);await page.screenshot({path:join(out,'cold-'+panel+'.png')});
  await page.evaluate(()=>loadingState={ready:false,error:'测试：素材暂不可用'});await frame.getByRole('button',{name:'重新加载'}).click();await frame.waitForFunction(()=>document.querySelector('#dice3d-loading-detail').textContent.includes('重新加载'));assert.equal(await page.evaluate(()=>calls.includes('dice3d.retry')),true);
  await page.evaluate(()=>loadingState={ready:true,physics:true,overlay:true});await frame.waitForFunction(()=>document.body.dataset.diceLoading==='false');assert.equal(await frame.evaluate(()=>document.querySelector('.popup,.panel').inert),false);await page.screenshot({path:join(out,'ready-'+panel+'.png')});checks.push(panel+': actual cold progress, inert input, retry and ready release');
  await page.evaluate(()=>loadingState={ready:false,error:'测试：渲染层连接中断'});await frame.getByText('测试：渲染层连接中断',{exact:true}).waitFor();assert.equal(await frame.evaluate(()=>document.querySelector('.popup,.panel').inert),true);checks.push(panel+': readiness loss relocks input and shows real error');
 }
 assert.deepEqual(errors,[]);const report={success:true,checks,warmReopenings:10,errors,realOwlbearRoom:false};writeFileSync(join(out,'loading-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
