import {workbenchPanelRequest} from './panel-sdk';
import {cloudFeaturesEnabled,assertCloudEnabled} from '../cloud-availability';
export {QQ_CARDS,type QQRoom} from '../modules/characterCards/qq-account';
let profile:{accountId?:string;nickname?:string}|undefined;
export const qqSession=()=>cloudFeaturesEnabled?profile:undefined;
export async function qqRequest<T=any>(path:string,method='GET',data?:unknown,room?:unknown):Promise<T>{assertCloudEnabled();const value=await workbenchPanelRequest('account.request',path,method,data,room);if(path==='session')profile=value.authenticated?{accountId:value.account.id,nickname:value.account.nickname}:undefined;return value;}
export async function connectQQ(){assertCloudEnabled();parent.postMessage({channel:'workbench-panel-frame/v1',login:true},location.origin);}
export async function disconnectQQ(){assertCloudEnabled();await workbenchPanelRequest('account.logout');profile=undefined;}
export async function selectQQCard(id:string){assertCloudEnabled();await workbenchPanelRequest('card.select',id);parent.postMessage({channel:'workbench-panel-frame/v1',close:true},location.origin);}
