// Real SDK + Jolt fixture; sequential diagnostic ablations. Never a product-speed claim.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {cpus,availableParallelism,totalmem,release} from 'node:os';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {PRODUCT_BASE,WEB_REF,VARIANTS,variantFlags} from './dice-pass-transform.mjs';
import {summarizeClient,compareCases} from './dice-pass-summary.mjs';
const root=resolve(process.env.DND_DICE_PASS_BUILD||'.local-evidence/dice-pass-budget/runtime'),out=resolve(process.env.DND_DICE_PASS_EVIDENCE||'.local-evidence/dice-pass-budget/browser');
const port=Number(process.env.DICE_PASS_PORT||5238),origin='http://127.0.0.1:'+port,repeats=Number(process.env.DICE_PASS_REPEATS||3),gpu=process.env.DICE_PASS_GPU!=='0';
assert(Number.isInteger(repeats)&&repeats>=1&&repeats<=10);mkdirSync(out,{recursive:true});
const old=readFileSync('tools/workbench-dice3d-sdk-probe.mjs','utf8');
let template=old.slice(old.indexOf('res.end(`')+9,old.indexOf('`);});'));
for(const [before,after] of [
  ['${JSON.stringify(base)}',JSON.stringify(origin+'/suite-dev/')],
  ["frame('sdk-verify.html','background')","frame('extensions/workbench-dice3d/sdk-verify.html','background')"],
  ["['Host','Player'].filter(n=>n!==name)","(new URLSearchParams(location.search).get('clients')==='2'?['Host','Player']:['Host']).filter(n=>n!==name)"]
]){assert.equal(template.split(before).length,2,'fixture source boundary '+before);template=template.replace(before,after);}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav','.ttf':'font/ttf'};
const server=createServer((req,res)=>{try{const path=decodeURIComponent(new URL(req.url,origin).pathname);if(path==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(template);}if(path==='/favicon.ico'){res.writeHead(204);return res.end();}const file=resolve(root,path.replace(/^\/suite-dev\//,''));if(!file.startsWith(root+sep)){res.writeHead(403);return res.end();}res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end('Not found');}});
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const launchArgs=['--disable-background-timer-throttling','--disable-renderer-backgrounding',...(process.env.DICE_PASS_SOFTWARE!=='0'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])];
const metadata={startedAt:new Date().toISOString(),suite:git('rev-parse','HEAD'),productBase:PRODUCT_BASE,web:process.env.DND_CARD_WEB_ROOT?git('-C',process.env.DND_CARD_WEB_ROOT,'rev-parse','HEAD'):null,build:JSON.parse(readFileSync(resolve(root,'..','build.json'),'utf8')),host:{cpuModel:cpus()[0]?.model,logicalCpus:cpus().length,availableParallelism:availableParallelism(),totalMemoryBytes:totalmem(),osRelease:release(),arch:process.arch,node:process.version},viewport:{width:1280,height:800,deviceScaleFactor:1},launchArgs,repeats,gpuRequested:gpu,realSDK:true,realPhysics:true,realOwlbearRoom:false,virtualOneWayNetworkMs:10,capture:{video:false,screenshots:false,readback:false,trace:'separate optional baseline case only'},measurement:'wholeJSCpuMs and GL/show CPU spans are submission-side CPU, never GPU/compositor time; optional asynchronous disjoint-safe GPU queries are separate. Ablations intentionally omit pixels and cannot establish a product improvement.'};
assert.equal(metadata.web,WEB_REF);assert.equal(metadata.build.assets.verified,59);assert.equal(metadata.build.suite,metadata.suite,'build must match current commit');
let browser;const cases=[],failures=[];
function save(name,value){writeFileSync(resolve(out,name),JSON.stringify(value,null,2));}
async function startTrace(page,label){
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,cc,viz,gpu',transferMode:'ReturnAsStream'});
  let resolveStop;const completion=new Promise(resolve=>resolveStop=resolve);
  cdp.once('Tracing.tracingComplete',resolveStop);
  let stopped=false;async function stop(){if(!stopped){stopped=true;await cdp.send('Tracing.end');}const {stream}=await completion;const chunks=[];for(;;){const part=await cdp.send('IO.read',{handle:stream});chunks.push(Buffer.from(part.data,part.base64Encoded?'base64':'utf8'));if(part.eof)break;}await cdp.send('IO.close',{handle:stream});const file=label+'.trace.json.gz';writeFileSync(resolve(out,file),gzipSync(Buffer.concat(chunks)));await cdp.detach();return file;}
  // A short, separate trace can perturb scheduling. It never enters the A/B summary.
  const done=new Promise((resolve,reject)=>setTimeout(()=>stop().then(resolve,reject),10000));done.catch(()=>{});return {promise:done};
}
async function runCase({variant,expression,clientCount,repeat,trace=false}){
  const label=`${String(cases.length+failures.length).padStart(3,'0')}-${clientCount}c-r${repeat}-${expression}-${variant}`;
  const config={variant,...variantFlags(variant),seed:123456,rollId:'dice-pass-budget-'+expression,gpu,trace};
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
  const pages=[],errors=[],requests=[],cold=[],clients=[];let result,submittedAt,traceDone,traceFile;
  const timers=new Set();
  await context.addInitScript(config=>{window.__dicePassConfig=config;const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>raf(t=>{window.__dicePassLastRAF=performance.timeOrigin+t;return callback(t);});},config);
  try{
    for(const name of ['Host','Player'].slice(0,clientCount)){
      const page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push({page:name,error:String(error)}));page.on('requestfailed',request=>requests.push({page:name,url:request.url(),failure:request.failure()}));
      await page.exposeBinding('sendRemote',async({page},packet)=>{for(const other of pages)if(other!==page){const timer=setTimeout(()=>{timers.delete(timer);void other.evaluate(packet=>window.deliver?.(packet),packet).catch(error=>errors.push({delivery:String(error)}));},10);timers.add(timer);}});
      const started=Date.now();await page.goto(origin+'/fixture?name='+name+'&clients='+clientCount);
      await page.waitForFunction(()=>document.querySelector('#background')?.contentWindow?.suiteHostProbe?.events.filter(e=>e.type==='state').at(-1)?.state.ready,null,{timeout:150000,polling:100});
      const sdk=page.frames().find(f=>f.url().includes('sdk-verify')),overlay=page.frames().find(f=>f.url().includes('/overlay.html'));assert(sdk&&overlay);
      await overlay.waitForFunction(()=>window.__dicePassBudget,null,{timeout:150000,polling:100});
      cold.push({name,readyMs:Date.now()-started,renderer:await sdk.evaluate(()=>window.suiteHostProbe.events.find(e=>e.event==='renderer-ready')?.detail),environment:await overlay.evaluate(()=>{const r=window.__diceProfileRenderer,gl=r.gl.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),browser:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,visibility:document.visibilityState,drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],projection:{...r.projection},gpu:window.__dicePassBudget.gpu.status()};})});
    }
    const sdks=pages.map(p=>p.frames().find(f=>f.url().includes('sdk-verify'))),overlays=pages.map(p=>p.frames().find(f=>f.url().includes('/overlay.html')));
    for(const sdk of sdks)await sdk.waitForFunction(count=>window.suiteHostProbe.events.filter(e=>e.type==='state').at(-1)?.state.peers.filter(p=>p.ready).length===count,clientCount-1,{timeout:120000,polling:100});
    if(trace)traceDone=await startTrace(pages[0],label);
    ({submittedAt,result}=await sdks[0].evaluate(async expression=>{const submittedAt=performance.timeOrigin+performance.now();return{submittedAt,result:await window.suiteHostProbe.submitDice3d({expression,itemId:null})};},expression));
    assert.equal(result.rollId,config.rollId,'fixed id also fixes CueRenderer particle seed');
    for(const sdk of sdks){await sdk.waitForFunction(id=>window.suiteHostProbe.events.some(e=>e.event==='render-complete'&&e.detail.roll===id),result.rollId,{timeout:180000,polling:100});await sdk.waitForFunction(id=>window.suiteHostProbe.results.some(r=>r.data.rollId===id),result.rollId,{timeout:15000,polling:100});}
    for(const overlay of overlays)await overlay.waitForFunction(()=>window.__diceProfileRenderer.active.length===0,null,{timeout:15000,polling:100});
    // Query retrieval is asynchronous and outside animation. Unavailable results stay unavailable.
    for(const overlay of overlays)await overlay.evaluate(async()=>{for(let i=0;i<20;i++){window.__dicePassBudget.gpu.poll();if(!window.__dicePassBudget.gpu.status().pendingCount)break;await new Promise(r=>setTimeout(r,50));}});
    for(let index=0;index<sdks.length;index++){
      const sdk=await sdks[index].evaluate(id=>({events:window.suiteHostProbe.events,results:window.suiteHostProbe.results.filter(r=>r.data.rollId===id),state:window.suiteHostProbe.events.filter(e=>e.type==='state').at(-1)?.state}),result.rollId);
      const raw=await overlays[index].evaluate(()=>window.__dicePassBudget.snapshot());
      const client={index,sdk,raw,summary:summarizeClient(raw,sdk,result.rollId)};clients.push(client);
      assert.equal(raw.active,0);assert.equal(raw.webglContextLost,false);assert.equal(raw.documentVisibility,'visible');assert.deepEqual(raw.faults,[]);assert(raw.rolls.length,'real authoritative trace prepared');assert(raw.rolls.every(r=>r.poseSha256?.length===64),'authoritative pose hashes');assert(raw.rolls.every(r=>r.seed===config.seed),'same fixed physics seed');assert(raw.frames.some(f=>f.rolls.length),'real active rAF records');
      assert(raw.frames.filter(f=>f.rolls.length).every(f=>f.glPassAttempted===1),'exactly one whole GL-pass boundary per active frame');
      assert(raw.frames.filter(f=>f.rolls.length).every(f=>f.glPassSkipped===Number(config.noGL)),'GL omission is explicit');
      const paint=raw.frames.flatMap(f=>Object.values(f.canvas));assert.deepEqual([...new Set(raw.frames.flatMap(f=>Object.keys(f.canvas)))].sort(),['cue-canvas','research-effects'],'both 2D surfaces retained');assert(paint.some(p=>p.attempted.clearRect>0),'logical clears still execute');assert(config.noGL?raw.gpu.records.length===0:raw.gpu.records.length>0,'GL render submission agrees with ablation');
      assert.equal(raw.frames.reduce((n,f)=>n+f.connectedCardDraws,0),0,'Suite FormulaShow card remains detached');
      if(config.no2D)assert(paint.every(p=>Object.keys(p.executed).length===0),'no paint or clear submitted');else assert(paint.some(p=>(p.executed.stroke||0)>0),'baseline actually paints cues');
      if(config.noDetachedDOM)assert(raw.frames.some(f=>f.suppressedCardDraws>0),'detached DOM diagnostic exercised');else assert(raw.frames.every(f=>!f.suppressedCardDraws));
      assert.equal(client.summary.completed,true);assert.equal(sdk.results.at(-1).data.total,result.total);assert.deepEqual(sdk.results.at(-1).data.dice,result.dice);
      assert.deepEqual(await pages[index].evaluate(()=>window.fixture.errors),[]);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    if(traceDone)traceFile=await traceDone.promise;
    const row={label,variant,expression,clientCount,repeat,trace,traceFile,config,submittedAt,result,cold,clients,errors,requests};save(label+'.json',row);cases.push(row);save('partial.json',{metadata,cases:cases.map(c=>({label:c.label,variant:c.variant,expression:c.expression,clientCount:c.clientCount,repeat:c.repeat,trace:c.trace,file:c.label+'.json',summaries:c.clients.map(c=>c.summary)})),failures});
    console.log(JSON.stringify({label,clients:clients.map(c=>c.summary)}));
  }catch(error){
    const diagnostics=[];for(const page of pages){try{diagnostics.push({fixture:await page.evaluate(()=>window.fixture),frames:await Promise.all(page.frames().map(async frame=>({url:frame.url(),probe:await frame.evaluate(async()=>({sdk:window.suiteHostProbe?{stage:window.suiteHostProbe.stage,error:window.suiteHostProbe.error,events:window.suiteHostProbe.events,results:window.suiteHostProbe.results}:null,pass:window.__dicePassBudget?await window.__dicePassBudget.snapshot():null})).catch(e=>({error:String(e)}))})))});}catch(e){diagnostics.push({error:String(e)});}}
    if(traceDone)try{traceFile=await traceDone.promise;}catch(e){diagnostics.push({traceError:String(e)});}
    const failure={label,variant,expression,clientCount,repeat,trace,traceFile,config,error:String(error),stack:error.stack,submittedAt,result,cold,clients,errors,requests,diagnostics};save(label+'.failure.json',failure);failures.push({label,error:String(error)});console.error(JSON.stringify({label,error:String(error)}));
  }finally{for(const timer of timers)clearTimeout(timer);await context.close();}
}
try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  browser=await chromium.launch({headless:true,args:launchArgs,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});metadata.browser=await browser.version();save('metadata.json',metadata);
  for(let repeat=1;repeat<=repeats;repeat++)for(const variant of VARIANTS)for(const expression of ['20d6','1d20'])await runCase({variant,expression,clientCount:1,repeat});
  for(let repeat=1;repeat<=repeats;repeat++)for(const expression of ['20d6','1d20'])await runCase({variant:'baseline-dual',expression,clientCount:2,repeat});
  if(process.env.DICE_PASS_TRACE==='1')await runCase({variant:'baseline-trace',expression:'20d6',clientCount:1,repeat:1,trace:true});
  const comparison=compareCases(cases);save('result.json',{success:failures.length===0&&comparison.invariants.valid,metadata,comparison,failures,cases:cases.map(c=>({label:c.label,file:c.label+'.json',variant:c.variant,expression:c.expression,clientCount:c.clientCount,repeat:c.repeat,trace:c.trace,summaries:c.clients.map(c=>c.summary)}))});
  assert.deepEqual(failures,[],'all variants must complete');assert.equal(comparison.invariants.valid,true,'authoritative outcomes, pose hashes and cue schedules must agree');
}catch(error){save('failure.json',{error:String(error),stack:error.stack,metadata,failures,completedCases:cases.map(c=>c.label)});throw error;}finally{if(browser)await browser.close();if(server.listening)await new Promise(r=>server.close(r));}
