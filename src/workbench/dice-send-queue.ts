export const DICE_SEND_INTERVAL=100;
export function isDiceRateLimit(error:unknown):boolean{
 let text='';try{text=JSON.stringify(error);}catch{}
 return /RateLimitHit|Too many requests/i.test(String(error)+' '+text);
}

/** Retry only an explicit rejected rate-limit response, with the same message.
 * Unknown outcomes are not replayed. Priorities share one paced lane; order is
 * preserved within each priority, with a bounded control burst for fairness. */
export class DiceSendQueue {
 private next=0;private running=false;private controls=0;
 private jobs:{run:()=>Promise<void>;control:boolean;queued:number}[]=[];
 private normalWindow?:{until:number;expired:boolean;leases:Set<()=>boolean>;timer:ReturnType<typeof setTimeout>};
 private wakeNormal?:()=>void;
 constructor(private interval=DICE_SEND_INTERVAL,private clock=()=>Date.now(),private sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))){}
 /** A ready tail may briefly keep the next slot free. The first deadline is
  * shared by overlapping leases; pending normal work must run before renewal. */
 reserveNormalWindow(maxMs:number,valid=()=>true):()=>void{
  if(!Number.isFinite(maxMs)||maxMs<=0||!valid())return()=>{};
  let window=this.normalWindow;
  if(!window){
   const duration=Math.min(250,maxMs);
   window={until:this.clock()+duration,expired:false,leases:new Set(),timer:undefined as any};
   const captured=window;window.timer=setTimeout(()=>{captured.expired=true;captured.leases.clear();this.wakeNormal?.();},duration);
   this.normalWindow=window;
  }
  const lease=()=>{try{return valid();}catch{return false;}};window.leases.add(lease);let released=false;
  return()=>{if(released)return;released=true;window.leases.delete(lease);
   if(this.normalWindow===window&&!window.leases.size&&!this.jobs.some(job=>!job.control))this.clearNormalWindow();
   this.wakeNormal?.();};
 }
 private clearNormalWindow(){if(this.normalWindow)clearTimeout(this.normalWindow.timer);this.normalWindow=undefined;}
 private async waitForNormalWindow(ms:number){
  await new Promise<void>(resolve=>{
   const finish=()=>{clearTimeout(timer);if(this.wakeNormal===finish)this.wakeNormal=undefined;resolve();};
   const timer=setTimeout(finish,Math.min(25,ms));this.wakeNormal=finish;
  });
 }
 send<T>(operation:()=>Promise<T>,valid=()=>true,priority:'normal'|'control'='normal'):Promise<T>{
  const task=new Promise<T>((resolve,reject)=>{this.jobs.push({control:priority==='control',queued:this.clock(),run:async()=>{try{resolve(await this.execute(operation,valid));}catch(error){reject(error);}}});});
  this.wakeNormal?.();
  void this.drain();return task;
 }
 private async drain(){
  if(this.running)return;this.running=true;
  try{while(this.jobs.length){
   // Choose at the available SDK slot: a roll arriving while a heartbeat waits
   // must be allowed to take that slot. Retries remain inside execute().
   const delay=Math.max(0,this.next-this.clock());if(delay)await this.sleep(delay);
   const control=this.jobs.findIndex(job=>job.control),normal=this.jobs.findIndex(job=>!job.control);
   const window=this.normalWindow,time=this.clock();
   if(window)for(const valid of window.leases)if(!valid())window.leases.delete(valid);
   // A hard age bound and the existing eight-control budget beat any lease.
   const aged=normal>=0&&!!window&&time-this.jobs[normal].queued>=1000;
   const index=aged?normal:control>=0&&(this.controls<8||normal<0)?control:normal>=0?normal:0;
   if(index===normal&&window&&!window.expired&&window.leases.size&&this.controls<8&&!aged&&time<window.until){
    await this.waitForNormalWindow(Math.min(window.until-time,1000-(time-this.jobs[normal].queued)));continue;
   }
   if(index===normal)this.clearNormalWindow();
   const [job]=this.jobs.splice(index,1);this.controls=job.control?this.controls+1:0;await job.run();
  }}finally{this.running=false;}
 }
 private async execute<T>(operation:()=>Promise<T>,valid:()=>boolean):Promise<T>{
   for(let retry=0;;retry++){
    if(!valid())throw Error('Dice sender disposed');
    const delay=Math.max(0,this.next-this.clock());if(delay)await this.sleep(delay);
    if(!valid())throw Error('Dice sender disposed');
    this.next=this.clock()+this.interval;
    try{return await operation();}catch(error){
     if(!isDiceRateLimit(error)||retry===3)throw error;
     this.next=Math.max(this.next,this.clock()+800*2**retry);
    }
   }
 }
}
