import OBR from '@owlbear-rodeo/sdk';
import historyMarkup from '../../dice-history.html?raw';
import {ACTION_HISTORY_CHANNEL,actionTabKey} from './action-history-state';

/** The existing history and notice renderer stays in the SDK action document.
 * No nested SDK iframe and no second history store are introduced. */
export function mountActionHistory(){
 const history=document.getElementById('action-history')!,home=document.getElementById('action-home')!;
 const tabs=[...document.querySelectorAll<HTMLButtonElement>('[data-action-tab]')];
 document.body.dataset.actionHistory='true';
 const template=new DOMParser().parseFromString(historyMarkup,'text/html');
 const style=document.createElement('style');style.textContent=[...template.querySelectorAll('style')].map(s=>s.textContent).join('\n')+`
 html{zoom:1!important}html,body{height:100%;width:100%;margin:0;overflow:hidden;background:#eee;color:#252525;font:14px system-ui}
 body{display:flex;flex-direction:column}#action-tabs{display:flex;gap:4px;flex:none;padding:10px;border-bottom:1px solid #999;background:#50525b}
 #action-tabs button{flex:1;min-height:34px;border:1px solid #aaa;background:#eee;color:#30313a;cursor:pointer;font:inherit;padding:6px}
 #action-tabs button[aria-selected=true]{background:#fff;box-shadow:inset 0 -3px #6d2b3a}#action-tabs button:hover{background:#fff}
 #action-tabs button:focus-visible{outline:2px solid #d9c887;outline-offset:1px}
 #action-home{flex:1;min-height:0;overflow:auto;padding:16px}#action-history{flex:1;min-height:0;position:relative;background:#eee;color:#eee}
 [hidden]{display:none!important}#action-history .box{position:absolute;inset:0}#action-history .foot-drag{display:none}
 #action-history .foot{background:#50525b}#action-history .detail{background:#41434b}
 `;document.head.append(style);
 for(const child of [...template.body.children])if(child.tagName!=='SCRIPT')history.append(child);
 let room='',connection='',latest=false;
 function select(tab:'home'|'history',follow=false){
  home.hidden=tab!=='home';history.hidden=tab!=='history';
  for(const button of tabs)button.setAttribute('aria-selected',String(button.dataset.actionTab===tab));
  if(room)try{sessionStorage.setItem(actionTabKey(room),tab);}catch{}
  if(tab==='history'&&follow){latest=true;document.getElementById('detailBack')?.click();requestAnimationFrame(()=>{const flow=history.querySelector<HTMLElement>('.activity-flow');if(flow)flow.scrollTop=flow.scrollHeight;});}
 }
 for(const button of tabs)button.onclick=()=>select(button.dataset.actionTab as 'home'|'history',button.dataset.actionTab==='history');
 document.addEventListener('suite-dice-content',()=>{if(latest&&!history.hidden){const flow=history.querySelector<HTMLElement>('.activity-flow');if(flow)flow.scrollTop=flow.scrollHeight;}});
 select('home');
 OBR.onReady(async()=>{
  room=String(OBR.room.id||'default');connection=await OBR.player.getConnectionId();
  OBR.broadcast.onMessage(ACTION_HISTORY_CHANNEL,event=>{if(event.connectionId===connection)select('history',true);});
  let tab='home';try{tab=sessionStorage.getItem(actionTabKey(room))||'home';}catch{}
  select(tab==='history'?'history':'home',tab==='history');
  await import('../modules/dice/history-page');
 });
}
