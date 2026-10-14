import OBR from '@owlbear-rodeo/sdk';
export type DiceIdentity={id:string;connectionId:string;name:string;color:string;role:string;metadata:Record<string,unknown>};
let profile:DiceIdentity|undefined,flight:Promise<DiceIdentity>|undefined;
let stop:(()=>void)|undefined;
export function diceIdentity():Promise<DiceIdentity>{
 if(profile)return Promise.resolve(profile);
 return flight??=Promise.all([OBR.player.getId(),OBR.player.getConnectionId(),OBR.player.getName(),OBR.player.getColor(),OBR.player.getRole()]).then(([id,connectionId,name,color,role])=>{
  profile={id,connectionId,name,color,role,metadata:{}};
  stop??=OBR.player.onChange(p=>{if(profile)Object.assign(profile,p);});return profile;
 }).catch(error=>{flight=undefined;throw error;});
}
export function resetDiceIdentity(){stop?.();stop=undefined;profile=undefined;flight=undefined;}
