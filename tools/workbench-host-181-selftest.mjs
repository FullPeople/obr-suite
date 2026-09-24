import {build} from 'rolldown';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const out=resolve('workbench-test-output/host-181');await mkdir(out,{recursive:true});
const results=[];const pass=(name,extra={})=>{results.push({name,...extra});console.log('PASS',name);};
async function bundle(name){const file=resolve(out,name+'.mjs');await build({input:resolve('src/workbench/'+name+'.ts'),output:{file,format:'esm'}});return import(pathToFileURL(file).href);}
const [{documentCoins},{cardLocation},{inventoryOperation,emptyLedger},{inventoryDocuments,inventoryProjection,inventoryReflected}]=await Promise.all(['currency','card-location','inventory-model','inventory'].map(bundle));
const money={cp:1,sp:2,ep:3,gp:4,pp:5},legacy={schema_version:'0.3',identity:{character_name:'旧卡'},inventory:{currency:{wallet:money,total_gp:55.71,total_gp_raw:'55.71'}}};
assert.deepEqual(documentCoins(legacy),money);assert.deepEqual(documentCoins({...legacy,dnd_card_web:{inventory:{coins:{gp:0}}}}),{cp:0,sp:0,ep:0,gp:0,pp:0});assert.deepEqual(documentCoins({inventory:{currency:{gp:'4',pp:Infinity,wallet:null,total_gp:100}}}),{cp:0,sp:0,ep:0,gp:4,pp:0});pass('legacy wallet normalized to denomination numbers without losing native zero');
let stored={revision:0,data:null};const mockRelay={send:async({sharedDocument:m})=>{if(m.operation==='write'){assert.equal(m.expected,stored.revision);stored={revision:stored.revision+1,data:structuredClone(m.data)};}return structuredClone(stored);}};
const inventory=inventoryDocuments(mockRelay,'coins');await inventory.ensure([{id:'card:hero',name:'旧卡',kind:'card',write:true,document:legacy}]);const seeded=(await inventory.read()).data.containers['card:hero'];assert.deepEqual(Object.fromEntries(seeded.items.map(row=>[row.coin,row.quantity])),money);pass('inventory seeding preserves all five stable wallet denominations');
assert.deepEqual(cardLocation('https://example.test','current-room','logical-id','https://example.test/characters/upload-room/document-id/'),{room:'upload-room',card:'document-id',url:'https://example.test/characters/upload-room/document-id/data.json'});
assert.equal(cardLocation('https://example.test','current-room','hero','https://evil.test/characters/stolen/hero/data.json').room,'current-room');pass('legacy document read and write resolve one same-origin upload location');

const base=emptyLedger();base.containers.hero={id:'hero',name:'Hero',kind:'card',revision:2,columns:4,capacity:24,items:[{id:'sword',kind:'item',name:'Sword',quantity:5,slot:0,revision:2,entry:{id:'sword',name:'Sword',kind:'item'}},{id:'shield',kind:'item',name:'Shield',quantity:1,slot:1,revision:1,entry:{id:'shield',name:'Shield',kind:'item'}}]};
const authority={gm:false,read:new Set(['hero']),write:new Set(['hero']),give:new Set(['hero'])};
const move={operationId:'move-181',action:'move',container:'hero',expected:{hero:1},positions:[{id:'sword',slot:4}],observedSlots:{sword:0}};
const moved=inventoryOperation(base,move,authority).ledger;assert.equal(moved.containers.hero.items[0].slot,4);assert.equal(moved.containers.hero.items[0].quantity,5);assert.equal(base.containers.hero.items[0].slot,0);pass('slot-only move rebases across unrelated quantity revision and preserves it');
assert.throws(()=>inventoryOperation(moved,{...move,operationId:'same-row-race',positions:[{id:'sword',slot:7}]},authority),/位置已被/);
assert.throws(()=>inventoryOperation(base,{...move,operationId:'occupied',positions:[{id:'sword',slot:1}]},authority),/占用/);
assert.throws(()=>inventoryOperation(base,{...move,operationId:'missing-observed',observedSlots:{}},authority),/原位置/);
assert.equal(inventoryOperation(moved,move,authority).duplicate,true);pass('move rejects real row race, occupied destination and incomplete baseline; receipt is idempotent');
const native={selections:[],inventory:{coins:{},positions:{sword:0}},runtime:{resources:{}}},projected=inventoryProjection({dnd_card_web:native},moved.containers.hero);
assert.deepEqual(projected.dnd_card_web.inventory.positions,{sword:4,shield:1});assert.equal(inventoryReflected(projected.dnd_card_web,moved.containers.hero,moved.projections.hero),true);assert.equal(inventoryReflected({...projected.dnd_card_web,inventory:{...projected.dnd_card_web.inventory,positions:{sword:0,shield:1}}},moved.containers.hero,moved.projections.hero),false);pass('durable inventory projection and acknowledgement include actual grid positions');

