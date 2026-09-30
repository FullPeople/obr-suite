import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('capacity retries do not spend registrations; orphan clients expire; auth and queue limits survive recovery',async()=>{
 process.env.PORT='0';process.env.RELAY_MAX_SESSIONS='2';process.env.RELAY_REGISTRATIONS_PER_HOUR='2';process.env.RELAY_HOST_TTL_MS='1000';process.env.RELAY_MAX_QUEUED_BYTES='1000';
 process.env.WORKBENCH_DATA_DIR=mkdtempSync(join(tmpdir(),'dnd-relay-test-'));
 const {server}=await import('../server/workbench-relay/server.mjs');await new Promise(r=>server.listening?r():server.once('listening',r));
 const realNow=Date.now;let now=realNow();Date.now=()=>now;
 const credentials=n=>({host:`host-${n}`.padEnd(64,'h'),client:`client-${n}`.padEnd(64,'c')});
 const a=credentials('a'),b=credentials('b'),c=credentials('c');
 const request=async(keys,role,body,secret=keys[role],ip='fixture-a')=>{const id=createHash('sha256').update(keys.host).digest('hex');const response=await fetch(`http://127.0.0.1:${server.address().port}/?session=${id}&role=${role}`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json','X-Real-IP':ip},body:JSON.stringify(body)});return {status:response.status,data:await response.json(),retry:response.headers.get('Retry-After')};};
 const register=(keys,ip)=>request(keys,'host',{register:true,clientKey:keys.client},keys.host,ip);
 try{
  assert.equal((await register(a)).status,200);assert.equal((await register(b,'fixture-b')).status,200);
  for(let i=0;i<35;i++){const r=await register(c);assert.equal(r.status,503);assert.equal(r.data.code,'SESSION_CAPACITY');assert.equal(r.retry,'15');}
  assert.equal((await request(a,'client',{type:'hello'},'wrong-key')).status,401);
  assert.equal((await request(a,'client',{sharedDocument:{operation:'read',key:'room_fixture'}})).status,403);
  now+=900;assert.equal((await request(a,'client',{type:'ping'})).status,200);
  now+=101;assert.equal((await register(c)).status,200); // client traffic did not keep orphan A alive
  assert.equal((await request(a,'client',{type:'ping'})).status,401);
  assert.equal((await register(a)).status,429); // two actual creations exhausted this IP's quota
  assert.equal((await request(c,'client',{type:'large',text:'x'.repeat(2000)})).status,429);
  assert.equal((await request(c,'client',{type:'hello'})).status,200);
  // Recovery of the same registered host does not consume a new allowance.
  assert.equal((await register(c)).status,200);
 }finally{Date.now=realNow;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
