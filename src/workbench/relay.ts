import {wireBody} from './wire';
// Poll liveness is independent of expensive character hydration.
export class Relay {
 private stopped=false;private active=false;private abort=new AbortController();
 constructor(private url:string,private session:string,private role:'host'|'client',private secret:string,private receive:(message:any)=>void,private clientKey?:string,private alive?:()=>void,private room?:string){void this.poll();}
 private endpoint(){return `${this.url}?${new URLSearchParams({session:this.session,role:this.role})}`;}
 async send(message:any){const encoded=await wireBody(message),r=await fetch(this.endpoint(),{method:'POST',headers:{Authorization:`Bearer ${this.secret}`,...encoded.headers},body:encoded.body as BodyInit,signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(60000)])});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||(r.status===409?'资料已被其他客户端修改，请刷新后重试':'连接暂不可用')),{status:r.status});this.alive?.();return data;}
 private async poll(){while(!this.stopped){try{if(this.role==='host'&&!this.active){await this.send({register:true,clientKey:this.clientKey,...(this.room?{room:this.room}:{})});this.active=true;}const r=await fetch(this.endpoint(),{headers:{Authorization:`Bearer ${this.secret}`},cache:'no-store',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(45000)])});if(!r.ok){this.active=false;throw Error('relay');}const messages=await r.json();this.alive?.();for(const message of messages)this.receive(message);}catch{if(!this.stopped)await new Promise(resolve=>setTimeout(resolve,1400));}}}
 close(){this.stopped=true;this.abort.abort();}
}
