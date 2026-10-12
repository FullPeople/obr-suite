import OBR from '@owlbear-rodeo/sdk';
import {qqRequest,qqSession,type QQRoom} from './qq-account';
import {characterDirectory,type DirectoryCard} from './directory';
import {roomCloudDocument} from '../../workbench/cloud-upload';
export type CloudCard=DirectoryCard&{qqRoom:QQRoom};
export type CloudInfo={id:string;cardId:string;name:string;revision:number;owner:boolean;editor:boolean;write:boolean;locked:boolean;ownerNickname:string;ownerAccountId:string;editors?:string[]};
export const isCloudCard=(card:DirectoryCard|undefined):card is CloudCard=>!!card&&typeof card.qqRoom?.id==='string'&&typeof card.qqRoom?.capability==='string';
let generation=0;
const summaries=new Map<string,{at:number;value:CloudInfo}>();
export const cloudScope=(card:CloudCard)=>JSON.stringify([qqSession()?.token||'',card.qqRoom.id,card.qqRoom.capability]);
export function invalidateCloudSummaries(){generation++;summaries.clear();}
export async function cloudInformation(card:CloudCard,fresh=false):Promise<CloudInfo>{
 const scope=cloudScope(card),cached=summaries.get(scope);if(!fresh&&cached&&Date.now()-cached.at<5000)return cached.value;
 for(;;){const epoch=generation,value=await qqRequest('room-cards/'+encodeURIComponent(card.qqRoom.id)+'?summary=1','GET',undefined,card.qqRoom);
  if(scope!==cloudScope(card))throw Error('QQ 账号已改变，请重新读取。');if(epoch!==generation)continue;
  summaries.set(scope,{at:Date.now(),value});while(summaries.size>64)summaries.delete(summaries.keys().next().value!);return value;
 }
}
export async function namedCloudCards<T extends DirectoryCard>(cards:T[]):Promise<T[]>{return Promise.all(cards.map(async card=>{if(!isCloudCard(card))return card;try{const info=await cloudInformation(card);return {...card,name:info.name,locked:info.locked,qqEditors:info.editors??card.qqEditors};}catch{return card;}}));}
export async function readCardDocument(roomId:string,cardId:string,signal?:AbortSignal){
 const room=await OBR.room.getMetadata(),card=characterDirectory({},room).find(row=>row.id===cardId);
 if(isCloudCard(card)){const scope=cloudScope(card),value=await qqRequest('room-cards/'+encodeURIComponent(card.qqRoom.id),'GET',undefined,card.qqRoom);if(scope!==cloudScope(card))throw Error('QQ 账号已改变，请重新读取。');return roomCloudDocument(value.document,card);}
 const response=await fetch(`https://obr.dnd.center/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data.json`,{cache:'no-store',signal});if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json();
}
