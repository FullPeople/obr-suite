import OBR from '@owlbear-rodeo/sdk';
import {TABLE_ROOM_KEY} from './protocol';
import {SERVER_ROOM_KEY,serverRoom} from './server-protocol';
OBR.onReady(()=>{void(async()=>{
 const metadata=await OBR.room.getMetadata();
 const legacy=metadata[TABLE_ROOM_KEY] as {stage?:string}|undefined;
 if(!serverRoom(metadata[SERVER_ROOM_KEY])&&legacy&&(legacy.stage==='playing'||legacy.stage==='lobby'))await import('./legacy-page');
 else{const {mountServerPage}=await import('./server-page');await mountServerPage(metadata);}
})().catch(error=>{
 const root=document.getElementById('table-app');if(root){const message=document.createElement('p');message.textContent='牌桌连接失败，请重试。'+String(error);const retry=document.createElement('button');retry.textContent='重试';retry.onclick=()=>location.reload();root.replaceChildren(message,retry);}
});});
