import {withRequestTimeout} from '../request-timeout';
import {wireBody} from './wire';
export type RelayState={status:number;message:string;retryAt:number};
// Register before any host request; never replay an uncertain data mutation.
const SOCKET_PROTOCOL='full-suite-relay';
const SOCKET_RETRY_MS=[15000,30000,60000,120000,300000];
const SOCKET_OPEN=1;
export class Relay {
 private stopped=false;private active=false;private abort=new AbortController();private registration?:Promise<void>;private retryAt=0;private failures=0;private lastError?:Error&{status:number};
 constructor(private url:string,private session:string,private role:'host'|'client',private secret:string,private receive:(message:any)=>void,private clientKey?:string,private alive?:()=>void,private room?:string,private changed?:(state:RelayState)=>void){void this.poll();}
 private socket?:WebSocket;private socketClosed?:Promise<void>;private socketFailures=0;private socketRetryAt=0;private socketNotice=false;
 private endpoint(){return `${this.url}?${new URLSearchParams({session:this.session,role:this.role})}`;}
 private failed(status:number,message:string,retryAfter:string|null){
  if(status===401||status===410)this.active=false;
  const serverDelay=Number(retryAfter),delay=Number.isFinite(serverDelay)&&serverDelay>0?Math.min(serverDelay*1000,3600000):Math.min(30000,1400*2**Math.min(this.failures++,5));
  this.retryAt=Math.max(this.retryAt,Date.now()+delay);this.lastError=Object.assign(Error(message),{status,retryAfterMs:this.retryAt-Date.now()});this.changed?.({status,message,retryAt:this.retryAt});return this.lastError;
 }
 private async response(r:Response,operation=false){
  const data=await r.json().catch(()=>({}));if(!r.ok){
   // Admission failure belongs to this delivery. A busy view must not pause receipts.
   if(operation&&[429,503].includes(r.status)&&['REQUEST_CAPACITY','QUEUE_CAPACITY'].includes(data.code)){
    const seconds=Number(r.headers.get('Retry-After'));
    throw Object.assign(Error(data.error||'中继正在处理其他请求'),{status:r.status,code:data.code,notSent:true,retryAfterMs:Number.isFinite(seconds)&&seconds>0?Math.min(seconds*1000,30000):1000});
   }
   // A rejected operation is not a broken connection. In particular, a CAS 409
   // must allow its caller to read the new revision; pausing the whole relay
   // would make that read (and unrelated saves) repeat the previous error.
   if(operation&&[400,403,404,409,422].includes(r.status))throw Object.assign(Error(data.error||'中继操作被拒绝'),{status:r.status});
   throw this.failed(r.status,data.error||(r.status===401||r.status===410?'宿主会话尚未就绪或凭证已失效，请从枭熊房间重新打开工作台':r.status===429?'中继请求过于频繁，正在等待重试':r.status===503?'中继容量暂满，正在等待恢复':'中继连接暂不可用'),r.headers.get('Retry-After'));
  }
  this.retryAt=0;this.failures=0;this.lastError=undefined;this.alive?.();return data;
 }
 private async post(message:any,beforeSend?:()=>void|Promise<void>){
  if(Date.now()<this.retryAt)throw Object.assign(Error(this.lastError?.message||'中继连接暂不可用'),{status:this.lastError?.status,notSent:true});
  const encoded=await wireBody(message);
  // Registration and compression can suspend long enough for an owner grant
  // to be revoked. Recheck immediately before transmitting the mutation.
  try{await beforeSend?.();}catch(error){throw Object.assign(error instanceof Error?error:Error(String(error)),{notSent:true});}
  return withRequestTimeout(60000,this.abort.signal,async signal=>this.response(await fetch(this.endpoint(),{method:'POST',headers:{Authorization:`Bearer ${this.secret}`,...encoded.headers},body:encoded.body as BodyInit,signal}),!message?.register));
 }
 private async register(){
  if(this.role!=='host'||this.active)return;
  if(!this.registration)this.registration=this.post({register:true,clientKey:this.clientKey,...(this.room?{room:this.room}:{})}).then(()=>{this.active=true;}).finally(()=>{this.registration=undefined;});
  await this.registration;
 }
 async send(message:any,beforeSend?:()=>void|Promise<void>){
  try{await this.register();}catch(error){throw Object.assign(error instanceof Error?error:Error(String(error)),{notSent:true});}
  const retryable=message?.protocol==='full-suite-workbench/v1'&&typeof message.type==='string'&&!['ready','catalog','selection','rolls','directory','access','cacheSnapshot','groupRollState'].includes(message.type);
  const receipt=retryable&&message.type==='ack'&&typeof message.requestId==='string';
  // Unknown transmission may repeat a receipt, never a business command.
  const deadline=Math.min(Date.now()+10000,typeof message?.expiresAt==='number'?message.expiresAt:Infinity);
  for(;;){try{return await this.post(message,beforeSend);}catch(error){
   const failure=error as Error&{status?:number;notSent?:boolean;code?:string;retryAfterMs?:number};
   const delay=failure.retryAfterMs||1000;
   const safe=!!failure.notSent&&['REQUEST_CAPACITY','QUEUE_CAPACITY'].includes(failure.code||'')||receipt&&(!failure.status||failure.status===429||failure.status>=500);
   if(this.stopped||!retryable||!safe||Date.now()+delay>=deadline)throw error;
   await this.pause(delay);
   if(this.stopped)throw error;
  }}
 }
 private async pause(ms:number){await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);this.abort.signal.removeEventListener('abort',finish);resolve();},timer=setTimeout(finish,ms);if(this.abort.signal.aborted)finish();else this.abort.signal.addEventListener('abort',finish,{once:true});});}
 private deliver(text:string){let batch:unknown;try{batch=JSON.parse(text);}catch{return;}if(Array.isArray(batch))for(const message of batch)this.receive(message);}
 private openSocket(){
  if(this.socket||typeof WebSocket==='undefined'||Date.now()<this.socketRetryAt)return;
  const refused=()=>{this.socketRetryAt=Date.now()+SOCKET_RETRY_MS[Math.min(this.socketFailures++,SOCKET_RETRY_MS.length-1)];};
  let socket:WebSocket;
  try{socket=new WebSocket(this.endpoint().replace(/^http/,'ws'),[SOCKET_PROTOCOL,'token.'+this.secret]);}catch{refused();return;}
  this.socket=socket;let opened=false;
  const closeOnAbort=()=>{try{socket.close(1000);}catch{}};
  this.abort.signal.addEventListener('abort',closeOnAbort,{once:true});
  const openTimer=setTimeout(()=>{if(!opened)try{socket.close();}catch{}},8000);
  this.socketClosed=new Promise<void>(resolve=>{
   socket.onopen=()=>{opened=true;clearTimeout(openTimer);this.socketFailures=0;this.alive?.();if(!this.socketNotice){this.socketNotice=true;console.info('[workbench] relay socket connected');}};
   socket.onmessage=event=>{this.alive?.();if(event.data==='pong')return;this.deliver(String(event.data));};
   socket.onerror=()=>{};
   socket.onclose=()=>{clearTimeout(openTimer);this.abort.signal.removeEventListener('abort',closeOnAbort);if(this.socket===socket){this.socket=undefined;this.socketClosed=undefined;}if(!opened)refused();resolve();};
  });
 }
 private async poll(){while(!this.stopped){try{
  if(Date.now()<this.retryAt){await this.pause(this.retryAt-Date.now());if(this.stopped)break;}
  await this.register();
  if(this.socket?.readyState===SOCKET_OPEN){await this.socketClosed;continue;}
  this.openSocket();
  const messages=await withRequestTimeout(45000,this.abort.signal,async signal=>this.response(await fetch(this.endpoint(),{headers:{Authorization:`Bearer ${this.secret}`},cache:'no-store',signal})));
  for(const message of messages)this.receive(message);
 }catch(error){if(!this.stopped){if(!(error as any)?.status)this.failed(0,'中继连接暂不可用，正在重新连接',null);await this.pause(Math.max(100,this.retryAt-Date.now()));}}}}
 close(){this.stopped=true;this.abort.abort();}
}
