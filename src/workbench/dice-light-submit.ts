import OBR from '@owlbear-rodeo/sdk';
import type {DiceRollPayload,QuickRollRequest} from '../modules/dice';
const REQUEST='com.obr-suite/dice-light-submit',REPLY=REQUEST+'/reply';
type Owner=(request:QuickRollRequest&{commandId?:string;rollId?:string;autoDismiss?:boolean;fixedRaw?:boolean})=>Promise<DiceRollPayload>;
let owner:Owner|undefined,listening=false;
const waiting=new Map<string,{connection:string;resolve:(p:DiceRollPayload)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
export function serveLightDice(connection:string,execute:Owner){
 owner=execute;
 const stop=OBR.broadcast.onMessage(REQUEST,event=>{
  const m=event.data as any;if(event.connectionId!==connection||typeof m?.id!=='string'||m.id.length>100)return;
  void execute({...m.request,commandId:m.id}).then(result=>OBR.broadcast.sendMessage(REPLY,{id:m.id,result},{destination:'LOCAL'}),error=>OBR.broadcast.sendMessage(REPLY,{id:m.id,error:String(error)},{destination:'LOCAL'})).catch(console.warn);
 });return()=>{stop();if(owner===execute)owner=undefined;};
}
export async function submitLightDice(request:QuickRollRequest&{commandId?:string;rollId?:string;autoDismiss?:boolean;fixedRaw?:boolean}):Promise<DiceRollPayload>{
 const id=request.commandId||crypto.randomUUID();if(owner)return owner({...request,commandId:id});
 const connection=await OBR.player.getConnectionId();
 if(!listening){listening=true;OBR.broadcast.onMessage(REPLY,event=>{const m=event.data as any,p=waiting.get(m?.id);if(!p||event.connectionId!==p.connection)return;waiting.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);});}
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{waiting.delete(id);reject(Error('投骰后台未返回，请查看历史记录，避免重复投掷'));},20000);
  waiting.set(id,{connection,resolve,reject,timer});
  void OBR.broadcast.sendMessage(REQUEST,{id,request},{destination:'LOCAL'}).catch(error=>{clearTimeout(timer);waiting.delete(id);reject(error);});
 });
}
// Old SDK callers submit their formula, never their precomputed faces.
export async function submitLightCompat(opts:any):Promise<string>{
 let expression=String(opts.expression||'');
 if(!expression){const groups=new Map<string,number>();for(const d of opts.dice||[])if(!d.loser)groups.set(d.type,(groups.get(d.type)||0)+(d.subtract?-1:1));expression=[...groups].map(([type,n])=>`${n}${type}`).join('+')+`${Number(opts.modifier)>=0?'+':''}${Number(opts.modifier)||0}`;}
 const result=await submitLightDice({...opts,expression});return result.rollId;
}
