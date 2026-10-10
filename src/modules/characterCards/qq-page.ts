import OBR from '@owlbear-rodeo/sdk';
import {QQ_CARDS,qqSession,qqRequest,connectQQ,disconnectQQ,selectQQCard,type QQRoom} from './qq-account';
type Entry={qqCardId?:string;qqEditors?:string[];id:string;name:string;qqRoom:QQRoom;qqOwner:string;locked:boolean;visibility:string;owner_ids:string[]};
const el=(id:string)=>document.getElementById(id)!;
let room='',player='',generation=0,active:string|undefined,busy=false;
const message=(value:unknown)=>{el('message').textContent=String(value||'');};
async function act(action:()=>Promise<void>){if(busy)return;busy=true;message('');document.querySelectorAll<HTMLButtonElement>('button:not(#close)').forEach(button=>button.disabled=true);try{await action();}catch(error){message(error instanceof Error?error.message:error);}finally{busy=false;document.querySelectorAll<HTMLButtonElement>('button:not(#close)').forEach(button=>button.disabled=false);}}
function open(entry:Entry){active=entry.id;void act(()=>selectQQCard(entry.id));}
async function refresh(){
  const serial=++generation;el('cards').replaceChildren();el('roomCards').replaceChildren();
  const profile=await qqRequest('session');if(serial!==generation)return;const session=qqSession();el('login').hidden=!!session;el('logout').hidden=!session;el('profile').textContent=session?.nickname||'';el('copyAccount').hidden=!session;
  if(session){if(!profile.authenticated)throw Error('QQ 登录已过期，请退出后重新连接。');const rows=await qqRequest('cards');if(serial!==generation)return;
    for(const card of rows.cards.filter((row:any)=>row.role==='owner')){const button=document.createElement('button');button.disabled=busy;button.textContent=card.name+' · '+card.id;button.onclick=()=>void act(async()=>{
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
  }else el('cards').textContent='登录后读取自己的卡库。';
  await refreshRoom();
}
async function refreshRoom(){
  const metadata=await OBR.room.getMetadata();el('roomCards').replaceChildren();
  const entries=Array.isArray(metadata[QQ_CARDS])?metadata[QQ_CARDS] as Entry[]:[];
  const current=entries.find(entry=>entry.id===active);if(active&&(!current||current.locked&&qqSession()?.accountId!==current.qqOwner)){active=undefined;}
  for(const entry of entries){
    const own=qqSession()?.accountId===entry.qqOwner;
    const row=document.createElement('div'),button=document.createElement('button');button.textContent=(entry.locked?'🔒 ':'')+entry.name;button.onclick=()=>open(entry);row.append(button);
    if(own){const lock=document.createElement('button');lock.disabled=busy;lock.textContent=entry.locked?'解锁给房间成员':'重新锁定';lock.onclick=()=>void act(async()=>{
      const result=await qqRequest('room-cards/'+entry.qqRoom.id+'/lock','PUT',{locked:!entry.locked},entry.qqRoom);
      const fresh=await OBR.room.getMetadata();if(OBR.room.id!==room||qqSession()?.accountId!==entry.qqOwner)throw Error('账号或房间已改变，请重新打开卡库。');await OBR.room.setMetadata({[QQ_CARDS]:(fresh[QQ_CARDS] as Entry[]).map(item=>item.id===entry.id?{...item,locked:result.locked,visibility:result.locked?'owners':'public'}:item)});await refresh();
    });row.append(lock);
      const remove=document.createElement('button');remove.disabled=busy;remove.textContent='移出房间';remove.onclick=()=>void act(async()=>{try{await qqRequest('room-cards/'+entry.qqRoom.id,'DELETE',{},entry.qqRoom);}catch(error){if((error as {status?:number}).status!==404)throw error;}const fresh=await OBR.room.getMetadata();if(OBR.room.id!==room||qqSession()?.accountId!==entry.qqOwner)throw Error('账号或房间已改变，请重新打开卡库。');await OBR.room.setMetadata({[QQ_CARDS]:(fresh[QQ_CARDS] as Entry[]).filter(item=>item.id!==entry.id)});if(active===entry.id){active=undefined;}await refresh();});row.append(remove);
    }el('roomCards').append(row);
  }
}
OBR.onReady(async()=>{room=OBR.room.id;player=await OBR.player.getId();el('login').onclick=()=>void act(async()=>{await connectQQ();await refresh();});el('logout').onclick=()=>void act(async()=>{await disconnectQQ();await refresh();});el('copyAccount').onclick=()=>void act(async()=>{const id=qqSession()?.accountId;if(!id)throw Error('请先完成 QQ 登录。');try{await navigator.clipboard.writeText(id);message('账号 ID 已复制。');}catch{message('账号 ID：'+id);}});el('refresh').onclick=()=>void act(refresh);el('close').onclick=()=>void OBR.modal.close('com.obr-suite/qq-card-library');let timer:ReturnType<typeof setTimeout>;OBR.room.onMetadataChange(()=>{clearTimeout(timer);timer=setTimeout(()=>void refreshRoom().catch(message),100);});window.addEventListener('storage',()=>void act(refresh));void act(refresh);});
