import {url} from './types';
import {ASSET_LOCKS} from './asset-manifest';
export interface LoadProgress {done:number;total:number;bytes:number;phase:string;current:string;attempt:number}
/** A single immutable URL is fetched once, even when eight styles share its audio/mask. */
export class DiceAssets {
  private tasks=new Map<string,Promise<ArrayBuffer>>();private planned=new Set<string>();private completed=new Set<string>();
  private sizes=new Map<string,number>();private active=0;private queue:(()=>void)[]=[];private last=0;
  locks:Record<string,string>={...ASSET_LOCKS};phase='下载资源';
  constructor(private report:(progress:LoadProgress)=>void=()=>{}){}
  plan(paths:string[]){for(const path of paths)this.planned.add(path);this.emit('',0,true);}
  private emit(current:string,attempt=0,force=false){if(!force&&performance.now()-this.last<120)return;this.last=performance.now();this.report({done:this.completed.size,total:this.planned.size,bytes:[...this.sizes.values()].reduce((a,b)=>a+b,0),phase:this.phase,current,attempt});}
  stage(phase:string){this.phase=phase;this.emit('',0,true);}
  bytes(path:string):Promise<ArrayBuffer>{
    let task=this.tasks.get(path);if(!task){this.planned.add(path);task=this.download(path);this.tasks.set(path,task);
      void task.catch(()=>{if(this.tasks.get(path)===task)this.tasks.delete(path);});}return task;
  }
  async json<T>(path:string):Promise<T>{try{return JSON.parse(new TextDecoder().decode(await this.bytes(path)));}catch(error){throw Error(`E_DICE_JSON ${url(path)}: ${String(error)}`);}}
  private async download(path:string){
    for(let attempt=1;attempt<=3;attempt++){
      if(this.active>=6)await new Promise<void>(resolve=>this.queue.push(resolve));else this.active++;
      const abort=new AbortController();let timedOut=false,waiting='响应头',retryable=true;
      const timeout=()=>{timedOut=true;abort.abort();};let timer=setTimeout(timeout,30000);
      try{
        this.emit(path,attempt,true);const response=await fetch(url(path)+(attempt>1?'&retry='+attempt:''),{signal:abort.signal,cache:attempt>1?'reload':'default'});
        if(!response.ok){retryable=[408,429].includes(response.status)||response.status>=500;throw Error(`HTTP ${response.status} ${response.statusText}`);}
        waiting='文件数据';const reader=response.body?.getReader(),parts:Uint8Array[]=[];let count=0;
        if(reader){for(;;){const {done,value}=await reader.read();if(done)break;clearTimeout(timer);timer=setTimeout(timeout,30000);parts.push(value);count+=value.byteLength;this.sizes.set(path,count);this.emit(path,attempt);}}
        else{const value=new Uint8Array(await response.arrayBuffer());parts.push(value);count=value.length;this.sizes.set(path,count);}
        const data=new Uint8Array(count);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}
        const expected=this.locks[path];if(expected){const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(n=>n.toString(16).padStart(2,'0')).join('');if(digest!==expected)throw Error(`SHA-256 mismatch expected=${expected} actual=${digest}`);}
        this.completed.add(path);this.emit(path,attempt,true);return data.buffer;
      }catch(error){if(!retryable||attempt===3)throw Error(`E_DICE_ASSET ${url(path)} attempt=${attempt}/3: ${timedOut?'E_DICE_TIMEOUT 等待'+waiting+'超过 30 秒':String(error)}`);}
      finally{clearTimeout(timer);const next=this.queue.shift();if(next)next();else this.active--;}
      await new Promise(resolve=>setTimeout(resolve,attempt*350));
    }
    throw Error(`E_DICE_ASSET ${url(path)}`);
  }
}
