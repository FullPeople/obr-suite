import OBR from '@owlbear-rodeo/sdk';
import {SERVER_GRANT,SERVER_ROOM_KEY,serverRoom,type ServerRoom,type ServerSession} from './server-protocol';
export const serverBase=import.meta.env?.VITE_TDA_API||'https://obr.dnd.center/three-dragon-api/v1';
const key=(room:string,player:string)=>'three-dragon-server-session:'+room+':'+player;
export function readServerSession(room:string,player:string):ServerSession|null {try{const s=JSON.parse(localStorage.getItem(key(room,player))||'null');return s?.roomId===room&&/^[a-f0-9]{64}$/.test(s.token)?s:null;}catch{return null;}}
export function writeServerSession(session:ServerSession,player:string){localStorage.setItem(key(session.roomId,player),JSON.stringify(session));}
export async function serverPost(path:string,data:unknown,token?:string){
 const response=await fetch(serverBase+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(12000)});
 const value=await response.json();if(!response.ok)throw Error(value.error||'requestFailed');return value;
}
export async function registerServerSession(room:ServerRoom,player:string,name:string){
 const old=readServerSession(room.id,player);if(old)return old;
 const session:ServerSession=await serverPost('/rooms/'+room.id+'/sessions',{joinKey:room.joinKey,externalId:player,name});writeServerSession(session,player);return session;
}
let admissionStarted=false;
/** One-time seat/role admission uses authenticated SDK connection identities.
 * Game actions, snapshots, gestures and reconnects never use this channel. */
export function setupServerAdmission():()=>void {
 if(admissionStarted)return()=>{};admissionStarted=true;const recently=new Map<string,number>();
 const off=OBR.broadcast.onMessage(SERVER_GRANT,event=>{void(async()=>{
  const data=event.data as {roomId?:string;memberId?:string;challenge?:string};
  if(!data||typeof data.roomId!=='string'||typeof data.memberId!=='string'||typeof data.challenge!=='string'||data.challenge.length>64)return;
  const stamp=data.memberId+':'+data.challenge;if(Date.now()-(recently.get(stamp)||0)<3000)return;recently.set(stamp,Date.now());if(recently.size>128)recently.delete(recently.keys().next().value!);
  const [metadata,playerId,connection,players,role]=await Promise.all([OBR.room.getMetadata(),OBR.player.getId(),OBR.player.getConnectionId(),OBR.party.getPlayers(),OBR.player.getRole()]);
  const room=serverRoom(metadata[SERVER_ROOM_KEY]);if(!room||room.id!==data.roomId)return;
  const session=readServerSession(room.id,playerId);if(!session||!session.owner)return;
  const peer=event.connectionId===connection?{id:playerId,role}:players.find(p=>p.connectionId===event.connectionId);if(!peer)return;
  await serverPost('/rooms/'+room.id+'/grants',{memberId:data.memberId,challenge:data.challenge,externalId:peer.id,role:peer.role==='GM'?'GM':'PLAYER'},session.token);
 })().catch(()=>{});});
 return()=>{admissionStarted=false;off();};
}
