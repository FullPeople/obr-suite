import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.env.DND_SUITE_BUILD||'../runtime-2'),sdk=resolve('../sdk235'),out=resolve(process.env.DND_DICE_EVIDENCE||'../browser235'),origin='http://127.0.0.1:5235',checks=[];
mkdirSync(out,{recursive:true});
// Reuse the actual SDK host fixture, with current production modules/worker.
const old=readFileSync('tools/workbench-dice3d-sdk-probe.mjs','utf8');
let template=old.slice(old.indexOf('res.end(`')+9,old.indexOf('`);});'));
template=template.replace('${JSON.stringify(base)}',JSON.stringify(origin+'/suite-dev/')).replace("frame('sdk-verify.html','background')","frame('extensions/workbench-dice3d/sdk-verify.html','background')");
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav'};
const server=createServer((req,res)=>{const path=new URL(req.url,origin).pathname;if(path==='/fixture'){res.setHeader('Content-Type','text/html');res.end(template);return;}if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
 const rel=path.replace(/^\/suite-dev\//,''),file=existsSync(resolve(sdk,rel))?resolve(sdk,rel):resolve(root,rel);
 try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end(path);}
});await new Promise(r=>server.listen(5235,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-proxy-server']}),context=await browser.newContext({viewport:{width:960,height:600}}),pages=[],errors=[];
let mode='normal',dropped=false;
try{
 for(const name of ['Host','Player']){const p=await context.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));
  await p.exposeBinding('sendRemote',async({page},packet)=>{for(const other of pages)if(other!==page){const type=packet.data?.type;
   if(page===pages[1]&&mode==='no-ready'&&type==='ready')continue;
   if(page===pages[0]&&mode==='lost-offer'&&type==='offer'&&!dropped){dropped=true;continue;}
   if(page===pages[0]&&mode==='late-chunks'&&type==='chunk'){setTimeout(()=>other.evaluate(packet=>window.deliver?.(packet),packet).catch(()=>{}),4500);continue;}
   // Receiving browsers do not acknowledge the sender's local SDK RPC.
   // Keep delivery asynchronous, as the real broadcast transport does.
   void other.evaluate(packet=>window.deliver?.(packet),packet).catch(error=>errors.push('fixture delivery: '+String(error)));
  }});await p.goto(origin+'/fixture?name='+name);await p.waitForFunction(()=>document.querySelector('#background')?.contentWindow?.suiteHostProbe,null,{timeout:90000});
  // Stabilize the first ready authority before introducing the second client.
  await p.frames().find(f=>f.url().includes('sdk-verify')).waitForFunction(()=>window.suiteHostProbe.events.filter(e=>e.type==='state').at(-1)?.state.ready,null,{timeout:90000});}
 const frames=pages.map(p=>p.frames().find(f=>f.url().includes('sdk-verify')));
 for(const f of frames)await f.waitForFunction(()=>window.suiteHostProbe.events.filter(e=>e.type==='state').at(-1)?.state.peers.filter(p=>p.ready).length===1,null,{timeout:90000});
 // This test measures protocol recovery, not GPU throughput. Software WebGL
 // renders at half density while retaining the full viewport/physical table.
 for(const p of pages)await p.frames().find(f=>f.url().includes('/overlay.html')).evaluate(()=>{const client=new URLSearchParams(location.search).get('client'),bus=new BroadcastChannel('com.obr-suite/workbench-dice3d.v1:local:'+client);bus.postMessage({type:'quality',value:.5});bus.close();});
 const completed=async id=>{for(const f of frames)await f.waitForFunction(id=>window.suiteHostProbe.events.some(e=>e.type==='log'&&e.event==='render-complete'&&e.detail.roll===id),id,{timeout:60000});};
 // Same local RPC used by the card's embedded quick-roll popup.
 if(!process.env.DICE235_GROUP_ONLY){
 const first=await frames[1].evaluate(async()=>{await window.suiteHostProbe.diceRpc('broadcast.sendMessage',['com.obr-suite/dice-quick-roll',{expression:'1d20+5',label:'快捷栏命中',itemId:null},{destination:'LOCAL'}],null,async()=>{});return window.suiteHostProbe.events.filter(e=>e.event==='roll-submitted').at(-1).detail.id;});
 await completed(first);const totals=await Promise.all(frames.map(f=>f.evaluate(id=>window.suiteHostProbe.results.find(r=>r.data.rollId===id).data.total,first)));assert.equal(totals[0],totals[1]);checks.push({case:'card/quickbar actual diceRpc → SDK → real physics → both full animations',totals});
 for(const fault of ['no-ready','lost-offer','late-chunks']){
  mode=fault;dropped=false;const result=await frames[0].evaluate(()=>window.suiteHostProbe.submitDice3d({expression:'1d20+2',label:'丢包复验',itemId:null}));
  await frames[0].waitForFunction(id=>window.suiteHostProbe.events.some(e=>e.event==='roll-start-scheduled'&&e.detail.id===id),result.rollId,{timeout:10000});
  const stage=await frames[0].evaluate(id=>window.suiteHostProbe.events.find(e=>e.event==='roll-start-scheduled'&&e.detail.id===id).detail,result.rollId);assert(stage.prepareWaitMs<7000);
  await completed(result.rollId);const peer=await frames[1].evaluate(id=>window.suiteHostProbe.results.find(r=>r.data.rollId===id).data,result.rollId);assert.equal(peer.total,result.total);checks.push({case:fault,prepareWaitMs:stage.prepareWaitMs,total:result.total});mode='normal';
 }
 const secret=await frames[1].evaluate(()=>window.suiteHostProbe.submitDice3d({expression:'1d6+5',visibility:'self',itemId:null}));await completed(secret.rollId);assert.equal(await frames[0].evaluate(id=>window.suiteHostProbe.results.some(r=>r.data.rollId===id),secret.rollId),false);checks.push({case:'private result remains restricted'});
 }
 const groups=await frames[0].evaluate(()=>window.suiteHostProbe.submitDice3dGroup([{expression:'1d20+3',itemId:null,label:'先攻 A'},{expression:'1d20+1',itemId:null,label:'先攻 B'}],'group-fixture-235'));for(const row of groups)await completed(row.rollId);checks.push({case:'group initiative/saves one shared real physics frontier',totals:groups.map(r=>r.total)});
 assert.deepEqual(errors,[]);for(const p of pages)assert.deepEqual(await p.evaluate(()=>window.fixture.errors),[]);
 await pages[0].screenshot({path:out+'/host.png'});writeFileSync(out+'/result.json',JSON.stringify({success:true,checks,errors,realSDK:true,realPhysics:true,softwareWebGL:true,realOwlbearRoom:false},null,2));console.log(JSON.stringify({success:true,checks,errors},null,2));
}catch(error){writeFileSync(out+'/failure.json',JSON.stringify({error:String(error),errors,checks,mode,stages:await Promise.all(pages.map(p=>p.frames().find(f=>f.url().includes('sdk-verify'))?.evaluate(()=>({state:window.suiteHostProbe?.events.filter(e=>e.type==='state').at(-1)?.state,hidden:document.hidden,events:window.suiteHostProbe?.events.filter(e=>e.type==='log'&&(!/^(render-|audio-)/.test(e.event)||/render-(complete|cancelled|frame-retry)$/.test(e.event))).slice(-45),fixture:parent.fixture?.errors}))))},null,2));throw error;}
finally{await context.close();await browser.close();await new Promise(r=>server.close(r));}
