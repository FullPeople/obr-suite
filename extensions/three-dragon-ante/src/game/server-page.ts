import OBR from '@owlbear-rodeo/sdk';
import {getLocalLang,onLangChange,setLocalLang} from '../locale';
import {mountTableUI} from './ui';
import type {TableView} from './protocol';
import {SERVER_GRANT,SERVER_ROOM_KEY,SERVER_WINDOW,serverRoom,type ServerRoom,type ServerSession} from './server-protocol';
import {registerServerSession,serverPost,setupServerAdmission,writeServerSession} from './server-session';
import {ServerTableClient} from './server-client';
import {readUIDraft} from './ui-command';
import './style.css';import './stage-ui.css';

export async function mountServerPage(initial:Record<string,unknown>){
 const root=document.getElementById('table-app')!,[playerId,name,initialRole]=await Promise.all([OBR.player.getId(),OBR.player.getName(),OBR.player.getRole()]);let role=initialRole,lastAdmission=0;
 let alive=true,client:ServerTableClient|undefined,room:ServerRoom|null=null,session:ServerSession|undefined,admitted=false,generation=0;
 const off: Array<()=>void>=[],instance=new URLSearchParams(location.search).get('instance')||'',draftKey='three-dragon-server-draft:'+OBR.room.id+':'+playerId;
 let overlay:any,overlayHost:HTMLElement|undefined;
 const surface=mountTableUI(root,{language:getLocalLang(),mode:new URLSearchParams(location.search).get('mode')==='compact'?'compact':'full',gesture:g=>client?.sendGesture(g),send:async command=>{
  if(command.type==='close'||command.type==='display'||command.type==='remember'){
   if('draft'in command&&command.draft)try{sessionStorage.setItem(draftKey,JSON.stringify(command.draft));}catch{}
   if(command.type==='remember')return;
   await OBR.broadcast.sendMessage(SERVER_WINDOW,{instance,command},{destination:'LOCAL'});return;
  }
  if(command.type==='create'){
   if(room)return;const marker='tda-storage-test';localStorage.setItem(marker,'1');localStorage.removeItem(marker);
   const response=await serverPost('/rooms',{name,externalId:playerId});writeServerSession(response.session,playerId);
   // Discovery contains only an invitation. Owner and seat credentials never enter room metadata.
   await OBR.room.setMetadata({[SERVER_ROOM_KEY]:response.room});await adopt(response.room);return;
  }
  if(command.type==='retry'&&!client){await adopt((await OBR.room.getMetadata())[SERVER_ROOM_KEY]);return;}
  if(!client)throw Error('connecting');await client.command(command);
 }});
 const empty=():TableView=>({actionReceiptVersion:1,table:null,selfPlayerId:playerId,isHost:false,role,connected:true,pending:false,game:null});
 function fail(error:unknown){if(alive)surface.update({...client?.view||empty(),message:error instanceof Error?error.message:'requestFailed',pending:false});}
 async function askAdmission(){
  if(!room||!session||admitted&&role!=='GM'&&session.role!=='GM'||Date.now()-lastAdmission<(admitted?20000:4000))return;lastAdmission=Date.now();
  await OBR.broadcast.sendMessage(SERVER_GRANT,{roomId:room.id,memberId:session.memberId,challenge:session.challenge},{destination:'ALL'});
 }
 async function adopt(raw:unknown){
  const next=serverRoom(raw);if(next?.id===room?.id&&client)return;const mine=++generation;client?.stop();client=undefined;room=next;session=undefined;admitted=false;lastAdmission=0;
  if(!next){surface.update(empty());return;}
  surface.update({...empty(),connected:false,message:'connecting'});
  try{
   const obtained=await registerServerSession(next,playerId,name);if(!alive||generation!==mine)return;session=obtained;
   client=new ServerTableClient(obtained,value=>{surface.update(value);session!.role=value.role||'PLAYER';session!.owner=value.isHost;writeServerSession(session!,playerId);},(seat,g)=>surface.gesture(seat,g),identity=>{
    if(!identity||!session)return;Object.assign(session,identity);admitted=identity.admitted;writeServerSession(session,playerId);void askAdmission().catch(()=>{});
   },()=>surface.failed());client.start();
  }catch(error){fail(error);}
 }
 off.push(setupServerAdmission(),OBR.room.onMetadataChange(metadata=>{void adopt(metadata[SERVER_ROOM_KEY]);}),onLangChange(language=>{surface.language(language);overlay?.setLanguage(language);}));
 if(OBR.player.onChange)off.push(OBR.player.onChange(player=>{if(player.role!==role){role=player.role;lastAdmission=0;void askAdmission().catch(()=>{});}}));
 const timer=setInterval(()=>void askAdmission().catch(()=>{}),5000);
 root.querySelector<HTMLButtonElement>('#language')!.onclick=()=>setLocalLang(getLocalLang()==='en'?'zh':'en');
 function closeOverlay(){overlay?.destroy();overlay=undefined;overlayHost?.remove();overlayHost=undefined;root.inert=false;surface.resume();}
 async function guide(practice=false){
  if(overlay)return;surface.suspend();root.inert=true;overlayHost=document.createElement('div');overlayHost.id=practice?'tutorial-host':'introduction-host';document.body.append(overlayHost);
  try{if(practice){const m=await import('./tutorial');overlay=m.mountTutorial(overlayHost,getLocalLang(),closeOverlay);}else{const m=await import('./onboarding');overlay=m.mountOnboarding(overlayHost,{language:getLocalLang(),getAnchor:zone=>surface.getAnchor(zone),onClose:closeOverlay,onPractice(){closeOverlay();void guide(true);}});}}
  catch{closeOverlay();}
 }
 root.querySelector<HTMLButtonElement>('#tutorial')!.onclick=()=>void guide();
 window.addEventListener('pagehide',()=>{alive=false;++generation;clearInterval(timer);client?.stop();closeOverlay();for(const f of off)f();surface.destroy();},{once:true});
 await adopt(initial[SERVER_ROOM_KEY]);
 try{const draft=readUIDraft(JSON.parse(sessionStorage.getItem(draftKey)||'null'));if(draft)surface.restore(draft);}catch{}
}
