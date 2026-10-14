// Execute the actual stable account API and QQ page with authored synthetic state.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'..'),read=file=>readFileSync(resolve(root,file),'utf8');
const saved=JSON.stringify({token:'authored-saved-token',expiresAt:Date.now()+86400000,accountId:'fixture'}),storage=new Map([['dnd-qq-plugin',saved]]),calls=[];
const nodes=new Map(['message','close','login','logout','refresh'].map(id=>[id,{hidden:false,disabled:false,textContent:''}]));
const context=vm.createContext({console,Map,Set,Promise,Date,JSON,Error,
 localStorage:{getItem:key=>storage.get(key),setItem:()=>calls.push('storage-write'),removeItem:()=>calls.push('storage-delete')},
 fetch:async()=>calls.push('fetch'),window:{open:()=>calls.push('popup'),addEventListener:()=>calls.push('subscription')},
 OBR:{onReady:callback=>callback(),modal:{close:()=>{}}},document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>[...nodes].filter(([id])=>id!=='close').map(([,node])=>node)}
});
const compile=source=>ts.transpileModule(source.replace(/^import.*\n/gm,'').replaceAll('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
vm.runInContext(compile(read('src/cloud-availability.ts')+'\n'+read('src/modules/characterCards/qq-account.ts')),context);
assert.equal(context.qqSession(),undefined);assert.equal(Object.keys(context.qqHeaders({id:'room',capability:'saved'})).length,0);
for(const invoke of [()=>context.acceptQQSession({}),()=>context.connectQQ(),()=>context.disconnectQQ(),()=>context.selectQQCard('cloud'),()=>context.qqRequest('session'),()=>context.qqRequest('cards','POST',{}),()=>context.qqRequest('room-cards/room','DELETE',{}, {id:'room',capability:'saved'})])await assert.rejects(invoke,error=>error.code==='CLOUD_DISABLED'&&error.notSent===true);
context.clearQQSession('authored-saved-token');assert.equal(storage.get('dnd-qq-plugin'),saved);
vm.runInContext(compile(read('src/modules/characterCards/qq-page.ts')),context);
for(const [id,node] of nodes)if(id!=='close'){assert.equal(node.hidden,true);assert.equal(node.disabled,true);}assert.equal(typeof nodes.get('close').onclick,'function');assert.deepEqual(calls,[]);
console.log(JSON.stringify({passed:true,synthetic:true,realRoom:false,cloudNetworkRequests:0,cloudMetadataMutations:0,oldCredentialsPreserved:true}));
