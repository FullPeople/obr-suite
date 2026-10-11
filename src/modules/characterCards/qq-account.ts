export const QQ_ORIGIN='https://dnd.center',QQ_STORAGE='dnd-qq-plugin',QQ_CARDS='com.obr-suite/qq-cards';
export type QQSession={token:string;expiresAt:number;accountId?:string;csrf?:string;nickname?:string;avatar?:string};
export type QQRoom={id:string;capability:string};
export async function selectQQCard(id:string){const OBR=(await import('@owlbear-rodeo/sdk')).default;await OBR.broadcast.sendMessage('com.obr-suite/workbench/open-cloud-card',{id},{destination:'LOCAL'});await OBR.modal.close('com.obr-suite/qq-card-library');}
let qqConnectionEpoch=0;
export async function acceptQQSession(candidate:unknown):Promise<void>{
  const value=candidate as QQSession|undefined;
  if(!value||typeof value.token!=='string'||value.token.length<24||value.token.length>256||!Number.isFinite(value.expiresAt)||value.expiresAt<=Date.now()||value.accountId!==undefined&&(typeof value.accountId!=='string'||value.accountId.length>256))throw Error('无效 QQ 账号连接');
  const generation=++qqConnectionEpoch,previousToken=qqSession()?.token;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(QQ_ORIGIN+'/api/session',{headers:{Authorization:'Bearer '+value.token},credentials:'omit',cache:'no-store',signal:controller.signal});
    const profile=await response.json();
    if(!response.ok||!profile.authenticated||typeof profile.account?.id!=='string'||value.accountId!==undefined&&profile.account.id!==value.accountId)throw Error('QQ 账号连接已失效，请重新登录。');
    if(generation!==qqConnectionEpoch||qqSession()?.token!==previousToken)throw Error('QQ 账号连接已改变，请重新登录。');
    localStorage.setItem(QQ_STORAGE,JSON.stringify({token:value.token,expiresAt:value.expiresAt,accountId:profile.account.id,csrf:profile.csrf,nickname:profile.account.nickname,avatar:profile.account.avatar}));
    window.dispatchEvent(new Event('qq-account-changed'));
  }finally{clearTimeout(timer);}
}
export function clearQQSession(token:unknown):void{if(typeof token==='string'&&qqSession()?.token===token){qqConnectionEpoch++;localStorage.removeItem(QQ_STORAGE);window.dispatchEvent(new Event('qq-account-changed'));}}
export function qqSession():QQSession|undefined{try{const value=JSON.parse(localStorage.getItem(QQ_STORAGE)||'null');return value?.expiresAt>Date.now()?value:undefined;}catch{return;}}
export function qqHeaders(room?:QQRoom){const session=qqSession();return {...session?{Authorization:'Bearer '+session.token}:{},...room?{'X-Room-Capability':room.capability}:{}};}
const qqReads=new Map<string,Promise<any>>();
export function qqRequest<T=any>(path:string,method='GET',data?:unknown,room?:QQRoom):Promise<T>{
 const actor=qqSession()?.token||'',key=JSON.stringify([actor,path,room?.id,room?.capability]);if(method!=='GET')return performQQRequest<T>(path,method,data,room);const pending=qqReads.get(key);if(pending)return pending;const task=performQQRequest<T>(path,method,data,room).finally(()=>{if(qqReads.get(key)===task)qqReads.delete(key);});qqReads.set(key,task);return task;
}
async function performQQRequest<T=any>(path:string,method='GET',data?:unknown,room?:QQRoom):Promise<T>{
  if(method==='GET'||method==='HEAD')data=undefined;
  let session=qqSession();
  if(method!=='GET'&&session&&!['plugin/start','plugin/poll','plugin/logout'].includes(path)){
    let fresh;try{fresh=await qqRequest('session');}catch(error){throw Object.assign(error instanceof Error?error:Error(String(error)),{notSent:true});}
    if(!fresh.authenticated||fresh.account.id!==session.accountId||qqSession()?.token!==session.token)throw Object.assign(Error('QQ 账号已改变，请重新连接。'),{status:403,notSent:true});
    session={...session,csrf:fresh.csrf};
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(QQ_ORIGIN+'/api/'+path,{method,credentials:'omit',cache:'no-store',signal:controller.signal,headers:{...qqHeaders(room),...(data===undefined?{}:{'Content-Type':'application/json'}),...session?.csrf?{'X-CSRF-Token':session.csrf}:{}},...data===undefined?{}:{body:JSON.stringify(data)}});
    const value=await response.json();if(!response.ok)throw Object.assign(Error(value.message||'QQ 卡库操作失败。'),{status:response.status});return value;
  }finally{clearTimeout(timer);}
}
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
/** Six characters both ends derive from the PKCE challenge; the person approving a pairing compares them. */
export function pairingCode(challenge:string){let h=2166136261;for(let i=0;i<challenge.length;i++){h^=challenge.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let out='';for(let i=0;i<6;i++){out+=alphabet[h%32];h=Math.floor(h/32);}return out;}
export async function connectQQ(onCode?:(code:string)=>void){
  const verifier=random(),nonce=random();
  const popup=window.open('about:blank','dnd-qq-login','popup,width=620,height=720');if(!popup)throw Error('浏览器阻止了登录窗口，请允许弹出窗口后重试。');
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))),challenge=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  onCode?.(pairingCode(challenge));
  const {connection}=await qqRequest('plugin/start','POST',{challenge});
  popup.location.href=QQ_ORIGIN+'/library/?'+new URLSearchParams({pluginAuth:'1',origin:location.origin,challenge,nonce,connection});
  // Polling survives a provider's opener-isolation policy and needs no third-party cookies.
  const deadline=Date.now()+600000;
  while(Date.now()<deadline){
    const value=await qqRequest('plugin/poll','POST',{connection,verifier});
    if(!value.pending){
      await acceptQQSession(value);popup.close();return;
    }
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw Error('登录连接已超时，请重新开始。');
}
export async function disconnectQQ(){const token=qqSession()?.token;try{if(token)await qqRequest('plugin/logout','POST',{});}finally{clearQQSession(token);}}
