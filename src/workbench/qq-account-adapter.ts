import {workbenchPanelRequest} from './panel-sdk';
import {qqSession,qqRequest as request,connectQQ as connect,disconnectQQ as disconnect} from '../modules/characterCards/qq-account';
export {QQ_CARDS,qqSession,type QQRoom} from '../modules/characterCards/qq-account';
let connected:string|undefined;
async function share(){const session=qqSession();if(session&&connected!==session.token){await workbenchPanelRequest('account.attach',session);connected=session.token;}}
export async function qqRequest<T=any>(...args:Parameters<typeof request>):Promise<T>{await share();return request<T>(...args);}
export async function connectQQ(){await connect();await share();}
export async function disconnectQQ(){const token=qqSession()?.token;try{await disconnect();}finally{if(token)await workbenchPanelRequest('account.clear',token);connected=undefined;}}
