// Genuine WebGL context loss/restore through WEBGL_lose_context. The SDK host
// is synthetic; no physical GPU, Owlbear account or latency claim is made.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.env.DND_DICE_LATENCY_BUILD||'.local-evidence/dice-context/runtime'),out=resolve(process.env.DND_DICE_EVIDENCE||'.local-evidence/dice-context/browser');
const unsafe=process.env.DICE_CONTEXT_EXPECT_UNSAFE==='1',port=Number(process.env.DICE_CONTEXT_PORT||5881),origin='http://127.0.0.1:'+port;mkdirSync(out,{recursive:true});
const source=readFileSync('tools/workbench-dice3d-sdk-probe.mjs','utf8');
const channel=readFileSync('extensions/workbench-dice3d/src/types.ts','utf8').match(/export const CHANNEL='([^']+)'/)?.[1];assert(channel);
let template=source.slice(source.indexOf('res.end(`')+9,source.indexOf('`);});'));
assert(template.includes('${JSON.stringify(base)}'));
template=template.replace('${JSON.stringify(base)}',JSON.stringify(origin+'/suite-dev/')).replace("frame('sdk-verify.html','background')","frame('extensions/workbench-dice3d/sdk-verify.html','background')").replace("['Host','Player'].filter(n=>n!==name)",'[]').replace('data={width:1440}','data={width:innerWidth}').replace('data={height:900}','data={height:innerHeight}');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav','.ttf':'font/ttf','.glb':'model/gltf-binary'};
const server=createServer((req,res)=>{const path=decodeURIComponent(new URL(req.url,origin).pathname);if(path==='/fixture'){res.setHeader('Content-Type','text/html');res.end(template);return;}if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
 const file=resolve(root,path.replace(/^\/suite-dev\//,''));if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end(path);}});
await new Promise(r=>server.listen(port,'127.0.0.1',r));
let browser;const cases=[],errors=[];
try{
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
 for(const name of ['font-pending-restore','font-rejected-restore','font-completes-while-lost']){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});let pending,resolvePending;
  const intercepted=new Promise(r=>resolvePending=r);
  await context.route('**/assets/fonts/Cinzel-Variable.ttf*',async route=>{
   if(name==='font-rejected-restore'){await route.fulfill({status:404,body:'authored font failure'});return;}
   pending=route;resolvePending();
  });
  try{
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.exposeBinding('sendRemote',async()=>{});
   await page.goto(origin+'/fixture?name=Host');await page.waitForFunction(()=>document.querySelector('#background')?.contentWindow?.suiteHostProbe,null,{timeout:90000});
   const host=page.frames().find(f=>f.url().includes('sdk-verify'));await page.waitForFunction(()=>document.querySelector('#overlay')?.contentWindow?.location.href.includes('/overlay.html'),null,{timeout:90000});
   const overlay=page.frames().find(f=>f.url().includes('/overlay.html'));assert(overlay);
   await overlay.waitForFunction(()=>!!window.__diceProfileRenderer,null,{timeout:90000});await overlay.evaluate(()=>window.__diceLabAudio.warmup());
   await overlay.evaluate(channel=>{window.__contextEvents=[];const bus=new BroadcastChannel(channel+':local:fixture-Host');bus.onmessage=e=>window.__contextEvents.push(e.data);
    window.__actualRestores=0;const renderer=window.__diceProfileRenderer,compile=renderer.gl.compileAsync.bind(renderer.gl);renderer.gl.compileAsync=async(...args)=>{const result=await compile(...args);window.__actualRestores++;return result;};
    window.__lose=renderer.gl.getContext().getExtension('WEBGL_lose_context');if(!window.__lose)throw Error('WEBGL_lose_context required');},channel);
   if(name==='font-rejected-restore')await host.waitForFunction(()=>window.suiteHostProbe.events.some(e=>e.type==='state'&&e.state.error),null,{timeout:30000});else await intercepted;
   await overlay.evaluate(()=>window.__lose.loseContext());await overlay.waitForFunction(()=>window.__diceProfileRenderer.gl.getContext().isContextLost());
   if(name==='font-completes-while-lost'){
    await pending.continue();pending=null;await overlay.waitForFunction(()=>[...document.fonts].some(f=>f.family==='CinzelVariable'&&f.status==='loaded'));
    if(unsafe)await host.waitForFunction(()=>window.suiteHostProbe.events.filter(e=>e.type==='state').at(-1)?.state.ready);
   }else{
    await overlay.evaluate(()=>window.__lose.restoreContext());await overlay.waitForFunction(()=>window.__actualRestores>0,null,{timeout:30000});
    if(unsafe)await host.waitForFunction(()=>window.suiteHostProbe.events.filter(e=>e.type==='state').at(-1)?.state.ready);
   }
   const state=await host.evaluate(()=>window.suiteHostProbe.events.filter(e=>e.type==='state').at(-1)?.state);
   assert.equal(state.ready,unsafe,'Full resource barrier must survive the actual WebGL event');
   let outcome;try{outcome={accepted:true,result:await host.evaluate(()=>window.suiteHostProbe.submitDice3d({expression:'1d6',itemId:null,label:'Readiness guard synthetic'}))};}catch(error){outcome={accepted:false,error:String(error)};}
   assert.equal(outcome.accepted,unsafe);
   const sample=await overlay.evaluate(()=>({events:window.__contextEvents,actualRestoreCompilations:window.__actualRestores,contextLost:window.__diceProfileRenderer.gl.getContext().isContextLost(),renderer:window.__diceProfileRenderer.gl.getContext().getParameter(window.__diceProfileRenderer.gl.getContext().getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL||window.__diceProfileRenderer.gl.getContext().RENDERER)}));
   await page.screenshot({path:join(out,name+'.png')});
   let recovery=null;
   if(!unsafe&&name!=='font-rejected-restore'){
    if(pending){await pending.continue();pending=null;}
    if(name==='font-completes-while-lost')await overlay.evaluate(()=>window.__lose.restoreContext());
    await host.waitForFunction(()=>window.suiteHostProbe.events.filter(e=>e.type==='state').at(-1)?.state.ready,null,{timeout:30000});
    await overlay.evaluate(()=>window.__lose.loseContext());await host.waitForFunction(()=>!window.suiteHostProbe.events.filter(e=>e.type==='state').at(-1)?.state.ready);
    await overlay.evaluate(()=>window.__lose.restoreContext());await host.waitForFunction(()=>window.suiteHostProbe.events.filter(e=>e.type==='state').at(-1)?.state.ready,null,{timeout:30000});
    const roll=await host.evaluate(()=>window.suiteHostProbe.submitDice3d({expression:'1d6',itemId:null,label:'Recovered synthetic request'}));assert(roll.dice[0].value>=1&&roll.dice[0].value<=6);
    await host.waitForFunction(id=>window.suiteHostProbe.events.some(e=>e.type==='log'&&e.event==='render-complete'&&e.detail.roll===id),roll.rollId,{timeout:30000});
    recovery={actualPublicRollCompleted:true,legalD6:true};
   }
   cases.push({name,ready:state.ready,error:state.error||'',requestAccepted:outcome.accepted,...sample,recovery});
  }finally{if(pending)await pending.abort().catch(()=>{});await context.close();}
 }
 assert.deepEqual(errors,[]);
 writeFileSync(join(out,'result.json'),JSON.stringify({success:true,expectedUnsafe:unsafe,browser:await browser.version(),genuineWebGL:true,syntheticSdk:true,physicalDevice:false,latencyClaim:false,cases,errors},null,2)+'\n');
 console.log(JSON.stringify({cases:cases.length,expectedUnsafe:unsafe,recoveredPublicRolls:cases.filter(c=>c.recovery).length,errors}));
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),expectedUnsafe:unsafe,cases,errors},null,2)+'\n');throw error;}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
