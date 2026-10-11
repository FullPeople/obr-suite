import {withRequestTimeout} from '../request-timeout';
import {wireBody} from './wire';
// Poll liveness is independent of expensive character hydration.
//
// Receive path: the HTTP long-poll that always worked, plus a WebSocket opened
// in the background whenever the proxy forwards the Upgrade header. While the
// socket is open the loop stops polling and a queued message is pushed the
// moment it arrives; a refused upgrade costs nothing but a later retry. Sends
// stay HTTP POST because operations need a reply.
const SOCKET_PROTOCOL='full-suite-relay';
const SOCKET_RETRY_MS=[15000,30000,60000,120000,300000];
const SOCKET_OPEN=1;
export class Relay {
 private stopped=false;private active=false;private abort=new AbortController();
 private socket?:WebSocket;private socketClosed?:Promise<void>;private socketFailures=0;private socketRetryAt=0;private socketNotice=false;
 constructor(private url:string,private session:string,private role:'host'|'client',private secret:string,private receive:(message:any)=>void,private clientKey?:string,private alive?:()=>void,private room?:string){void this.poll();}
 private endpoint(){return `${this.url}?${new URLSearchParams({session:this.session,role:this.role})}`;}
 async send(message:any){
  const encoded=await wireBody(message);
  return withRequestTimeout(60000,this.abort.signal,async signal=>{
   const r=await fetch(this.endpoint(),{method:'POST',headers:{Authorization:`Bearer ${this.secret}`,...encoded.headers},body:encoded.body as BodyInit,signal});
   const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||(r.status===409?'资料已被其他客户端修改，请刷新后重试':'连接暂不可用')),{status:r.status});this.alive?.();return data;
  });
 }
 private deliver(text:string){let batch:any;try{batch=JSON.parse(text);}catch{return;}if(Array.isArray(batch))for(const message of batch)this.receive(message);}
 /** Opens the push socket in the background; the poll loop idles while it is open. */
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
  if(this.role==='host'&&!this.active){await this.send({register:true,clientKey:this.clientKey,...(this.room?{room:this.room}:{})});this.active=true;}
  // The server releases a waiting long-poll with [] when the socket attaches,
  // so this loop reaches the idle branch within one round trip of the upgrade.
  if(this.socket?.readyState===SOCKET_OPEN){await this.socketClosed;continue;}
  this.openSocket();
  const messages=await withRequestTimeout(45000,this.abort.signal,async signal=>{
   const r=await fetch(this.endpoint(),{headers:{Authorization:`Bearer ${this.secret}`},cache:'no-store',signal});
   if(!r.ok){this.active=false;throw Error('relay');}return r.json();
  });
  this.alive?.();for(const message of messages)this.receive(message);
 }catch{if(!this.stopped)await new Promise(resolve=>setTimeout(resolve,1400));}}}
 close(){this.stopped=true;this.abort.abort();}
}
