// Browser runner: strict correctness readback only. This is deliberately not a benchmark.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {validateCandidate,BASELINE} from './dice-canvas-visual-source.mjs';
const root=resolve(process.env.DICE_CANVAS_BUILD||'.local-evidence/dice-canvas-visual/runtime');
const out=resolve(process.env.DICE_CANVAS_EVIDENCE||'.local-evidence/dice-canvas-visual/browser');
const build=JSON.parse(readFileSync(resolve(root,'build.json'),'utf8'));
const pin=validateCandidate(process.env.DICE_CANVAS_CANDIDATE);
assert.equal(build.baseline,BASELINE);assert.equal(build.candidate,pin.candidate,'rebuild for selected candidate');assert.deepEqual(build.productBlobs,pin.productBlobs);
const dprs=(process.env.DICE_CANVAS_DPRS||'1,2').split(',').map(Number);assert(dprs.length&&dprs.every(d=>[1,1.25,1.5,2].includes(d)),'supported DPR matrix: 1, 1.25, 1.5, 2');
const only=process.env.DICE_CANVAS_CASES?.split(',');
mkdirSync(out,{recursive:true});const save=(path,value)=>writeFileSync(resolve(out,path),JSON.stringify(value,null,2));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=createServer((request,response)=>{try{const pathname=decodeURIComponent(new URL(request.url,'http://fixture.invalid').pathname);if(pathname==='/favicon.ico'){response.writeHead(204);return response.end();}const file=resolve(root,'.'+pathname);if(!file.startsWith(root+sep)){response.writeHead(403);return response.end();}response.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');response.end(readFileSync(file));}catch{response.writeHead(404);response.end('Not found');}});
let browser;const cases=[],failures=[],run={startedAt:new Date().toISOString(),build,currentHead:pin.head,dprs,requestedCases:only||'all',browserRun:true,boundary:'Same Chromium, pinned production modules, real Canvas2D exact RGBA and DOM composition. No SDK/physics/WebGL or real room. Readback and screenshots invalidate all timing/performance claims.',contextRestoration:'synthetic events/backing reset only; genuine Canvas2D loss/restoration is not induced'};
try{
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});run.browser=await browser.version();save('metadata.json',run);
 for(const dpr of dprs){
  const context=await browser.newContext({viewport:{width:1100,height:1400},deviceScaleFactor:dpr});const page=await context.newPage(),cdp=await context.newCDPSession(page);
  page.setDefaultTimeout(30000);const errors=[],requests=[];page.on('pageerror',error=>errors.push(String(error)));page.on('requestfailed',request=>requests.push({url:request.url(),failure:request.failure()}));
  let caseName='',captures=0;
  await page.exposeBinding('visualDpr',async(_source,value)=>{await cdp.send('Emulation.setDeviceMetricsOverride',{width:1100,height:1400,deviceScaleFactor:value,mobile:false});});
  await page.exposeBinding('visualCapture',async(_source,{label,surfaces,dom})=>{
   const prefix=`dpr-${dpr}-${caseName}-${String(captures++).padStart(2,'0')}-${label.replaceAll(/[^a-zA-Z0-9_.-]/g,'_')}`;
   const surfaceFiles=[];
   for(const surface of surfaces){for(const side of ['baseline','candidate','diff']){const file=prefix+'-'+surface.kind+'-'+side+'.png';writeFileSync(resolve(out,file),Buffer.from(surface[side],'base64'));surfaceFiles.push(file);}}
   const shots=[];
   try{for(const side of [0,1]){await page.evaluate(async side=>window.diceCanvasVisual.mount(side),side);shots.push(await page.locator('#capture').screenshot({animations:'disabled',scale:'css'}));}}
   finally{await page.evaluate(()=>window.diceCanvasVisual.unmount());}
   const files={baseline:prefix+'-dom-baseline.png',candidate:prefix+'-dom-candidate.png',diff:prefix+'-dom-diff.png'};
   writeFileSync(resolve(out,files.baseline),shots[0]);writeFileSync(resolve(out,files.candidate),shots[1]);
   const comparison=await page.evaluate(async values=>window.diceCanvasVisual.comparePNGs(...values),shots.map(buffer=>buffer.toString('base64')));
   writeFileSync(resolve(out,files.diff),Buffer.from(comparison.diff,'base64'));delete comparison.diff;
   return{label,...comparison,files,surfaceFiles,dom,animations:'Playwright animations=disabled settles finite CSS/WAAPI animations for snapshot only; animation timing not compared'};
  });
  await page.goto(origin+'/dice-canvas-visual-fixture.html');await page.waitForFunction(()=>window.diceCanvasVisual);
  assert.equal(await page.evaluate(()=>devicePixelRatio),dpr);
  const all=await page.evaluate(()=>window.diceCanvasVisual.cases);assert(!only||only.every(id=>all.includes(id)),'unknown requested case');
  for(const id of only||all){
   caseName=id;captures=0;errors.length=0;requests.length=0;
   const result=await page.evaluate(id=>window.diceCanvasVisual.run(id),id);
   result.devicePixelRatio=dpr;result.pageErrors=[...errors];result.requestFailures=[...requests];result.success&&=errors.length===0&&requests.length===0;
   const file=`dpr-${dpr}-${id}.json`;save(file,result);const record={id,dpr,success:result.success,frames:result.frames.length,captures:result.captures.length,file,error:result.error};cases.push(record);
   if(!record.success)failures.push(record);console.log(JSON.stringify(record));save('partial.json',{run,cases,failures});
  }
  await context.close();
 }
 run.endedAt=new Date().toISOString();save('result.json',{success:failures.length===0,run,cases,failures,fullMatrix:!only&&dprs.includes(1)&&dprs.includes(2)});assert.deepEqual(failures,[],'strict browser contracts failed');
}catch(error){save('failure.json',{error:String(error),stack:error.stack,run,cases,failures});throw error;}finally{if(browser)await browser.close();if(server.listening)await new Promise(done=>server.close(done));}
