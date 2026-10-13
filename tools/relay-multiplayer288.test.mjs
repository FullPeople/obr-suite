import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {storageLane} from '../server/workbench-relay/admission.mjs';

test('storage queues are finite, abortable, FIFO, and recover after timeout',async()=>{
 const lane=storageLane(1,2,40),first=await lane.acquire(),controller=new AbortController();
 const cancelled=lane.acquire(controller.signal),waiting=lane.acquire();
 assert.equal(await lane.acquire(),null);controller.abort();assert.equal(await cancelled,null);
 first();const next=await waiting;assert.equal(typeof next,'function');
 assert.equal(await lane.acquire(),null);next();assert.deepEqual(lane.stats(),{active:0,queued:0});
});

test('two slow saves do not block control messages or shared reads; card CAS remains enforced',async()=>{
 const room='capacity288',documents=new Map(['a','b'].map(id=>[id,{schema_version:'0.3',identity:{character_name:id},_suiteRevision:0}]));
 let entered=0,releaseReads;const blocked=new Promise(resolve=>releaseReads=resolve);
 const backend=http.createServer(async(req,res)=>{
  const id=new URL(req.url,'http://fixture').pathname.split('/')[req.method==='GET'?3:4];
  if(req.method==='GET'){entered++;await blocked;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(documents.get(id)));}
  else{const parts=[];for await(const part of req)parts.push(part);documents.set(id,JSON.parse(Buffer.concat(parts)));res.end('{"ok":true}');}
 });
 await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
 process.env.PORT='0';process.env.RELAY_MAX_ACTIVE_POSTS='2';process.env.WORKBENCH_DATA_DIR=mkdtempSync(join(tmpdir(),'relay288-'));
 process.env.CARD_READ_BASE=process.env.CARD_WRITE_BASE=`http://127.0.0.1:${backend.address().port}`;
 const {server}=await import('../server/workbench-relay/server.mjs');await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const host='synthetic-host-288'.padEnd(64,'h'),client='synthetic-client-288'.padEnd(64,'c'),session=createHash('sha256').update(host).digest('hex');
 const endpoint=`http://127.0.0.1:${server.address().port}/relay?session=${session}&role=host`;
 const post=async body=>{const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+host,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 let saves=[];
 try{
  assert.equal((await post({register:true,clientKey:client,room})).status,200);
  saves=['a','b'].map(id=>{const previous=documents.get(id);return post({saveCard:{room,card:id,inventoryRoom:room,expected:createHash('sha256').update(JSON.stringify(previous)).digest('hex'),data:{...previous,_suiteRevision:1}}});});
  const deadline=Date.now()+3000;while(entered<2&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(entered,2);
  const started=performance.now();assert.equal((await post({type:'pong'})).status,200);
  assert.equal((await post({sharedDocument:{key:'inventory_'+room,operation:'read'}})).status,200);
  assert(performance.now()-started<500,'control and reads waited behind saves');
  releaseReads();assert.deepEqual((await Promise.all(saves)).map(value=>value.status),[200,200]);
  assert.equal(documents.get('a')._suiteRevision,1);assert.equal(documents.get('b')._suiteRevision,1);
  const stale=await post({saveCard:{room,card:'a',inventoryRoom:room,expected:'0'.repeat(64),data:documents.get('a')}});
  assert.equal(stale.status,409);
  assert.equal((await post({sharedDocument:{key:'inventory_other',operation:'read'}})).status,403);
 }finally{releaseReads();await Promise.allSettled(saves);server.closeAllConnections();backend.closeAllConnections();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>backend.close(resolve))]);}
});
