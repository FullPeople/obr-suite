import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('actual inventory client handles 1/4/8 actors, duplicate IDs, permissions and lost receipts',async()=>{
 const output=resolve('workbench-test-output/multiplayer288');mkdirSync(output,{recursive:true});
 const bundle=join(output,'inventory.mjs');await build({input:resolve('src/workbench/inventory.ts'),output:{file:bundle,format:'esm'}});
 const {inventoryDocuments}=await import(pathToFileURL(bundle));
 process.env.PORT='0';process.env.WORKBENCH_DATA_DIR=mkdtempSync(join(tmpdir(),'inventory288-'));process.env.RELAY_REGISTRATIONS_PER_HOUR='100';
 const {server}=await import('../server/workbench-relay/server.mjs');await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 let conflicts=0;
 const makeActor=async(room,index)=>{
  const host=('fixture-'+room+'-'+index).padEnd(64,'h'),client=('fixture-client-'+room+'-'+index).padEnd(64,'c'),session=createHash('sha256').update(host).digest('hex');
  const send=async(body,beforeSend)=>{await beforeSend?.();const response=await fetch(`http://127.0.0.1:${server.address().port}/relay?session=${session}&role=host`,{method:'POST',headers:{Authorization:'Bearer '+host,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok){if(response.status===409)conflicts++;throw Object.assign(Error(data.error||'request failed'),{status:response.status,...data.accepted===false?{notSent:true}:{}});}return data;};
  await send({register:true,clientKey:client,room});return {send,api:inventoryDocuments({send},room)};
 };
 const authority=id=>({gm:false,read:new Set([id]),write:new Set([id]),give:new Set([id])});
 const operation=(id,round,expected)=>({operationId:id+'-'+round,action:'add',container:id,expected:{[id]:expected},row:{id:'row-'+id+'-'+round,name:'Synthetic item '+id+' '+round,kind:'item',entry:{id:'entry-'+id+'-'+round,name:'Synthetic item',kind:'item',raw:{}},quantity:1,unitWeight:1,equipped:false,attuned:false,slot:round,revision:1}});
 try{
  for(const players of [1,4,8]){
   const room='inventory288_'+players,actors=[];for(let index=0;index<players;index++)actors.push(await makeActor(room,index));
   const definitions=Array.from({length:10},(_,index)=>({id:'hero'+index,name:'Synthetic '+index,kind:'card',write:true,document:{dnd_card_web:{selections:[],inventory:{coins:{gp:0}}}}}));await actors[0].api.ensure(definitions);
   const started=performance.now();let failures=0;
   await Promise.all(actors.map(async({api},index)=>{for(let round=0;round<4;round++){const id='hero'+index,current=await api.read(true);try{await api.command(operation(id,round,current.data.containers[id].revision),authority(id));}catch(error){failures++;throw error;}}}));
   const final=await actors[0].api.read(true);assert.equal(failures,0);assert.equal(final.data.receipts.length,players*4);
   assert.equal(Object.values(final.data.containers).reduce((total,container)=>total+container.items.filter(row=>row.kind==='item').length,0),players*4);
   const repeated=await actors[0].api.command(operation('hero0',0,1),authority('hero0'));assert.equal(repeated.duplicate,true);
   await assert.rejects(()=>actors[0].api.command(operation('hero0',100,final.data.containers.hero0.revision),authority('other')),/不可编辑|不可查看|权限/);
   console.log(JSON.stringify({players,cards:10,operations:players*4,failed:failures,conflicts,elapsedMs:Math.round(performance.now()-started)}));
   if(players===1){
    let committed=0;const lossy=inventoryDocuments({send:async(body,guard)=>{const result=await actors[0].send(body,guard);if(body.sharedDocument?.operation==='write'){committed++;throw Error('lost response');}return result;}},room);
    const id='hero0',message=operation(id,99,final.data.containers[id].revision);await lossy.command(message,authority(id));assert.equal(committed,1);
    let wrote=0;const unsent=inventoryDocuments({send:async body=>{if(body.sharedDocument?.operation==='write'){wrote++;throw Object.assign(Error('not accepted'),{status:503,notSent:true});}return actors[0].send(body);}},room);
    const current=await unsent.read(true);await assert.rejects(()=>unsent.command(operation(id,101,current.data.containers[id].revision),authority(id)),error=>error.notSent===true);assert.equal(wrote,1);
   }
  }
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
