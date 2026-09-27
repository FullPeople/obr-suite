import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {WebSocketServer,WebSocket} from 'ws';
import {createGame,applyAction,applyEdit,projectPublic,projectSeat,projectOmniscient,checkInvariants} from '../../extensions/three-dragon-ante/src/game/rules/index.ts';
import {validGameSetup} from '../../extensions/three-dragon-ante/src/game/setup.ts';
import {packPublic,packSeat,unpackPublicHistoryEntry} from '../../extensions/three-dragon-ante/src/game/wire.ts';
import {packOmniscient} from '../../extensions/three-dragon-ante/src/game/local-view.ts';
import {objectPatch} from '../../extensions/three-dragon-ante/src/game/server-protocol.ts';
import {readHandGesture} from '../../extensions/three-dragon-ante/src/game/gesture.ts';

const random=n=>randomBytes(n).toString('hex'),hash=v=>createHash('sha256').update(v).digest('hex');
const text=(v,max=128)=>typeof v==='string'&&v.length>0&&v.length<=max;
const fail=code=>{throw Error(code);};
const stage=g=>!g?'lobby':g.stage==='ended'?'ended':'playing';
const trimGame=game=>game?{...game,history:(game.history||[]).slice(-24),historyComplete:false,accepted:{}}:null;
const cleanName=v=>String(v||'玩家').replace(/[\u0000-\u001f]/g,'').slice(0,60)||'玩家';
export function createTableService({database,origin='https://obr.dnd.center',maxRooms=20,maxSockets=180,injectFailure,hostGraceMs=8000}={}){
 if(database!==':memory:')mkdirSync(dirname(database),{recursive:true,mode:0o700});
 const db=new DatabaseSync(database);db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,join_hash TEXT NOT NULL,state TEXT NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,token_hash TEXT UNIQUE NOT NULL,name TEXT NOT NULL,external_id TEXT NOT NULL,role TEXT NOT NULL,challenge TEXT NOT NULL,gm_until INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS credentials(room TEXT NOT NULL,token_hash TEXT PRIMARY KEY,member TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS receipts(room TEXT NOT NULL,member TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(room,member,id));
 CREATE TABLE IF NOT EXISTS history(room TEXT NOT NULL,game TEXT NOT NULL,sequence INTEGER NOT NULL,entry TEXT NOT NULL,PRIMARY KEY(room,game,sequence));`);
 if(!db.prepare('PRAGMA table_info(members)').all().some(c=>c.name==='gm_until'))db.exec('ALTER TABLE members ADD COLUMN gm_until INTEGER NOT NULL DEFAULT 0');
 const sockets=new Map(),rooms=new Map(),rates=new Map(),hostTimers=new Map();let closing=false;
 const stmt={room:db.prepare('SELECT * FROM rooms WHERE id=?'),member:db.prepare('SELECT m.* FROM members m JOIN credentials c ON c.member=m.id WHERE c.room=? AND c.token_hash=?'),members:db.prepare('SELECT * FROM members WHERE room=?'),save:db.prepare('UPDATE rooms SET state=?,updated=? WHERE id=?'),receipt:db.prepare('SELECT * FROM receipts WHERE room=? AND member=? AND id=?'),saveReceipt:db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)'),history:db.prepare('INSERT OR REPLACE INTO history VALUES(?,?,?,?)')};
 function rate(key,max,interval=60000){const now=Date.now();let r=rates.get(key);if(!r||now-r.at>interval){r={at:now,n:0};rates.set(key,r);}if(++r.n>max)fail('rateLimited');}
 function load(id){const row=stmt.room.get(id);if(!row)fail('roomMissing');return rooms.get(id)||JSON.parse(row.state);}
 function member(room,token){if(!text(token,64)||!/^[a-f0-9]{64}$/.test(token))fail('notAllowed');const m=stmt.member.get(room,hash(token));if(!m)fail('notAllowed');return m;}
 function transaction(run){db.exec('BEGIN IMMEDIATE');try{const result=run();injectFailure?.();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 const roleOf=m=>m.role==='GM'&&m.gm_until>Date.now()?'GM':'PLAYER';
 const admin=(state,m)=>state.table.hostPlayerId===m.id||roleOf(m)==='GM';
 function send(ws,value,compress=true){if(ws.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>512000){ws.close(1013,'slowConsumer');return;}ws.send(JSON.stringify(value),{compress});}
 function view(ctx){
  const s=load(ctx.room),m=member(ctx.room,ctx.token),seat=s.table.seats.find(p=>p.playerId===m.id),isHost=s.table.hostPlayerId===m.id;
  if(ctx.receipt&&ctx.receipt.gameId!==s.game?.id)ctx.receipt=null;
  const live=s.game?{...s.game,history:(s.game.history||[]).slice(-4),historyComplete:false}:null;
  let game=null;if(live)game=ctx.inspect&&admin(s,m)?packOmniscient(projectOmniscient(live,seat?.seatId||''),12000):seat?packSeat(projectSeat(live,seat.seatId),12000):packPublic(projectPublic(live),12000);
  ctx.member=m.id;
  return {actionReceiptVersion:1,table:s.table,selfPlayerId:m.id,isHost,role:roleOf(m),canEdit:admin(s,m),canKick:admin(s,m),canHandover:isHost&&s.table.seats.some(p=>p.playerId!==m.id),connected:true,pending:false,game,...(m.role==='PENDING'?{message:'admissionPending'}:{}),...(ctx.receipt?{actionReceipt:ctx.receipt}:{})};
 }
 function publish(ctx,full=false){const next=view(ctx),seq=ctx.seq+1;
  if(full||!ctx.last){const m=member(ctx.room,ctx.token);send(ctx.ws,{type:'view',seq,view:next,identity:{memberId:m.id,challenge:m.challenge,role:next.role,owner:next.isHost,admitted:m.role!=='PENDING'}});}
  else{
   const {game,...root}=next,{game:oldGame,...oldRoot}=ctx.last;
   const patch=objectPatch(oldRoot,root),gamePatch=game&&oldGame?objectPatch(oldGame,game):undefined;
   if(!patch.remove.length&&!Object.keys(patch.set).length&&gamePatch&&!gamePatch.remove.length&&!Object.keys(gamePatch.set).length)return;
   send(ctx.ws,{type:'patch',base:ctx.seq,seq,patch,...(gamePatch?{gamePatch}:{game})});
  }
  ctx.seq=seq;ctx.last=next;
 }
 function publishRoom(id){for(const ctx of sockets.values())if(ctx.room===id)try{publish(ctx);}catch{ctx.ws.close(1011,'publicationFailed');}}
 function successor(id,state,previous){
  const online=new Set([...sockets.values()].filter(c=>c.room===id&&c.ws.readyState===WebSocket.OPEN).map(c=>c.member));
  const members=stmt.members.all(id).filter(m=>m.id!==previous&&m.role!=='PENDING'&&online.has(m.id));
  return members.find(m=>roleOf(m)==='GM')||state.table.seats.map(s=>members.find(m=>m.id===s.playerId)).find(Boolean);
 }
 function checkHost(id){
  if(closing)return;
  const state=load(id),online=[...sockets.values()].some(c=>c.room===id&&c.member===state.table.hostPlayerId&&c.ws.readyState===WebSocket.OPEN);
  if(online){clearTimeout(hostTimers.get(id));hostTimers.delete(id);return;}
  if(hostTimers.has(id)||!successor(id,state,state.table.hostPlayerId))return;
  // A refresh or a second window must not hand away ownership. Once the
  // grace expires, persist only ownership; cards, seats and receipts stay intact.
  hostTimers.set(id,setTimeout(()=>{
   hostTimers.delete(id);if(closing)return;
   try{
    const current=load(id);
    if([...sockets.values()].some(c=>c.room===id&&c.member===current.table.hostPlayerId&&c.ws.readyState===WebSocket.OPEN))return;
    const nextHost=successor(id,current,current.table.hostPlayerId);if(!nextHost)return;
    const next={...current,table:{...current.table,hostPlayerId:nextHost.id,hostName:nextHost.name,revision:current.table.revision+1}};
    transaction(()=>stmt.save.run(JSON.stringify(next),Date.now(),id));rooms.set(id,next);publishRoom(id);
   }catch(error){console.warn('[three-dragon] automatic host transfer pending',error);checkHost(id);}
  },hostGraceMs));
 }
 function command(ctx,message){
  const {id,command:cmd}=message;if(!text(id,128)||!cmd||typeof cmd.type!=='string')fail('invalidCommand');
  const m=member(ctx.room,ctx.token),s=load(ctx.room),fingerprint=JSON.stringify(cmd),duplicate=stmt.receipt.get(ctx.room,m.id,id);
  if(duplicate){if(duplicate.fingerprint!==fingerprint)fail('invalidCommand');const response=JSON.parse(duplicate.response);if(response.actionReceipt)ctx.receipt=response.actionReceipt;publish(ctx,true);send(ctx.ws,response);return;}
  const owner=s.table.hostPlayerId===m.id,seat=s.table.seats.find(p=>p.playerId===m.id);
  if(cmd.type==='history'){
   if(!s.game||!Number.isSafeInteger(cmd.before)||cmd.before<1)fail('invalidCommand');
   let entries=db.prepare('SELECT entry FROM history WHERE room=? AND game=? AND sequence<? ORDER BY sequence DESC LIMIT 40').all(ctx.room,s.game.id,cmd.before).map(r=>unpackPublicHistoryEntry(JSON.parse(r.entry))).reverse();
   while(entries.length>1&&Buffer.byteLength(JSON.stringify(entries))>40000)entries.shift();
   send(ctx.ws,{type:'history',id,page:{gameId:s.game.id,before:cmd.before,entries,historyStartSequence:entries[0]?.sequence||0,historyComplete:entries[0]?.sequence===1||!entries.length}});return;
  }
  if(cmd.type==='omniscient'||cmd.type==='inspect'){
   if(!admin(s,m))fail('notAllowed');ctx.inspect=cmd.enabled===true;publish(ctx,true);send(ctx.ws,{type:'ack',id,ok:true});return;
  }
  let next={...s,table:structuredClone(s.table),game:s.game},actionReceipt;
  if(cmd.type==='join'){
   if(m.role==='PENDING')fail('privateSync');
   if(stage(s.game)==='playing')fail('gameStarted');if(!seat){if(s.table.seats.length>=6)fail('tableFull');next.table.seats.push({playerId:m.id,seatId:m.id,name:m.name});}
  }else if(cmd.type==='leave'||cmd.type==='kick'){
   const playing=stage(s.game)==='playing';if(playing&&(cmd.type!=='leave'||!owner))fail('cannotLeave');const target=cmd.type==='leave'?m.id:cmd.playerId;
   if(cmd.type==='kick'&&!admin(s,m)||target===s.table.hostPlayerId&&cmd.type==='kick')fail('notAllowed');
   if(!playing)next.table.seats=next.table.seats.filter(p=>p.playerId!==target);
   if(target===next.table.hostPlayerId){const peer=successor(ctx.room,s,m.id);if(playing&&!peer)fail('noSuccessor');if(peer){next.table.hostPlayerId=peer.id;next.table.hostName=peer.name;}}
  }else if(cmd.type==='handover'){
   if(!owner)fail('notHost');const peers=[...sockets.values()].filter(c=>c.room===ctx.room&&c.member!==m.id).map(c=>member(c.room,c.token));
   const successor=peers.find(p=>roleOf(p)==='GM')||peers.find(p=>s.table.seats.some(seat=>seat.playerId===p.id));if(!successor)fail('noSuccessor');next.table.hostPlayerId=successor.id;next.table.hostName=successor.name;
  }else if(cmd.type==='start'||cmd.type==='newGame'){
   if(!owner)fail('notHost');if(cmd.type==='newGame')next.game=null;
   else{if(s.game)fail('gameStarted');if(s.table.seats.length<2)fail('tooFewPlayers');if(!validGameSetup(cmd.options))fail('invalidCommand');next.game=createGame({...cmd.options,id:random(16),seats:s.table.seats.map(p=>({id:p.seatId,name:p.name}))});next.table.variant=next.game.variant;}
   ctx.receipt=undefined;
  }else if(cmd.type==='action'){
   const a=cmd.action;if(!seat||!a||a.seatId!==seat.seatId||!s.game||cmd.gameId!==s.game.id||!text(a.id,128))fail('notAllowed');
   // The durable idempotency key also protects retries sent under a new envelope ID.
   const actionKey='action:'+s.game.id+':'+a.id,old=stmt.receipt.get(ctx.room,m.id,actionKey);
   if(old){if(old.fingerprint!==JSON.stringify(a))fail('invalidCommand');actionReceipt=JSON.parse(old.response).actionReceipt;ctx.receipt=actionReceipt;publish(ctx,true);send(ctx.ws,{type:'ack',id,ok:true,actionReceipt});return;}
   const applied=applyAction(s.game,a);if(!applied.ok)fail(applied.error.code);next.game=applied.state;
   actionReceipt={actionId:a.id,tableId:s.table.id,gameId:s.game.id,revision:next.game.revision,ok:true,source:'host'};
  }else if(cmd.type==='edit'){
   if(!admin(s,m)||!s.game||cmd.gameId!==s.game.id)fail('notAllowed');next.game=applyEdit(s.game,cmd.edit);if(!next.game)fail('invalidEdit');
  }else fail('invalidCommand');
  next.table.revision++;next.table.stage=stage(next.game);
  const entries=next.game?.history||[];next={...next,game:trimGame(next.game)};
  if(next.game&&checkInvariants(next.game).length)fail('invalidState');
  const response={type:'ack',id,ok:true,...(actionReceipt?{actionReceipt}:{})};
  // Both action receipt keys and public history share the same durable commit.
  transaction(()=>{
   for(const e of entries)stmt.history.run(ctx.room,next.game.id,e.sequence,JSON.stringify(e));
   stmt.save.run(JSON.stringify(next),Date.now(),ctx.room);
   stmt.saveReceipt.run(ctx.room,m.id,id,fingerprint,JSON.stringify(response));
   if(actionReceipt)stmt.saveReceipt.run(ctx.room,m.id,'action:'+s.game.id+':'+cmd.action.id,JSON.stringify(cmd.action),JSON.stringify(response));
  });rooms.set(ctx.room,next);if(actionReceipt)ctx.receipt=actionReceipt;
  publishRoom(ctx.room);send(ctx.ws,response);
 }
 function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
 async function body(req){let bytes=0,parts=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>16000)fail('payloadTooLarge');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
 const server=createServer(async(req,res)=>{
  try{
   if(req.headers.origin&&req.headers.origin!==origin)fail('notAllowed');
   if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',origin);
   if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600'});res.end();return;}
   const path=new URL(req.url,'http://localhost').pathname.replace(/^\/three-dragon-api\/v1/,'');
   if(req.method==='GET'&&path==='/health'){json(res,200,{ok:true,protocol:1});return;}
   if(req.method!=='POST'){json(res,405,{});return;}
   const ip=String(req.headers['x-real-ip']||req.socket.remoteAddress||'');rate('http:'+ip,480);const b=await body(req);
   if(path==='/rooms'){
    rate('create:'+ip,30,3600000);const id=random(16),joinKey=random(32),token=random(32),memberId=random(16),challenge=random(24),name=cleanName(b.name);
    const state={table:{version:1,id,hostPlayerId:memberId,hostConnectionId:'server',hostName:name,stage:'lobby',seats:[{playerId:memberId,seatId:memberId,name}],revision:1},game:null};
    transaction(()=>{db.prepare('INSERT INTO rooms VALUES(?,?,?,?)').run(id,hash(joinKey),JSON.stringify(state),Date.now());db.prepare('INSERT INTO members(id,room,token_hash,name,external_id,role,challenge) VALUES(?,?,?,?,?,?,?)').run(memberId,id,hash(token),name,String(b.externalId||'').slice(0,128),'PLAYER',challenge);db.prepare('INSERT INTO credentials VALUES(?,?,?)').run(id,hash(token),memberId);});
    json(res,201,{room:{version:1,id,joinKey},session:{roomId:id,memberId,token,role:'PLAYER',owner:true,challenge}});return;
   }
   const match=/^\/rooms\/([a-f0-9]{32})\/(sessions|grants)$/.exec(path);if(!match)fail('invalidCommand');const [,id,op]=match,row=stmt.room.get(id);if(!row)fail('roomMissing');
   if(op==='sessions'){
    if(!text(b.joinKey,64)||hash(b.joinKey)!==row.join_hash)fail('notAllowed');
    if(stmt.members.all(id).length>=64)fail('tableFull');const token=random(32),memberId=random(16),challenge=random(24);
    transaction(()=>{db.prepare('INSERT INTO members(id,room,token_hash,name,external_id,role,challenge) VALUES(?,?,?,?,?,?,?)').run(memberId,id,hash(token),cleanName(b.name),String(b.externalId||'').slice(0,128),'PENDING',challenge);db.prepare('INSERT INTO credentials VALUES(?,?,?)').run(id,hash(token),memberId);});
    json(res,201,{roomId:id,memberId,token,role:'PLAYER',owner:false,challenge});return;
   }
   const m=member(id,(req.headers.authorization||'').replace(/^Bearer /,'')),s=load(id);if(s.table.hostPlayerId!==m.id)fail('notAllowed');
   const target=db.prepare('SELECT * FROM members WHERE room=? AND id=?').get(id,b.memberId);
   if(!target||target.challenge!==b.challenge||target.external_id!==b.externalId)fail('notAllowed');
   if(!['GM','PLAYER'].includes(b.role))fail('notAllowed');
   const existing=db.prepare("SELECT * FROM members WHERE room=? AND external_id=? AND role!='PENDING' AND id!=?").get(id,target.external_id,target.id);
   transaction(()=>{
    if(existing){db.prepare('UPDATE credentials SET member=? WHERE member=?').run(existing.id,target.id);db.prepare('DELETE FROM members WHERE id=?').run(target.id);}
    db.prepare('UPDATE members SET role=?,gm_until=? WHERE id=?').run(b.role,b.role==='GM'?Date.now()+60000:0,(existing||target).id);
   });for(const ctx of sockets.values())if(ctx.room===id)try{publish(ctx,true);}catch{ctx.ws.close(1011,'publicationFailed');}json(res,200,{ok:true});
  }catch(error){const code=['notAllowed','roomMissing','invalidCommand','payloadTooLarge','rateLimited','tableFull'].includes(error.message)?error.message:'requestFailed';json(res,['notAllowed','roomMissing'].includes(code)?403:400,{error:code});}
 });
 const wss=new WebSocketServer({noServer:true,maxPayload:16000,perMessageDeflate:{threshold:1024,serverNoContextTakeover:true,clientNoContextTakeover:true,concurrencyLimit:2,zlibDeflateOptions:{level:3,memLevel:4}}});
 server.on('upgrade',(req,socket,head)=>{
  if(closing||req.headers.origin!==origin||new URL(req.url,'http://localhost').pathname!=='/three-dragon-api/v1/socket'||wss.clients.size>=maxSockets){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
 });
 wss.on('connection',ws=>{
  let ctx;const authTimer=setTimeout(()=>ws.close(1008,'authenticationRequired'),5000);ws.on('error',()=>{});ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true;});
  ws.on('message',raw=>{
   let message;try{
    message=JSON.parse(raw.toString());
    if(!ctx){
     if(message.type!=='auth'||!text(message.room,32))fail('notAllowed');const m=member(message.room,message.token);
     if(!rooms.has(m.room)&&rooms.size>=maxRooms)fail('roomFull');rooms.set(m.room,load(m.room));
     if([...sockets.values()].filter(c=>c.member===m.id).length>=3)fail('tooManyWindows');
     ctx={ws,room:m.room,member:m.id,token:message.token,inspect:false,seq:0,last:null,receipt:null,gesture:null};sockets.set(ws,ctx);clearTimeout(authTimer);publish(ctx,true);checkHost(m.room);return;
    }
    rate('ws:'+ctx.member,90,10000);
    if(message.type==='sync'){publish(ctx,true);return;}
    if(message.type==='gesture'){
     const g=readHandGesture(message.gesture),s=load(ctx.room),seat=s.table.seats.find(p=>p.playerId===ctx.member);
     if(g&&seat&&s.game&&g.gameId===s.game.id&&g.revision===s.game.revision&&g.count===s.game.seats.find(p=>p.id===seat.seatId)?.hand.length)ctx.gesture={seatId:seat.seatId,gesture:g};return;
    }
    if(message.type!=='command')fail('invalidCommand');command(ctx,message);
   }catch(error){
    if(!ctx){ws.close(1008,'notAllowed');return;}
    const id=text(message?.id,128)?message.id:undefined,cmd=message?.command;
    let actionReceipt;
    if(cmd?.type==='action'&&text(cmd.action?.id,128)){const s=load(ctx.room);actionReceipt={actionId:cmd.action.id,tableId:s.table.id,gameId:s.game?.id||'',revision:cmd.action.revision,ok:false,code:error.message,source:'host',retryable:['storageFailed','database is locked'].includes(error.message)};ctx.receipt=actionReceipt;publish(ctx);}
    send(ws,{type:'ack',id,ok:false,code:error.message,...(actionReceipt?{actionReceipt}:{})});
   }
  });
  ws.on('close',()=>{clearTimeout(authTimer);sockets.delete(ws);if(ctx){const peers=[...sockets.values()].filter(c=>c.room===ctx.room);if(!peers.length)rooms.delete(ctx.room);else if(ctx.gesture)for(const c of peers)send(c.ws,{type:'gestures',values:[{...ctx.gesture,gesture:{...ctx.gesture.gesture,hover:null,selected:[],slap:false}}]},false);checkHost(ctx.room);}});
 });
 const gestures=setInterval(()=>{
  const groups=new Map();for(const ctx of sockets.values())if(ctx.gesture){const values=groups.get(ctx.room)||[];values.push(ctx.gesture);groups.set(ctx.room,values);ctx.gesture=null;}
  for(const [id,values] of groups)for(const ctx of sockets.values())if(ctx.room===id&&ctx.ws.bufferedAmount<32000)send(ctx.ws,{type:'gestures',values},false);
 },250);
 const pulse=setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();const ctx=sockets.get(ws);if(ctx&&ctx.last?.role==='GM'&&roleOf(member(ctx.room,ctx.token))!=='GM')publish(ctx,true);}for(const [key,r] of rates)if(Date.now()-r.at>3600000)rates.delete(key);},15000);
 return {server,db,stats:()=>({rooms:rooms.size,sockets:sockets.size}),async close(){closing=true;clearInterval(gestures);clearInterval(pulse);for(const timer of hostTimers.values())clearTimeout(timer);hostTimers.clear();for(const ws of wss.clients)ws.terminate();await new Promise(done=>server.close(done));wss.close();db.close();}};
}
