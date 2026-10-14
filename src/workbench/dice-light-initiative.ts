import OBR from '@owlbear-rodeo/sdk';
import {submitLightDice} from './dice-light-submit';
import {isGlobalDarkRollEnabled} from '../modules/dice';
export async function rollLightInitiative(itemId:string,variant:string,label='先攻',collectiveId?:string){
 const [item]=await OBR.scene.items.getItems([itemId]);if(!item)throw Error('先攻目标不存在');
 const bonus=Number(item.metadata['com.initiative-tracker/dexMod'])||0;
 const hidden=!!(item.metadata['com.initiative-tracker/data'] as any)?.invisible||isGlobalDarkRollEnabled();
 const result=await submitLightDice({expression:`1d20${bonus>=0?'+':''}${bonus}`,itemId,label,advMode:variant==='advantage'||variant==='adv'?'adv':variant==='disadvantage'||variant==='dis'?'dis':undefined,hidden,collectiveId,autoDismiss:true,fixedRaw:true});
 // Settlement uses the same authoritative faces as the animation, without another roll.
 const raw=result.total-result.modifier;
 await OBR.scene.items.updateItems([itemId],items=>{for(const token of items){const old=token.metadata['com.initiative-tracker/data'] as any;token.metadata['com.initiative-tracker/data']={...old,count:raw,rolled:true,active:old?.active??false,ownerId:old?.ownerId??token.createdUserId};}});
 return {...result,total:raw+bonus};
}
