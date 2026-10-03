import OBR from '@owlbear-rodeo/sdk';
import {setupDice3d,submitDice3d,submitDice3dGroup,submitCompat3d,dice3dRpc,resultListeners} from './dice3d';
import {CHANNEL} from '../../extensions/workbench-dice3d/src/types';
import {setupWorkbenchDice,rolls} from './dice';
import {diceRpc} from './dice-rpc';
OBR.onReady(async()=>{const results:any[]=[],events:any[]=[],local=new BroadcastChannel(`${CHANNEL}:local:${await OBR.player.getConnectionId()}`);local.onmessage=e=>{if(e.data.type==='state'||e.data.type==='log')events.push(e.data);};resultListeners.add((data,revealed)=>results.push({data,revealed}));(window as any).suiteHostProbe={submitDice3d,submitDice3dGroup,submitCompat3d,dice3dRpc,diceRpc,results,events,rolls,stage:'initializing'};try{await Promise.all([setupWorkbenchDice(),setupWorkbenchDice()]);(window as any).suiteHostProbe.stage='ready';}catch(error){(window as any).suiteHostProbe.error=String(error);throw error;}});
