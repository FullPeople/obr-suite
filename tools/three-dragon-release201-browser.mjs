import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname,join} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('.'),web=process.env.DND_CARD_WEB_ROOT||resolve(root,'../web');
const {chromium}=createRequire(join(web,'package.json'))('@playwright/test');
const live=process.argv.includes('--live'),origin=live?'https://obr.dnd.center':'http://127.0.0.1:5642';
const workbenchOnly=process.argv.includes('--workbench-only');
const out=process.env.TDA_RELEASE_EVIDENCE||resolve(root,'../release201');mkdirSync(out,{recursive:true});
const roots={'/three-dragon-ante-dev/':process.env.TDA_RELEASE_DIST||'D:/Temp/DND-card-release201-storage/three-dragon-dist','/suite-dev/':resolve(root,'dist-workbench-dev')};
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const server=live?null:createServer((req,res)=>{const path=decodeURIComponent(new URL(req.url,origin).pathname),prefix=Object.keys(roots).find(p=>path.startsWith(p));if(prefix){const folder=resolve(roots[prefix]),file=resolve(folder,path.slice(prefix.length)+(path.endsWith('/')?'index.html':''));if(file.startsWith(folder+'\\')&&existsSync(file)){res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));return;}}res.writeHead(404);res.end();});
if(server)await new Promise(done=>server.listen(5642,'127.0.0.1',done));
const direct=process.argv.includes('--direct');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader',...(direct?['--no-proxy-server']:[])]}),errors=[],checks=[];
try{
 for(const mode of workbenchOnly?['workbench']:['independent','workbench'])for(const width of [1440,390]){
  console.log(`Checking ${live?'live':'local'} ${mode} at ${width}px`);
  const context=await browser.newContext({locale:'zh-CN',viewport:{width,height:960},reducedMotion:'reduce'}),page=await context.newPage();context.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('three-dragon-ante.introduction.v1','seen');localStorage.setItem('three-dragon-ante/language','zh');});
  const target=mode==='independent'?'/three-dragon-ante-dev/index.html?obrref='+Buffer.from(origin+' fixture-room').toString('base64'):'/suite-dev/workbench-panels/table.html';
  const parent=`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><script>
  window.commands=[];window.messages=[];let clientId='',sequence=0;
  const channel='workbench-panel-frame/v1',pack='com.fullpeople/three-dragon-ante/pack-20260910',embedded=${mode==='workbench'};
  function send(value){document.querySelector('iframe').contentWindow.postMessage(value,location.origin);}
  function view(){const envelope={actionReceiptVersion:1,table:{version:1,id:'production-fixture',hostPlayerId:'you',hostConnectionId:'fixture',hostName:'你',stage:'lobby',revision:0,seats:[{playerId:'you',seatId:'you',name:'你'},{playerId:'two',seatId:'two',name:'玩家二'}]},selfPlayerId:'you',isHost:true,connected:true,pending:false,game:null};const data={connectionId:'fixture',data:{version:1,clientId,sequence:++sequence,part:0,total:1,payload:btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(envelope))))}};send(embedded?{channel,event:'broadcast',name:pack+'/view',data}:{id:'OBR_BROADCAST_MESSAGE_'+pack+'/view',data});}
  addEventListener('message',e=>{if(e.source!==document.querySelector('iframe').contentWindow)return;const m=e.data;messages.push(m);
   let broadcast;
   if(embedded&&m.channel===channel&&m.id){let result;if(m.method==='init')result={roomId:'fixture-room',playerId:'you',preferences:{},reads:{'player.getConnectionId':'fixture'}};if(m.method==='player.getConnectionId')result='fixture';send({channel,id:m.id,result});if(m.method==='broadcast.sendMessage')broadcast={channel:m.args[0],data:m.args[1]};}
   else if(!embedded&&m.nonce){send({id:m.id+'_RESPONSE'+m.nonce,data:m.id==='OBR_PLAYER_GET_CONNECTION_ID'?{connectionId:'fixture'}:{}});if(m.id==='OBR_BROADCAST_SEND_MESSAGE')broadcast=m.data;}
   if(broadcast?.channel===pack+'/ready'){clientId=broadcast.data.clientId;view();}if(broadcast?.channel===pack+'/command')commands.push(broadcast.data.command);
  });</script><iframe src="${target}" onload="${mode==='independent'?"send({id:'OBR_READY',data:{ref:'fixture',userId:'you'}})":''}"></iframe>`;
  await page.route(origin+'/release201-fixture',route=>route.fulfill({contentType:'text/html',body:parent}));await page.goto(origin+'/release201-fixture',{timeout:120000});
  const frame=page.frames().find(f=>f.parentFrame());assert.ok(frame);await frame.locator('#deck-choice').waitFor({timeout:45000});
  const names=await frame.locator('#deck-choice option').allTextContents();assert.match(names[1],/命运之轮的轮转使用/);
  await frame.locator('#deck-choice').selectOption('wheel-of-fate-v1');assert.match(await frame.locator('.setup-extra-card').innerText(),/传说巨龙 · 善良 · 力量 12/);
  const img=frame.locator('.setup-extra-card img');await img.evaluate(image=>Promise.race([image.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('card image decode timed out')),120000))]));const src=await img.getAttribute('src');assert.match(src,/time-dragon/);
  // Check the current live node after network activity settles. A decode promise
  // from an earlier node alone does not prove that the visible image has painted.
  await page.waitForLoadState('networkidle',{timeout:120000});
  await frame.waitForFunction(()=>{const img=document.querySelector('.setup-extra-card img');return img?.complete&&img.naturalWidth>0;},undefined,{timeout:120000});
  await frame.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const imageState=await img.evaluate(image=>({complete:image.complete,naturalWidth:image.naturalWidth,width:image.clientWidth,opacity:getComputedStyle(image).opacity,visibility:getComputedStyle(image).visibility}));
  assert.equal(imageState.complete,true);assert.ok(imageState.naturalWidth>0&&imageState.width>0);assert.equal(imageState.opacity,'1');assert.equal(imageState.visibility,'visible');
  assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(out,`${live?'live':'local'}-${mode}-${width}.png`),animations:'disabled'});
  if(width===390){await frame.locator('.setup-extra-card').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`${live?'live':'local'}-${mode}-${width}-card.png`),animations:'disabled'});}
  await frame.getByRole('button',{name:'开始游戏',exact:true}).click();await page.waitForFunction(()=>commands.some(c=>c.type==='start'));
  const command=await page.evaluate(()=>commands.find(c=>c.type==='start'));assert.equal(command.options.variant.deckId,'wheel-of-fate-v1');
  checks.push({mode,width,deck:names[1],image:src,imageState,startCommand:command,overflow:false});console.log(`PASS ${mode} ${width}px ${JSON.stringify(imageState)}`);await context.close();
 }
 assert.deepEqual(errors,[]);const record={passed:true,checks,errors,sdkAndRoomSimulated:true,realRoomVerified:false,directConnection:direct};writeFileSync(join(out,(live?'live':'local')+(workbenchOnly?'-workbench-image-check':'-three-dragon-browser')+'.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}catch(error){writeFileSync(join(out,(live?'live':'local')+'-three-dragon-browser-failure.json'),JSON.stringify({checks,errors,error:String(error)},null,2));throw error;}
finally{await browser.close();if(server)await new Promise(done=>server.close(done));}
