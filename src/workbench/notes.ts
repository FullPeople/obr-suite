import type {Relay} from './relay';

/** Kept out of room/player metadata and catalog broadcasts. Only the GM panel
 * RPC may reach this document; revision checks protect other open DM tabs. */
export function privateNotesCapability(roomId:string,playerId:string,storage:Pick<Storage,'getItem'|'setItem'>=localStorage){
 const storageKey=`com.obr-suite/private-notes/${encodeURIComponent(roomId)}/${encodeURIComponent(playerId)}`;
 let capability=storage.getItem(storageKey);
 if(!capability||!/^notes_[a-f0-9]{64}$/.test(capability)){
  capability='notes_'+[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
  storage.setItem(storageKey,capability);
 }
 return capability;
}
export function roomNotes(relay:Pick<Relay,'send'>,capability:()=>Promise<string>,role:()=>Promise<string>){
 return async(method:string,args:any[])=>{
  if(await role()!=='GM')throw Error('只有 DM 可以查看或编辑笔记');
  const key=await capability();
  if(!/^notes_[a-f0-9]{64}$/.test(key))throw Error('笔记存储凭证无效');
  if(method==='notes.read'){
   const value=await relay.send({sharedDocument:{key,operation:'read'}});
   return {revision:value.revision,text:String(value.data?.text||'')};
  }
  if(method!=='notes.write')throw Error('不支持的笔记操作');
  const [{text,expected}={}]=args;
  if(typeof text!=='string'||text.length>500_000||!Number.isSafeInteger(expected)||expected<0)throw Error('笔记内容或版本无效');
  try{
   const value=await relay.send({sharedDocument:{key,operation:'write',expected,data:{text}}});
   return {revision:value.revision,text:value.data.text};
  }catch(error){
   // A lost reply must not strand an already saved draft at an old revision.
   const actual=await relay.send({sharedDocument:{key,operation:'read'}}).catch(()=>undefined);
   if(actual?.data?.text===text)return {revision:actual.revision,text};
   throw error;
  }
 };
}
