import OBR from '@owlbear-rodeo/sdk';
export type DiceIdentity={id:string;connectionId:string;name:string;color:string;role:string;metadata:Record<string,unknown>};
let profile:DiceIdentity|undefined,flight:Promise<DiceIdentity>|undefined;
let stop:(()=>void)|undefined;
let generation=0;
export function diceIdentity():Promise<DiceIdentity>{
 if(profile)return Promise.resolve(profile);
 if(flight)return flight;
 const own=generation;
 let observed:Partial<DiceIdentity>|undefined;
 stop=OBR.player.onChange(value=>{if(own!==generation)return;observed=value;if(profile)Object.assign(profile,value);});
 const task=Promise.all([OBR.player.getId(),OBR.player.getConnectionId(),OBR.player.getName(),OBR.player.getColor(),OBR.player.getRole()]).then(([id,connectionId,name,color,role])=>{
  const value={id,connectionId,name,color,role,metadata:{},...observed};
  if(own!==generation)return value;
  profile=value;
  return profile;
 }).catch(error=>{if(flight===task){flight=undefined;stop?.();stop=undefined;}throw error;});
 return flight=task;
}
export function resetDiceIdentity(){generation++;stop?.();stop=undefined;profile=undefined;flight=undefined;}
