import type {TableView} from './protocol';
import type {TableUICommand} from './ui-command';
import {applyObjectPatch,type ServerSession} from './server-protocol';
import {unpackPublic,unpackSeat} from './wire';
import {unpackOmniscient} from './local-view';
import {serverBase} from './server-session';
import type {HandGesture} from './gesture';
export class ServerTableClient {
 private socket?:WebSocket;private stopped=false;private timer?:ReturnType<typeof setTimeout>;private retry=0;private seq=0;private wire:any;
 private pending?:{id:string;command:any};private receipt:TableView['actionReceipt'];private message?:string;private gestureValue?:HandGesture;private gestureTimer?:ReturnType<typeof setTimeout>;
 private viewValue:TableView;private commandTimer?:ReturnType<typeof setTimeout>;
 constructor(private session:ServerSession,private changed:(view:TableView)=>void,private gesture:(seat:string,value:HandGesture)=>void,private identity:(value:any)=>void,private stalled:()=>void=()=>{}){
  this.viewValue={actionReceiptVersion:1,table:null,selfPlayerId:session.memberId,isHost:session.owner,connected:false,pending:false,game:null};
 }
 get view(){return this.viewValue;}
 start(){this.stopped=false;this.connect();}
 private connect(){
  if(this.stopped)return;let authenticated=false;const ws=this.socket=new WebSocket(serverBase.replace(/^http/,'ws')+'/socket');
  ws.onopen=()=>ws.send(JSON.stringify({type:'auth',room:this.session.roomId,token:this.session.token}));
  ws.onmessage=event=>{if(this.socket!==ws)return;try{
   const packet=JSON.parse(event.data);
   if(packet.type==='view'){this.wire=packet.view;this.seq=packet.seq;this.retry=0;this.message=undefined;this.identity(packet.identity);this.apply();if(!authenticated&&this.pending)ws.send(JSON.stringify({type:'command',...this.pending}));authenticated=true;}
   else if(packet.type==='patch'){
    if(!this.wire||packet.base!==this.seq){ws.send(JSON.stringify({type:'sync'}));return;}
    const root=applyObjectPatch(this.wire,packet.patch);root.game=packet.gamePatch?applyObjectPatch(this.wire.game,packet.gamePatch):packet.game;
    this.wire=root;this.seq=packet.seq;this.message=undefined;this.apply();
   }else if(packet.type==='ack'){
    if(packet.id!==this.pending?.id)return;
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
  if(this.receipt&&this.receipt.gameId!==game?.id)this.receipt=undefined;
  const decoded=game===null?null:game.omniscient?unpackOmniscient(game):'selfSeatId'in game?unpackSeat(game):unpackPublic(game);
  const connected=this.socket?.readyState===WebSocket.OPEN;
  this.viewValue={...this.wire,game:decoded,connected,pending:!!this.pending,historyPage,message:this.message||this.wire.message,actionReceipt:this.receipt||this.wire.actionReceipt};
  this.changed(this.viewValue);
 }
 async command(command:TableUICommand){
  if(command.type==='retry'){
   if(this.socket?.readyState!==WebSocket.OPEN){clearTimeout(this.timer);this.socket?.close();this.connect();return;}
   if(this.pending){this.socket.send(JSON.stringify({type:'command',...this.pending}));return;}
   if('action'in command&&command.action)command={type:'action',action:command.action};else{this.socket.send(JSON.stringify({type:'sync'}));return;}
  }
  if(this.pending)throw Error('privateSync');if(this.socket?.readyState!==WebSocket.OPEN)throw Error('connecting');
  this.pending={id:crypto.randomUUID(),command:{...command,gameId:this.viewValue.game?.id||null}};this.receipt=undefined;this.message=undefined;this.apply();
  this.socket.send(JSON.stringify({type:'command',...this.pending}));
  clearTimeout(this.commandTimer);this.commandTimer=setTimeout(()=>{if(this.pending)this.stalled();},8000);
 }
 sendGesture(value:HandGesture){this.gestureValue=value;if(this.gestureTimer)return;this.gestureTimer=setTimeout(()=>{this.gestureTimer=undefined;const gesture=this.gestureValue;this.gestureValue=undefined;if(this.socket?.readyState===WebSocket.OPEN&&this.socket.bufferedAmount<16000&&gesture)this.socket.send(JSON.stringify({type:'gesture',gesture}));},250);}
 stop(){this.stopped=true;clearTimeout(this.timer);clearTimeout(this.gestureTimer);clearTimeout(this.commandTimer);this.socket?.close();}
}
