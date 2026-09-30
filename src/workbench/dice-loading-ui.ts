export type DiceLoadingState={ready:boolean;error?:string;phase?:string;done?:number;total?:number;bytes?:number;physics?:boolean;overlay?:boolean};
/** Fixed, in-frame gate: never participates in the quick panel's flex row. */
export function diceLoadingUi(retry:()=>Promise<unknown>){
 const cover=document.createElement('section');cover.id='dice3d-loading';cover.hidden=true;cover.setAttribute('role','status');cover.setAttribute('aria-live','polite');
 const title=document.createElement('p');title.textContent='正在加载骰子，首次渲染会花费一点时间，请等待....';
 const detail=document.createElement('p');detail.id='dice3d-loading-detail';const bar=document.createElement('progress');bar.max=100;
 const error=document.createElement('p');error.id='dice3d-loading-error';const button=document.createElement('button');button.textContent='重新加载';button.hidden=true;
 cover.append(title,bar,detail,error,button);document.body.append(cover);document.body.inert=false;
 const style=document.createElement('style');style.textContent='#dice3d-loading{position:fixed;inset:0;z-index:2147483647;background:var(--bg,#f7f8fa);color:var(--text,#292a30);display:flex;flex-direction:column;justify-content:center;align-items:stretch;gap:12px;padding:20px;font:13px/1.65 "Segoe UI","Microsoft YaHei",sans-serif}#dice3d-loading[hidden]{display:none}#dice3d-loading p{margin:0}#dice3d-loading progress{width:100%;height:8px;accent-color:var(--suite-tone,#50525B)}#dice3d-loading-detail{font-size:12px;opacity:.75}#dice3d-loading-error{font-size:11px;color:#ad3d3d;word-break:break-all;max-height:40vh;overflow:auto}#dice3d-loading button{padding:6px 12px;align-self:center}';document.head.append(style);
 // Unknown is not loading: keep input gated until the host's first authoritative state,
 // but never flash a progress overlay while checking an already warm renderer.
 const block=(value:boolean)=>{document.body.setAttribute('aria-busy',String(value));for(const child of document.body.children)if(child!==cover&&child instanceof HTMLElement)child.inert=value;document.body.dataset.diceLoading=String(value);};block(true);
 document.addEventListener('keydown',e=>{if(document.body.dataset.diceLoading==='true'&&!cover.contains(e.target as Node)){e.preventDefault();e.stopImmediatePropagation();}},true);
 const update=(state:DiceLoadingState)=>{cover.hidden=state.ready;block(!state.ready);error.textContent=state.error||'';button.hidden=!state.error;const done=state.done||0,total=state.total||0;if(total){bar.value=100*done/total;}else bar.removeAttribute('value');detail.textContent=`${state.phase||'连接骰子渲染层'}${total?` · 已加载 ${done}/${total} 项资源`:''}${state.bytes?` · ${(state.bytes/1048576).toFixed(1)} MB`:''}${state.physics?' · 物理引擎就绪':''}`;};
 button.onclick=()=>{button.disabled=true;error.textContent='';void retry().catch(e=>{error.textContent=String(e);}).finally(()=>{button.disabled=false;});};return {update,element:cover};
}
