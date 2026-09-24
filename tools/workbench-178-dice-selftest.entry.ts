import OBR from '@owlbear-rodeo/sdk';
import {workbenchObservation} from '../src/workbench/observation';
import {executeRoll} from '../src/workbench/dice';
import {diceRpc} from '../src/workbench/dice-rpc';
import {disarmFixedRoll,readFixedRoll} from '../src/modules/dice/fixed-roll';
const state=window as any;
state.diceReads=[];
for(const [name,api] of Object.entries({player:OBR.player,party:OBR.party,scene:OBR.scene,items:OBR.scene.items}))for(const [key,value] of Object.entries(api))if(typeof value==='function'&&(key.startsWith('get')||key==='isReady'))(api as any)[key]=async(...args:any[])=>{state.diceReads.push(`${name}.${key}`);await new Promise(r=>setTimeout(r,40));return (value as Function)(...args);};
state.dice178={warm:()=>workbenchObservation().read(),executeRoll,diceRpc,disarmFixedRoll,readFixedRoll};
