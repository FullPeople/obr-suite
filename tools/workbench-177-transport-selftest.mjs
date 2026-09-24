import {build} from 'rolldown';
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createServer,request} from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const out=resolve('workbench-test-output/transport177');mkdirSync(out,{recursive:true});
const entry=resolve(out,'entry.ts');writeFileSync(entry,`export * from '../../src/workbench/document-delta';export * from '../../src/workbench/wire';export * from '../../src/workbench/merge';export * from '../../src/workbench/inventory';`);
await build({input:entry,output:{file:resolve(out,'model.mjs'),format:'esm'}});const {documentChanges,expandChanges,applyProjectionPatch,wireBody,inventoryDocuments}=await import(pathToFileURL(resolve(out,'model.mjs')));
let checks=0;const check=(value,name)=>{assert(value,name);console.log('PASS',++checks,name);};
const portrait='data:image/png;base64,'+randomBytes(256000).toString('base64'),base={schema_version:'0.3',_suiteRevision:4,identity:{character_name:'压力样本'},dnd_card_web:{schemaVersion:1,portrait:{src:portrait},runtime:{hp:20,resources:{}},selections:[],notes:'旧内容'}};
const next=structuredClone(base);next._suiteRevision++;next.dnd_card_web.runtime.hp=19;
const changes=documentChanges(base,next),nativeChanges=documentChanges(base.dnd_card_web,next.dnd_card_web),compressed=await wireBody({delta:{native:nativeChanges}});
check(JSON.stringify(changes).length<300&&JSON.stringify(nativeChanges).length<160,'HP-only save excludes unchanged 341 KB embedded portrait');
const reconstructed=expandChanges(base,changes,'after');assert.deepEqual(reconstructed,next);check(true,'delta round-trip preserves every untouched field including portrait');
const concurrent=structuredClone(base.dnd_card_web);concurrent.notes='另一人编辑';const merged=applyProjectionPatch(concurrent,expandChanges(concurrent,nativeChanges,'before'),expandChanges(concurrent,nativeChanges,'after'),expandChanges(concurrent,nativeChanges,'observed'));
check(merged.runtime.hp===19&&merged.notes==='另一人编辑','sparse transfer preserves independent concurrent edits');
const oldUpload={identity:{character_name:'旧卡'}},hydrated={identity:{character_name:'旧卡',size:''}},filled={identity:{character_name:'旧卡',size:'中型'}},legacyChanges=JSON.parse(JSON.stringify(documentChanges(hydrated,filled,oldUpload)));
const restoredLegacy=applyProjectionPatch(oldUpload,expandChanges(oldUpload,legacyChanges,'before'),expandChanges(oldUpload,legacyChanges,'after'),expandChanges(oldUpload,legacyChanges,'observed'));
check(restoredLegacy.identity.size==='中型','legacy absent field remains absent in observed delta despite hydrated UI default');
const oldNested={identity:{character_name:'旧卡'}},hydratedNested={identity:{character_name:'旧卡',race:{name:'',subrace:null}}},filledNested={identity:{character_name:'旧卡',race:{name:'测试旅人',subrace:null}}};
for(const ancestor of [undefined,null]){
 const observed=structuredClone(oldNested);if(ancestor!==undefined)observed.identity.race=ancestor;
 const nested=JSON.parse(JSON.stringify(documentChanges(hydratedNested,filledNested,observed))),restoredObserved=expandChanges(observed,nested,'observed');assert.deepEqual(restoredObserved,observed);
 assert.deepEqual(applyProjectionPatch(observed,expandChanges(observed,nested,'before'),expandChanges(observed,nested,'after'),restoredObserved),filledNested);
}
check(true,'legacy absent and null parent branches retain their original shape when adding the first race');
assert.throws(()=>expandChanges(base,[{path:['__proto__','polluted'],after:true}],'after'));check(!{}.polluted,'delta refuses prototype paths');
const full=await wireBody({previous:base,native:next,observed:base});check(full.headers['Content-Encoding']==='gzip'&&full.body.byteLength<JSON.stringify({previous:base,native:next,observed:base}).length,'large transport envelopes are gzip compressed');

let stored=structuredClone(base),writes=0;const cardServer=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);stored=JSON.parse(Buffer.concat(chunks));writes++;res.end('{"ok":true}');}else res.end(JSON.stringify(stored));});await new Promise(r=>cardServer.listen(5497,'127.0.0.1',r));
process.env.CARD_READ_BASE=process.env.CARD_WRITE_BASE='http://127.0.0.1:5497';process.env.PORT='5498';process.env.WORKBENCH_DATA_DIR=resolve(out,'shared');const {server}=await import('../server/workbench-relay/server.mjs');
const hostKey=randomBytes(32).toString('hex'),clientKey=randomBytes(32).toString('hex'),session=createHash('sha256').update(hostKey).digest('hex'),url='http://127.0.0.1:5498/?session='+session+'&role=host';
const post=async(body,slow=false)=>{const bytes=gzipSync(JSON.stringify(body));return new Promise((resolve,reject)=>{const req=request(url,{method:'POST',headers:{Authorization:'Bearer '+hostKey,'Content-Type':'application/json','Content-Encoding':'gzip'}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks)),bytes:bytes.length}));});req.on('error',reject);void(async()=>{for(let i=0;i<bytes.length;i+=1024){req.write(bytes.subarray(i,i+1024));if(slow)await new Promise(r=>setTimeout(r,34));}req.end();})();});};
try{
 await post({register:true,clientKey});const expected=createHash('sha256').update(JSON.stringify(base)).digest('hex'),body={saveCard:{room:'test',card:'hero',expected,changes:changes.map(({path,after,remove})=>({path,after,remove}))}},start=Date.now(),result=await post(body,true);
 check(result.status===200&&Date.now()-start<1500&&stored.dnd_card_web.runtime.hp===19,'actual relay commits sparse card update over throttled 30 KB/s request stream');
 check(stored.dnd_card_web.portrait.src===portrait&&writes===1,'server reconstructs full Flask payload without sending portrait over WAN');
 const stale=await post(body);check(stale.status===409&&writes===1,'replayed old document delta fails CAS without a second write');
 const client=await fetch(url.replace('role=host','role=client'),{method:'POST',headers:{Authorization:'Bearer '+clientKey,'Content-Type':'application/json'},body:JSON.stringify(body)});check(client.status===403,'client relay credential cannot write character document directly');
 // Simulate server committed ledger but its HTTP response was lost.
 let ledger={revision:0,data:null},dropped=false;
 const fakeRelay={async send(m){const d=m.sharedDocument;if(d.operation==='read')return structuredClone(ledger);if(d.expected!==ledger.revision)throw Object.assign(Error('conflict'),{status:409});ledger={revision:ledger.revision+1,data:structuredClone(d.data)};if(!dropped){dropped=true;throw Error('response lost');}return structuredClone(ledger);}};
 const inventory=inventoryDocuments(fakeRelay,'receipt-test');await inventory.ensure([{id:'public:test',name:'仓库',kind:'public',write:true}]);check(ledger.revision===1&&(await inventory.read()).data.containers['public:test'],'lost successful ledger response is confirmed by readback without replay');
 console.log(JSON.stringify({checks,throttledBytesPerSecond:30117,deltaWireBytes:result.bytes,originalFullSaveBytes:JSON.stringify({previous:base,native:next,observed:base}).length,realRoomVerified:false}));
}finally{server.closeAllConnections();cardServer.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>cardServer.close(r))]);}
