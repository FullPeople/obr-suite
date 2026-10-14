// Exercise the real emitted documents in cross-origin iframes. No SDK room is
// created; external application scripts are blocked while CSS and theme boot
// remain real. Sampling the composited screenshot catches UA canvas painting
// that a computed background-color assertion alone cannot detect.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';

const root=process.cwd(),args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const baseline=args.includes('--baseline'),legacy=args.includes('--legacy'),out=resolve(option('--out','.local-evidence/transparent-canvas291'));
mkdirSync(out,{recursive:true});
const req=createRequire(resolve(process.env.TRANSPARENT_BROWSER_DEPS||root,'package.json'));
const {chromium}=req('@playwright/test');
let server,origin=option('--origin',undefined);
if(!origin){
 const build=resolve(option('--built','dist')),channel=option('--channel','suite');
 assert(existsSync(join(build,'boss-bar.html'))&&existsSync(join(build,'initiative-panel.html')),'Missing actual production documents');
 server=createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost'),prefix='/'+channel+'/';
  if(!url.pathname.startsWith(prefix)){response.writeHead(404);response.end();return;}
  const relative=decodeURIComponent(url.pathname.slice(prefix.length)),file=resolve(build,relative);
  if(!file.startsWith(build+'/')&&!file.startsWith(build+'\\')){response.writeHead(403);response.end();return;}
  try{const content=readFileSync(file),types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.svg':'image/svg+xml'};response.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});response.end(content);}catch{response.writeHead(404);response.end();}
 });
 await new Promise(ready=>server.listen(0,'127.0.0.1',ready));
 origin=`http://127.0.0.1:${server.address().port}/${channel}/`;
}
origin=origin.replace(/\/?$/,'/');
const executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH||process.env.TRANSPARENT_CHROME;
const browser=await chromium.launch(executablePath?{executablePath}:process.platform==='win32'?{channel:'msedge'}:{});
let fixtureBody='';
const fixtureServer=createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});response.end(fixtureBody);});
await new Promise(ready=>fixtureServer.listen(0,'127.0.0.1',ready));
const fixtureUrl=`http://127.0.0.1:${fixtureServer.address().port}/`;
const checks=[],controls=[],configuration=[];
try{
 // The SDK palette mode is not the iframe's CSS color-scheme. In particular,
 // a default (`normal`) owner still uses light while propagating the system
 // preference. Cover that missing dark-system/default-owner regression.
 // This fixture does not establish the actual room's embedding styles.
 for(const preferred of ['light','dark']){
  const context=await browser.newContext({viewport:{width:900,height:700},colorScheme:preferred});
  await context.route('**/*',route=>route.request().resourceType()==='script'?route.abort():route.continue());
  const page=await context.newPage();
  const failed=[];page.on('requestfailed',request=>{if(request.resourceType()!=='script')failed.push({url:request.url(),error:request.failure()?.errorText});});
  for(const host of ['normal','light'])for(const file of ['boss-bar.html','initiative-panel.html']){
   fixtureBody=`<!doctype html><html style="color-scheme:${host}"><head><style>html,body{margin:0;width:100%;height:100%;background:rgb(31,172,145)}iframe{position:absolute;left:20px;top:20px;width:800px;height:600px;border:0;background:transparent}</style></head><body><iframe src="${origin+file}"></iframe></body></html>`;
   await page.goto(fixtureUrl);
   const frame=page.frames().find(frame=>frame.url().startsWith(origin));assert(frame,'Production iframe did not load: '+JSON.stringify({frames:page.frames().map(frame=>frame.url()),failed}));
   await frame.waitForFunction(()=>document.styleSheets.length>0);
   for(const theme of legacy?['legacy']:['night','graphite','parchment','celadon']){
    if(!legacy){await frame.evaluate(theme=>{localStorage.setItem('full-suite/ui-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'full-suite/ui-theme'}));},theme);
    await frame.waitForFunction(theme=>document.documentElement.dataset.suiteTheme===theme,theme);}
    await frame.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    const canvas=await frame.evaluate(()=>({scheme:getComputedStyle(document.documentElement).colorScheme,prefersDark:matchMedia('(prefers-color-scheme: dark)').matches,root:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor}));
    if(!baseline)assert.equal(canvas.scheme,'normal','Transparent root must retain the legacy default');
    const shot=await page.screenshot();
    const pixel=await page.evaluate(async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(22,22,1,1).data];},shot.toString('base64'));
    const transparent=pixel[0]===31&&pixel[1]===172&&pixel[2]===145&&pixel[3]===255;
    checks.push({file,host,preferred,theme,...canvas,pixel,transparent});
    if(host==='light'&&(theme==='night'||legacy))writeFileSync(join(out,file.replace('.html','')+'.png'),shot);
   }
   if(file==='boss-bar.html'){
    await frame.evaluate(()=>document.body.classList.add('config'));
    await frame.evaluate(()=>new Promise(done=>requestAnimationFrame(done)));
    const background=await frame.evaluate(()=>getComputedStyle(document.body).backgroundColor);
    const retained=background==='rgb(33, 29, 35)';
    configuration.push({host,preferred,background,retained});
   }
  }
  await page.goto(origin+'settings.html');
  for(const theme of legacy?['legacy']:['night','graphite','parchment','celadon']){
   if(!legacy)await page.evaluate(theme=>{localStorage.setItem('full-suite/ui-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'full-suite/ui-theme'}));},theme);
   const scheme=await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme);
   const expected=legacy?'normal':['night','graphite'].includes(theme)?'dark':'light';
   controls.push({file:'settings.html',preferred,theme,scheme,expected,unchanged:scheme===expected});
  }
  await context.close();
 }
 const mismatches=checks.filter(check=>!check.transparent);
 const proof={origin,baseline,passed:!mismatches.length&&controls.every(check=>check.unchanged)&&configuration.every(check=>check.retained),transparentCases:checks.length,opaqueControlCases:controls.length,configurationCases:configuration.length,mismatchCount:mismatches.length,checks,controls,configuration,embeddingSchemes:['normal','light'],explicitDarkEmbeddingVerified:false,realOwlbearRoomVerified:false,externalApplicationScriptsBlocked:true};
 writeFileSync(join(out,'results.json'),JSON.stringify(proof,null,2)+'\n');
 assert(controls.every(check=>check.unchanged),'Ordinary settings theme was changed');
 assert(configuration.every(check=>check.retained),'Boss configuration background was removed');
 if(baseline)assert(mismatches.length>0,'The reported production canvas regression was not reproduced');
 else assert.equal(mismatches.length,0,JSON.stringify(mismatches.slice(0,3)));
 console.log(JSON.stringify({baseline,passed:proof.passed,transparentCases:checks.length,opaqueControlCases:controls.length,mismatchCount:mismatches.length}));
}finally{await browser.close();await new Promise(done=>fixtureServer.close(done));if(server)await new Promise(done=>server.close(done));}
