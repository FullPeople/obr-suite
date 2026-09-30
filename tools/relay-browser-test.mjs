import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const web=process.env.DND_CARD_WEB_ROOT,out=process.env.DND_RELAY_TEST_OUT;
assert(web&&out,'Set isolated Web checkout and evidence directory');mkdirSync(out,{recursive:true});
const requireWeb=createRequire(join(web,'package.json')),{chromium}=requireWeb('@playwright/test');
const {build}=await import(pathToFileURL(requireWeb.resolve('rolldown')).href);
await build({input:'fixture-entry',plugins:[{name:'fixture',resolveId(id){if(id==='fixture-entry')return '\0fixture';if(id==='suite-relay')return resolve('src/workbench/relay.ts');if(id==='web-relay')return join(web,'src/platform/relay.ts');},load(id){if(id==='\0fixture')return `import {Relay as Host} from 'suite-relay';import {Relay as Client} from 'web-relay';window.start=(session,hostKey,clientKey)=>{window.received=[];window.errors=[];window.host=new Host('/relay',session,'host',hostKey,m=>window.received.push(m),clientKey,undefined,'test-room',s=>window.errors.push(s));window.client=new Client('/relay',session,'client',clientKey,()=>{},undefined,undefined,undefined,s=>window.errors.push(s));window.timer=setInterval(()=>window.client.send({type:'hello',fixture:true}).catch(()=>{}),1000);};window.stop=()=>{clearInterval(window.timer);window.host.close();window.client.close();};`;}}],output:{file:join(out,'relay-fixture.js'),format:'esm'}});
process.env.PORT='5937';process.env.RELAY_ORIGIN='http://127.0.0.1:5937';process.env.RELAY_MAX_SESSIONS='1';process.env.RELAY_HOST_TTL_MS='10000';process.env.WORKBENCH_DATA_DIR=mkdtempSync(join(tmpdir(),'relay-browser-'));
const {server}=await import('../server/workbench-relay/server.mjs');await new Promise(r=>server.listening?r():server.once('listening',r));
const realNow=Date.now;let offset=0;Date.now=()=>realNow()+offset;
const hash=s=>createHash('sha256').update(s).digest('hex'),oldHost='old-fixture-host'.padEnd(64,'x'),oldClient='old-fixture-client'.padEnd(64,'y'),host='new-fixture-host'.padEnd(64,'x'),client='new-fixture-client'.padEnd(64,'y');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const registered=await fetch(`http://127.0.0.1:5937/relay?session=${hash(oldHost)}&role=host`,{method:'POST',headers:{Authorization:`Bearer ${oldHost}`},body:JSON.stringify({register:true,clientKey:oldClient})});assert.equal(registered.status,200);
 const page=await browser.newPage();await page.route('**/fixture.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Relay recovery fixture</title><script type="module" src="/relay-fixture.js"></script>'}));await page.route('**/relay-fixture.js',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(join(out,'relay-fixture.js'),'utf8')}));
 const statuses=[];page.on('response',r=>{if(r.url().includes('/relay?'))statuses.push(r.status());});await page.goto('http://127.0.0.1:5937/fixture.html');await page.waitForFunction(()=>!!window.start);await page.evaluate(args=>window.start(...args),[hash(host),host,client]);
 await page.waitForFunction(()=>window.errors.some(s=>s.status===503)&&window.errors.some(s=>s.status===401));offset=20000;
 await page.waitForFunction(()=>window.received.some(m=>m.type==='hello'&&m.fixture),{},{timeout:35000});
 const denied=await fetch(`http://127.0.0.1:5937/relay?session=${hash(host)}&role=client`,{headers:{Authorization:'Bearer wrong-fixture-secret'}});assert.equal(denied.status,401);
 const result={passed:true,fixtureOnly:true,recoveredAfterCapacity:true,invalidCredentialRejected:true,statusCounts:Object.fromEntries([...new Set(statuses)].map(status=>[status,statuses.filter(s=>s===status).length]))};writeFileSync(join(out,'browser-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await page.evaluate(()=>window.stop());
}finally{Date.now=realNow;await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
