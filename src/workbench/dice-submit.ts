import OBR from '@owlbear-rodeo/sdk';
import type {DiceRollPayload,QuickRollRequest} from '../modules/dice';
import {errorText} from '../../extensions/workbench-dice3d/src/types';

// Initiative, bestiary and rule popovers are different JS realms. Only the
// persistent background owns the worker, keys and renderer for this connection.
const REQUEST='com.obr-suite/dice3d-submit',RESPONSE=REQUEST+'/reply';
type Method='formula'|'compat';
type Owner=(method:Method,data:any)=>Promise<any>;
let owner:Owner|undefined,clientListening=false;
const pending=new Map<string,{connection:string;ack:()=>void;finish:(error:unknown,result?:any)=>void}>();

export function serveDiceSubmissions(connection:string,execute:Owner){
 owner=execute;let disposed=false;
 const requests=new Map<string,{task:Promise<any>;timer:ReturnType<typeof setTimeout>}>();
 const send=(data:any)=>OBR.broadcast.sendMessage(RESPONSE,data,{destination:'LOCAL'});
 const stop=OBR.broadcast.onMessage(REQUEST,event=>{
  const data=event.data as any;
  if(disposed||event.connectionId!==connection||!data||typeof data.id!=='string'||data.id.length>80||!['formula','compat'].includes(data.method))return;
  // A retry only repeats the acknowledgement/result, never the roll itself.
  let record=requests.get(data.id);
  if(!record){const task=Promise.resolve().then(()=>{if(disposed)throw Error('骰子场景已改变，本次投骰已取消');return execute(data.method,data.data);});record={task,timer:setTimeout(()=>requests.delete(data.id),250000)};requests.set(data.id,record);}
  void send({id:data.id,ack:true}).catch(()=>{});
  void record.task.then(result=>{if(!disposed)return send({id:data.id,result});},error=>{if(!disposed)return send({id:data.id,error:errorText(error)});}).catch(error=>console.warn('[dice] local submission reply failed',error));
 });
 return()=>{disposed=true;stop();if(owner===execute)owner=undefined;for(const [id,record] of requests){clearTimeout(record.timer);void send({id,error:'骰子场景已改变，本次投骰已取消'}).catch(()=>{});}requests.clear();};
}

async function submit(method:Method,data:any):Promise<any>{
 if(owner)return owner(method,data);
 const connection=await OBR.player.getConnectionId();
 if(!clientListening){clientListening=true;OBR.broadcast.onMessage(RESPONSE,event=>{const reply=event.data as any,request=pending.get(reply?.id);if(!request||event.connectionId!==request.connection)return;if(reply.ack)request.ack();else request.finish(reply.error?Error(reply.error):undefined,reply.result);});}
 const id=crypto.randomUUID();
 return new Promise((resolve,reject)=>{
  let completed=false;
  const finish=(error:unknown,result?:any)=>{if(completed)return;completed=true;clearInterval(retry);clearTimeout(ackTimer);clearTimeout(resultTimer);pending.delete(id);error?reject(error instanceof Error?error:Error(errorText(error))):resolve(result);};
  const send=()=>{void OBR.broadcast.sendMessage(REQUEST,{id,method,data},{destination:'LOCAL'}).catch(error=>finish(error));};
  const retry=setInterval(send,500),ackTimer=setTimeout(()=>finish(Error('未收到骰子后台确认，结果暂不确定；请先查看历史记录，避免重复投掷')),5000),resultTimer=setTimeout(()=>finish(Error('3D 投骰超过 240 秒未返回，请查看网络/物理错误')),245000);
  pending.set(id,{connection,ack:()=>{clearInterval(retry);clearTimeout(ackTimer);},finish});send();
 });
}
export const submitDice3d=(request:QuickRollRequest):Promise<DiceRollPayload>=>submit('formula',request);
export const submitCompat3d=(request:any):Promise<string>=>submit('compat',request);
