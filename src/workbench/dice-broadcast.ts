import OBR from '@owlbear-rodeo/sdk';
import {DiceSendQueue} from './dice-send-queue';
const queue=new DiceSendQueue();
// Control packets must not sit behind hundreds of trajectory repair fragments.
// Both priorities still share the same SDK rate budget and bounded retry policy.
const controlTypes=new Set(['hello','ping','pong','ready','start','start-group','start-ack','offer','chunks-done','abort','secret-failed','request-ack','roll-rejected']);
export const sendDiceMessage=(channel:string,data:any,options:{destination:'LOCAL'|'REMOTE'|'ALL'},valid=()=>true,beforeDispatch?:()=>void)=>queue.send(()=>{beforeDispatch?.();return OBR.broadcast.sendMessage(channel,data,options);},valid,controlTypes.has(data?.type)?'control':'normal');
