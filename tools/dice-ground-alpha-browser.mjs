// CI-only browser experiment. No product edits and no latency acceptance threshold.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {probeGroundAlphaCache} from './dice-ground-alpha-probe.mjs';
const root=resolve(process.env.DND_DICE_LATENCY_BUILD||'.local-evidence/dice-latency/runtime');
const out=resolve(process.env.DICE_GROUND_ALPHA_OUT||'.local-evidence/dice-ground-alpha');
const port=Number(process.env.DICE_GROUND_ALPHA_PORT||5241),origin='http://127.0.0.1:'+port;
mkdirSync(out,{recursive:true});
const source=readFileSync('tools/workbench-dice3d-sdk-probe.mjs','utf8');
const begin=source.indexOf('res.end(`'),end=source.indexOf('`);});',begin);
assert(begin>=0&&end>begin,'Actual SDK fixture template boundary changed');
let template=source.slice(begin+9,end);
for(const token of ['${JSON.stringify(base)}',"frame('sdk-verify.html','background')",'metadata:{},ids:[]'])assert(template.includes(token),'SDK template token changed: '+token);
template=template.replace('${JSON.stringify(base)}',JSON.stringify(origin+'/suite-dev/')).replace("frame('sdk-verify.html','background')","frame('extensions/workbench-dice3d/sdk-verify.html','background')").replace('metadata:{},ids:[]',"metadata:{'com.obr-suite/dice/3d-theme':'ink_sketch'},ids:[]");
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav','.ttf':'font/ttf'};
const server=createServer((req,res)=>{
 try {const pathname=decodeURIComponent(new URL(req.url,origin).pathname);
  if(pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(template);return;}
  if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  const file=resolve(root,pathname.replace(/^\/suite-dev\//,''));
  if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
 } catch(error){res.writeHead(404);res.end(String(error));}
});
const rows=[],pageErrors=[],consoleErrors=[];let browser,context,page;
const baseMetadata={harnessBase:'2e2ddb1f642e1375cffda45efad9584b33100008',suite:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),singleClient:true,realSDK:true,realJoltTrajectory:true,realOwlbearRoom:false,softwareGPURequested:true,viewport:{width:1280,height:800,dpr:1},measurement:'Full original drawFrame plus gl.finish and synchronous RGBA readback; no GPU timestamp/presentation claim. A diagnostic rejection is an experiment result, not cache acceptance.'};
function save(name,value){writeFileSync(resolve(out,name),JSON.stringify(value,null,2));}
function images(prefix,report){for(const item of report.images||[]){assert(item.png.startsWith('data:image/png;base64,'),'Invalid screenshot encoding');const filename=prefix+'-'+item.name+'.png';writeFileSync(resolve(out,filename),Buffer.from(item.png.split(',')[1],'base64'));item.file=filename;delete item.png;}}
try {
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
 browser=await chromium.launch({...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 baseMetadata.browser=await browser.version();
 const scenarios=[{id:'sketch-1d20',expression:'1d20',seed:7},{id:'sketch-20d6',expression:'20d6',seed:7},{id:'sketch-real-clamp',expression:'max(2d6,6)',seed:2,requireClamp:true}];
 for(const scenario of scenarios) {
  context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
  await context.addInitScript(seed=>{window.__diceProfileSeed=()=>seed;},scenario.seed);
  page=await context.newPage();page.on('pageerror',error=>pageErrors.push({scenario:scenario.id,error:String(error)}));page.on('console',message=>{if(message.type()==='error')consoleErrors.push({scenario:scenario.id,text:message.text()});});
  await page.exposeFunction('sendRemote',()=>{});
  await page.goto(origin+'/fixture?name=Host');
  await page.waitForFunction(()=>document.querySelector('#background')?.contentWindow?.suiteHostProbe?.events.filter(e=>e.type==='state').at(-1)?.state.ready,null,{timeout:120000,polling:100});
  const sdk=page.frames().find(f=>f.url().includes('sdk-verify')),overlay=page.frames().find(f=>f.url().includes('overlay.html'));
  assert(sdk&&overlay,'SDK/overlay frame missing');
  const roll=await sdk.evaluate(expression=>window.suiteHostProbe.submitDice3d({expression,itemId:null}),scenario.expression);
  assert.equal(typeof roll.rollId,'string','Actual SDK roll ID missing');
  await overlay.waitForFunction(id=>window.__diceProfileRenderer?.active.some(a=>a.roll.request.id.startsWith(id)),roll.rollId,{timeout:120000,polling:20});
  const plan=await overlay.evaluate(id=>{
   const r=window.__diceProfileRenderer,gl=r.gl.getContext();cancelAnimationFrame(r.frameHandle);r.frameHandle=0;
   r.projection.pixelsPerDie=r.targetPixelsPerDie;r.layout();
   const active=r.active.find(a=>a.roll.request.id.startsWith(id));
   if(r.active.length!==1||!active||active.roll.frames<2||active.roll.poses.length!==active.roll.frames*active.meshes.length*7||active.roll.fps!==120)throw Error('Invalid actual Jolt/active-roll fixture');
   const cue=active.cue,first=cue.beams[0];if(!first||!(cue.settled<first.start&&first.start<first.reveal&&first.reveal<cue.diceExit))throw Error('Invalid settled/gathering timeline');
   const phases=[{name:'settled',age:Math.min(cue.settled+.12,(cue.settled+first.start)/2)},{name:'gathering',age:(first.start+first.reveal)/2}];
   const clamps=active.roll.formulaData?.timeline?.clamps||[];
   if(clamps.length)phases.push({name:'visible-clamp',age:(clamps[0].start+clamps[0].end)/2,clamp:clamps[0]});
   const debug=gl.getExtension('WEBGL_debug_renderer_info');
   return{phases:phases.sort((a,b)=>a.age-b.age),clamps,physicalCount:active.meshes.length,frames:active.roll.frames,fps:active.roll.fps,physicsMs:active.roll.physicsMs,duration:active.roll.duration,results:active.roll.results,cue:{settled:cue.settled,firstBeam:cue.firstBeam,firstReveal:first.reveal,finalReveal:cue.finalReveal,diceExit:cue.diceExit},renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
  },roll.rollId);
  if(scenario.requireClamp)assert(plan.clamps.length>0,'Seed 2 must produce an actual physical clamp episode');
  assert.equal(plan.physicalCount,scenario.id==='sketch-20d6'?20:scenario.requireClamp?2:1,'Wrong actual physical dice count');
  const row={...scenario,theme:'ink_sketch',rollId:roll.rollId,...plan,probes:[]};rows.push(row);
  for(const phase of plan.phases) {
   const original=await overlay.evaluate(({age,id})=>{
    const r=window.__diceProfileRenderer,T=window.__diceProfileThree,gl=r.gl.getContext(),active=r.active.find(a=>a.roll.request.id.startsWith(id));
    if(!active||age>=active.cue.diceExit)throw Error('Fixed pose outside active timeline');
    cancelAnimationFrame(r.frameHandle);r.frameHandle=0;window.__diceProfileTime=active.start+age*1000;r.last=window.__diceProfileTime-16;r.drawFrame();
    const rgba=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.finish();gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
    let alphaPixels=0;for(let i=3;i<rgba.length;i+=4)if(rgba[i])alphaPixels++;
    if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR||alphaPixels<100)throw Error('Original fixture has invalid/empty WebGL pixels');
    const ground=r.scene.children.find(o=>o.material instanceof T.ShadowMaterial),bodies=r.active.flatMap(a=>a.meshes),known=new Set([ground,...bodies,...bodies.flatMap(m=>m.children.filter(c=>c.userData.diceDecoration))]),unknown=[];
    r.scene.traverseVisible(o=>{if((o.isMesh||o.isLine||o.isPoints||o.isSprite)&&!known.has(o))unknown.push({name:o.name,type:o.type});});
    return{alphaPixels,unknownVisibleDrawables:unknown,activeBeams:active.cue.beams.filter(b=>age>=b.start&&age<=b.reveal).length,png:r.gl.domElement.toDataURL('image/png')};
   },{age:phase.age,id:roll.rollId});
   if(phase.name==='gathering')assert(original.activeBeams>0,'Gathering pose must contain an active result beam');
   if(phase.name==='visible-clamp')assert(original.unknownVisibleDrawables.length>0,'Clamp must visibly exercise unknown 3D FX/depth masks');
   const prefix=scenario.id+'-'+phase.name;
   const fixturePNG=prefix+'-fixture-original.png';writeFileSync(resolve(out,fixturePNG),Buffer.from(original.png.split(',')[1],'base64'));delete original.png;original.file=fixturePNG;
   const result=await overlay.evaluate(probeGroundAlphaCache,{samples:5,warmup:2,captureImages:true});
   images(prefix,result);row.probes.push({phase,fixture:original,...result});
   save('partial.json',{...baseMetadata,rows,pageErrors,consoleErrors});save(prefix+'.json',row.probes.at(-1));
   assert(['passed-fixed-pose-only','rejected'].includes(result.status),'Unknown diagnostic outcome');
   assert(!['fixture-error','probe-error'].includes(result.failureClass),'Probe/fixture failed: '+result.reasons.join('; '));
   assert.notEqual(result.stateRestored,false,'Probe failed to restore renderer configuration');
   if(phase.name==='visible-clamp'){assert.equal(result.status,'rejected','Unsafe clamp must not cache');assert(result.reasons.some(reason=>reason.includes('Unknown visible drawable/FX')),'Clamp must reject specifically for visible unknown 3D FX');}
   console.log(JSON.stringify({scenario:scenario.id,phase:phase.name,age:phase.age,status:result.status,reasons:result.reasons,summary:result.summary,activation:result.activation}));
  }
  const fixtureErrors=await page.evaluate(()=>window.fixture.errors);assert.deepEqual(fixtureErrors,[],'SDK host fixture reported errors');
  const renderErrors=await sdk.evaluate(()=>window.suiteHostProbe.events.filter(e=>e.event==='error'||e.event==='render-frame-retry'||e.event==='render-cancelled'||e.event==='render-unavailable'));
  assert.deepEqual(renderErrors,[],'Actual product render lifecycle reported failure');assert.deepEqual(pageErrors,[],'Browser JavaScript errors');
  await context.close();context=undefined;page=undefined;
 }
 const probes=rows.flatMap(row=>row.probes);assert.equal(probes.length,7,'Expected two phases per scenario plus one real clamp phase');
 save('result.json',{...baseMetadata,success:true,experimentCompleted:true,cacheAccepted:false,acceptanceScope:'Per-pose outcomes only; no production or cross-GPU acceptance',summary:{probes:probes.length,passedFixedPose:probes.filter(p=>p.status==='passed-fixed-pose-only').length,rejected:probes.filter(p=>p.status==='rejected').length,visibleClampSafelyRejected:true},rows,pageErrors,consoleErrors});
} catch(error) {
 let fixture;
 if(page)try{await page.screenshot({path:resolve(out,'failure-page.png')});fixture=await page.evaluate(()=>window.fixture);}catch(snapshotError){fixture={snapshotError:String(snapshotError)};}
 save('failure.json',{...baseMetadata,success:false,experimentCompleted:false,error:String(error.stack||error),rows,pageErrors,consoleErrors,fixture});throw error;
} finally {if(context)await context.close();if(browser)await browser.close();if(server.listening)await new Promise(done=>server.close(done));}
