import assert from 'node:assert/strict';
import {request} from 'node:http';
import {once} from 'node:events';
import {createHash,randomBytes} from 'node:crypto';
import {coalescedQueue,pruneIdleViews,queueLimit} from '../server/workbench-relay/queue-policy.mjs';
process.env.PORT='0';process.env.RELAY_MAX_QUEUED_BYTES='16384';
const {server,relayLoad}=await import('../server/workbench-relay/server.mjs');
if(!server.listening)await once(server,'listening');
const port=server.address().port;
const key=randomBytes(32).toString('hex'),client=randomBytes(32).toString('hex'),session=createHash('sha256').update(key).digest('hex');
function post(body,role='host'){
 return new Promise((resolve,reject)=>{const data=JSON.stringify(body),req=request({host:'127.0.0.1',port,path:`/?session=${session}&role=${role}`,method:'POST',headers:{Authorization:'Bearer '+(role==='host'?key:client),'Content-Length':Buffer.byteLength(data),'Content-Type':'application/json'}},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});req.on('error',reject);req.end(data);});
}
const held=[];
try{
 assert.equal((await post({register:true,clientKey:client})).status,200);
 for(let i=0;i<2;i++){
  const req=request({host:'127.0.0.1',port,path:`/?session=${session}&role=host`,method:'POST',headers:{Authorization:'Bearer '+key,'Content-Length':20000}},res=>res.resume());req.on('error',()=>{});req.write('{"padding":"'+'.'.repeat(5000));held.push(req);
 }
 for(let i=0;i<100&&relayLoad().activePosts!==2;i++)await new Promise(r=>setImmediate(r));assert.equal(relayLoad().activePosts,2);
 assert.equal((await post({type:'ack',requestId:'roll-one',ok:true})).status,200);
 assert.equal((await post({type:'ack',requestId:'roll-two',ok:true})).status,200);
 held.splice(0).forEach(r=>r.destroy());
 for(let i=0;i<100&&relayLoad().activePosts;i++)await new Promise(r=>setImmediate(r));assert.equal(relayLoad().activePosts,0);
 // Fill view capacity without consuming the reserved receipt budget.
 let refused=false;for(let i=0;i<20;i++){const reply=await post({type:'cacheSnapshot',state:{key:'card-'+i},document:{padding:'.'.repeat(1800)}});if(reply.status===429){refused=true;break;}}
 assert(refused);assert.equal((await post({type:'ack',requestId:'after-full-views',ok:true})).status,200);
 assert(relayLoad().queuedBytes<=16384);
 const old={queue:[{type:'catalog'},{type:'ack',requestId:'durable'},{type:'save',requestId:'mutation'}],lastSeen:0,wait:null};assert(pruneIdleViews(old,120000));assert.deepEqual(old.queue.map(m=>m.type),['ack','save']);
 const active={queue:[{type:'catalog'}],lastSeen:0,socket:{open:true}};assert.equal(pruneIdleViews(active,120000),false);
 assert.equal(coalescedQueue([{type:'ack',requestId:'same',ok:true}],{type:'ack',requestId:'same',ok:true},'host').length,1);
 assert(queueLimit(16384,true)<queueLimit(16384,false));
 console.log(JSON.stringify({passed:true,bulkPostsHeld:2,consecutiveReceiptsWhileBusy:2,receiptAfterViewQueueFull:true,orphanViewsReclaimed:true,commandsAndReceiptsPreserved:true,queueBudgetUnchanged:true}));
}finally{held.forEach(r=>r.destroy());server.closeAllConnections();await new Promise(r=>server.close(r));}
