export const QQ_ORIGIN='https://dnd.center',QQ_STORAGE='dnd-qq-plugin',QQ_CARDS='com.obr-suite/qq-cards';
export type QQSession={token:string;expiresAt:number;accountId?:string;csrf?:string;nickname?:string};
export type QQRoom={id:string;capability:string};
export async function acceptQQSession(candidate:unknown):Promise<void>{
  const value=candidate as QQSession|undefined;
  if(!value||typeof value.token!=='string'||value.token.length<24||value.token.length>256||!Number.isFinite(value.expiresAt)||value.expiresAt<=Date.now()||typeof value.accountId!=='string'||value.accountId.length>256)throw Error('无效 QQ 账号连接');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(QQ_ORIGIN+'/api/session',{headers:{Authorization:'Bearer '+value.token},credentials:'omit',cache:'no-store',signal:controller.signal});
    const profile=await response.json();
    if(!response.ok||!profile.authenticated||profile.account?.id!==value.accountId)throw Error('QQ 账号连接已失效，请重新登录。');
    localStorage.setItem(QQ_STORAGE,JSON.stringify({token:value.token,expiresAt:value.expiresAt,accountId:profile.account.id,csrf:profile.csrf,nickname:profile.account.nickname}));
    window.dispatchEvent(new Event('qq-account-changed'));
  }finally{clearTimeout(timer);}
}
export function clearQQSession(token:unknown):void{if(typeof token==='string'&&qqSession()?.token===token){localStorage.removeItem(QQ_STORAGE);window.dispatchEvent(new Event('qq-account-changed'));}}
export function qqSession():QQSession|undefined{try{const value=JSON.parse(localStorage.getItem(QQ_STORAGE)||'null');return value?.expiresAt>Date.now()?value:undefined;}catch{return;}}
export function qqHeaders(room?:QQRoom){const session=qqSession();return {...session?{Authorization:'Bearer '+session.token}:{},...room?{'X-Room-Capability':room.capability}:{}};}
export async function qqRequest<T=any>(path:string,method='GET',data?:unknown,room?:QQRoom):Promise<T>{
  let session=qqSession();
  if(method!=='GET'&&session&&!['plugin/start','plugin/poll','plugin/logout'].includes(path)){
    const fresh=await qqRequest('session');if(!fresh.authenticated||fresh.account.id!==session.accountId)throw Error('QQ 账号已改变，请重新连接。');
    session={...session,csrf:fresh.csrf};
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(QQ_ORIGIN+'/api/'+path,{method,credentials:'omit',cache:'no-store',signal:controller.signal,headers:{...qqHeaders(room),...(data===undefined?{}:{'Content-Type':'application/json'}),...session?.csrf?{'X-CSRF-Token':session.csrf}:{}},...data===undefined?{}:{body:JSON.stringify(data)}});
    const value=await response.json();if(!response.ok)throw Object.assign(Error(value.message||'QQ 卡库操作失败。'),{status:response.status});return value;
  }finally{clearTimeout(timer);}
}
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function connectQQ(){
  const verifier=random(),nonce=random();
  const popup=window.open('about:blank','dnd-qq-login','popup,width=620,height=720');if(!popup)throw Error('浏览器阻止了登录窗口，请允许弹出窗口后重试。');
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))),challenge=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const {connection}=await qqRequest('plugin/start','POST',{challenge});
  popup.location.href=QQ_ORIGIN+'/library/?'+new URLSearchParams({pluginAuth:'1',origin:location.origin,challenge,nonce,connection});
  // Polling survives a provider's opener-isolation policy and needs no third-party cookies.
  const deadline=Date.now()+600000;
  while(Date.now()<deadline){
    const value=await qqRequest('plugin/poll','POST',{connection,verifier});
    if(!value.pending){
      localStorage.setItem(QQ_STORAGE,JSON.stringify(value));
      try{const profile=await qqRequest('session');if(!profile.authenticated)throw Error('插件登录未完成。');localStorage.setItem(QQ_STORAGE,JSON.stringify({...value,accountId:profile.account.id,csrf:profile.csrf,nickname:profile.account.nickname}));}
      catch(error){localStorage.removeItem(QQ_STORAGE);throw error;}
      popup.close();window.dispatchEvent(new Event('qq-account-changed'));return;
    }
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw Error('登录连接已超时，请重新开始。');
}
export async function disconnectQQ(){try{if(qqSession())await qqRequest('plugin/logout','POST',{});}finally{localStorage.removeItem(QQ_STORAGE);window.dispatchEvent(new Event('qq-account-changed'));}}
