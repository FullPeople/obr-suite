/** AbortController is available in older Chromium versions without AbortSignal.any/timeout.
 * Keep the deadline alive through body consumption; release listeners after every outcome. */
export async function withRequestTimeout<T>(milliseconds:number,parent:AbortSignal|undefined,request:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 const controller=new AbortController();
 const cancel=()=>controller.abort(parent?.reason);
 if(parent?.aborted){cancel();throw controller.signal.reason||new DOMException('请求已取消','AbortError');}
 parent?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('请求超时，请检查网络后重试','TimeoutError')),milliseconds);
 try{return await request(controller.signal);}
 finally{clearTimeout(timer);parent?.removeEventListener('abort',cancel);}
}
