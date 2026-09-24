// Appended to the original Music Studio module by the workbench build.
// Playback stays in Owlbear; this frame only edits the shared music session.
import OBR, {workbenchPanelRequest} from './panel-sdk.ts';
let embeddedSequence = 0;
const embeddedSession = crypto.randomUUID();
function embeddedSnapshot(result) {
 if (!result?.state) return;
 document.body.dataset.canControl = String(result.canControl);
 _roomSync?.receive({type:'room-state',protocol:2,sessionId:embeddedSession,sequence:++embeddedSequence,sentAt:Date.now(),state:result.state,adoptStudio:false});
}
async function embeddedSend(message) {
 if(message.type==='studio-ready'){embeddedSnapshot(await workbenchPanelRequest('studio.read'));return;}
 if(message.type!=='studio-command')return;
 try {embeddedSnapshot(await workbenchPanelRequest('studio.command',message.command,message.requestId));_roomSync?.receive({type:'studio-ack',sessionId:embeddedSession,requestId:message.requestId,ok:true});}
 catch(error){_roomSync?.receive({type:'studio-ack',sessionId:embeddedSession,requestId:message.requestId,ok:false,error:String(error)});}
}
OBR.onReady(async()=>{
 setLocalMute(true);setPairUi('live');
 _peerConn={open:true,send:message=>void embeddedSend(message),close(){}};
 _roomSync=new StudioRoomSync(message=>void embeddedSend(message).catch(error=>toast(String(error),'error')),applyRoomState,()=>{},()=>toast('音乐修改未成功，请检查连接与控制权限','warn'));
 OBR.broadcast.onMessage('com.obr-suite/music-board:view',event=>embeddedSnapshot(event.data));
 await OBR.broadcast.sendMessage('com.obr-suite/music-board:ready',{workbench:true},{destination:'LOCAL'});
 document.body.classList.add('workbench-studio');
});
window.addEventListener('pagehide',()=>{_roomSync?.dispose();_peerConn=null;});
