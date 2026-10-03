import type {TableView} from './protocol';
import type {TableUICommand} from './ui-command';
import {applyObjectPatch,type ServerSession} from './server-protocol';
import {unpackPublic,unpackSeat} from './wire';
import {unpackOmniscient} from './local-view';
import {serverBase} from './server-session';
import type {HandGesture} from './gesture';
export class ServerTableClient {
 private socket?:WebSocket;private stopped=false;private timer?:ReturnType<typeof setTimeout>;private retry=0;private seq=0;private wire:any;
 private pending?:{id:string;command:any;dismissalBefore?:string|null};private receipt:TableView['actionReceipt'];private message?:string;private gestureValue?:HandGesture;private gestureTimer?:ReturnType<typeof setTimeout>;
 private dismissedGameId?:string;
 private get dismissalKey(){return `three-dragon-ended-exit:${this.session.roomId}:${this.session.memberId}`;}
 private dismiss(gameId:string|undefined,persist=true){
  this.dismissedGameId=gameId;
  if(persist)try{if(gameId)sessionStorage.setItem(this.dismissalKey,gameId);else sessionStorage.removeItem(this.dismissalKey);}catch{}
 }
 private viewValue:TableView;private commandTimer?:ReturnType<typeof setTimeout>;
 constructor(private session:ServerSession,private changed:(view:TableView)=>void,private gesture:(seat:string,value:HandGesture)=>void,private identity:(value:any)=>void,private stalled:()=>void=()=>{}){
  try{this.dismissedGameId=sessionStorage.getItem(this.dismissalKey)||undefined;}catch{}
  this.viewValue={actionReceiptVersion:1,table:null,selfPlayerId:session.memberId,isHost:session.owner,connected:false,pending:false,game:null};
 }
 get view(){return this.viewValue;}
 start(){this.stopped=false;this.connect();}
 private connect(){
  if(this.stopped)return;let authenticated=false;const ws=this.socket=new WebSocket(serverBase.replace(/^http/,'ws')+'/socket');
  ws.onopen=()=>ws.send(JSON.stringify({type:'auth',room:this.session.roomId,token:this.session.token}));
  ws.onmessage=event=>{if(this.socket!==ws)return;try{
   const packet=JSON.parse(event.data);
   if(packet.type==='view'){this.wire=packet.view;this.seq=packet.seq;this.retry=0;this.message=undefined;this.identity(packet.identity);this.apply();if(!authenticated&&this.pending)ws.send(JSON.stringify({type:'command',id:this.pending.id,command:this.pending.command}));authenticated=true;}
   else if(packet.type==='patch'){
    if(!this.wire||packet.base!==this.seq){ws.send(JSON.stringify({type:'sync'}));return;}
    const root=applyObjectPatch(this.wire,packet.patch);root.game=packet.gamePatch?applyObjectPatch(this.wire.game,packet.gamePatch):packet.game;
    this.wire=root;this.seq=packet.seq;this.message=undefined;this.apply();
   }else if(packet.type==='ack'){
    const pending=this.pending;if(!pending||packet.id!==pending.id)return;
    if(pending.dismissalBefore!==undefined)this.dismiss(packet.ok?this.dismissedGameId:pending.dismissalBefore||undefined);
    if(packet.ok&&pending.command.type==='join')this.dismiss(undefined);
    clearTimeout(this.commandTimer);this.pending=undefined;this.message=packet.ok?undefined:packet.code;if(packet.actionReceipt)this.receipt=packet.actionReceipt;this.apply();
   }else if(packet.type==='history'){
    if(packet.id!==this.pending?.id)return;clearTimeout(this.commandTimer);this.pending=undefined;this.apply(packet.page);
   }else if(packet.type==='gestures')for(const item of packet.values||[])this.gesture(item.seatId,item.gesture);
  }catch{this.message='protocolMismatch';this.apply();}};
  ws.onclose=()=>{if(this.socket!==ws||this.stopped)return;this.viewValue={...this.viewValue,connected:false,message:'connecting'};this.changed(this.viewValue);if(this.pending)this.stalled();this.timer=setTimeout(()=>this.connect(),Math.min(8000,500*2**Math.min(4,this.retry++)));};
  ws.onerror=()=>{};
 }
 private apply(historyPage?:TableView['historyPage']){
  if(!this.wire)return;const game=this.wire.game;
  // Never replay a previous game's optimistic exit into a replacement game.
  // Its late ACK is ignored after cancellation just like any superseded request.
  if(this.pending?.dismissalBefore!==undefined&&(game?.id!==this.pending.command.gameId||game?.phase!=='ended')){
   clearTimeout(this.commandTimer);this.pending=undefined;this.dismiss(undefined);
  }
  if(this.receipt&&this.receipt.gameId!==game?.id)this.receipt=undefined;
  const decoded=game===null?null:game.omniscient?unpackOmniscient(game):'selfSeatId'in game?unpackSeat(game):unpackPublic(game);
  // Leaving a completed game is local navigation. Keep the authoritative wire
  // snapshot intact so other members, history and the next game are untouched.
  if(this.dismissedGameId&&decoded&&(decoded.id!==this.dismissedGameId||decoded.phase!=='ended'))this.dismiss(undefined);
  const visible=decoded?.id===this.dismissedGameId?null:decoded;
  const connected=this.socket?.readyState===WebSocket.OPEN;
  this.viewValue={...this.wire,game:visible,connected,pending:!!this.pending,historyPage,message:this.message||this.wire.message,actionReceipt:this.receipt||this.wire.actionReceipt};
  this.changed(this.viewValue);
 }
 async command(command:TableUICommand){
  if(command.type==='retry'){
   if(this.socket?.readyState!==WebSocket.OPEN){clearTimeout(this.timer);this.socket?.close();this.connect();return;}
   if(this.pending){this.socket.send(JSON.stringify({type:'command',id:this.pending.id,command:this.pending.command}));return;}
   if('action'in command&&command.action)command={type:'action',action:command.action};else{this.socket.send(JSON.stringify({type:'sync'}));return;}
  }
  if(this.pending)throw Error('privateSync');if(this.socket?.readyState!==WebSocket.OPEN)throw Error('connecting');
  const endedExit=command.type==='leave'&&this.wire?.table?.stage==='ended'&&this.wire?.game?.phase==='ended';
  const dismissalBefore=this.dismissedGameId||null;
  this.pending={id:crypto.randomUUID(),command:{...command,gameId:this.wire?.game?.id||null},...(endedExit?{dismissalBefore}:{})};
  // Show the main screen on click, even on a slow connection. A rejection
  // restores the result view; a successful join explicitly reopens it.
  if(endedExit)this.dismiss(this.wire.game.id,false);
  this.receipt=undefined;this.message=undefined;this.apply();
  try{this.socket.send(JSON.stringify({type:'command',id:this.pending.id,command:this.pending.command}));}
  catch(error){this.pending=undefined;if(endedExit)this.dismiss(dismissalBefore||undefined);this.apply();throw error;}
  clearTimeout(this.commandTimer);this.commandTimer=setTimeout(()=>{if(this.pending)this.stalled();},8000);
 }
 sendGesture(value:HandGesture){this.gestureValue=value;if(this.gestureTimer)return;this.gestureTimer=setTimeout(()=>{this.gestureTimer=undefined;const gesture=this.gestureValue;this.gestureValue=undefined;if(this.socket?.readyState===WebSocket.OPEN&&this.socket.bufferedAmount<16000&&gesture)this.socket.send(JSON.stringify({type:'gesture',gesture}));},250);}
 stop(){this.stopped=true;clearTimeout(this.timer);clearTimeout(this.gestureTimer);clearTimeout(this.commandTimer);this.socket?.close();}
}
