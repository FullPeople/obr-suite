type Receipt={characterId:string;source:string;creating?:boolean;cloudId?:string;room?:{id:string;capability:string}};
type Dependencies={roomId:string;cardId:string;playerId:string;native?:any;read:()=>Promise<any>;guard:()=>Promise<void>;session:()=>{accountId?:string;token:string}|undefined;request:(path:string,method?:string,data?:unknown)=>Promise<any>;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;getMetadata:()=>Promise<Record<string,any>>;setMetadata:(update:Record<string,unknown>)=>Promise<void>;registryKey:string};
export const cloudRevisionOffset=(entry:any)=>Number.isSafeInteger(entry?.qqRevisionOffset)&&entry.qqRevisionOffset>=0?entry.qqRevisionOffset:0;
export const roomCloudDocument=(document:any,entry:any)=>({...document,_suiteRevision:(document?._suiteRevision||0)+cloudRevisionOffset(entry)});
const sourceHash=async(document:any)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(document))))).map(value=>value.toString(16).padStart(2,'0')).join('');

// Upload receipts belong to this player's host. An unknown POST outcome must
// be reconciled against the personal library before another upload is allowed.
export async function uploadRoomCard(d:Dependencies){
 const actor=d.session();if(!actor?.accountId)throw Error('请先登录 QQ 账号。');
 const guard=async()=>{if(d.session()?.token!==actor.token)throw Error('QQ 账号已改变，请重新打开云端设置。');await d.guard();if(d.session()?.token!==actor.token)throw Error('QQ 账号已改变，请重新打开云端设置。');};
 await guard();const document=await d.read(),native=document?.dnd_card_web||d.native;
 if(!native||typeof native!=='object'||typeof native.name!=='string'||typeof native.id!=='string')throw Error('角色资料尚未完整读取，请重新打开这张卡。');
 const key='com.obr-suite/cloud-upload:'+JSON.stringify([d.roomId,d.cardId,actor.accountId]),source=await sourceHash(document);
 let receipt:Receipt|undefined;try{receipt=JSON.parse(d.storage.getItem(key)||'null')||undefined;}catch{throw Error('上次上传记录无法读取，请在 QQ 卡库核对原卡。');}
 if(receipt&&receipt.source!==source)throw Error('原房间卡在上次上传后已有修改，请先在 QQ 卡库核对已上传的版本。');
 receipt??={characterId:crypto.randomUUID(),source};const save=()=>d.storage.setItem(key,JSON.stringify(receipt));
 if(!receipt.cloudId){
  if(receipt.creating){
   const directory=await d.request('cards'),matches=[];
   for(const row of directory.cards||directory.mine||[])if(row.role==='owner'){const card=await d.request('cards/'+row.id);if(card.character?.id===receipt.characterId)matches.push(card);}
   if(matches.length!==1)throw Error('上次上传结果尚未确认，已暂停重复上传。请在 QQ 卡库核对。');
   receipt.cloudId=matches[0].id;save();
  }else{
   await guard();receipt.creating=true;save();
   try{const card=await d.request('cards','POST',{character:{...structuredClone(native),id:receipt.characterId},confirmUpload:true});receipt.cloudId=card.id;save();}
   catch(error){const failure=error as {status?:number;notSent?:boolean};if(failure.notSent||failure.status&&failure.status<500)d.storage.removeItem(key);throw error;}
  }
 }
 if(!receipt.room){await guard();const room=await d.request('cards/'+receipt.cloudId+'/rooms','POST',{room:d.roomId,confirmRoomSync:true});receipt.room={id:room.id,capability:room.capability};save();}
 await guard();if(await sourceHash(await d.read())!==source)throw Error('原房间卡已变化；上传版本已保存在 QQ 卡库，请先核对。');
 const room=await d.request('room-cards/'+receipt.room.id),metadata=await d.getMetadata(),rows=Array.isArray(metadata[d.registryKey])?metadata[d.registryKey]:[],existing=rows.find((row:any)=>row.id===d.cardId);
 if(rows.some((row:any)=>row.id!==d.cardId&&row.qqCardId===receipt!.cloudId))throw Error('已上传的云端卡已经加载到房间，请从角色簿打开它。原房间卡保留。');
 if(existing?.qqRoom&&existing.qqCardId!==receipt.cloudId)throw Error('这张房间卡已绑定其他云端原卡，请重新读取。');
 await guard();const entry={...existing,id:d.cardId,name:room.name,qqOwner:actor.accountId,qqCardId:receipt.cloudId,qqRevisionOffset:Number.isSafeInteger(document._suiteRevision)?Math.max(0,document._suiteRevision):0,qqEditors:room.editors||[],qqRoom:receipt.room,owner_ids:[d.playerId],locked:room.locked,visibility:room.locked?'owners':'public'};
 await d.setMetadata({[d.registryKey]:[...rows.filter((row:any)=>row.id!==d.cardId),entry]});
 d.storage.removeItem(key);return {entry,document:roomCloudDocument(room.document,entry)};
}
