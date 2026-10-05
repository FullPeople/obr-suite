import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,extname,sep} from 'node:path';
import {chromium} from '@playwright/test';

// Real production quick/full panel bundles and facade, mocked parent RPC host.
// This companion covers DOM, actual panel subscriptions, role updates and reopen.
// No HTTP listener is needed. Remove Playwright's default anti-throttling flags;
// this headless UI test still does not establish real window visibility behavior.
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.DND_DICE_EVIDENCE||'.cache/dice-quick-history-browser'),panels=resolve(out,'panels');
mkdirSync(out,{recursive:true});
execFileSync(process.execPath,['tools/build-workbench-dice.mjs'],{cwd:root,env:{...process.env,WORKBENCH_DICE_OUT:panels},stdio:'inherit'});
const origin='https://dice-history-fixture.test',channel='workbench-dice-frame/v1';
const fixture=`<!doctype html><title>Dice history subscription fixture</title><script>
const channel=${JSON.stringify(channel)};
window.fixture={role:'GM',calls:[],ready:0,closes:0};
window.publish=(event,data)=>document.querySelector('iframe')?.contentWindow.postMessage({channel,event,data},location.origin);
window.row=(id,extra={})=>({_3dConnection:'local',rollId:id,ts:Date.now(),itemId:null,rollerId:'other',rollerName:'Saved roller',rollerColor:'#ffffff',expression:'1d6',label:id,total:3,modifier:0,winnerIdx:-1,hidden:false,visibility:'all',dice:[{type:'d6',value:3}],...extra});
window.saved=Array.from({length:100},(_,i)=>row('saved-'+i,{ts:i}));
addEventListener('message',event=>{
 if(event.source!==document.querySelector('iframe')?.contentWindow||event.origin!==location.origin||event.data?.channel!==channel)return;
 const m=event.data;if(m.ready){fixture.ready++;return;}if(m.close){fixture.closes++;return;}if(!m.id)return;
 fixture.calls.push({method:m.method,args:m.args});let result;
 if(m.method==='init')result={roomId:'history-fixture',diceLoading:{ready:true,physics:true,overlay:true},reads:{'player.getId':'owner','player.getConnectionId':'local','player.getName':'Synthetic','player.getRole':fixture.role,'player.getColor':'#ffffff','player.getMetadata':{},'player.getSelection':[],'scene.items.getItems':[],'scene.grid.getDpi':150,'party.getPlayers':[]}};
 else if(m.method==='dice3d.history'){for(const row of saved)publish('com.obr-suite/dice-roll',{connectionId:'local',data:row});}
 else if(m.method==='dice3d.status')result={ready:true,physics:true,overlay:true};
 else if(m.method==='scene.items.getItems')result=[];
 event.source.postMessage({channel,id:m.id,result},location.origin);
});
window.openPanel=name=>{document.querySelector('iframe')?.remove();const frame=document.createElement('iframe');frame.style='width:960px;height:800px;border:0';frame.src='/panels/'+name+'.html?expr=1d6&label=Quick';document.body.append(frame);};
</script>`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const ignoredDefaults=['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'];
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:ignoredDefaults,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})}).catch(error=>{writeFileSync(resolve(out,'failure.json'),JSON.stringify({success:false,phase:'browser-launch',error:String(error),stack:error?.stack},null,2));throw error;});
const context=await browser.newContext({viewport:{width:1100,height:900}}),page=await context.newPage(),errors=[],checks=[];
page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(15000);
page.on('pageerror',error=>errors.push(String(error)));
await context.route(origin+'/**',route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/fixture')return route.fulfill({contentType:'text/html',body:fixture});
 const base=path.startsWith('/panels/')?panels:resolve(root,'public'),file=resolve(base,path.replace(/^\/panels\/|^\/suite-dev\//,''));
 if(!file.startsWith(base+sep))return route.fulfill({status:403});
 try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:readFileSync(file)});}catch{return route.fulfill({status:404});}
});
async function open(name){
 await page.evaluate(name=>openPanel(name),name);
 await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.body?.dataset.bridgeReady==='true');
 return page.frames().find(frame=>frame.url().includes('/panels/'));
}
try{
 await page.goto(origin+'/fixture');
 for(let cycle=0;cycle<5;cycle++){
  const frame=await open('quick');
  assert.equal(await frame.evaluate(()=>document.body.dataset.diceLoading),'false');
  await frame.locator('[data-act="roll"]').click();
  await page.waitForFunction(count=>fixture.closes===count,cycle+1);
 }
 assert.equal(await page.evaluate(()=>fixture.calls.filter(call=>call.method==='dice3d.history').length),0);
 assert.equal(await page.evaluate(()=>fixture.calls.filter(call=>call.method==='broadcast.sendMessage'&&call.args[0]==='com.obr-suite/dice-quick-roll').length),5);
 checks.push('five actual quick-page mount/click/close cycles send zero history RPCs and five requested rolls');

 let frame=await open('index');
 assert.equal(await page.evaluate(()=>fixture.calls.filter(call=>call.method==='dice3d.history').length),1);
 await frame.locator('button.tab[data-tab="history"]').click();
 await frame.waitForFunction(()=>document.querySelectorAll('#historyList .entry').length===100);
 checks.push('actual full panel requests and renders all 100 history records');
 await page.evaluate(()=>publish('com.obr-suite/dice-roll',{connectionId:'local',data:row('current-result',{ts:1001})}));
 await frame.locator('#historyList .entry[data-cid="current-result"]').waitFor();
 await page.evaluate(()=>publish('com.obr-suite/dice-roll',{connectionId:'local',data:row('gm-private-current',{ts:1002,hidden:true,visibility:'gm'})}));
 await frame.locator('#historyList .entry[data-cid="gm-private-current"]').waitFor();
 await page.evaluate(()=>{fixture.role='PLAYER';publish('player',{id:'owner',connectionId:'local',role:'PLAYER',name:'Synthetic',color:'#ffffff',metadata:{}});});
 await frame.waitForFunction(()=>!document.querySelector('#historyList .entry[data-cid="gm-private-current"]'));
 assert.equal(await frame.locator('#btnDarkRoll').isVisible(),false);
 await page.evaluate(()=>{fixture.role='GM';publish('player',{id:'owner',connectionId:'local',role:'GM',name:'Synthetic',color:'#ffffff',metadata:{}});});
 await frame.locator('#historyList .entry[data-cid="gm-private-current"]').waitFor();
 checks.push('live results and GM demotion/promotion preserve the existing private-history UI filter');

 frame=await open('index');
 assert.equal(await page.evaluate(()=>fixture.calls.filter(call=>call.method==='dice3d.history').length),2);
 await frame.locator('button.tab[data-tab="history"]').click();
 await frame.waitForFunction(()=>document.querySelectorAll('#historyList .entry').length===100);
 await frame.locator('#historyList .entry[data-cid="current-result"]').waitFor();
 const stored=await frame.evaluate(()=>JSON.parse(localStorage.getItem('obr-suite/dice/history:history-fixture')||'[]'));
 assert.equal(stored.length,100);
 assert.deepEqual(stored.slice(0,2).map(row=>row.rollId),['gm-private-current','current-result'],'newer current results outrank replayed old saved rows');
 assert(!stored.some(row=>row.rollId==='saved-0'||row.rollId==='saved-1'),'only oldest two saved results leave the capped archive');
 checks.push('full panel reconnect/reopen keeps its history request and stored current results');
 await page.screenshot({path:resolve(out,'full-panel-history.png')});
 await open('quick');
 assert.equal(await page.evaluate(()=>fixture.calls.filter(call=>call.method==='dice3d.history').length),2);
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(out,'result.json'),JSON.stringify({success:true,checks,errors,browser:await browser.version(),headless:true,ignoredDefaultArgs:ignoredDefaults,realOwlbearRoom:false,windowVisibilityTested:false,boundary:'Actual quick/full panel DOM and SDK facade with a synthetic parent RPC host. Headless UI regression only; no physics, GPU presentation, real cross-window bridge, natural background-throttling behavior or latency measurement.'},null,2));
 console.log(JSON.stringify({success:true,checks},null,2));
}catch(error){
 const state=await page.evaluate(()=>({fixture:window.fixture,frames:[...document.querySelectorAll('iframe')].map(frame=>({url:frame.src,bridgeReady:frame.contentDocument?.body?.dataset.bridgeReady,bridgeError:frame.contentDocument?.body?.dataset.bridgeError,loading:frame.contentDocument?.body?.dataset.diceLoading,historyRows:frame.contentDocument?.querySelectorAll('#historyList .entry').length}))})).catch(error=>({readError:String(error)}));
 await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});
 writeFileSync(resolve(out,'failure.json'),JSON.stringify({success:false,error:String(error),stack:error?.stack,checks,errors,state},null,2));throw error;
}finally{await context.close();await browser.close();}
