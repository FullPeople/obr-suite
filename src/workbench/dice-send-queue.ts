export const DICE_SEND_INTERVAL=100;
export function isDiceRateLimit(error:unknown):boolean{
 let text='';try{text=JSON.stringify(error);}catch{}
 return /RateLimitHit|Too many requests/i.test(String(error)+' '+text);
}

/** Retry only an explicit rejected rate-limit response, with the same message.
 * Unknown outcomes are not replayed. All sends share a paced, ordered lane. */
export class DiceSendQueue {
 private lane:Promise<void>=Promise.resolve();private next=0;
 constructor(private interval=DICE_SEND_INTERVAL,private clock=()=>Date.now(),private sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))){}
 send<T>(operation:()=>Promise<T>,valid=()=>true):Promise<T>{
  const task=this.lane.then(async()=>{
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
  });
  this.lane=task.then(()=>{},()=>{});return task;
 }
}
