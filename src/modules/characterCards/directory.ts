export const CARD_LIST='com.character-cards/list';
export const ROOM_CARD_LIST='com.character-cards/list-room';
export const WORKBENCH_CARD_DIRECTORY='com.obr-suite/workbench/cards';
export const DELETED_CARDS='com.obr-suite/workbench/deleted-cards';
export interface DirectoryCard {id:string;name?:string;uploader?:string;uploaded_at?:string;url?:string;visibility?:string;locked?:boolean;owner_ids?:string[]}
/** Room records survive scene changes; durable records override stale scene copies. */
export function characterDirectory(scene:Record<string,unknown>,room:Record<string,unknown>):DirectoryCard[]{
 const deleted=new Set(Array.isArray(room[DELETED_CARDS])?room[DELETED_CARDS] as unknown[]:[]),cards=new Map<string,DirectoryCard>();
 for(const value of [scene[CARD_LIST],room[ROOM_CARD_LIST],room[WORKBENCH_CARD_DIRECTORY]])if(Array.isArray(value))for(const entry of value){
  if(!entry||typeof entry!=='object'||typeof entry.id!=='string'||!entry.id||entry.id.length>200||deleted.has(entry.id))continue;
  cards.set(entry.id,{...cards.get(entry.id),...entry});
 }
 return [...cards.values()];
}
