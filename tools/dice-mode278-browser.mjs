import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,extname,sep} from 'node:path';
import {chromium} from '@playwright/test';
const root=resolve(process.env.DICE_MODE278_ROOT||'dist-workbench-dev'),overlay=resolve(process.env.DICE_MODE278_OVERLAY||join(root,'dice3d'));
const out=resolve(process.env.DICE_MODE278_EVIDENCE||'.local-evidence/dice-mode278');mkdirSync(out,{recursive:true});
const remote=process.env.DICE_MODE278_PUBLIC,checks=[],errors=[],requests=[];
const check=(value,name)=>{assert(value,name);checks.push(name);console.log('PASS',name);};
const harness=`<!doctype html><html><body style="margin:0;background:#333"><iframe style="border:0;width:100vw;height:100vh" src="/suite-dev/workbench-panels/settings.html?workbench=1&section=dice"></iframe><script>
addEventListener('message',e=>{const m=e.data;if(m.channel!=='workbench-panel-frame/v1'||!m.method)return;let result=true;if(m.method==='init')result={roomId:'fixture',playerId:'fixture',preferences:{},reads:{'player.getRole':'GM','scene.isReady':true,'scene.getMetadata':{'com.obr-suite/state':{enabled:{dice:true},crossSceneSyncSettings:false}},'room.getMetadata':{}}};e.source.postMessage({channel:m.channel,id:m.id,result},location.origin);});
</script></body></html>`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.svg':'image/svg+xml'};
const server=remote?null:createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/harness'){res.setHeader('Content-Type','text/html');res.end(harness);return;}
 if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
 const directory=path.startsWith('/suite-dev/dice3d/')?overlay:root;
 const relative=path.startsWith('/suite-dev/dice3d/')?path.slice('/suite-dev/dice3d/'.length):path.replace(/^\/suite-dev\//,'');
 let file=resolve(directory,relative);if(!file.startsWith(directory+sep)){res.writeHead(403);res.end();return;}
 if(!existsSync(file)&&/\/d(?:4|6|8|10|12|20|100)\.png$/.test(path))file=resolve('public',relative);
 try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end(path);}
});
if(server)await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=remote||'http://127.0.0.1:'+server.address().port+'/suite-dev/';let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:process.env.CI?{}:{channel:'msedge'})});
 const context=await browser.newContext({viewport:{width:1200,height:800}}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(String(error)));page.on('request',r=>requests.push(r.url()));
 if(!remote){
  await page.goto(base.replace(/suite-dev\/$/,'harness'));const settings=page.frameLocator('iframe');
  await settings.locator('body[data-bridge-ready=true]').waitFor();await settings.locator('#tabs [data-tab="dice"]').click();await settings.locator('[data-key="diceViewMode"]').waitFor();
  check(await settings.locator('[data-key="diceViewMode"]').inputValue()==='3d','default keeps current 3D');
  await settings.locator('[data-key="diceViewMode"]').selectOption('2d');
  check(await page.evaluate(()=>localStorage.getItem('obr-suite/dice/view-mode'))==='2d','2D preference is saved in browser');
  check((await settings.locator('[data-key="diceViewNotice"]').innerText()).includes('刷新'),'settings explicitly tell the user to refresh the room');
  await page.reload();await settings.locator('body[data-bridge-ready=true]').waitFor();await settings.locator('#tabs [data-tab="dice"]').click();check(await settings.locator('[data-key="diceViewMode"]').inputValue()==='2d','2D selection survives reopening settings');
  await settings.locator('[data-key="diceViewMode"]').selectOption('3d');await page.reload();await settings.locator('body[data-bridge-ready=true]').waitFor();await settings.locator('#tabs [data-tab="dice"]').click();
  check(await settings.locator('[data-key="diceViewMode"]').inputValue()==='3d','3D can be restored and persists');
  await page.screenshot({path:join(out,'settings.png')});
 }
 const client='synthetic-2d-278';
 await page.addInitScript(client=>{window.signals=[];window.testBus=new BroadcastChannel('com.obr-suite/workbench-dice3d.v1:local:'+client);testBus.onmessage=e=>signals.push(e.data);},client);
 const offset=requests.length;
 await page.goto(base+'dice3d/overlay2d.html?client='+client);
 await page.waitForFunction(()=>signals.some(p=>p.type==='overlay-ready'));
 const make=(id,types=['d20'],masked=false,itemId='')=>({version:2,request:{id,name:'Fixture',source:client,count:types.length,theme:'ink_sketch',bodyColor:'#d0a45a',modifier:0,visibility:masked?'gm':'all'},kinds:types,results:masked?types.map(()=>0):types.map(()=>3),fps:120,frames:1,poses:new Array(types.length*7).fill(0),contacts:[],physicsMs:1,steps:1,collisions:0,duration:1,masked,...(masked?{}:{formulaData:{ids:types.map((_,i)=>'d'+i),rows:[{index:0,formula:types.join('+'),total:types.length*3,operation:'sum',dice:types.map((kind,i)=>({id:'d'+i,kind,value:3,raw:3,kept:true,sign:1,flags:[]}))}],expression:'fixture',births:types.map(()=>0),context:{itemId,label:'Fixture'}}})});
 const prepare=async roll=>{await page.evaluate(roll=>{roll.poses=new Float32Array(roll.poses);testBus.postMessage({type:'prepare',roll});},roll);await page.waitForFunction(id=>signals.some(p=>p.type==='prepared'&&p.id===id),roll.request.id);};
 const start=async id=>{await page.evaluate(id=>testBus.postMessage({type:'start',id,at:performance.timeOrigin+performance.now()+20}),id);await page.waitForFunction(id=>signals.some(p=>p.event==='render-start'&&p.detail.roll===id),id);};
 const done=async id=>page.waitForFunction(id=>signals.some(p=>p.event==='render-complete'&&p.detail.roll===id),id,{timeout:20000});
 await prepare(make('single'));check(await page.locator('iframe').evaluate(el=>getComputedStyle(el).visibility)==='hidden','prepared dice are hidden before shared start');
 check(!await page.evaluate(()=>signals.some(p=>p.event==='render-complete')),'preparing never completes history early');
 await start('single');await page.frameLocator('iframe').locator('.dice').waitFor();
 check(await page.frameLocator('iframe').locator('.art-fg').count()===1,'original grayscale die art is present');
 check(await page.frameLocator('iframe').locator('video,.art-custom').count()===0,'2D never creates custom skin or video');
 await page.screenshot({path:join(out,'2d-single.png')});await done('single');
 check(await page.locator('iframe').count()===0,'legacy animation completes and releases its frame');
 await page.evaluate(()=>testBus.postMessage({type:'suite-replay',ids:['single']}));await page.locator('iframe').waitFor();await page.waitForFunction(()=>signals.filter(p=>p.event==='render-complete'&&p.detail.roll==='single').length===2,undefined,{timeout:20000});
 check(true,'history replay runs the original result without rerolling');
 await prepare(make('mixed',['d4','d6','d8','d10','d12','d20','d_percentile']));await start('mixed');
 check(await page.frameLocator('iframe').locator('.dice').count()===7,'all seven logical dice appear for the mixed formula');
 check(await page.frameLocator('iframe').locator('.dice[data-type=d100]').count()===1,'percentile uses original d100 art');
 await page.screenshot({path:join(out,'2d-mixed.png')});await done('mixed');
 await prepare(make('private',['d20'],true));await start('private');
 check(await page.locator('iframe').count()===0&&(await page.locator('.dice2d-private').innerText()).includes('?'),'unauthorized dark roll has only a question mark and no result frame');await done('private');
 await prepare(make('target',['d6'],false,'token'));await page.evaluate(()=>testBus.postMessage({type:'token-results',anchors:{token:{x:340,y:280}},groups:[]}));await start('target');
 await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.documentElement.style.getPropertyValue('--tx')==='340px');
 check(true,'2D dice use the current target position without SDK round trips each frame');
 await page.evaluate(()=>testBus.postMessage({type:'token-results',anchors:{token:{x:520,y:300}},groups:[]}));
 await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.documentElement.style.getPropertyValue('--tx')==='520px');check(true,'moving target updates the legacy dice anchor');
 await page.evaluate(()=>testBus.postMessage({type:'token-results',scale:2,anchors:{token:{x:520,y:300}},groups:[]}));
 await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.documentElement.style.getPropertyValue('--vp-scale')==='2');
 check(await page.locator('iframe').evaluate(el=>el.contentDocument.documentElement.style.getPropertyValue('--tx'))==='520px','camera zoom scales target dice without moving the anchor');
 await page.evaluate(()=>testBus.postMessage({type:'clear'}));await page.waitForFunction(()=>!document.querySelector('iframe'));check(true,'clear removes active legacy effects');
 check(!requests.slice(offset).some(url=>/\.glb|\.wasm|\.wav|skin-preview|Cinzel|verified-texture|overlay-[^/]+\.js/.test(url)),'2D display requests no WebGL renderer, models, skin preview or 3D audio/font bank');
 check(!requests.slice(offset).some(url=>/dvalues=|total=|doriginals=/.test(url)),'dice values stay in browser fragments and never enter HTTP requests');
 check(errors.length===0,'no browser script errors');
 writeFileSync(join(out,'result.json'),JSON.stringify({checks,errors,requests,public:!!remote,realRoomVerified:false},null,2)+'\n');
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}
