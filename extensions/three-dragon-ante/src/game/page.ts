import { TABLE_GESTURE } from "./gesture";
import OBR from "@owlbear-rodeo/sdk";
import {getLocalLang,onLangChange,setLocalLang} from "../locale";
import {TABLE_COMMAND,TABLE_READY,TABLE_VIEW} from "./protocol";
import {mountTableUI} from "./ui";
import {LocalViewReceiver} from "./local-view";
import {TABLE_UI_RESTORE} from "./ui-command";
import "./style.css";
let alive=true,connectionId="",timer:ReturnType<typeof setTimeout>|undefined;
const clientId=crypto.randomUUID(),instance=new URLSearchParams(location.search).get("instance")??"",receiver=new LocalViewReceiver(clientId);
const unsubs:Array<()=>void>=[];
const surface=mountTableUI(document.getElementById("table-app")!,{language:getLocalLang(),gesture:gesture=>{void OBR.broadcast.sendMessage(TABLE_GESTURE,{clientId,instance,gesture},{destination:"LOCAL"}).catch(()=>{});},mode:new URLSearchParams(location.search).get("mode")==="compact"?"compact":"full",send:async command=>{
 if(!alive)return;
 if(timer)clearTimeout(timer);
 if(!["close","display","remember"].includes(command.type))timer=setTimeout(()=>surface.failed(),12000);
 await OBR.broadcast.sendMessage(TABLE_COMMAND,{clientId,instance,command},{destination:"LOCAL"});
}});
let tutorial: { setLanguage(language: "zh" | "en"): void; destroy(): void } | undefined, tutorialOpening = false;
document.getElementById("tutorial")!.onclick = async () => {
 if (tutorial || tutorialOpening || !alive) return;
 tutorialOpening = true;
 let tutorialParent: HTMLElement | undefined;
 try {
  const { mountTutorial } = await import("./tutorial"); if (!alive) return;
  const parent = tutorialParent = document.createElement("div"); parent.id = "tutorial-host"; document.body.append(parent);
  void OBR.broadcast.sendMessage(TABLE_GESTURE,{clientId,instance,clear:true},{destination:"LOCAL"}).catch(()=>{});
  const table = document.getElementById("table-app")!; table.inert = true;
  tutorial = mountTutorial(parent,getLocalLang(),() => { tutorial?.destroy(); tutorial=undefined;parent.remove();table.inert=false;surface.language(getLocalLang());document.getElementById("tutorial")?.focus(); });
 } catch {
  tutorialParent?.remove(); document.getElementById("table-app")!.inert=false;
  if(alive){const status=document.getElementById("status")!;status.hidden=false;status.textContent=getLocalLang()==="zh"?"教程暂时未能加载，请再点一次重试。":"The tutorial could not load. Select Learn by playing to retry.";}
 } finally { tutorialOpening=false; }
};
window.addEventListener("pagehide",()=>{tutorial?.destroy();tutorial=undefined;document.getElementById("tutorial-host")?.remove();},{once:true});
document.getElementById("language")!.onclick=()=>setLocalLang(getLocalLang()==="en"?"zh":"en");
unsubs.push(onLangChange(language=>{surface.language(language);tutorial?.setLanguage(language);}));
window.addEventListener("pagehide",()=>{void OBR.broadcast.sendMessage(TABLE_GESTURE,{clientId,instance,clear:true},{destination:"LOCAL"}).catch(()=>{});const draft=surface.draft();if(draft)void OBR.broadcast.sendMessage(TABLE_COMMAND,{clientId,instance,command:{type:"remember",draft}},{destination:"LOCAL"}).catch(()=>{});alive=false;if(timer)clearTimeout(timer);for(const off of unsubs)off();receiver.clear();surface.destroy();});
OBR.onReady(async()=>{try{
 connectionId=await OBR.player.getConnectionId();if(!alive)return;
 unsubs.push(OBR.broadcast.onMessage(TABLE_GESTURE,event=>{const data=event.data as {clientId?:unknown;instance?:unknown;seatId?:unknown;gesture?:unknown};if(alive&&event.connectionId===connectionId&&data?.clientId===clientId&&data.instance===instance&&typeof data.seatId==="string")surface.gesture(data.seatId,data.gesture);}));
 unsubs.push(OBR.broadcast.onMessage(TABLE_UI_RESTORE,event=>{const data=event.data as {clientId?:unknown;instance?:unknown;draft?:unknown};if(alive&&event.connectionId===connectionId&&data?.clientId===clientId&&data.instance===instance)surface.restore(data.draft);}));
 unsubs.push(OBR.broadcast.onMessage(TABLE_VIEW,event=>{if(!alive||event.connectionId!==connectionId)return;const view=receiver.receive(event.data);if(!view)return;if(timer)clearTimeout(timer);surface.update(view);if(view.pending)timer=setTimeout(()=>surface.failed(),12000);}));
 timer=setTimeout(()=>surface.failed(),12000);await OBR.broadcast.sendMessage(TABLE_READY,{clientId,instance}, {destination:"LOCAL"});
 }catch{if(alive)surface.failed();}
});
