export interface ChangeNotice {accountId:string|null;cursor:string;changed:boolean}
export interface ChangeWatchOptions {
 request:(cursor:string|undefined,signal:AbortSignal)=>Promise<unknown>;
 changed:()=>void|Promise<void>;
 scope:()=>string;
 active?:()=>boolean;
 account?:()=>string|null|undefined;
 failed?:(error:unknown)=>void;
}

/** A single wait per scope; aborted or stale replies never refresh the next account. */
export function watchCloudChanges(options:ChangeWatchOptions){
 let alive=true,epoch=0,cursor:string|undefined,controller:AbortController|undefined;
 let delayTimer:ReturnType<typeof setTimeout>|undefined,releaseDelay:(()=>void)|undefined;
 const delay=(ms:number)=>new Promise<void>(resolve=>{releaseDelay=resolve;delayTimer=setTimeout(()=>{delayTimer=undefined;releaseDelay=undefined;resolve();},ms);});
 const wake=()=>{epoch++;cursor=undefined;controller?.abort();clearTimeout(delayTimer);delayTimer=undefined;const release=releaseDelay;releaseDelay=undefined;release?.();};
 const done=(async()=>{
  let failures=0;
  while(alive){
   if(options.active&&!options.active()){await delay(1000);continue;}
   const generation=epoch,scope=options.scope(),account=options.account?.();controller=new AbortController();
   const timeout=setTimeout(()=>controller?.abort(),30000);
   try{
    const value=await options.request(cursor,controller.signal) as Partial<ChangeNotice>|null;
    if(!alive||generation!==epoch||scope!==options.scope()){cursor=undefined;continue;}
    if(!value||typeof value.cursor!=='string'||!/^[a-f0-9]{64}$/.test(value.cursor)||typeof value.changed!=='boolean'||value.accountId!==null&&typeof value.accountId!=='string')throw Error('云端变更响应无效。');
    if(account!==undefined&&value.accountId!==account)throw Object.assign(Error('QQ 账号已改变，正在重新核对。'),{status:401});
    if(value.changed)await options.changed();
    if(!alive||generation!==epoch||scope!==options.scope()){cursor=undefined;continue;}
    cursor=value.cursor;failures=0;
    // Bound rapid invalidations without slowing the normal held request.
    await delay(50);
   }catch(error){
    if(!alive||generation!==epoch||scope!==options.scope()){cursor=undefined;continue;}
    try{options.failed?.(error);}catch{}
    if([404,405].includes(Number((error as {status?:number})?.status)))break;
    await delay(Math.min(30000,1000*2**Math.min(failures++,5)));
   }finally{clearTimeout(timeout);controller=undefined;}
  }
 })();
 return {wake,stop:()=>{alive=false;wake();},done};
}
