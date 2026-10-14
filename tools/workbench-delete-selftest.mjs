// Execute the production host command/receipt handlers with authored synthetic cards.
// No network, live SDK, real cards, browser or server data is accessed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root=resolve(import.meta.dirname,'..');
function declaration(file,name){
 const source=ts.createSourceFile(file,readFileSync(resolve(root,file),'utf8'),ts.ScriptTarget.Latest,true);let found;
 function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node.getText(source);ts.forEachChild(node,visit);}
 visit(source);assert.ok(found,`${file}:${name}`);return found.replace(/^export /,'');
}
const source=['command','receive'].map(name=>declaration('src/workbench/background.ts',name)).join('\n')+'\n'+declaration('src/modules/characterCards/native-owner.ts','ownsNativeToken');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const BIND='bind',DIRECTORY='directory',ROOM_LIST='room-list',LIST='scene-list',QQ_CARDS='cloud',DELETED='deleted';
const checks=[];
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
function fixture({cloud=false,ids=['a'],role='GM'}={}){
 let sceneEpoch=1,owner='me',identity=0;
 const rows=ids.map(id=>({id,qqRoom:cloud?{id:'cloud-'+id,capability:'synthetic'}:undefined}));
 const world={role,room:{[DIRECTORY]:rows,[ROOM_LIST]:rows,[QQ_CARDS]:cloud?rows:[],[DELETED]:[]},scene:{[LIST]:rows},items:ids.map(id=>({id:'token-'+id,type:'IMAGE',createdUserId:'me',metadata:{[BIND]:id}}))};
 const deleted=new Set(),messages=[],posts=[],versions=new Map();let host;
 const catalog=async()=>({cards:rows.filter(row=>!world.room[DELETED].includes(row.id)).map(row=>({id:row.id,itemIds:['token-'+row.id],write:world.role==='GM'||owner==='me',locked:false,grantVersion:`${identity}:${versions.get(row.id)||0}`})),monsters:[],room:'room',scope:'room:scene-'+sceneEpoch,role:world.role,enabled:{characterCards:true}});
 const hooks={};
 const sdk={
  room:{id:'room',getMetadata:async()=>{await hooks.getRoom?.();return structuredClone(world.room);},setMetadata:async patch=>{await hooks.setRoom?.();Object.assign(world.room,structuredClone(patch));host.accessHistory.set(++host.accessEpoch,await catalog());messages.push({type:'access',access:await catalog()});}},
  scene:{getMetadata:async()=>structuredClone(world.scene),setMetadata:async patch=>Object.assign(world.scene,structuredClone(patch)),items:{updateItems:async(ids,apply)=>{await hooks.updateItems?.();const drafts=structuredClone(world.items.filter(row=>ids.includes(row.id)));apply(drafts);for(const row of drafts){const old=world.items.find(item=>item.id===row.id);if(old.metadata[BIND]!==row.metadata[BIND])versions.set(old.metadata[BIND],(versions.get(old.metadata[BIND])||0)+1);Object.assign(old,row);}}}},
  broadcast:{sendMessage:async()=>{await hooks.broadcast?.();}}
 };
 const transmit=async(id,before)=>{await hooks.beforeSend?.();try{await before?.();}catch(error){throw Object.assign(error,{notSent:true});}posts.push(id);await hooks.post?.();deleted.add(id);await hooks.afterDelete?.();return {};};
 host=vm.createContext({console,performance,structuredClone,Map,Set,Promise,Date,
  protocol:'full-suite-workbench/v1',session:'delete',BIND,DIRECTORY,ROOM_LIST,LIST,QQ_CARDS,DELETED,playerId:'me',
  OBR:sdk,devManifest:{version:'synthetic-delete'},
  access:async itemId=>{const id=itemId.replace(/^card:/,''),card=rows.find(row=>row.id===id);if(!card||world.room[DELETED].includes(id))throw Error('没有角色卡');return {card,cardId:id,targetId:'card:'+id,key:'room:card:'+id,write:world.role==='GM'||owner==='me',role:world.role,items:world.items};},
  catalog,publishAccess:data=>{host.accessHistory.set(host.accessEpoch,data);return data;},accessEpoch:1,accessHistory:new Map(),
  observation:{peek:()=>world,sceneEpoch:()=>sceneEpoch,authorityVersion:id=>`${identity}:${versions.get(id?.replace(/^card:/,''))||0}`,refreshAuthority:async()=>world},
  relay:{send:async(payload,before)=>transmit(payload.deleteCard.card,before)},qqRequest:async(path,method,_data,_room,options)=>{assert.equal(method,'DELETE');return transmit(path.replace('room-cards/cloud-',''),options?.guard);},
  documentLocation:id=>({room:'room',card:id}),documents:new Map(ids.map(id=>['room:card:'+id,{}])),documentCacheVersion:0,invalidateCard:()=>{},chosen:'card:a',
  send:(type,data)=>messages.push({type,...data}),refresh:async()=>{},refreshSelection:async()=>{},
  activeRequests:new Set(),cancelledRequests:new Set(),requestRuns:new Map(),seen:new Map(),stockHistory:new Map(),queue:Promise.resolve(),groupQueue:Promise.resolve(),mutation:0,epoch:0,
 });
 vm.runInContext(compiled,host);
 const request=async(id,requestId='delete-'+id)=>{
  const grant=await catalog();host.accessHistory.set(host.accessEpoch,grant);
  await host.receive({protocol:host.protocol,session:'delete',type:'delete',itemId:'card:'+id,requestId,expiresAt:Date.now()+30000,accessEpoch:host.accessEpoch,accessScope:grant.scope,accessRoom:'room'});
  await host.requestRuns.get(requestId);return messages.filter(m=>m.type==='ack'&&m.requestId===requestId).at(-1);
 };
 return {host,world,hooks,messages,posts,deleted,request,changeScene:()=>sceneEpoch++,revoke:()=>{owner='other';world.role='PLAYER';identity++;},transferToken:()=>{world.items[0].createdUserId='other';versions.set('a',(versions.get('a')||0)+1);}};
}

