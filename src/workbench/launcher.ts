import {assetUrl} from '../asset-base';
import {WORKBENCH_DEV,WORKBENCH_PROTOCOL as protocol} from './channel';
const link=document.querySelector<HTMLAnchorElement>('#open')!,status=document.querySelector<HTMLElement>('#status')!;
let background:Window|null=null;
const nonce=crypto.randomUUID();
function discover(w:Window,depth=0){if(depth>3)return;try{w.postMessage({protocol,type:'discover',nonce},location.origin);for(let i=0;i<Math.min(w.length,64);i++)discover(w.frames[i],depth+1);}catch{}}
window.addEventListener('message',e=>{
 if(e.origin!==location.origin||e.data?.protocol!==protocol||e.data.nonce!==nonce||e.data.type!=='background')return;
 background=e.source as Window;
 const target=new URL(assetUrl('workbench/index.html'));
 target.hash=new URLSearchParams({suite:e.data.session,bridge:location.origin,...(e.data.clientKey?{relay:e.data.clientKey}:{})}).toString();
 link.href=target.href;
 link.target=`full-suite-workbench-${e.data.session}`;
 link.removeAttribute('aria-disabled');
 status.hidden=true;
});
// Keep the room's top-level WindowProxy as the opener. An action popover iframe
// is destroyed when the action closes; retaining that iframe as opener made a
// later room refresh silently fall back to network transport forever. Opening
// without window features still lets the browser create a normal tab. The link
// itself stays native for context menus, copy, and modified clicks.
// BEGIN persistent-room-opener
link.addEventListener('click',event=>{
 if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||!background||!link.getAttribute('href'))return;
 const child=window.open(link.href,link.target);
 if(!child)return;
 event.preventDefault();
 try{child.opener=window.top;}catch{}
});
// END persistent-room-opener
if(WORKBENCH_DEV){discover(parent);setInterval(()=>{if(!background)discover(parent);},700);}else status.textContent='此入口仅用于 Full Suite-dev。';
