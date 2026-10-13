/** Only disposable UI snapshots use this pump. Commands never enter it. */
export function uiSnapshotPump(visible:()=>boolean, send:()=>Promise<void>, failed:(error:unknown)=>void, interval=400) {
 let pending=false,flight=false,timer:ReturnType<typeof setTimeout>|undefined,nextAt=0,failures=0,generation=0;
 const rateLimited=(error:any)=>error?.error?.name==='RateLimitHit'||error?.name==='RateLimitHit';
 function pump(){
  if(!pending||flight||timer)return;
  if(!visible()){pending=false;return;}
  const delay=Math.max(0,nextAt-Date.now());
  if(delay){timer=setTimeout(()=>{timer=undefined;pump();},delay);return;}
  pending=false;flight=true;nextAt=Date.now()+interval;const current=generation;
  void Promise.resolve().then(()=>current===generation&&visible()?send():undefined).then(()=>{if(current===generation)failures=0;}).catch(error=>{
   if(current!==generation)return;
   failed(error);
   if(rateLimited(error)){failures++;nextAt=Date.now()+Math.min(8000,1000*2**Math.min(failures-1,3));if(failures<=4)pending=true;}
  }).finally(()=>{flight=false;pump();});
 }
 return {request(){pending=true;pump();},cancel(){generation++;pending=false;failures=0;nextAt=0;if(timer)clearTimeout(timer);timer=undefined;}};
}
