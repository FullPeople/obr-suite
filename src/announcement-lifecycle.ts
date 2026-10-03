export function localDayStamp(date=new Date()):string {
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function announcementVersion(markdown:string):string|null {
 return markdown.match(/^\s*-\s*(\d+\.\d+\.\d+(?:[-.][\w]+)*)\s*[·\-—]/m)?.[1]??null;
}
/** Eligibility/opening is not exposure or acknowledgement. Only the visible
 * modal records those, so failed/cancelled opens remain eligible and unread. */
export function dailyAnnouncement(deps:{role:()=>Promise<string>;readDay:()=>string|null;open:()=>Promise<void>;presentation:{readonly ready:boolean;readonly token:number};warn:(error:unknown)=>void}){
 let opening=false;
 const run=async()=>{
  if(opening||!deps.presentation.ready)return;
  opening=true;const token=deps.presentation.token;
  try{
   if(await deps.role()!=='GM'||deps.readDay()===localDayStamp())return;
   if(!deps.presentation.ready||deps.presentation.token!==token)return;
   await deps.open();
  }catch(error){deps.warn(error);}finally{opening=false;if(deps.presentation.ready&&deps.presentation.token!==token)queueMicrotask(()=>{void run();});}
 };
 return run;
}
/** Run only after content has had a visible paint. Background tabs postpone
 * exposure and the read gate; leaving the document cancels the callback. */
export function afterVisiblePaint(run:()=>void,doc:Document=document,win:Window=window){
 let disposed=false,queued=false,frame=0;
 const dispose=()=>{disposed=true;win.cancelAnimationFrame(frame);doc.removeEventListener('visibilitychange',schedule);win.removeEventListener('pagehide',pagehide);win.removeEventListener('pageshow',schedule);};
 function schedule(){if(disposed||queued||doc.visibilityState==='hidden')return;queued=true;frame=win.requestAnimationFrame(()=>{frame=win.requestAnimationFrame(()=>{queued=false;if(disposed)return;if(doc.visibilityState==='hidden')return;dispose();run();});});}
 function pagehide(event:PageTransitionEvent){if(event.persisted){win.cancelAnimationFrame(frame);queued=false;}else dispose();}
 doc.addEventListener('visibilitychange',schedule);win.addEventListener('pagehide',pagehide);win.addEventListener('pageshow',schedule);schedule();return dispose;
}
