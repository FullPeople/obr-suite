import OBR from '@owlbear-rodeo/sdk';
import {DiceSendQueue} from './dice-send-queue';
const queue=new DiceSendQueue();
export const sendDiceMessage=(channel:string,data:any,options:{destination:'LOCAL'|'REMOTE'|'ALL'},valid=()=>true)=>queue.send(()=>OBR.broadcast.sendMessage(channel,data,options),valid);
