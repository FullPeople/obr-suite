import OBR from "@owlbear-rodeo/sdk";
import {getLocalLang,onLangChange} from "../../state";
import {TABLE_COMMAND,TABLE_READY,TABLE_VIEW} from "./protocol";
import {mountTableUI} from "./ui";
import {LocalViewReceiver} from "./local-view";
import {TABLE_UI_RESTORE} from "./ui-command";
import "./style.css";
let alive=true,connectionId="",timer:ReturnType<typeof setTimeout>|undefined;
const clientId=crypto.randomUUID(),instance=new URLSearchParams(location.search).get("instance")??"",receiver=new LocalViewReceiver(clientId);
const unsubs:Array<()=>void>=[];
const surface=mountTableUI(document.getElementById("table-app")!,{language:getLocalLang(),mode:new URLSearchParams(location.search).get("mode")==="compact"?"compact":"full",send:async command=>{
 if(!alive)return;
 if(timer)clearTimeout(timer);
 if(!["close","display","remember"].includes(command.type))timer=setTimeout(()=>surface.failed(),12000);
 await OBR.broadcast.sendMessage(TABLE_COMMAND,{clientId,instance,command},{destination:"LOCAL"});
}});
unsubs.push(onLangChange(language=>surface.language(language)));
window.addEventListener("pagehide",()=>{const draft=surface.draft();if(draft)void OBR.broadcast.sendMessage(TABLE_COMMAND,{clientId,instance,command:{type:"remember",draft}},{destination:"LOCAL"}).catch(()=>{});alive=false;if(timer)clearTimeout(timer);for(const off of unsubs)off();receiver.clear();surface.destroy();});
OBR.onReady(async()=>{try{
 connectionId=await OBR.player.getConnectionId();if(!alive)return;
 unsubs.push(OBR.broadcast.onMessage(TABLE_UI_RESTORE,event=>{const data=event.data as {clientId?:unknown;instance?:unknown;draft?:unknown};if(alive&&event.connectionId===connectionId&&data?.clientId===clientId&&data.instance===instance)surface.restore(data.draft);}));
 unsubs.push(OBR.broadcast.onMessage(TABLE_VIEW,event=>{if(!alive||event.connectionId!==connectionId)return;const view=receiver.receive(event.data);if(!view)return;if(timer)clearTimeout(timer);surface.update(view);if(view.pending)timer=setTimeout(()=>surface.failed(),12000);}));
 timer=setTimeout(()=>surface.failed(),12000);await OBR.broadcast.sendMessage(TABLE_READY,{clientId,instance}, {destination:"LOCAL"});
 }catch{if(alive)surface.failed();}
});
