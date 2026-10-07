// Test unmodified publishing files. The browser observes native requests and
// canvas events; it does not transform the product or write player data.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {verifyProductionDice} from './dice-production-package.mjs';

const root=resolve('dist-workbench-dev'),out=resolve(process.env.DND_DICE_PRODUCTION_EVIDENCE||'.local-evidence/production-dice/browser');
mkdirSync(out,{recursive:true});const binding=verifyProductionDice(join(root,'dice3d'));
const remote=process.env.DND_DICE_PRODUCTION_BASE,port=Number(process.env.DND_DICE_PRODUCTION_PORT||5894),origin='http://127.0.0.1:'+port;
const base=remote||origin+'/suite-dev/';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav','.ttf':'font/ttf','.glb':'model/gltf-binary'};
const server=remote?null:createServer((req,res)=>{
 const path=new URL(req.url,origin).pathname;
 if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
 const file=resolve(root,decodeURIComponent(path.replace(/^\/suite-dev\//,'')));
 if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}
 catch{res.writeHead(404);res.end(path);}
});
if(server)await new Promise(r=>server.listen(port,'127.0.0.1',r));
let browser;const cases=[],errors=[];
try{
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
 for(const name of ['font-pending-restore','audio-pending-restore','font-rejected-restore','font-completes-while-lost']){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,serviceWorkers:'block'});
  const client='synthetic-production-252-'+name;let pending,firstRequest=true,requested;
  const requestSeen=new Promise(r=>requested=r);
  await context.route(name==='audio-pending-restore'?'**/*.wav*':'**/assets/fonts/Cinzel-Variable.ttf*',async route=>{
   if(!firstRequest){await route.continue();return;}firstRequest=false;requested();
   if(name==='font-rejected-restore'){await route.fulfill({status:404,body:'authored font failure'});return;}
   pending=route;
  });
  try{
   const page=await context.newPage();page.on('pageerror',e=>errors.push({name,error:e.message}));
   await page.addInitScript(client=>{
    window.__productionSignals=[];window.__actualLosses=0;window.__actualRestores=0;
    const bus=new BroadcastChannel('com.obr-suite/workbench-dice3d.v1:local:'+client);
    bus.onmessage=e=>window.__productionSignals.push({at:performance.now(),packet:e.data});
    const original=HTMLCanvasElement.prototype.getContext,seen=new WeakSet();
    HTMLCanvasElement.prototype.getContext=function(type,...args){const gl=original.call(this,type,...args);
     if(gl&&String(type).includes('webgl')){window.__productionGl=gl;
      if(!seen.has(this)){seen.add(this);this.addEventListener('webglcontextlost',()=>window.__actualLosses++);this.addEventListener('webglcontextrestored',()=>window.__actualRestores++);}}
     return gl;
    };
   },client);
   await page.goto(base+'dice3d/overlay.html?client='+client,{waitUntil:'domcontentloaded'});
   await requestSeen;await page.waitForFunction(()=>!!window.__productionGl,null,{timeout:30000});
   if(name==='font-rejected-restore')await page.waitForFunction(()=>window.__productionSignals.some(s=>s.packet.type==='renderer-event'&&s.packet.event==='error'));
   await page.evaluate(()=>{window.__productionLose=window.__productionGl.getExtension('WEBGL_lose_context');if(!window.__productionLose)throw Error('Native WebGL context-loss extension required');window.__productionLose.loseContext();});
   await page.waitForFunction(()=>window.__productionGl.isContextLost());
   if(name==='font-completes-while-lost'){
    await pending.continue();pending=null;
    await page.waitForFunction(()=>[...document.fonts].some(f=>f.family==='CinzelVariable'&&f.status==='loaded'));
   }else{
    await page.evaluate(()=>window.__productionLose.restoreContext());
    await page.waitForFunction(()=>window.__actualRestores>0);
   }
   // Give native restore/compile promises time to complete while the initial
   // resource is still withheld or failed. This is not a latency measurement.
   await page.waitForTimeout(750);
   const before=await page.evaluate(()=>({losses:window.__actualLosses,restores:window.__actualRestores,contextLost:window.__productionGl.isContextLost(),fontLoaded:[...document.fonts].some(f=>f.family==='CinzelVariable'&&f.status==='loaded'),signals:window.__productionSignals}));
   const readySignals=before.signals.filter(s=>s.packet.type==='overlay-ready'||(s.packet.type==='renderer-event'&&s.packet.event==='render-context-restored'));
   assert.equal(readySignals.length,0,'Initial resource barrier bypassed by native context restoration: '+name);
   assert.equal(before.losses,1);if(name!=='font-completes-while-lost')assert.equal(before.restores,1);
   await page.screenshot({path:join(out,name+'.png')});
   let recovered=false;
   if(name!=='font-rejected-restore'){
    if(pending){await pending.continue();pending=null;}
    if(name==='font-completes-while-lost')await page.evaluate(()=>window.__productionLose.restoreContext());
    await page.waitForFunction(()=>window.__productionSignals.filter(s=>s.packet.type==='overlay-ready').length===1,null,{timeout:30000});
    await page.evaluate(()=>window.__productionLose.loseContext());await page.waitForFunction(()=>window.__productionGl.isContextLost());
    await page.evaluate(()=>window.__productionLose.restoreContext());
    await page.waitForFunction(()=>window.__productionSignals.some(s=>s.packet.type==='renderer-event'&&s.packet.event==='render-context-restored'),null,{timeout:30000});
    const after=await page.evaluate(()=>window.__productionSignals);
    assert.equal(after.filter(s=>s.packet.type==='overlay-ready').length,1,'Duplicate first readiness');recovered=true;
   }
   cases.push({name,passed:true,initialPendingOrFailed:true,prematureReadinessSignals:readySignals.length,...before,recovered});
  }finally{if(pending)await pending.abort().catch(()=>{});await context.close();}
 }
 assert.deepEqual(errors,[]);
 writeFileSync(join(out,'result.json'),JSON.stringify({passed:true,base,binding,browser:await browser.version(),unmodifiedProductionFiles:true,genuineWebGL:true,syntheticClientOnly:true,physicalGpu:false,playerDataWritten:false,latencyClaim:false,cases,errors},null,2)+'\n');
 console.log(JSON.stringify({passed:true,cases:cases.length,normalRecoveries:cases.filter(c=>c.recovered).length,productionFiles:binding.files,pinnedAssets:binding.pinnedAssets}));
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({passed:false,error:String(error),base,binding,cases,errors},null,2)+'\n');throw error;}
finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));}
