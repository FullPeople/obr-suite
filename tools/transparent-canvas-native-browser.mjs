import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
const options=process.argv.slice(2),value=(name,fallback)=>options.includes(name)?options[options.indexOf(name)+1]:fallback;
const deps=resolve(process.env.SUITE_BUILD_DEPS||'.'),{chromium}=createRequire(join(deps,'package.json'))('@playwright/test');
const out=resolve(value('--out','.local-evidence/native-canvas'));mkdirSync(out,{recursive:true});
let origin=value('--origin',undefined),server;
if(!origin){const built=resolve(value('--built','dist-workbench-dev'));server=createServer((req,res)=>{const file=join(built,new URL(req.url,'http://localhost').pathname.replace(/^\/suite-dev\//,''));try{res.setHeader('content-type',extname(file)==='.js'?'application/javascript':'text/html');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}/suite-dev/`;}
let html='';const hostServer=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(html);});await new Promise(r=>hostServer.listen(0,'127.0.0.1',r));
const hostOrigin=`http://127.0.0.1:${hostServer.address().port}`,iframeOrigin=new URL(origin).origin;
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true}),checks=[];
try{
 for(const preferred of [null,'light','dark']){
  const context=await browser.newContext({viewport:{width:900,height:700},colorScheme:preferred});
  await context.route('**/*',route=>route.request().resourceType()==='script'&&!route.request().url().includes('/transparent-canvas-')?route.abort():route.continue());
  const page=await context.newPage();
  for(const role of ['GM','PLAYER'])for(const host of ['light','dark'])for(const file of ['boss-bar.html','initiative-panel.html']){
   const url=new URL(origin+file);url.searchParams.set('obrref',Buffer.from(hostOrigin+' fixture-room').toString('base64'));
   html=`<!doctype html><html style="color-scheme:${host}" data-role="${role}"><head><style>html,body{margin:0;width:100%;height:100%;background:rgb(31,172,145)}iframe{position:absolute;left:20px;top:20px;width:800px;height:600px;border:0;background:transparent}</style></head><body><iframe id="overlay" src="${url.href}"></iframe><script>
    const frame=document.getElementById('overlay');let mode=${JSON.stringify(host.toUpperCase())};
    window.changeHostMode=next=>{mode=next;document.documentElement.style.colorScheme=next.toLowerCase();frame.contentWindow.postMessage({id:'OBR_THEME_EVENT_CHANGE',data:{theme:{mode}}},${JSON.stringify(iframeOrigin)});};
    frame.onload=()=>frame.contentWindow.postMessage({id:'OBR_READY',data:{ref:'fixture',userId:'fixture-${role}'}},${JSON.stringify(iframeOrigin)});
    window.addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!==${JSON.stringify(iframeOrigin)})return;const m=event.data;if(m.id==='OBR_THEME_GET_THEME')frame.contentWindow.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:{theme:{mode}}},event.origin);});
   </script></body></html>`;
   await page.goto(hostOrigin);const frame=page.frames().find(f=>f.url().startsWith(origin));assert(frame);
   await frame.waitForFunction(mode=>document.documentElement.dataset.suiteCanvasScheme===mode,host,{timeout:10000});
   for(const theme of ['night','graphite','parchment','celadon']){
    await frame.evaluate(theme=>{localStorage.setItem('full-suite/ui-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'full-suite/ui-theme'}));},theme);
    await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const shot=await page.screenshot(),pixel=await page.evaluate(async bytes=>{const image=new Image();image.src='data:image/png;base64,'+bytes;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const c=canvas.getContext('2d');c.drawImage(image,0,0);return [...c.getImageData(22,22,1,1).data];},shot.toString('base64'));
    assert.deepEqual(pixel,[31,172,145,255],JSON.stringify({role,host,preferred,file,theme,pixel}));
    checks.push({role,host,preferred,file,theme,transparent:true});
    if(preferred==='dark'&&role==='GM'&&host==='light'&&theme==='night')writeFileSync(join(out,file+'.png'),shot);
   }
   const next=host==='light'?'dark':'light';await page.evaluate(mode=>window.changeHostMode(mode.toUpperCase()),next);await frame.waitForFunction(mode=>document.documentElement.dataset.suiteCanvasScheme===mode,next);
  }
  await context.close();
 }
 const proof={passed:true,canvasCases:checks.length,nativeSdkThemeBridge:true,roles:['GM','PLAYER'],hostChangeCovered:true,realOwlbearRoomVerified:false,applicationScriptsBlocked:true,checks};writeFileSync(join(out,'results.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({...proof,checks:undefined}));
}finally{await browser.close();await new Promise(r=>hostServer.close(r));if(server)await new Promise(r=>server.close(r));}
