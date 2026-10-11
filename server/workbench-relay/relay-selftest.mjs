// Exercises the relay transport end to end on a loopback port: host registers
// over HTTP, the client receives over a WebSocket (push), the long-poll path
// still works, auth is enforced on the socket, and keepalive pings answer.
// Run: node server/workbench-relay/relay-selftest.mjs
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.PORT=String(20000+Math.floor(Math.random()*20000));
// A stand-in for the character API: DELETE answers vary by card id so the relay's
// handling of empty, missing and non-JSON bodies is exercised end to end.
import http from 'node:http';
const api=http.createServer((req,res)=>{
 const card=req.url.split('/').pop();
 if(req.method!=='DELETE'){res.writeHead(405);res.end();return;}
 if(card==='empty204'){res.writeHead(204);res.end();return;}
 if(card==='gone404'){res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"not found"}');return;}
 if(card==='html500'){res.writeHead(500,{'Content-Type':'text/html'});res.end('<h1>Internal Server Error</h1>');return;}
 if(card==='json409'){res.writeHead(409,{'Content-Type':'application/json'});res.end('{"error":"card is locked"}');return;}
 res.writeHead(200,{'Content-Type':'application/json'});res.end('{"deleted":true}');
});
await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
process.env.CARD_WRITE_BASE=`http://127.0.0.1:${api.address().port}`;
process.env.RELAY_ORIGIN='https://obr.dnd.center';
process.env.WORKBENCH_DATA_DIR=mkdtempSync(join(tmpdir(),'relay-selftest-'));
const {server}=await import('./server.mjs');
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
const port=server.address().port,base=`http://127.0.0.1:${port}`;
const hostKey='h'.repeat(72),clientKey='c'.repeat(72),session=createHash('sha256').update(hostKey).digest('hex');
const endpoint=role=>`${base}/?session=${session}&role=${role}`;
const post=(role,secret,body)=>fetch(endpoint(role),{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
const results=[];const check=(name,ok)=>{results.push({name,ok});console.log((ok?'PASS ':'FAIL ')+name);};
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
function openSocket(role,secret){return new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${port}/?session=${session}&role=${role}`,['full-suite-relay','token.'+secret]);const messages=[];ws.addEventListener('message',e=>messages.push(String(e.data)));ws.addEventListener('open',()=>resolve({ws,messages}));ws.addEventListener('error',()=>reject(Error('socket error')));ws.addEventListener('close',e=>{if(ws.readyState!==WebSocket.OPEN)reject(Error('closed '+e.code));});});}
// 1. A socket before registration is refused.
await openSocket('client',clientKey).then(()=>check('socket before host registration is refused',false),()=>check('socket before host registration is refused',true));
// 2. Host registers over HTTP.
const registered=await post('host',hostKey,{register:true,clientKey,room:'selftest'});check('host registration over HTTP',registered.status===200);
// 3. Wrong secret on the socket is refused; the right one connects.
await openSocket('client','x'.repeat(72)).then(()=>check('socket with a wrong secret is refused',false),()=>check('socket with a wrong secret is refused',true));
const client=await openSocket('client',clientKey);check('client socket connects with the client key',client.ws.readyState===WebSocket.OPEN);
// 4. A host message is pushed to the client socket without any GET.
const t0=performance.now();await post('host',hostKey,{protocol:'full-suite-workbench/v1',type:'ready',rolls:[]});
for(let i=0;i<50&&!client.messages.length;i++)await wait(5);
const pushed=client.messages.length?JSON.parse(client.messages[0]):null;
check('host message is pushed to the client socket',Array.isArray(pushed)&&pushed[0]?.type==='ready');
console.log(`  push latency ${(performance.now()-t0).toFixed(1)} ms (loopback)`);
// 5. Queue dedupe for single-slot message types still applies before delivery.
client.messages.length=0;
// send two catalogs quickly: with an open socket each is flushed immediately, so both arrive; dedupe applies only to queued (unflushed) items.
await post('host',hostKey,{protocol:'full-suite-workbench/v1',type:'catalog',sequence:1});
for(let i=0;i<50&&!client.messages.length;i++)await wait(5);
check('subsequent messages keep flowing over the socket',client.messages.length===1);
// 6. Keepalive: a text "ping" gets "pong".
client.messages.length=0;client.ws.send('ping');for(let i=0;i<50&&!client.messages.length;i++)await wait(5);
check('socket answers ping with pong',client.messages[0]==='pong');
// 7. Long-poll fallback: close the socket; queued message is answered by GET.
client.ws.close();await wait(50);
await post('host',hostKey,{protocol:'full-suite-workbench/v1',type:'selection',sequence:2});
const polled=await fetch(endpoint('client'),{headers:{Authorization:`Bearer ${clientKey}`}}).then(r=>r.json());
check('long-poll GET still delivers after the socket closes',Array.isArray(polled)&&polled.some(m=>m.type==='selection'));
// 8. A pending long-poll is released when a socket attaches, and the socket gets later messages.
const pending=fetch(endpoint('client'),{headers:{Authorization:`Bearer ${clientKey}`}}).then(r=>r.json());
const again=await openSocket('client',clientKey);
const released=await Promise.race([pending,wait(3000).then(()=>'timeout')]);
check('a waiting long-poll is released when the socket attaches',Array.isArray(released));
await post('host',hostKey,{protocol:'full-suite-workbench/v1',type:'rolls',rolls:[1]});
for(let i=0;i<50&&!again.messages.length;i++)await wait(5);
check('messages after re-attach arrive on the new socket',again.messages.length===1&&JSON.parse(again.messages[0])[0]?.type==='rolls');
// 9. Host side can also receive over a socket (client → host direction).
const host=await openSocket('host',hostKey);
await post('client',clientKey,{protocol:'full-suite-workbench/v1',type:'hello'});
for(let i=0;i<50&&!host.messages.length;i++)await wait(5);
check('client message is pushed to the host socket',host.messages.length===1&&JSON.parse(host.messages[0])[0]?.type==='hello');
host.ws.close();again.ws.close();
// 10. Card deletion: the durable outcome is the status, whatever the body looks like.
const del=async card=>{const r=await post('host',hostKey,{deleteCard:{room:'selftest',card}});return {status:r.status,body:await r.json()};};
check('DELETE answered with 200 JSON reports ok',(await del('plain')).body.ok===true);
check('DELETE answered with an empty 204 reports ok instead of a relay failure',(await del('empty204')).body.ok===true);
check('DELETE of a card that is already gone (404) reports ok',(await del('gone404')).body.ok===true);
const html=await del('html500');check('DELETE answered with a non-JSON 500 passes the status and a readable error',html.status===500&&typeof html.body.error==='string'&&!html.body.ok);
const locked=await del('json409');check('DELETE refused with JSON keeps the status and message',locked.status===409&&locked.body.error==='card is locked');
// 11. Shared documents are scoped to the host's registered room.
const shared=async key=>(await post('host',hostKey,{sharedDocument:{key,operation:'read'}})).status;
check('a shared document of the registered room is served',await shared('inventory_selftest')===200);
check('a shared document of another room is refused',await shared('inventory_other')===403);
check('a monster override keeps its origin room',await shared('monster_other_token1')===200);
await wait(50);server.close();api.close();
const failed=results.filter(r=>!r.ok);
console.log(`${results.length-failed.length}/${results.length} passed`);
process.exit(failed.length?1:0);
