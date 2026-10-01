import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.env.DND_SUITE_BUILD||'.cache/release224/suite-host'),out=resolve(process.env.DND_DICE_EVIDENCE||'.cache/edge224'),origin=process.env.DICE_EDGE_ORIGIN||'http://127.0.0.1:5220';
const {chromium}=createRequire(resolve(process.env.DND_WEB_ROOT||'F:/CodexWork/2026-09-27/feedback/web','package.json'))('@playwright/test');
const catalogFixture=JSON.parse(readFileSync(root+'/dice3d/assets/catalog.json','utf8'));
const metadata=/\/dice3d\/(vendor\/lock\.json|asset-hashes\.json|assets\/catalog\.json)(\?|$)/;
const worker=readdirSync(root+'/assets').find(n=>/^physics\.worker-.*\.js$/.test(n)),checks=[],errors=[];
const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm','.wav':'audio/wav'};
let server;
if(!process.env.DICE_EDGE_ORIGIN){
 server=createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,origin).pathname);
  if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(name==='/fixture'){res.setHeader('Content-Type',mime['.html']);res.end('<html><head><link rel="icon" href="data:,"></head><body>Edge dice verification</body></html>');return;}
  const file=name.endsWith('/manifest-dev.json')?resolve('public/manifest-dev.json'):resolve(root,name.replace(/^\/suite-dev\//,''));
  if(!file.startsWith(root)&&!name.endsWith('/manifest-dev.json')){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
 });await new Promise(r=>server.listen(5220,'127.0.0.1',r));
}
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--disable-background-timer-throttling',...(process.env.DICE3D_BROWSER_DIRECT?['--no-proxy-server']:[])],...(process.env.DICE3D_BROWSER_PROXY?{proxy:{server:process.env.DICE3D_BROWSER_PROXY}}:{})});
async function warm(page,{keep=false,reuse=false}={}){return page.evaluate(async ({worker,catalog,keep,reuse})=>{
 const engine=reuse?window.engine:new Worker('/suite-dev/assets/'+worker,{type:'module'});window.engine=engine;
 const reply=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('warmup timeout')),60000);engine.onerror=reject;engine.onmessage=e=>{if(e.data.type==='warm'){clearTimeout(timer);resolve(e.data);}};engine.postMessage({type:'warmup',catalog,view:{w:1440,h:900}});});if(!keep)engine.terminate();return reply;
},{worker,catalog:catalogFixture,keep,reuse});}

