import http from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {documentStore} from './documents.mjs';
import {fileURLToPath} from 'node:url';
import {gzip,createGunzip} from 'node:zlib';
import {applyDocumentChanges} from './patches.mjs';
const sharedDocuments=documentStore(process.env.WORKBENCH_DATA_DIR||fileURLToPath(new URL('./data/',import.meta.url)));
const writes=new Map(),registrations=new Map();
async function serialized(key,run){const task=(writes.get(key)||Promise.resolve()).catch(()=>{}).then(run);writes.set(key,task);try{return await task;}finally{if(writes.get(key)===task)writes.delete(key);}}
const sessions=new Map(),origin=process.env.RELAY_ORIGIN||'https://obr.dnd.center';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const hash=s=>createHash('sha256').update(s).digest('hex');
function reply(res,status,data){if(res.writableEnded||res.destroyed)return;const text=JSON.stringify(data),headers={'Content-Type':'application/json','Cache-Control':'no-store'};if(text.length>4096&&res.compress){gzip(text,{level:4},(error,bytes)=>{if(res.writableEnded||res.destroyed)return;if(!error){headers['Content-Encoding']='gzip';headers.Vary='Accept-Encoding';}res.writeHead(status,headers);res.end(error?text:bytes);});}else{res.writeHead(status,headers);res.end(text);}}
function flush(box){if(box.wait&&box.queue.length){clearTimeout(box.wait.timer);reply(box.wait.res,200,box.queue.splice(0));box.wait=null;}}
const server=http.createServer(async(req,res)=>{
 res.compress=/\bgzip\b/.test(req.headers['accept-encoding']||'');
 if(req.headers.origin&&req.headers.origin!==origin)return reply(res,403,{error:'origin'});
 if(req.method==='OPTIONS')return reply(res,405,{});
 try{
  const url=new URL(req.url,'http://localhost'),id=url.searchParams.get('session'),role=url.searchParams.get('role'),secret=req.headers.authorization?.replace(/^Bearer /,'');
  if(!/^[a-f0-9]{64}$/.test(id||'')||!['host','client'].includes(role)||!secret||secret.length>128)return reply(res,401,{});
  let body={};if(req.method==='POST'){const stream=req.headers['content-encoding']==='gzip'?req.pipe(createGunzip()):req;let size=0;const chunks=[];for await(const part of stream){size+=part.length;if(size>10_000_000){reply(res,413,{});req.destroy();return;}chunks.push(part);}body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
  let session=sessions.get(id);
  if(role==='host'&&hash(secret)===id&&req.method==='POST'&&body.register){
   if(typeof body.clientKey!=='string'||body.clientKey.length<40)return reply(res,400,{});
   if(body.room!==undefined&&!/^[a-zA-Z0-9_-]+$/.test(body.room||''))return reply(res,400,{});
   if(!session){const ip=String(req.headers['x-real-ip']||req.socket.remoteAddress||''),record=registrations.get(ip)||{count:0,time:Date.now()};if(Date.now()-record.time>3600000){record.count=0;record.time=Date.now();}if(++record.count>30)return reply(res,429,{});registrations.set(ip,record);if(sessions.size>=100)return reply(res,503,{});session={hostKey:secret,clientKey:body.clientKey,host:{queue:[],wait:null},client:{queue:[],wait:null},touched:Date.now()};sessions.set(id,session);}
   if(body.room){if(session.room&&session.room!==body.room)return reply(res,409,{error:'宿主房间已改变'});session.room=body.room;}
  }
  if(!session||!equal(secret,role==='host'?session.hostKey:session.clientKey))return reply(res,401,{});
  session.touched=Date.now();const box=session[role];
  if(req.method==='POST'&&body.createCard){
   if(role!=='host')return reply(res,403,{});
   const {room,uploader,data}=body.createCard;
   if(!/^[a-zA-Z0-9_-]+$/.test(room||'')||data?.schema_version!=='0.3'||typeof data.identity?.character_name!=='string')return reply(res,400,{});
   const result=await fetch(`${process.env.CARD_WRITE_BASE||'http://127.0.0.1:5001'}/api/character/create-from-json?${new URLSearchParams({room,uploader:String(uploader||'').slice(0,40)})}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
   return reply(res,result.status,await result.json());
  }
  if(req.method==='POST'&&body.sharedDocument){
   if(role!=='host')return reply(res,403,{});
   try{const m=body.sharedDocument,write=()=>sharedDocuments(m);return reply(res,200,await (m.operation==='write'&&m.key?.startsWith('inventory_')?serialized('room:'+m.key.slice('inventory_'.length),write):write()));}catch(error){if(!error.status)console.error('sharedDocument storage failure',{key:body.sharedDocument?.key,operation:body.sharedDocument?.operation,phase:error.storagePhase,code:error.code,syscall:error.syscall,renameAttempts:error.renameAttempts,cleanupCode:error.cleanupCode,message:error.message});return reply(res,error.status||500,{error:error.status?error.message:'共享资料保存失败'});}
  }
  if(req.method==='POST'&&body.deleteCard){
   if(role!=='host')return reply(res,403,{});
   const {room,card}=body.deleteCard;if(!/^[a-zA-Z0-9_-]+$/.test(room||'')||!/^[a-zA-Z0-9_-]+$/.test(card||''))return reply(res,400,{});
   const key='card:'+room+':'+card,task=(writes.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{const result=await fetch(`${process.env.CARD_WRITE_BASE||'http://127.0.0.1:5001'}/api/character/${room}/${card}`,{method:'DELETE',signal:AbortSignal.timeout(60000)});reply(res,result.status===404?200:result.status,result.status===404?{ok:true}:await result.json());});writes.set(key,task);try{await task;}finally{if(writes.get(key)===task)writes.delete(key);}return;
  }
  if(req.method==='POST'&&body.saveCard){
   if(role!=='host')return reply(res,403,{});
   const {room,card,expected,changes,inventoryGuard}=body.saveCard;let {data}=body.saveCard;const inventoryRoom=body.saveCard.inventoryRoom||room;if(!/^[a-zA-Z0-9_-]+$/.test(room||'')||!/^[a-zA-Z0-9_-]+$/.test(card||'')||!/^[a-zA-Z0-9_-]+$/.test(inventoryRoom)||!(data?.schema_version==='0.3'||Array.isArray(changes))||!/^[a-f0-9]{64}$/.test(expected||''))return reply(res,400,{});
   // Document location can be the original upload room. Its projection still
   // shares a lock with the current host's inventory, bound at registration.
   if(inventoryGuard&&inventoryRoom!==(session.room||room))return reply(res,403,{error:'库存房间与宿主不一致'});
   const key='card:'+room+':'+card,task=(writes.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{const commit=async()=>{
    if(inventoryGuard){if(inventoryGuard.key!=='inventory_'+inventoryRoom||!Number.isSafeInteger(inventoryGuard.revision))return reply(res,400,{error:'无效库存投影凭证'});const ledger=await sharedDocuments({key:inventoryGuard.key,operation:'read'});if(ledger.revision!==inventoryGuard.revision)return reply(res,409,{error:'库存投影已过期，请使用最新库存重试'});}
    const current=await fetch(`${process.env.CARD_READ_BASE||'https://obr.dnd.center'}/characters/${room}/${card}/data.json`,{signal:AbortSignal.timeout(15000)});if(!current.ok)return reply(res,502,{error:'read failed'});
    const currentData=await current.json();if(hash(JSON.stringify(currentData))!==expected)return reply(res,409,{error:'角色已被其他客户端修改，请刷新后重试'});
    if(changes){try{data=applyDocumentChanges(currentData,changes);}catch{return reply(res,400,{error:'角色增量无效'});}if(data?.schema_version!=='0.3')return reply(res,400,{error:'角色格式无效'});}
    const result=await fetch(`${process.env.CARD_WRITE_BASE||'http://127.0.0.1:5001'}/api/character/${room}/${card}/data`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(60000)});reply(res,result.status,await result.json());};if(inventoryGuard)await serialized('room:'+inventoryRoom,commit);else await commit();
   });writes.set(key,task);try{await task;}finally{if(writes.get(key)===task)writes.delete(key);}return;
  }
  if(req.method==='GET'){
   if(box.wait){clearTimeout(box.wait.timer);reply(box.wait.res,200,[]);}
   const timer=setTimeout(()=>{if(box.wait?.res===res){box.wait=null;reply(res,200,[]);}},20000);box.wait={res,timer};res.on('close',()=>{if(box.wait?.res===res){clearTimeout(timer);box.wait=null;}});flush(box);
  }else if(req.method==='POST'){
   if(!body.register){const peer=session[role==='host'?'client':'host'];if(peer.queue.length>=96)return reply(res,429,{});if(role==='host'&&['ready','catalog','selection','rolls'].includes(body.type))peer.queue=peer.queue.filter(m=>m.type!==body.type);if(peer.queue.reduce((n,m)=>n+JSON.stringify(m).length,0)+JSON.stringify(body).length>12_000_000)return reply(res,429,{});peer.queue.push(body);flush(peer);}reply(res,200,{ok:true});
  }else reply(res,405,{});
 }catch(error){reply(res,error instanceof SyntaxError?400:500,{error:error instanceof SyntaxError?'invalid message':'relay operation failed'});}
});
const sweep=setInterval(()=>{for(const [id,s] of sessions)if(Date.now()-s.touched>3600000){for(const key of ['host','client'])if(s[key].wait){clearTimeout(s[key].wait.timer);reply(s[key].wait.res,410,{});}sessions.delete(id);}},60000);sweep.unref();
server.listen(Number(process.env.PORT||5012),'127.0.0.1');
export {server};
