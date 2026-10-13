// Actual host send function with controlled transport promises. Synthetic data only.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const root=resolve(process.env.SUITE_ROOT||'.');
const source=readFileSync(join(root,'src/workbench/background.ts'),'utf8');
const tree=ts.createSourceFile('background.ts',source,ts.ScriptTarget.Latest,true);
let declaration;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='send')declaration=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);
assert.ok(declaration,'Production send declaration must exist');
const code=ts.transpileModule('globalThis.send='+declaration.slice(declaration.indexOf('=')+1),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const reports=[];
async function check(name,run){await run();reports.push({name,passed:true});console.log('PASS '+name);}
function fixture(){
 const calls=[];
 const context=vm.createContext({console,protocol:'fixture',session:'session',hostStarted:1,origin:'https://fixture.invalid',child:null,relayActive:true,relayPeerSeen:Date.now(),directPeerSeen:0,directClientInstance:'',warmClientInstance:'viewer-a',viewPublication:0,viewPublications:new Map(),last:'selection-signature',lastDocument:{id:'doc'},lastAccessEpoch:7,lastDirectory:'directory-signature',lastCatalog:'catalog-signature',warmSnapshots:new Map(),relay:{send(data){let reject,resolve;const promise=new Promise((a,b)=>{resolve=a;reject=b;});calls.push({data,resolve,reject});return promise;}}});
 vm.runInContext(code,context);return {context,calls};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
await check('failed selection releases selection deduplication and does not retry transport itself',async()=>{const {context:c,calls}=fixture();c.send('selection',{state:{key:'card:one'}});calls[0].reject(Error('offline'));await flush();assert.equal(c.last,'');assert.equal(c.lastDocument,undefined);assert.equal(calls.length,1);});
for(const [type,key,cleared] of [['access','lastAccessEpoch',0],['directory','lastDirectory',''],['catalog','lastCatalog','']])await check(`failed ${type} releases only its own deduplication marker`,async()=>{const {context:c,calls}=fixture();c.send(type,{access:{epoch:7}});calls[0].reject(Error('offline'));await flush();assert.equal(c[key],cleared);assert.equal(c.last,'selection-signature');});
await check('failed warm snapshot releases matching publication only',async()=>{const {context:c,calls}=fixture();const document={id:'one'},state={key:'card:one',itemId:'token-one'};c.warmSnapshots.set('card:one',{document,state:JSON.stringify(state),epoch:7});c.warmSnapshots.set('card:other',{document:{id:'other'},state:JSON.stringify({key:'card:other'}),epoch:7});c.send('cacheSnapshot',{document,state,access:{epoch:7}});calls[0].reject(Error('offline'));await flush();assert.equal(c.warmSnapshots.has('card:one'),false);assert.equal(c.warmSnapshots.has('card:other'),true);});
await check('older rejected publication cannot erase a newer successful selection',async()=>{const {context:c,calls}=fixture();c.send('selection',{state:{key:'card:old'}});c.last='new-selection';const document={id:'new'};c.lastDocument=document;c.send('selection',{state:{key:'card:new'}});calls[1].resolve({});await flush();calls[0].reject(Error('late old failure'));await flush();assert.equal(c.last,'new-selection');assert.equal(c.lastDocument,document);});
await check('older viewer failure cannot erase replacement viewer state',async()=>{const {context:c,calls}=fixture();c.send('selection',{state:{key:'card:one'}});c.warmClientInstance='viewer-b';c.last='replacement-selection';calls[0].reject(Error('old viewer failed'));await flush();assert.equal(c.last,'replacement-selection');});
await check('older failed cache publication cannot erase newer successful warm state',async()=>{const {context:c,calls}=fixture();const state={key:'card:one',itemId:'token-one'},old={id:'old'},latest={id:'latest'};c.warmSnapshots.set('card:one',{document:old,state:JSON.stringify(state),epoch:7});c.send('cacheSnapshot',{state,document:old,access:{epoch:7}});c.warmSnapshots.set('card:one',{document:latest,state:JSON.stringify(state),epoch:8});c.send('cacheSnapshot',{state,document:latest,access:{epoch:8}});calls[1].resolve({});calls[0].reject(Error('old cache failed'));await flush();assert.equal(c.warmSnapshots.get('card:one').document,latest);});
await check('failed acknowledgements and mutation-shaped traffic are not replayed or marked as views',async()=>{const {context:c,calls}=fixture();for(const type of ['ack','save','stats','requestPending'])c.send(type,{requestId:'once'});for(const call of calls)call.reject(Error('offline'));await flush();assert.equal(calls.length,4);assert.equal(c.viewPublications.size,0);assert.equal(c.last,'selection-signature');assert.equal(c.lastAccessEpoch,7);});
await check('failed direct post releases view marker without inventing a relay recipient',async()=>{const {context:c,calls}=fixture();c.child={closed:false,postMessage(){throw Error('window gone');}};c.directClientInstance='viewer-a';c.directPeerSeen=Date.now();c.send('selection',{state:{key:'card:one'}},'direct');assert.equal(c.last,'');assert.equal(calls.length,0);});
await check('publication tracking remains bounded during many distinct warm-card targets',async()=>{const {context:c}=fixture();for(let n=0;n<200;n++)c.send('cacheSnapshot',{state:{key:'card:'+n,itemId:'token:'+n}});assert.ok(c.viewPublications.size<=128);});
const out=resolve(process.env.PROFILE_OUT||'../owner-view-delivery-evidence');mkdirSync(out,{recursive:true});writeFileSync(join(out,'results.json'),JSON.stringify({actualSendFunction:true,syntheticBoundary:true,realRoomVerified:false,reports},null,2));
console.log(`${reports.length} publication recovery checks passed`);