try{
 if(!process.env.DICE_EDGE_ORIGIN){
  for(const mode of ['stale-once','corrupt-always']){
   const page=await browser.newPage();let requests=[],metadataRequests=[];
   await page.route(metadata,route=>{metadataRequests.push(route.request().url());return route.abort('timedout');});
   await page.route('**/vendor/jolt-physics.wasm.js*',route=>{requests.push(route.request().url());if(mode==='corrupt-always'||requests.length===1)return route.fulfill({status:200,contentType:'text/javascript',body:readFileSync(root+'/dice3d/vendor/jolt-physics.wasm.js','utf8').replaceAll('\n','\r\n')});return route.continue();});
   await page.goto(origin+'/fixture');const reply=await warm(page,{keep:true});
   if(mode==='stale-once'){assert(!reply.error,JSON.stringify(reply));assert(requests.some(u=>u.includes('&retry=2')));checks.push({case:'Edge recovers from screenshot-matching stale CRLF vendor bytes',requests});}
   else{assert.match(reply.error,/SHA-256 mismatch/);assert.match(reply.error,/attempt=3\/3/);assert.equal(requests.length,3);checks.push({case:'persistent corrupted engine fails closed after three attempts'});
    await page.unroute('**/vendor/jolt-physics.wasm.js*');const recovered=await warm(page,{reuse:true});assert(!recovered.error,JSON.stringify(recovered));checks.push({case:'same worker retries successfully after a failed engine load'});}
   assert.deepEqual(metadataRequests,[]);await page.close();
  }
 }
 const metadataRequests=[];
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());else if(m.text().startsWith('DICE224 '))console.log(m.text());});
 await page.route(metadata,route=>{metadataRequests.push(route.request().url());return route.abort('timedout');});
 await page.addInitScript(()=>{window.events=[];window.bus=new BroadcastChannel('com.obr-suite/workbench-dice3d.v1:local:edge224-production');window.bus.onmessage=e=>window.events.push(e.data);});
 console.log('Loading Edge overlay from '+origin);
 await page.goto(origin+'/suite-dev/dice3d/overlay.html?client=edge224-production&v=224');
 try{await page.waitForFunction(()=>window.events.some(e=>e.type==='overlay-ready'),null,{timeout:180000});}catch(error){
  const state=await page.evaluate(()=>({events:window.events,resources:performance.getEntriesByType('resource').map(e=>({name:e.name,duration:e.duration,bytes:e.transferSize}))}));
  writeFileSync(out+'/overlay-failure.json',JSON.stringify({error:String(error),errors,...state},null,2));throw error;
 }
 console.log('Edge overlay ready');
 const result=await page.evaluate(async ({worker,catalog})=>{
  const engine=new Worker('/suite-dev/assets/'+worker,{type:'module'});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{engine.terminate();reject(Error('physics warmup exceeded 120 seconds'));},120000);engine.onerror=e=>{clearTimeout(timer);reject(e);};engine.onmessage=e=>{if(e.data.type==='load-progress')console.log('DICE224 '+JSON.stringify(e.data.progress));if(e.data.error){clearTimeout(timer);reject(Error(e.data.error));}else if(e.data.type==='warm'){clearTimeout(timer);resolve(e.data);}};engine.postMessage({type:'warmup',catalog,view:{w:1440,h:900}});});
  const roll=await new Promise((resolve,reject)=>{engine.onmessage=e=>{if(e.data.error)reject(Error(e.data.error));else if(e.data.roll)resolve(e.data.roll);};engine.postMessage({request:{id:'edge224-real-roll',source:'edge224-production',authority:'edge224-production',name:'Edge verification',count:3,kind:'mixed',theme:'stage6_calibration',bodyColor:'#76bceb',modifier:0,visibility:'all',seed:12345,recipe:true,formula:'2d6+1d20+5',context:{rollerId:'edge224-production',itemId:null,label:'Edge'}},catalog,view:{w:1440,h:900}});});
  window.bus.postMessage({type:'prepare',roll});window.bus.postMessage({type:'start',id:roll.request.id,at:performance.timeOrigin+performance.now()+200});engine.terminate();return {results:roll.results,total:roll.formulaData.rows[0].total,duration:roll.duration};
 },{worker,catalog:catalogFixture});
 console.log('Edge physics completed');
 assert.equal(result.total,32);assert.deepEqual(result.results,[6,5,16]);
 await page.waitForTimeout(result.duration*1000+450);await page.screenshot({path:out+(process.env.DICE_EDGE_ORIGIN?'/public-edge.png':'/production-edge.png')});
 await page.waitForFunction(()=>window.events.some(e=>e.type==='renderer-event'&&e.event==='render-complete'&&e.detail.roll==='edge224-real-roll'),null,{timeout:60000});assert.deepEqual(errors,[]);checks.push({case:'production Edge Jolt/WASM/WebGL roll and full animation',...result});
 assert.deepEqual(metadataRequests,[]);checks.push({case:'blocked startup JSON endpoints are never requested; physics and renderer still complete'});
 const report={browser:'Microsoft Edge',origin,checks,errors,success:true,realOwlbearRoom:false,roomMessagesSent:0};writeFileSync(out+(process.env.DICE_EDGE_ORIGIN?'/public-edge.json':'/production-edge.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();if(server)await new Promise(r=>server.close(r));}
