import {withRequestTimeout} from '../request-timeout';
import {wireBody} from './wire';
export type RelayState={status:number;message:string;retryAt:number};
// Register before any host request; never replay an uncertain data mutation.
export class Relay {
 private stopped=false;private active=false;private abort=new AbortController();private registration?:Promise<void>;private retryAt=0;private failures=0;private lastError?:Error&{status:number};
 constructor(private url:string,private session:string,private role:'host'|'client',private secret:string,private receive:(message:any)=>void,private clientKey?:string,private alive?:()=>void,private room?:string,private changed?:(state:RelayState)=>void){void this.poll();}
 private endpoint(){return `${this.url}?${new URLSearchParams({session:this.session,role:this.role})}`;}
 private failed(status:number,message:string,retryAfter:string|null){
  if(status===401||status===410)this.active=false;
  const serverDelay=Number(retryAfter),delay=Number.isFinite(serverDelay)&&serverDelay>0?Math.min(serverDelay*1000,3600000):Math.min(30000,1400*2**Math.min(this.failures++,5));
  this.retryAt=Math.max(this.retryAt,Date.now()+delay);this.lastError=Object.assign(Error(message),{status});this.changed?.({status,message,retryAt:this.retryAt});return this.lastError;
 }
 private async response(r:Response,operation=false){
  const data=await r.json().catch(()=>({}));if(!r.ok){
   // A rejected operation is not a broken connection. In particular, a CAS 409
   // must allow its caller to read the new revision; pausing the whole relay
   // would make that read (and unrelated saves) repeat the previous error.
   if(operation&&[400,403,404,409,422].includes(r.status))throw Object.assign(Error(data.error||'中继操作被拒绝'),{status:r.status});
   throw this.failed(r.status,data.error||(r.status===401||r.status===410?'宿主会话尚未就绪或凭证已失效，请从枭熊房间重新打开工作台':r.status===429?'中继请求过于频繁，正在等待重试':r.status===503?'中继容量暂满，正在等待恢复':'中继连接暂不可用'),r.headers.get('Retry-After'));
  }
  this.retryAt=0;this.failures=0;this.lastError=undefined;this.alive?.();return data;
 }
 private async post(message:any){
  if(Date.now()<this.retryAt)throw this.lastError;
  const encoded=await wireBody(message);
  return withRequestTimeout(60000,this.abort.signal,async signal=>this.response(await fetch(this.endpoint(),{method:'POST',headers:{Authorization:`Bearer ${this.secret}`,...encoded.headers},body:encoded.body as BodyInit,signal}),!message?.register));
 }
 private async register(){
  if(this.role!=='host'||this.active)return;
  if(!this.registration)this.registration=this.post({register:true,clientKey:this.clientKey,...(this.room?{room:this.room}:{})}).then(()=>{this.active=true;}).finally(()=>{this.registration=undefined;});
  await this.registration;
 }
 async send(message:any){await this.register();return this.post(message);}
 private async pause(ms:number){await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);this.abort.signal.removeEventListener('abort',finish);resolve();},timer=setTimeout(finish,ms);if(this.abort.signal.aborted)finish();else this.abort.signal.addEventListener('abort',finish,{once:true});});}
 private async poll(){while(!this.stopped){try{
  if(Date.now()<this.retryAt){await this.pause(this.retryAt-Date.now());if(this.stopped)break;}
  await this.register();
  const messages=await withRequestTimeout(45000,this.abort.signal,async signal=>this.response(await fetch(this.endpoint(),{headers:{Authorization:`Bearer ${this.secret}`},cache:'no-store',signal})));
  for(const message of messages)this.receive(message);
 }catch(error){if(!this.stopped){if(!(error as any)?.status)this.failed(0,'中继连接暂不可用，正在重新连接',null);await this.pause(Math.max(100,this.retryAt-Date.now()));}}}}
 close(){this.stopped=true;this.abort.abort();}
}
