// The actual relay process receives synthetic documents; no player store is used.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..'),out=join(root,'.local-evidence/relay-memory');mkdirSync(out,{recursive:true});
const serverUrl=pathToFileURL(join(root,'server/workbench-relay/server.mjs')).href;
const child=spawn(process.execPath,['--max-old-space-size=96','--max-semi-space-size=4','--input-type=module','-e',`const {server}=await import(${JSON.stringify(serverUrl)});await new Promise(r=>server.listening?r():server.once('listening',r));process.send({port:server.address().port});setInterval(()=>process.send({rss:process.memoryUsage().rss,peak:process.resourceUsage().maxRSS*1024}),10).unref();`],{env:{...process.env,PORT:'0',WORKBENCH_DATA_DIR:mkdtempSync(join(tmpdir(),'relay-memory-')),RELAY_REGISTRATIONS_PER_HOUR:'100'},stdio:['ignore','pipe','pipe','ipc']});
let rss=0,peak=0,stderr='';child.stderr.on('data',bytes=>stderr+=bytes.toString());child.on('message',m=>{rss=Math.max(rss,m.rss||0);peak=Math.max(peak,m.peak||0);});
const port=await new Promise((resolve,reject)=>{child.on('message',m=>{if(m.port)resolve(m.port);});child.on('exit',(code,signal)=>reject(Error(`Relay exited ${code}/${signal}: ${stderr}`)));});
const accounts=Array.from({length:4},(_,i)=>{const host='synthetic-memory-host-'+i+'h'.repeat(64),client='synthetic-memory-client-'+i+'c'.repeat(64);return {host,client,id:createHash('sha256').update(host).digest('hex')};});
const url=(a,role)=>`http://127.0.0.1:${port}/?session=${a.id}&role=${role}`;
const post=(a,body)=>fetch(url(a,'host'),{method:'POST',headers:{Authorization:'Bearer '+a.host,'Content-Type':'application/json'},body});
const hold=a=>{const request=http.request(url(a,'host'),{method:'POST',headers:{Authorization:'Bearer '+a.host,'Content-Type':'application/json'}},response=>response.resume());request.on('error',()=>{});request.write('{');return request;};
try{
 for(const a of accounts)assert.equal((await post(a,JSON.stringify({register:true,clientKey:a.client}))).status,200);
 const held=[hold(accounts[0]),hold(accounts[1])];await new Promise(r=>setTimeout(r,100));const busy=await post(accounts[2],'{}');assert.equal(busy.status,503);assert.equal((await busy.json()).code,'REQUEST_CAPACITY');held.forEach(r=>r.destroy());await new Promise(r=>setTimeout(r,100));assert.equal((await post(accounts[2],'{}')).status,200);
 const payload=JSON.stringify({type:'catalog',data:'x'.repeat(8*1024*1024)});let accepted=0,rejected=0;
 for(let round=0;round<6;round++){
  const polls=accounts.map(a=>fetch(url(a,'client'),{headers:{Authorization:'Bearer '+a.client,'Accept-Encoding':'gzip'},signal:AbortSignal.timeout(3000)}).then(r=>r.arrayBuffer()).catch(()=>null));
  await Promise.all(accounts.map(a=>post(a,payload).then(async r=>{await r.arrayBuffer();if(r.status===200)accepted++;else {assert([429,503].includes(r.status));rejected++;}}).catch(error=>{assert(/fetch failed|socket|reset/i.test(String(error)));rejected++;})));
  await Promise.all(polls);
 }
 assert(accepted>0&&rejected>0);await new Promise(r=>setTimeout(r,100));assert.equal(child.exitCode,null);
 const measured=Math.max(rss,process.platform==='win32'?0:peak);assert(measured<256*1024*1024,`Relay exceeded its 256 MiB service limit: ${measured}`);
 const result={requestAdmission:true,admissionRecoversAfterDisconnect:true,accepted,rejected,maxRssBytes:measured,nodeHeapMiB:96,semiSpaceMiB:4,serviceLimitMiB:256,syntheticDocuments:true,playerData:false};writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{child.kill();}
