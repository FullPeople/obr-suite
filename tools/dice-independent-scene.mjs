// Diagnostic boundary for independent benchmark cases. Never used by product code.
import assert from 'node:assert/strict';
export function isIndependentSceneEmpty(snapshot){
 if(!Array.isArray(snapshot?.clients)||snapshot.clients.length!==2)return false;
 return snapshot.clients.every(client=>client.renderer?.active===0&&client.controller?.heldRolls===0&&client.controller?.retainedUntil===0&&client.controller?.queued===0&&client.controller?.pending===false&&Array.isArray(client.workers)&&client.workers.length===1&&client.workers.every(worker=>worker&&worker.incumbents===0&&worker.bounds===0&&worker.kinds===0&&worker.groups===0));
}
export async function waitForIndependentScene(read,{timeoutMs=30000,intervalMs=25}={}){
 const began=Date.now();let last;
 do{last=await read();if(isIndependentSceneEmpty(last))return{waitMs:Date.now()-began,observedAt:Date.now(),...last};if(Date.now()-began>=timeoutMs)break;await new Promise(r=>setTimeout(r,intervalMs));}while(true);
 assert.fail('Independent physics scene was not observed empty: '+JSON.stringify(last));
}
