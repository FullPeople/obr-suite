import assert from 'node:assert/strict';
import {request} from 'node:http';
import {once} from 'node:events';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'rolldown';

process.env.PORT='0';
const {server,relayLoad}=await import('../server/workbench-relay/server.mjs');
if(!server.listening)await once(server,'listening');
const port=server.address().port,key=randomBytes(32).toString('hex'),client=randomBytes(32).toString('hex'),session=createHash('sha256').update(key).digest('hex');
const url=`http://127.0.0.1:${port}/`,protocol='full-suite-workbench/v1';
const out=resolve('workbench-test-output/relay-capacity');mkdirSync(out,{recursive:true});
const file=resolve(out,'relay.mjs');await build({input:resolve('src/workbench/relay.ts'),platform:'node',output:{file,format:'esm'}});
const {Relay}=await import(pathToFileURL(file).href);
const nativeFetch=globalThis.fetch,statuses=[],held=[];let relay;
globalThis.fetch=async(...args)=>{const response=await nativeFetch(...args);if(args[1]?.method==='POST')statuses.push(response.status);return response;};
const wait=async(predicate,label)=>{for(let index=0;index<300&&!predicate();index++)await new Promise(r=>setTimeout(r,5));assert(predicate(),label);};
function holdBodies(){
 for(let index=0;index<2;index++){
  const req=request({host:'127.0.0.1',port,path:`/?session=${session}&role=host`,method:'POST',headers:{Authorization:'Bearer '+key,'Content-Length':20000}},response=>response.resume());
  req.on('error',()=>{});req.write('{"padding":"'+'.'.repeat(5000));held.push(req);
 }
}
function release(){held.splice(0).forEach(req=>req.destroy());}
try{
 relay=new Relay(url,session,'host',key,()=>{},client);
 await relay.send({protocol,type:'ack',requestId:'initial',ok:true});
 holdBodies();await wait(()=>relayLoad().activePosts===2,'Two real streaming requests must occupy bulk admission');
 const rejected=statuses.filter(status=>status===503).length;
 await assert.rejects(relay.send({protocol,type:'cacheSnapshot',expiresAt:Date.now()+900,document:{padding:'.'.repeat(10000)}}),error=>error.code==='REQUEST_CAPACITY'&&error.notSent===true);
 assert.equal(statuses.filter(status=>status===503).length,rejected+1);
 const receiptAt=Date.now();await relay.send({protocol,type:'ack',requestId:'while-bulk-busy',ok:true});assert(Date.now()-receiptAt<1000,'A failed view must not globally pause the reserved small receipt lane');
 const large={protocol,type:'ack',requestId:'large-receipt',ok:true,result:{padding:'.'.repeat(12000)}};
 const sending=relay.send(large);await wait(()=>statuses.filter(status=>status===503).length===rejected+2,'The first large ACK must meet real capacity rejection');
 release();await sending;
 const response=await nativeFetch(`${url}?session=${session}&role=client`,{headers:{Authorization:'Bearer '+client}}),messages=await response.json();
 assert.deepEqual(messages.map(row=>row.requestId),['initial','while-bulk-busy','large-receipt']);assert.equal(messages.filter(row=>row.requestId==='large-receipt').length,1);
 holdBodies();await wait(()=>relayLoad().activePosts===2,'Bulk admission must be occupied again');
 let allowed=true,checks=0;const forbidden=relay.send({protocol,type:'stats',requestId:'revoked-before-retry',expiresAt:Date.now()+5000,padding:'.'.repeat(10000)},()=>{checks++;if(!allowed)throw Error('permission changed');});
 const denied=forbidden.catch(error=>error);await wait(()=>checks===1,'Initial final-send guard must run');await wait(()=>statuses.filter(status=>status===503).length===rejected+3,'Rejected command must not reach the peer');allowed=false;release();
 const error=await denied;assert.equal(error.notSent,true);assert.match(error.message,/permission changed/);assert.equal(checks,2);
 console.log(JSON.stringify({passed:true,realHTTP:true,bulkRequestsHeld:2,smallReceiptUnaffected:true,largeReceiptRecoveredExactlyOnce:true,retryRechecksAuthority:true,originalCapacityLimits:true,realOwlbear:false}));
}finally{
 release();relay?.close();globalThis.fetch=nativeFetch;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
