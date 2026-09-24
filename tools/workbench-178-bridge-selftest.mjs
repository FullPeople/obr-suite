import {build} from 'rolldown';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

// Real browser origin / opener / iframe lifecycle test. No Owlbear SDK mock:
// this measures only the browser transport, not scene writes or API latency.
const out=process.env.BRIDGE178_OUT||'F:/CodexWork/2026-09-20/w-xu/bridge178';
mkdirSync(out,{recursive:true});
const {chromium,expect}=createRequire('D:/Desktop/DND-card-web/package.json')('@playwright/test');
for(const variant of ['baseline','candidate'])await build({input:resolve('src/workbench/launcher.ts'),plugins:[{name:'env',transform(code,id){if(variant==='baseline'&&id.replaceAll('\\','/').endsWith('/workbench/launcher.ts'))code=code.replace(/\/\/ BEGIN persistent-room-opener[\s\S]*?\/\/ END persistent-room-opener/,'');return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');}}],output:{file:join(out,`launcher-${variant}.js`),format:'esm'}});
const origin='http://127.0.0.1:5497',roomOrigin='http://localhost:5497',protocol='full-suite-workbench/v1';
const sandbox='allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';
const sources=Object.fromEntries(['baseline','candidate'].map(variant=>[variant,readFileSync(join(out,`launcher-${variant}.js`),'utf8')]));
let mode='baseline';
const client=`
const p='${protocol}',session='bridge178',origin='${origin}';window.messages=[];window.host=null;window.times=[];
window.addEventListener('message',e=>{if(e.origin!==origin||e.data?.protocol!==p)return;window.messages.push(e.data);if(e.data.type==='ready')window.host=e.source;if(e.data.type==='pong')window.times.push(performance.now()-e.data.started);});
function discover(w,depth=0){if(depth>3)return;try{w.postMessage({protocol:p,type:'hello',session},origin);for(let i=0;i<Math.min(w.length,64);i++)discover(w.frames[i],depth+1);}catch{}}
window.findHost=()=>{if(window.opener)discover(window.opener.parent)};window.findHost();
window.measure=async(n=100)=>{window.times=[];for(let i=0;i<n;i++){const count=window.times.length;window.host.postMessage({protocol:p,session,type:'ping',started:performance.now()},origin);await new Promise((resolve,reject)=>{const limit=Date.now()+500;function check(){if(window.times.length>count)resolve();else if(Date.now()>limit)reject(Error('ping timeout'));else setTimeout(check,0)}check()});}return window.times;};
`;
const host=`
const p='${protocol}',session='bridge178',origin='${origin}';window.addEventListener('message',e=>{if(e.origin!==origin||e.data?.protocol!==p)return;const m=e.data;if(m.type==='discover')e.source.postMessage({protocol:p,type:'background',nonce:m.nonce,session,clientKey:'test'},origin);if(m.type==='hello')e.source.postMessage({protocol:p,type:'ready',session},origin);if(m.type==='ping')e.source.postMessage({protocol:p,type:'pong',session,started:m.started},origin)});
`;
const server=createServer((req,res)=>{
const path=new URL(req.url,origin).pathname;res.setHeader('Content-Type','text/html');
if(path==='/'){res.end(`<iframe id="bg" sandbox="${sandbox}" src="${origin}/background.html"></iframe><iframe id="launcher" sandbox="${sandbox}" src="${origin}/launcher.html"></iframe>`);return;}
if(path==='/launcher.html'){res.end(`<a id="open" rel="opener">Open</a><span id="status"></span><script type="module" src="/launcher.js"></script>`);return;}
if(path==='/launcher.js'){res.setHeader('Content-Type','text/javascript');res.end(sources[mode]);return;}
if(path==='/background.html'){res.end(`<script>${host}</script>`);return;}
if(path==='/suite-dev/workbench/index.html'){res.end(`<script>${client}</script>`);return;}
res.writeHead(404);res.end();});
await new Promise(r=>server.listen(5497,'0.0.0.0',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
const results={browser:browser.version(),at:new Date().toISOString(),scope:'Cross-site top page and sandboxed same-origin sibling iframes. Browser transport only; no Owlbear network claim.',cases:[]};
try{
for(const variant of ['baseline','candidate']){
mode=variant;const context=await browser.newContext();const room=await context.newPage();await room.goto(roomOrigin);
const launcher=room.frameLocator('#launcher');await launcher.locator('#open[href]').waitFor();
const event=context.waitForEvent('page');await launcher.locator('#open').click();const tab=await event;await tab.waitForLoadState();await expect.poll(()=>tab.evaluate(()=>!!window.host)).toBe(true);
const before=await tab.evaluate(()=>({openerClosed:window.opener?.closed,openerIsTop:window.opener===window.opener?.top}));
await room.locator('#launcher').evaluate(el=>el.remove());
const samples=await tab.evaluate(()=>window.measure(150));samples.sort((a,b)=>a-b);
await room.reload();await expect.poll(()=>room.frames().some(f=>f.url().includes('background.html'))).toBe(true);
await tab.evaluate(()=>{window.host=null;window.findHost();});await new Promise(r=>setTimeout(r,300));const reloadReconnected=await tab.evaluate(()=>!!window.host);
await tab.reload();await tab.waitForLoadState();await new Promise(r=>setTimeout(r,100));const bothReloadedConnected=await tab.evaluate(()=>!!window.host);
const item={variant,...before,p50:samples[Math.floor(samples.length*.50)],p95:samples[Math.floor(samples.length*.95)],max:Math.max(...samples),afterActionRemovedWorks:true,reloadReconnected,bothReloadedConnected};results.cases.push(item);console.log(item);if(variant==='candidate')assert(reloadReconnected,'persistent room opener must rediscover fresh host after full room reload');await context.close();
}
// A copied / browser-noopener link deliberately has no local window authority.
const context=await browser.newContext();const copied=await context.newPage();await copied.goto(origin+'/suite-dev/workbench/index.html');assert.equal(await copied.evaluate(()=>window.opener),null);assert.equal(await copied.evaluate(()=>window.host),null);results.cases.push({variant:'copied-link',localAuthority:false,requiredFallback:'authenticated network transport'});await context.close();
writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
