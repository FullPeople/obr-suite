const handlers=new Set<(event:any)=>void>();
window.addEventListener('message',event=>{if(event.source===parent&&event.origin===location.origin&&event.data?.channel==='suite-supporter-effect'){(window as any).supporterHole=event.data.hole;for(const fn of handlers)fn({data:event.data});}});
export default {onReady:(fn:()=>unknown)=>void fn(),broadcast:{onMessage:(_name:string,fn:(event:any)=>void)=>{handlers.add(fn);return()=>handlers.delete(fn);}},modal:{close:async()=>{}}};
