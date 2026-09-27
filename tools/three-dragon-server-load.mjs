// Bounded isolated load: no production database, room or existing relay is used.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import WebSocket from '../server/three-dragon/node_modules/ws/wrapper.mjs';
const origin='http://load.test',self=fileURLToPath(import.meta.url),folder=process.env.TDA_SERVER_OUT||dirname(self);
if(process.argv[2]==='--service'){
 const {createTableService}=await import(pathToFileURL(join(folder,'service.mjs')));
 const service=createTableService({database:process.argv[3],origin}),lag=monitorEventLoopDelay({resolution:10});lag.enable();
 let cpu=process.cpuUsage(),at=performance.now();
 await new Promise(r=>service.server.listen(0,'127.0.0.1',r));process.send({port:service.server.address().port});
 process.on('message',async message=>{
  if(message==='reset'){cpu=process.cpuUsage();at=performance.now();lag.reset();process.send({reset:true});}
  if(message==='stats'){const used=process.cpuUsage(cpu);process.send({stats:{...service.stats(),rss:process.memoryUsage().rss,cpuOneCorePercent:(used.user+used.system)/1000/(performance.now()-at)*100,eventLoopP95Ms:lag.percentile(95)/1e6,eventLoopMaxMs:lag.max/1e6}});}
  if(message==='stop'){await service.close();process.exit(0);}
 });
}else{
 const evidence=mkdtempSync(join(tmpdir(),'tda-load203-')),child=fork(self,['--service',join(evidence,'load.sqlite')],{stdio:['ignore','inherit','inherit','ipc']}),clients=[],rooms=[],times=[];
 const receive=key=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('IPC timeout '+key)),15000);const handler=m=>{if(key in m){clearTimeout(timer);child.off('message',handler);resolve(m[key]);}};child.on('message',handler);});
 const wait=async check=>{const end=Date.now()+12000;while(!check()){if(Date.now()>end)throw Error('Timed out');await new Promise(r=>setTimeout(r,2));}};
 const patch=(v,p)=>{const next={...v,...p.set};for(const key of p.remove)delete next[key];return next;};
 try{
  const port=await receive('port'),url='http://127.0.0.1:'+port+'/three-dragon-api/v1';
  const post=async(path,data,token)=>{const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  async function connect(s){const ws=new WebSocket(url.replace('http:','ws:')+'/socket',{origin,perMessageDeflate:true}),c={ws,s,view:null,pending:new Map(),raw:0};clients.push(c);
   ws.on('message',data=>{c.raw+=data.length;const m=JSON.parse(data);if(m.type==='view')c.view=m.view;else if(m.type==='patch')c.view={...patch(c.view,m.patch),game:m.gamePatch?patch(c.view.game,m.gamePatch):m.game};else if(m.type==='ack')c.pending.get(m.id)?.(m);});
   await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});ws.send(JSON.stringify({type:'auth',room:s.roomId,token:s.token}));await wait(()=>c.view);return c;
  }
  async function command(c,command){const id=crypto.randomUUID(),at=performance.now();const response=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Command timeout')),12000);c.pending.set(id,m=>{clearTimeout(timer);c.pending.delete(id);resolve(m);});});c.ws.send(JSON.stringify({type:'command',id,command}));const result=await response;assert.equal(result.ok,true,JSON.stringify(result));return performance.now()-at;}
  for(let table=0;table<20;table++){
   const {room,session}=await post('/rooms',{name:'Host '+table,externalId:'h'+table}),players=[await connect(session)];
   for(let i=1;i<6;i++){const externalId='p'+table+'-'+i,s=await post('/rooms/'+room.id+'/sessions',{joinKey:room.joinKey,name:externalId,externalId});await post('/rooms/'+room.id+'/grants',{memberId:s.memberId,challenge:s.challenge,externalId,role:'PLAYER'},session.token);const c=await connect(s);await command(c,{type:'join'});players.push(c);}
   await command(players[0],{type:'start',options:{startingGold:200,variant:{ruleSetId:'provided-pack-20260910',deckId:'wheel-of-fate-v1'}}});await wait(()=>players.every(c=>c.view.game));rooms.push(players);
  }
  const rawBefore=clients.reduce((n,c)=>n+c.raw,0),wireBefore=clients.reduce((n,c)=>n+c.ws._socket.bytesRead,0),reset=receive('reset');child.send('reset');await reset;const start=performance.now();
  // Twenty simultaneous tables each execute forty rules-legal actions, with a
  // 200ms inter-action pause: substantially above ordinary human turn frequency.
  await Promise.all(rooms.map(async players=>{for(let i=0;i<40;i++){
   await wait(()=>players.some(c=>c.view.game.actions?.length));const actor=players.find(c=>c.view.game.actions?.length),g=actor.view.game,o=g.actions[0],a={id:crypto.randomUUID(),revision:g.revision,seatId:g.selfSeatId,kind:o.kind};
   if(o.kind==='choose'){a.choiceId=o.choice.id;a.optionIds=o.choice.options.filter(o=>o.id!=='skip').slice(0,Math.max(o.choice.min,Math.min(1,o.choice.max))).map(o=>o.id);}else a.cardId=o.cardIds[i%o.cardIds.length];
   times.push(await command(actor,{type:'action',gameId:g.id,action:a}));await new Promise(r=>setTimeout(r,200));
  }}));
  const duration=(performance.now()-start)/1000,statsPromise=receive('stats');child.send('stats');const stats=await statsPromise;times.sort((a,b)=>a-b);
  const compressedBytes=clients.reduce((n,c)=>n+c.ws._socket.bytesRead,0)-wireBefore,rawBytes=clients.reduce((n,c)=>n+c.raw,0)-rawBefore;
  const result={...stats,actions:times.length,durationSeconds:duration,actionsPerSecond:times.length/duration,p50Ms:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],maxMs:Math.max(...times),compressedBytes,rawBytes,serverOutputMbps:compressedBytes*8/duration/1e6,scope:'20 tables / 120 real WebSocket connections; separate server process and temporary SQLite database. Loopback latency, not player WAN latency.'};
  writeFileSync(join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));console.log(evidence);
 }finally{for(const c of clients)c.ws.terminate();child.send('stop');await new Promise(r=>child.once('exit',r));}
}