// Exercise the actual relay's two locks and scope check, not a hand-written CAS substitute.
let doc={schema_version:'0.3',_suiteRevision:1,identity:{character_name:'Before'}},reads=[],writes=[];
const api=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='GET'){reads.push(req.url);res.end(JSON.stringify(doc));return;}let text='';for await(const chunk of req)text+=chunk;doc=JSON.parse(text);writes.push(req.url);res.end('{"ok":true}');});await new Promise(r=>api.listen(5603,'127.0.0.1',r));
const directory=await mkdtemp(resolve(out,'relay-'));const child=spawn(process.execPath,['server/workbench-relay/server.mjs'],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:'5602',CARD_READ_BASE:'http://127.0.0.1:5603',CARD_WRITE_BASE:'http://127.0.0.1:5603',WORKBENCH_DATA_DIR:directory}});let errorText='';child.stderr.on('data',v=>errorText+=v);
const secret='host181'.repeat(10),session=createHash('sha256').update(secret).digest('hex'),clientKey='client181'.repeat(8),url=`http://127.0.0.1:5602/?session=${session}&role=host`;
const post=async body=>{const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
try{
 let registered=false;for(let i=0;i<100;i++){try{const result=await post({register:true,clientKey,room:'current-room'});if(result.status===200){registered=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}assert.equal(registered,true,errorText);
 const ledger=await post({sharedDocument:{key:'inventory_current-room',operation:'write',expected:0,data:{containers:{}}}});assert.equal(ledger.status,200);
 const hash=()=>createHash('sha256').update(JSON.stringify(doc)).digest('hex');
 const request=()=>({room:'upload-room',card:'hero',inventoryRoom:'current-room',expected:hash(),changes:[{path:['identity','character_name'],after:'After'},{path:['_suiteRevision'],after:2}],inventoryGuard:{key:'inventory_current-room',revision:1}});
 const saved=await post({saveCard:request()});assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(doc.identity.character_name,'After');assert.deepEqual(reads,['/characters/upload-room/hero/data.json']);assert.deepEqual(writes,['/api/character/upload-room/hero/data']);pass('real relay writes upload-room card while guarding current-room inventory');
 const forged=request();forged.inventoryRoom='other-room';forged.inventoryGuard.key='inventory_other-room';assert.equal((await post({saveCard:forged})).status,403);
 const stale=request();stale.inventoryGuard.revision=0;assert.equal((await post({saveCard:stale})).status,409);assert.equal(writes.length,1);assert.equal((await post({register:true,clientKey,room:'other-room'})).status,409);pass('relay rejects forged inventory scope, stale ledger and host room reassignment');
}finally{child.kill();await new Promise(r=>child.once('exit',r));api.closeAllConnections();await new Promise(r=>api.close(r));}
await writeFile(resolve(out,'results.json'),JSON.stringify({realRoomVerified:false,results},null,2));
