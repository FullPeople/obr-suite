import OBR from '@owlbear-rodeo/sdk';
type BroadcastEvent=Parameters<Parameters<typeof OBR.broadcast.onMessage>[1]>[0];
type BroadcastOptions=Parameters<typeof OBR.broadcast.sendMessage>[2];
// The SDK limits each broadcast to 16 KB. Large snapshots are bounded and
// assembled completely before any consumer validates or mutates room state.
const MAX_BYTES=64000, PART_CHARS=10000, MAX_PARTS=9, TTL=5000;
interface Part {v:number;id:string;index:number;count:number;bytes:number;text:string}
export async function sendMusicMessage(channel:string,data:unknown,options?:BroadcastOptions):Promise<void>{
 const json=JSON.stringify(data),bytes=new TextEncoder().encode(json);
 if(bytes.length>MAX_BYTES)throw Error('libraryFull');
 if(bytes.length<=14000){await OBR.broadcast.sendMessage(channel,data,options);return;}
 let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);const encoded=btoa(binary),id=crypto.randomUUID(),count=Math.ceil(encoded.length/PART_CHARS);
 for(let index=0;index<count;index++)await OBR.broadcast.sendMessage(channel+':part',{v:1,id,index,count,bytes:bytes.length,text:encoded.slice(index*PART_CHARS,(index+1)*PART_CHARS)},options);
}
export function onMusicMessage(channel:string,receive:(event:BroadcastEvent)=>void):()=>void{
 const pending=new Map<string,{parts:Map<number,string>;count:number;bytes:number;timer:ReturnType<typeof setTimeout>}>();
 const direct=OBR.broadcast.onMessage(channel,receive);
 const fragmented=OBR.broadcast.onMessage(channel+':part',event=>{
  const part=event.data as Part;
  if(!part||part.v!==1||typeof part.id!=='string'||!part.id||part.id.length>100||!Number.isInteger(part.count)||part.count<2||part.count>MAX_PARTS||!Number.isInteger(part.index)||part.index<0||part.index>=part.count||!Number.isInteger(part.bytes)||part.bytes<=14000||part.bytes>MAX_BYTES||typeof part.text!=='string'||!part.text||part.text.length>PART_CHARS||!/^[A-Za-z0-9+/]*={0,2}$/.test(part.text))return;
  const key=event.connectionId+':'+part.id;let batch=pending.get(key);
  if(!batch){if(pending.size>=8)return;batch={parts:new Map(),count:part.count,bytes:part.bytes,timer:setTimeout(()=>pending.delete(key),TTL)};pending.set(key,batch);}
  if(batch.count!==part.count||batch.bytes!==part.bytes||batch.parts.has(part.index))return;
  batch.parts.set(part.index,part.text);if(batch.parts.size!==batch.count)return;
  clearTimeout(batch.timer);pending.delete(key);
  try{const text=Array.from({length:batch.count},(_,i)=>batch!.parts.get(i)!).join(''),bytes=Uint8Array.from(atob(text),char=>char.charCodeAt(0));if(bytes.length!==batch.bytes)return;const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));receive({...event,data});}catch{}
 });
 return()=>{direct();fragmented();for(const batch of pending.values())clearTimeout(batch.timer);pending.clear();};
}
