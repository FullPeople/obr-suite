import OBR from "@owlbear-rodeo/sdk";
import {QQ_CARDS,qqRequest,type QQRoom} from "./qq-account";
import {roomCloudDocument} from "../../workbench/cloud-upload";
// Cards a token can be bound to come from two stores: uploaded cards live in
// the scene/room directories and on obr.dnd.center, cloud cards are registry
// rows in room metadata whose document lives on dnd.center. Popovers outside
// the workbench window read both here, and ask the workbench host for the
// names it displays so a rename on the sheet shows up everywhere.
export type CloudEntry={id:string;name?:string;qqRoom:QQRoom;qqOwner?:string;locked?:boolean;visibility?:string;owner_ids?:string[]};
export function cloudEntries(room:Record<string,unknown>):CloudEntry[]{
  const rows=room[QQ_CARDS];
  return Array.isArray(rows)?rows.filter((row:any):row is CloudEntry=>!!row&&typeof row.id==="string"&&typeof row.qqRoom?.id==="string"&&typeof row.qqRoom?.capability==="string"):[];
}
export async function cloudEntry(cardId:string):Promise<CloudEntry|undefined>{
  try{return cloudEntries(await OBR.room.getMetadata()).find(row=>row.id===cardId);}catch{return undefined;}
}
/** The room document of a card: data.json for uploaded cards, the dnd.center room card for cloud cards. */
export async function readCardDocument(roomId:string,cardId:string,signal?:AbortSignal):Promise<any>{
  const cloud=await cloudEntry(cardId);
  if(cloud){
    const result=await qqRequest("room-cards/"+cloud.qqRoom.id,"GET",undefined,cloud.qqRoom);
    if(!result||typeof result.document!=="object"||!result.document)throw Error("云端卡资料暂不可用");
    return roomCloudDocument(result.document,cloud);
  }
  const response=await fetch(`https://obr.dnd.center/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data.json`,{cache:"no-store",signal});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  return response.json();
}
export type HostCard={id:string;name:string;cloud:boolean;locked:boolean;inScene:boolean};
const CATALOG_REQUEST="com.obr-suite/workbench/catalog-request",CATALOG_REPLY="com.obr-suite/workbench/catalog-reply";
/** Asks this client's workbench host for its card catalog; undefined when no host answers in time. */
export function requestHostCatalog(timeoutMs=1200):Promise<HostCard[]|undefined>{
  return new Promise(resolve=>{
    const nonce=crypto.randomUUID();let done=false;
    const finish=(value?:HostCard[])=>{if(done)return;done=true;clearTimeout(timer);try{off();}catch{}resolve(value);};
    const off=OBR.broadcast.onMessage(CATALOG_REPLY,event=>{
      const data=event.data as any;if(!data||data.nonce!==nonce)return;
      finish(Array.isArray(data.cards)?data.cards.filter((c:any)=>c&&typeof c.id==="string").map((c:any)=>({id:c.id,name:typeof c.name==="string"&&c.name?c.name:c.id,cloud:!!c.cloud,locked:!!c.locked,inScene:!!c.inScene})):undefined);
    });
    const timer=setTimeout(()=>finish(),timeoutMs);
    OBR.broadcast.sendMessage(CATALOG_REQUEST,{nonce},{destination:"LOCAL"}).catch(()=>finish());
  });
}
