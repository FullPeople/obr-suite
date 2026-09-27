export const SERVER_ROOM_KEY='com.fullpeople/three-dragon-ante/server-v1';
export const SERVER_GRANT='com.fullpeople/three-dragon-ante/server-grant-v1';
export const SERVER_WINDOW='com.fullpeople/three-dragon-ante/server-window-v1';
export interface ServerRoom {version:1;id:string;joinKey:string}
export interface ServerSession {roomId:string;memberId:string;token:string;role:'GM'|'PLAYER';owner:boolean;challenge?:string}
export function serverRoom(value:unknown):ServerRoom|null {
 const v=value as ServerRoom;return v?.version===1&&/^[a-f0-9]{32}$/.test(v.id)&&/^[a-f0-9]{64}$/.test(v.joinKey)?{version:1,id:v.id,joinKey:v.joinKey}:null;
}
export function objectPatch(before:Record<string,any>,after:Record<string,any>){
 const set:Record<string,unknown>={},remove:string[]=[];
 for(const key of Object.keys(before))if(!(key in after))remove.push(key);
 for(const key of Object.keys(after))if(JSON.stringify(before[key])!==JSON.stringify(after[key]))set[key]=after[key];
 return {set,remove};
}
export function applyObjectPatch(before:Record<string,any>,patch:{set:Record<string,unknown>;remove:string[]}){
 const next={...before};for(const key of patch.remove)delete next[key];for(const [key,value] of Object.entries(patch.set))if(!['__proto__','constructor','prototype'].includes(key))next[key]=value;return next;
}
