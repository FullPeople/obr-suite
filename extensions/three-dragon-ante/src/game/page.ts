import { TABLE_GESTURE } from "./gesture";
import OBR from "@owlbear-rodeo/sdk";
import {getLocalLang,onLangChange,setLocalLang} from "../locale";
import {TABLE_COMMAND,TABLE_READY,TABLE_VIEW} from "./protocol";
import {mountTableUI} from "./ui";
import {LocalViewReceiver} from "./local-view";
import {createIdentity, type Identity} from "./identity";
import {describeError, diag, throttle} from "./diagnostics";
import {sendQueued} from "./broadcast";
import {TABLE_UI_RESTORE} from "./ui-command";
import "./style.css";
import "./stage-ui.css";

let alive=true,connectionId="",timer:ReturnType<typeof setTimeout>|undefined;
let receivedView=false,handshake:Promise<void>|undefined;
let identity:Identity|null=null,lastViewAt=0,viewCount=0,lastSignature="";
const logOnce=throttle(1000),logRare=throttle(5000);
const clientId=crypto.randomUUID(),instance=new URLSearchParams(location.search).get("instance")??"",receiver=new LocalViewReceiver(clientId,(reason,detail)=>{
 // A dropped part is the difference between "the host sent nothing" and "this
 // page refused what it got", so it must name itself in the console.
 if(logOnce(`drop:${reason}`))diag("view",`part dropped (${reason})`,detail);
});
const unsubs:Array<()=>void>=[],table=document.getElementById("table-app")!;
const surface=mountTableUI(table,{language:getLocalLang(),gesture:gesture=>{void sendQueued(()=>OBR.broadcast.sendMessage(TABLE_GESTURE,{clientId,instance,gesture},{destination:"LOCAL"})).catch(()=>{});},mode:new URLSearchParams(location.search).get("mode")==="compact"?"compact":"full",send:async command=>{
 if(!alive)return;
 if(timer)clearTimeout(timer);timer=undefined;
 if(!["close","display","remember"].includes(command.type))timer=setTimeout(()=>surface.failed(),12000);
 if(command.type==="retry"&&!receivedView){diag("cmd","retry re-connects the page",{receivedView});await connectPage();return;}
 try{
  await sendQueued(()=>OBR.broadcast.sendMessage(TABLE_COMMAND,{clientId,instance,command},{destination:"LOCAL"}));
  if(logOnce("cmd"))diag("cmd","sent",{type:command.type,connection:identity?.id??"?"});
 }catch(error){diag("cmd","send failed",{type:command.type,error:describeError(error),connection:identity?.id??"?"});throw error;}
}});
type Overlay={setLanguage(language:"zh"|"en"):void;destroy():void};
let overlay:Overlay|undefined,overlayParent:HTMLElement|undefined,opening=false,overlayGeneration=0;
const INTRO_KEY="three-dragon-ante.introduction.v1";
function markIntroduction(){try{localStorage.setItem(INTRO_KEY,"seen");}catch{/* A blocked preference never blocks the table. */}}
function closeOverlay(restore=true){
 overlayGeneration++;opening=false;const old=overlay;overlay=undefined;old?.destroy();overlayParent?.remove();overlayParent=undefined;
 if(restore&&alive){table.inert=false;surface.language(getLocalLang());surface.resume();table.querySelector<HTMLElement>("#tutorial")?.focus();}
}
async function openOverlay(kind:"introduction"|"practice"){
 if(!alive||opening||overlay)return;
 const generation=++overlayGeneration;opening=true;surface.suspend();table.inert=true;
 void sendQueued(()=>OBR.broadcast.sendMessage(TABLE_GESTURE,{clientId,instance,clear:true},{destination:"LOCAL"})).catch(()=>{});
 try{
  const module=kind==="practice"?await import("./tutorial"):await import("./onboarding");
  if(!alive||generation!==overlayGeneration)return;
  const parent=overlayParent=document.createElement("div");parent.id=kind==="practice"?"tutorial-host":"introduction-host";document.body.append(parent);
  if("mountTutorial" in module)overlay=module.mountTutorial(parent,getLocalLang(),()=>closeOverlay());
  else overlay=module.mountOnboarding(parent,{language:getLocalLang(),getAnchor:zone=>surface.getAnchor(zone),onClose(){markIntroduction();closeOverlay();},onPractice(){markIntroduction();closeOverlay(false);void openOverlay("practice");}});
 }catch{
  if(alive&&generation===overlayGeneration){closeOverlay();const status=table.querySelector<HTMLElement>("#status")!;status.hidden=false;status.textContent=getLocalLang()==="zh"?"教学暂时未能加载，请再点一次重试。":"The guide could not load. Select How to play to retry.";}
 }finally{if(generation===overlayGeneration)opening=false;}
}
table.querySelector<HTMLButtonElement>("#tutorial")!.onclick=()=>{void openOverlay("introduction");};
table.querySelector<HTMLButtonElement>("#language")!.onclick=()=>setLocalLang(getLocalLang()==="en"?"zh":"en");
unsubs.push(onLangChange(language=>{surface.language(language);overlay?.setLanguage(language);}));
window.addEventListener("pagehide",()=>{
 if(!alive)return;alive=false;closeOverlay(false);
 void sendQueued(()=>OBR.broadcast.sendMessage(TABLE_GESTURE,{clientId,instance,clear:true},{destination:"LOCAL"})).catch(()=>{});
 const draft=surface.draft();if(draft)void sendQueued(()=>OBR.broadcast.sendMessage(TABLE_COMMAND,{clientId,instance,command:{type:"remember",draft}},{destination:"LOCAL"})).catch(()=>{});
 if(timer)clearTimeout(timer);for(const off of unsubs)off();receiver.clear();surface.destroy();
},{once:true});
function connectPage():Promise<void>{
 if(handshake)return handshake;
 const run=(async()=>{try{
 if(!connectionId){
  const current=await OBR.player.getConnectionId();if(!alive)return;connectionId=current;
  if(!identity)identity=createIdentity(connectionId,"panel");else identity.set(connectionId);
  diag("boot","panel ready",{connection:connectionId,client:clientId,instance});
 unsubs.push(OBR.broadcast.onMessage(TABLE_GESTURE,event=>{const data=event.data as {clientId?:unknown;instance?:unknown;seatId?:unknown;gesture?:unknown};if(alive&&event.connectionId===connectionId&&data?.clientId===clientId&&data.instance===instance&&typeof data.seatId==="string")surface.gesture(data.seatId,data.gesture);}));
 unsubs.push(OBR.broadcast.onMessage(TABLE_UI_RESTORE,event=>{const data=event.data as {clientId?:unknown;instance?:unknown;draft?:unknown};if(alive&&event.connectionId===connectionId&&data?.clientId===clientId&&data.instance===instance)surface.restore(data.draft);}));
 unsubs.push(OBR.broadcast.onMessage(TABLE_VIEW,event=>{void(async()=>{
 if(!alive)return;
 // Owlbear can re-issue this client's connection id; a cached copy would drop
 // every view for the rest of the session.
 if(identity&&!(await identity.matches(event.connectionId)))return;
 const view=receiver.receive(event.data);
 if(!view)return;receivedView=true;lastViewAt=Date.now();viewCount++;
 const signature=`${view.connected}|${view.message??""}|${view.game&&"revision"in view.game?view.game.revision:""}|${view.pending}`;
 if(signature!==lastSignature){lastSignature=signature;diag("view","applied",{count:viewCount,connected:view.connected,message:view.message??"",revision:view.game&&"revision"in view.game?view.game.revision:null,pending:view.pending});}
 surface.update(view);
  // Regular three-second snapshots cannot extend this submission's deadline.
  if(view.pending||surface.waitingForReceipt()){if(timer===undefined)timer=setTimeout(()=>surface.failed(),12000);}
  else{if(timer)clearTimeout(timer);timer=undefined;}
 })();}));}
 if(timer)clearTimeout(timer);timer=setTimeout(()=>surface.failed(),12000);await sendQueued(()=>OBR.broadcast.sendMessage(TABLE_READY,{clientId,instance}, {destination:"LOCAL"}));
 if(!alive)return;let seen=false;try{seen=localStorage.getItem(INTRO_KEY)==="seen";}catch{}
 if(!seen)void openOverlay("introduction");
 }catch(error){if(alive)surface.failed();throw error;}})();
 handshake=run;void run.finally(()=>{if(handshake===run)handshake=undefined;}).catch(()=>{});return run;
}
/** While the page has no fresh view, one line every five seconds says how long
 *  it has been waiting and what it last saw — the part a screenshot can carry. */
function watchdog(){
 if(!alive)return;
 if(!receivedView)diag("diag","no view has ever arrived",{client:clientId,instance,connection:identity?.id??(connectionId||"?"),handshake:!!handshake});
 else if(Date.now()-lastViewAt>5000)diag("diag",`no view for ${Math.round((Date.now()-lastViewAt)/1000)}s`,{count:viewCount,connection:identity?.id??(connectionId||"?"),applied:lastSignature});
}
setInterval(watchdog,5000);
OBR.onReady(()=>{void connectPage().catch(()=>{});});
