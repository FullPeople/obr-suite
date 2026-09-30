import OBR from '@owlbear-rodeo/sdk';
import {setupDice3d,submitDice3d,submitCompat3d,dice3dRpc,resultListeners} from './dice3d';
import {CHANNEL} from '../../extensions/workbench-dice3d/src/types';
OBR.onReady(async()=>{const results:any[]=[],events:any[]=[],local=new BroadcastChannel(`${CHANNEL}:local:${await OBR.player.getConnectionId()}`);local.onmessage=e=>{if(e.data.type==='state'||e.data.type==='log')events.push(e.data);};resultListeners.add((data,revealed)=>results.push({data,revealed}));(window as any).suiteHostProbe={submitDice3d,submitCompat3d,dice3dRpc,results,events,stage:'initializing'};try{await setupDice3d();(window as any).suiteHostProbe.stage='ready';}catch(error){(window as any).suiteHostProbe.error=String(error);throw error;}});
