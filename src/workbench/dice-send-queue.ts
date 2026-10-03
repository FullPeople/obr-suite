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
 private jobs:{run:()=>Promise<void>;control:boolean}[]=[];
 constructor(private interval=DICE_SEND_INTERVAL,private clock=()=>Date.now(),private sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))){}
 send<T>(operation:()=>Promise<T>,valid=()=>true,priority:'normal'|'control'='normal'):Promise<T>{
  const task=new Promise<T>((resolve,reject)=>{this.jobs.push({control:priority==='control',run:async()=>{try{resolve(await this.execute(operation,valid));}catch(error){reject(error);}}});});
  void this.drain();return task;
 }
 private async drain(){
  if(this.running)return;this.running=true;
  try{while(this.jobs.length){const control=this.jobs.findIndex(job=>job.control),normal=this.jobs.findIndex(job=>!job.control);
   const index=control>=0&&(this.controls<8||normal<0)?control:normal>=0?normal:0;
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
