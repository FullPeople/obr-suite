import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.env.DICE_BASELINE_BUILD||'../local-dice-edge-215/.cache/release220/suite-host');
const worker=readdirSync(root+'/assets').find(n=>/^physics\.worker-.*\.js$/.test(n));
const catalog=JSON.parse(readFileSync(root+'/dice3d/assets/catalog.json','utf8'));
const source=readFileSync(root+'/assets/'+worker,'utf8');
const {chromium}=createRequire('F:/CodexWork/2026-09-27/feedback/web/package.json')('@playwright/test');
const server=createServer((req,res)=>{if(req.url==='/worker.js'){
 res.setHeader('Content-Type','text/javascript');
 // Same production worker, with only its inactivity clock accelerated for the fixture.
 res.end('const fixtureTimer=self.setTimeout.bind(self);self.setTimeout=(fn,ms,...args)=>fixtureTimer(fn,ms===30000?50:ms,...args);\n'+source);
}else{res.setHeader('Content-Type','text/html');res.end('<html><link rel="icon" href="data:,">Baseline</html>');}});
await new Promise(r=>server.listen(5221,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage(),requests=[];
 await page.route('**/vendor/lock.json*',route=>{requests.push(route.request().url());});
 await page.goto('http://127.0.0.1:5221/');
 async function warm(reuse=false){return page.evaluate(async({catalog,reuse})=>{
  if(!reuse)window.engine=new Worker('/worker.js',{type:'module'});
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture timeout')),10000);window.engine.onmessage=e=>{if(e.data.type==='warm'){clearTimeout(timer);resolve(e.data);}};window.engine.postMessage({type:'warmup',catalog,view:{w:1440,h:900}});});
 },{catalog,reuse});}
 const failed=await warm();assert.match(failed.error,/E_DICE_JSON.*vendor\/lock\.json.*attempt=3\/3.*AbortError/);assert.equal(requests.length,3);
 const retry=await warm(true);assert.equal(retry.error,failed.error);assert.equal(requests.length,3);
 const report={success:true,browser:'Microsoft Edge',baselineWorker:worker,clock:'30-second inactivity accelerated to 50 ms',failed,retry,requests,checks:['reproduced reported lock JSON AbortError after three stalled requests','same worker reuses rejected initialization without another network attempt'],realOwlbearRoom:false};
 mkdirSync('.cache/edge224',{recursive:true});writeFileSync('.cache/edge224/baseline.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