await check('normal delete confirms after directory removal and cleans only its own binding',async()=>{
 const f=fixture({ids:['a','b']}),reply=await f.request('a');assert.equal(reply.ok,true);assert.equal(reply.result.deleted,true);assert.equal(reply.result.cleanupPending,false);
 assert.equal(f.world.items[0].metadata[BIND],undefined);assert.equal(f.world.items[1].metadata[BIND],'b');assert.deepEqual(f.posts,['a']);
 assert.ok(f.messages.findIndex(m=>m.type==='access')<f.messages.findIndex(m=>m.type==='ack'));
});
await check('consecutive selected deletes each commit once with a terminal ACK',async()=>{
 const f=fixture({ids:['a','b','c']});for(const id of ['a','b','c'])assert.equal((await f.request(id)).ok,true);assert.deepEqual(f.posts,['a','b','c']);assert.equal(f.host.mutation,0);
});
await check('duplicate delete and requestStatus reuse the saved receipt without executing again',async()=>{
 const f=fixture();await f.request('a');const message={protocol:f.host.protocol,session:'delete',requestId:'delete-a'};
 await f.host.receive({...message,type:'delete',itemId:'card:a'});await f.host.requestRuns.get('delete-a');await f.host.receive({...message,type:'requestStatus'});
 assert.deepEqual(f.posts,['a']);assert.equal(f.messages.filter(m=>m.type==='ack'&&m.ok).length,3);
});
await check('normal post-commit cleanup failure still confirms deletion',async()=>{
 const f=fixture();f.hooks.setRoom=async()=>{throw Error('synthetic cleanup failure');};const reply=await f.request('a');assert.equal(reply.ok,true);assert.equal(reply.result.deleted,true);assert.equal(reply.result.cleanupPending,true);assert.ok(f.deleted.has('a'));
});
await check('cloud delete records its durable commit before a directory cleanup failure',async()=>{
 const f=fixture({cloud:true});f.hooks.setRoom=async()=>{throw Error('synthetic cleanup failure');};const reply=await f.request('a');assert.equal(reply.ok,true);assert.equal(reply.result.deleted,true);assert.equal(reply.result.cleanupPending,true);assert.deepEqual(f.posts,['a']);
});
await check('cloud delete completes normally and evicts its local document cache',async()=>{
 const f=fixture({cloud:true}),reply=await f.request('a');assert.equal(reply.ok,true);assert.equal(reply.result.deleted,'a');assert.equal(f.host.documents.size,0);assert.deepEqual(f.world.room[QQ_CARDS],[]);
});
await check('normal and cloud denied deletes report zero confirmed commits',async()=>{
 for(const cloud of [false,true]){const f=fixture({cloud});f.hooks.post=async()=>{throw Object.assign(Error('synthetic denied'),{status:403});};const reply=await f.request('a');assert.equal(reply.ok,false);assert.equal(reply.uncertain,false);assert.equal(f.deleted.size,0);}
});
await check('normal and cloud lost responses remain uncertain instead of claiming deletion',async()=>{
 for(const cloud of [false,true]){const f=fixture({cloud});f.hooks.post=async()=>{throw Object.assign(Error('synthetic lost response'),{status:503});};const reply=await f.request('a');assert.equal(reply.ok,false);assert.equal(reply.uncertain,true);assert.equal(reply.diagnostic.code,'DELETE_RESULT_UNKNOWN');assert.equal(f.posts.length,1);}
});
await check('normal and cloud final send guard block permission loss before DELETE transmission',async()=>{
 for(const cloud of [false,true]){const f=fixture({cloud});f.hooks.beforeSend=f.revoke;const reply=await f.request('a');assert.equal(reply.ok,false);assert.equal(reply.uncertain,false);assert.equal(f.posts.length,0);}
});
await check('a late cloud response confirms deletion but never cleans metadata in a replacement scene',async()=>{
 const f=fixture({cloud:true});f.hooks.afterDelete=f.changeScene;const reply=await f.request('a');assert.equal(reply.ok,true);assert.equal(reply.result.cleanupPending,true);assert.equal(f.world.room[QQ_CARDS].length,1);
});
await check('cleanup never clears a token rebound to another card or newly transferred owner',async()=>{
 const f=fixture({role:'PLAYER'});f.hooks.updateItems=async()=>{f.world.items[0].metadata[BIND]='replacement';f.transferToken();};const reply=await f.request('a');assert.equal(reply.ok,true);assert.equal(reply.result.cleanupPending,true);assert.equal(f.world.items[0].metadata[BIND],'replacement');
});
console.log(JSON.stringify({passed:checks.length,synthetic:true,realCards:false,realRoom:false}));
