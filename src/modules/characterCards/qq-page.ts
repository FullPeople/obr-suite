import OBR from '@owlbear-rodeo/sdk';
import {cloudFeaturesEnabled,cloudDisabledMessage} from '../../cloud-availability';
import {ICONS} from '../../icons';
import {QQ_CARDS,qqSession,qqRequest,connectQQ,disconnectQQ,selectQQCard,type QQRoom} from './qq-account';
type Entry={qqCardId?:string;qqEditors?:string[];id:string;name:string;qqRoom:QQRoom;qqOwner:string;locked:boolean;visibility:string;owner_ids:string[]};
const el=(id:string)=>document.getElementById(id)!;
let room='',player='',generation=0,active:string|undefined,busy=false;
const message=(value:unknown)=>{el('message').textContent=String(value||'');};
const note=(target:HTMLElement,text:string)=>{const p=document.createElement('p');p.className='grid-note';p.textContent=text;target.append(p);};
function showAccount(session:ReturnType<typeof qqSession>,authenticated:boolean){
  const avatar=el('avatar') as HTMLImageElement,fallback=el('avatarFallback');
  const url=session?.avatar&&/^https:\/\//.test(session.avatar)?session.avatar:'';
  avatar.hidden=!url;fallback.hidden=!!url;if(url&&avatar.src!==url)avatar.src=url;
  el('profile').textContent=session?.nickname||(session?'QQ 用户':'未登录');
  el('accountId').textContent=session?(session.accountId?'账号 ID '+session.accountId:''):'登录后可以读取自己的云端卡，并把它们加载到房间。';
  el('connState').textContent=session?(authenticated?'已连接 dnd.center · 云端卡与房间卡保持同步':'登录已过期，请退出后重新连接'):'未登录 · 用 QQ 登录后读取自己的卡库';
}
async function act(action:()=>Promise<void>){if(busy)return;busy=true;message('');document.querySelectorAll<HTMLButtonElement>('button:not(#close)').forEach(button=>button.disabled=true);try{await action();}catch(error){message(error instanceof Error?error.message:error);}finally{busy=false;document.querySelectorAll<HTMLButtonElement>('button:not(#close)').forEach(button=>button.disabled=false);}}
function open(entry:Entry){active=entry.id;void act(()=>selectQQCard(entry.id));}
async function refresh(){
  const serial=++generation;el('cards').replaceChildren();el('roomCards').replaceChildren();
  const profile=await qqRequest('session');if(serial!==generation)return;const session=qqSession();el('login').hidden=!!session;el('logout').hidden=!session;el('copyAccount').hidden=!session;showAccount(session,!!profile.authenticated);
  if(session){if(!profile.authenticated)throw Error('QQ 登录已过期，请退出后重新连接。');const rows=await qqRequest('cards');if(serial!==generation)return;
    const owned=rows.cards.filter((row:any)=>row.role==='owner');if(!owned.length)note(el('cards'),'云端还没有你的角色卡。先在车卡网站创建一张，再回到这里加载。');
    for(const card of owned){const button=document.createElement('button');button.type='button';button.className='card-tile';button.disabled=busy;button.title='加载到当前房间';
      const name=document.createElement('span');name.className='tile-name';name.innerHTML=ICONS.book;const text=document.createElement('span');text.textContent=card.name||card.id;name.append(text);
      const meta=document.createElement('span');meta.className='tile-id';meta.textContent=card.id;button.append(name,meta);button.onclick=()=>void act(async()=>{
      const existing=await OBR.room.getMetadata(),loaded=(existing[QQ_CARDS] as Entry[]|undefined)?.find(entry=>entry.qqCardId===card.id&&entry.qqOwner===profile.account.id);if(loaded){await selectQQCard(loaded.id);return;}
      if(!window.confirm('将这张卡加载到当前房间？解锁后的房间修改会自动写回云端原卡。'))return;
      if(OBR.room.id!==room)throw Error('房间已改变，请重新打开卡库。');
      const result=await qqRequest('cards/'+card.id+'/rooms','POST',{room,confirmRoomSync:true});
      if(qqSession()?.accountId!==profile.account.id||OBR.room.id!==room)throw Error('账号或房间已改变，未把授权发布到房间。');
      const entry:Entry={id:result.id,name:result.character.name,qqRoom:{id:result.id,capability:result.capability},qqOwner:profile.account.id,qqCardId:result.cardId,qqEditors:result.editors||[],locked:result.locked,visibility:result.locked?'owners':'public',owner_ids:[player]};
      const metadata=await OBR.room.getMetadata(),list=Array.isArray(metadata[QQ_CARDS])?metadata[QQ_CARDS] as Entry[]:[];
      if(qqSession()?.accountId!==profile.account.id||OBR.room.id!==room)throw Error('账号或房间已改变，请重新打开卡库。');
      await OBR.room.setMetadata({[QQ_CARDS]:[...list.filter(item=>item.id!==entry.id),entry]});await selectQQCard(entry.id);
    });el('cards').append(button);}
  }else note(el('cards'),'登录后这里会列出你的云端卡。');
  await refreshRoom();
}
async function refreshRoom(){
  const metadata=await OBR.room.getMetadata();el('roomCards').replaceChildren();
  const entries=Array.isArray(metadata[QQ_CARDS])?metadata[QQ_CARDS] as Entry[]:[];
  const current=entries.find(entry=>entry.id===active);if(active&&(!current||current.locked&&qqSession()?.accountId!==current.qqOwner)){active=undefined;}
  if(!entries.length)note(el('roomCards'),'房间里还没有云端卡。从上面的「我的云端卡」加载一张。');
  for(const entry of entries){
    const own=qqSession()?.accountId===entry.qqOwner;
    const row=document.createElement('div');row.className='room-card'+(entry.id===active?' is-active':'');
    const button=document.createElement('button');button.type='button';button.className='open';button.innerHTML=ICONS.book;const text=document.createElement('span');text.textContent=entry.name;button.append(text);button.title='在角色簿中打开';button.onclick=()=>open(entry);row.append(button);
    const meta=document.createElement('div');meta.className='room-meta';const state=document.createElement('span');state.className='chip '+(entry.locked?'chip-warn':'chip-success');state.innerHTML=(entry.locked?ICONS.lock:ICONS.users)+(entry.locked?'仅卡主可见':'房间成员可见');meta.append(state);if(own){const mine=document.createElement('span');mine.className='chip chip-accent';mine.innerHTML=ICONS.badgeCheck+'我的卡';meta.append(mine);}row.append(meta);
    if(own){const actions=document.createElement('div');actions.className='room-actions';row.append(actions);
      const lock=document.createElement('button');lock.type='button';lock.className='btn btn-sm';lock.disabled=busy;lock.innerHTML=(entry.locked?ICONS.users:ICONS.lock)+(entry.locked?'解锁给房间成员':'重新锁定');lock.title=entry.locked?'解锁后房间成员都能打开这张卡，修改会写回云端原卡':'锁定后只有你能打开这张卡';lock.onclick=()=>void act(async()=>{
      const result=await qqRequest('room-cards/'+entry.qqRoom.id+'/lock','PUT',{locked:!entry.locked},entry.qqRoom);
      const fresh=await OBR.room.getMetadata();if(OBR.room.id!==room||qqSession()?.accountId!==entry.qqOwner)throw Error('账号或房间已改变，请重新打开卡库。');await OBR.room.setMetadata({[QQ_CARDS]:(fresh[QQ_CARDS] as Entry[]).map(item=>item.id===entry.id?{...item,locked:result.locked,visibility:result.locked?'owners':'public'}:item)});await refresh();
    });actions.append(lock);
      const remove=document.createElement('button');remove.type='button';remove.className='btn btn-sm btn-danger';remove.disabled=busy;remove.innerHTML=ICONS.trash+'移出房间';remove.title='只解除房间引用，云端原卡不会删除';remove.onclick=()=>void act(async()=>{try{await qqRequest('room-cards/'+entry.qqRoom.id,'DELETE',{},entry.qqRoom);}catch(error){if((error as {status?:number}).status!==404)throw error;}const fresh=await OBR.room.getMetadata();if(OBR.room.id!==room||qqSession()?.accountId!==entry.qqOwner)throw Error('账号或房间已改变，请重新打开卡库。');await OBR.room.setMetadata({[QQ_CARDS]:(fresh[QQ_CARDS] as Entry[]).filter(item=>item.id!==entry.id)});if(active===entry.id){active=undefined;}await refresh();});actions.append(remove);
    }el('roomCards').append(row);
  }
}
if(!cloudFeaturesEnabled){document.querySelectorAll<HTMLButtonElement>('button:not(#close)').forEach(button=>{button.hidden=true;button.disabled=true;});message(cloudDisabledMessage);el('close').onclick=()=>void OBR.modal.close('com.obr-suite/qq-card-library');}else OBR.onReady(async()=>{room=OBR.room.id;player=await OBR.player.getId();el('login').onclick=()=>void act(async()=>{await connectQQ(code=>message('请在浏览器授权页核对校验码 '+code+' 后再点击连接。'));message('');await refresh();});el('logout').onclick=()=>void act(async()=>{await disconnectQQ();await refresh();});el('copyAccount').onclick=()=>void act(async()=>{const id=qqSession()?.accountId;if(!id)throw Error('请先完成 QQ 登录。');try{await navigator.clipboard.writeText(id);message('账号 ID 已复制。');}catch{message('账号 ID：'+id);}});el('refresh').onclick=()=>void act(refresh);el('close').onclick=()=>void OBR.modal.close('com.obr-suite/qq-card-library');let timer:ReturnType<typeof setTimeout>;OBR.room.onMetadataChange(()=>{clearTimeout(timer);timer=setTimeout(()=>void refreshRoom().catch(message),100);});window.addEventListener('storage',()=>void act(refresh));void act(refresh);});
