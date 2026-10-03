import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(process.env.DND_RESOURCE_EVIDENCE||join(root,'workbench-test-output/resource220'));
mkdirSync(out,{recursive:true});
const require=createRequire(join(root,'package.json')),{build}=await import(pathToFileURL(require.resolve('rolldown')));
const entry=join(out,'dashboard-entry.ts'),model=join(out,'dashboard-model.mjs');
writeFileSync(entry,['inventory-model','resource-presentation','document-delta','merge'].map(name=>`export * from ${JSON.stringify(join(root,'src/workbench',name+'.ts').replaceAll('\\','/'))};`).join('\n'));
await build({input:entry,output:{file:model,format:'esm'}});
const {emptyLedger,inventoryOperation,RESOURCE_WIDGET_STYLES:styles,resourceWidgetPresentation:project,quickbarAttackPresentation:attacks,updateResourceWidgetPresentation:update,documentChanges,expandChanges,applyProjectionPatch}=await import(pathToFileURL(model));
const reports=[];
function test(name,run){run();reports.push({name,passed:true});console.log('PASS',name);}
const shape={style:'ring',x:0,y:0,w:2,h:2,page:1,color:'#3e6688',icon:'shield'};
const native=()=>({dnd_card_web:{runtime:{resources:{a:{current:3,max:5},b:{current:1,max:2},c:{current:2,max:3}}},quickbarLayout:{order:['a','b'],hidden:['c'],widgets:{a:{...shape,members:['a','b','c'],label:'共享法术位'}},attacks:{...shape,x:6,w:6}}}});

test('all 16 retained styles and two legacy styles survive storage and authorized projection',()=>{
 assert.equal(styles.length,18);
 for(const style of styles){const doc=native();update(doc,'a',{...shape,style});const loaded=JSON.parse(JSON.stringify(doc));assert.equal(project(loaded,[{id:'a'},{id:'b'},{id:'c'}]).a.style,style);}
});
test('one-column compact modules are valid; unsafe style, geometry, color and icons are rejected atomically',()=>{
 for(const invalid of [{style:'removed-energy'},{style:'ring',color:'url(https://bad)'},{style:'ring',icon:'<img>'},{...shape,w:0},{...shape,x:11},{...shape,h:7},{...shape,page:3000},{style:'ring',x:1},{style:'ring',unexpected:'payload'}]){
  const doc=native(),before=JSON.stringify(doc);assert.throws(()=>update(doc,'a',invalid));assert.equal(JSON.stringify(doc),before);
 }
});
test('projection drops unauthorized groups and unknown fields without mutating saved metadata',()=>{
 const doc=native();doc.dnd_card_web.quickbarLayout.widgets.a.privateNote='never transport';
 const before=JSON.stringify(doc),all=project(doc,[{id:'a'},{id:'b'}]);
 assert.deepEqual(all.a.members,['a','b']);assert.equal(all.a.label,'共享法术位');assert.equal(all.a.privateNote,undefined);
 const alone=project(doc,[{id:'a'}]).a;assert.equal(alone.members,undefined);assert.equal(alone.label,undefined);
 assert.deepEqual(Object.keys(project(doc,[])),[]);assert.equal(JSON.stringify(doc),before);
});
test('invalid optional appearance does not erase otherwise valid legacy geometry on read',()=>{
 const doc={web_resource_widgets:{a:{...shape,color:'invalid',icon:'invalid'}}};
 assert.deepEqual(project(doc,[{id:'a'}]).a,{style:'ring',x:0,y:0,w:2,h:2,page:1});
});
test('appearance-only update preserves grouping, attacks, runtime and placement',()=>{
 const doc=native(),before=structuredClone(doc);update(doc,'a',{style:'diamond',color:'#123456',icon:'leaf'});
 const current=doc.dnd_card_web.quickbarLayout.widgets.a;assert.deepEqual(current.members,['a','b','c']);assert.equal(current.label,'共享法术位');assert.equal(current.page,1);assert.equal(current.w,2);assert.equal(current.style,'diamond');assert.equal(current.icon,'leaf');
 assert.deepEqual(doc.dnd_card_web.runtime,before.dnd_card_web.runtime);assert.deepEqual(doc.dnd_card_web.quickbarLayout.attacks,before.dnd_card_web.quickbarLayout.attacks);assert.deepEqual(doc.dnd_card_web.quickbarLayout.order,before.dnd_card_web.quickbarLayout.order);
});
test('invalid group IDs, duplicate IDs and overlong labels reject before mutation',()=>{
 for(const patch of [{members:['a','private']},{members:['a','a']},{members:['b','c']},{members:['a']},{label:'x'.repeat(101)}]){
  const doc=native(),before=JSON.stringify(doc);assert.throws(()=>update(doc,'a',{style:'pool',...patch}));assert.equal(JSON.stringify(doc),before);
 }
});
test('deleting pool members and anchor preserves remaining members and appearance',()=>{
 const doc=native();delete doc.dnd_card_web.runtime.resources.a;update(doc,'a',null);
 assert.equal(doc.dnd_card_web.quickbarLayout.widgets.a,undefined);const next=doc.dnd_card_web.quickbarLayout.widgets.b;
 assert.deepEqual(next.members,['b','c']);assert.equal(next.color,shape.color);assert.equal(next.page,1);
 delete doc.dnd_card_web.runtime.resources.c;update(doc,'c',null);
 assert.equal(next.members,undefined);assert.equal(next.label,undefined);assert.equal(next.color,shape.color);
});
test('attacks project independently with native precedence and no resource identities',()=>{
 const doc=native();doc.web_quickbar_attacks={...shape,x:2};doc.dnd_card_web.quickbarLayout.attacks.label='private';
 assert.deepEqual(attacks(doc),{...shape,x:6,w:6});assert.equal(Object.keys(project(doc,[{id:'a'}])).includes('attacks'),false);
 doc.dnd_card_web.quickbarLayout.attacks.members=['a','b'];assert.equal(attacks(doc),undefined);
 delete doc.dnd_card_web.quickbarLayout.attacks;assert.equal(attacks(doc),undefined);
 delete doc.dnd_card_web;assert.deepEqual(attacks(doc),{...shape,x:2});
});
test('legacy appearance updates never synthesize a partial native document',()=>{
 const doc={web_resources:{a:{current:1,max:2},b:{current:2,max:3}},web_quickbar_attacks:{...shape}};
 update(doc,'a',{...shape,style:'poolchips',members:['a','b'],label:'法术位'});
 assert.equal(doc.dnd_card_web,undefined);assert.equal(project(JSON.parse(JSON.stringify(doc)),[{id:'a'},{id:'b'}]).a.style,'poolchips');assert.deepEqual(doc.web_quickbar_attacks,shape);
});
test('prototype keys cannot be written; saved own keys remain safe to project',()=>{
 const doc=native();assert.throws(()=>update(doc,'__proto__',shape));
 Object.defineProperty(doc.dnd_card_web.quickbarLayout.widgets,'__proto__',{value:shape,enumerable:true});
 const picked=project(doc,[{id:'__proto__'}]);assert.equal(Object.getPrototypeOf(picked),null);assert.deepEqual(picked.__proto__,shape);assert.equal({}.style,undefined);
});
test('invalid layout containers reject before creating or changing document fields',()=>{
 for(const layout of [false,[],{widgets:[]},{widgets:null}]){const doc=native();doc.dnd_card_web.quickbarLayout=layout;const before=JSON.stringify(doc);assert.throws(()=>update(doc,'a',shape));assert.equal(JSON.stringify(doc),before);}
});
test('dashboard save delta round-trips grouped style and attacks without overwriting concurrent resource use',()=>{
 const before=native(),changed=structuredClone(before);
 changed.dnd_card_web.quickbarLayout.widgets.a={...changed.dnd_card_web.quickbarLayout.widgets.a,style:'poolbars',color:'#BB7733',icon:'bottle',page:2};
 changed.dnd_card_web.quickbarLayout.attacks={...shape,x:8,w:4,page:2};
 const delta=JSON.parse(JSON.stringify(documentChanges(before,changed)));
 assert.deepEqual(expandChanges(before,delta,'after'),changed);
 const otherClient=structuredClone(before);otherClient.dnd_card_web.runtime.resources.a.current=2;
 const merged=applyProjectionPatch(otherClient,expandChanges(otherClient,delta,'before'),expandChanges(otherClient,delta,'after'),expandChanges(otherClient,delta,'observed'));
 assert.equal(merged.dnd_card_web.runtime.resources.a.current,2);
 assert.deepEqual(merged.dnd_card_web.quickbarLayout,changed.dnd_card_web.quickbarLayout);
 assert.deepEqual(project(JSON.parse(JSON.stringify(merged)),[{id:'a'},{id:'b'},{id:'c'}]).a,changed.dnd_card_web.quickbarLayout.widgets.a);
});

const ledger=emptyLedger();ledger.containers.public={id:'public',name:'测试公共区',kind:'public',revision:1,columns:4,capacity:24,items:[]};
const player={gm:false,read:new Set(['public']),write:new Set(),give:new Set()},gm={...player,gm:true};
const row={id:'pool',kind:'resource',name:'动作如潮',quantity:2,max:5,slot:9000,revision:1,type:'count',presentation:{style:'pips',color:'#334455',icon:'spark'}};
const add={operationId:'add',action:'add',container:'public',expected:{public:1},row};
test('public inventory accepts every new appearance while preserving GM-only configuration',()=>{
 for(const style of styles){const request={...add,row:{...row,presentation:{...row.presentation,style}}};assert.throws(()=>inventoryOperation(ledger,request,player),/只有 DM/);const result=inventoryOperation(ledger,request,gm).ledger;assert.deepEqual(result.containers.public.items[0].presentation,request.row.presentation);}
});
test('public resource spending preserves appearance across CAS and JSON persistence',()=>{
 const created=inventoryOperation(ledger,add,gm).ledger;
 const spent=inventoryOperation(created,{operationId:'spend',action:'update',container:'public',id:'pool',expected:{public:2},patch:{quantity:1}},player).ledger;
 assert.deepEqual(JSON.parse(JSON.stringify(spent)).containers.public.items[0].presentation,row.presentation);
 assert.throws(()=>inventoryOperation(spent,{operationId:'style',action:'update',container:'public',id:'pool',expected:{public:3},patch:{presentation:{style:'ready'}}},player),/只有 DM/);
 assert.throws(()=>inventoryOperation(spent,{operationId:'stale',action:'update',container:'public',id:'pool',expected:{public:2},patch:{quantity:0}},gm),/修改/);
 assert.equal(inventoryOperation(created,add,gm).duplicate,true);
});
test('public inventory rejects extra fields and unsafe appearance without changing ledger',()=>{
 const before=JSON.stringify(ledger);
 for(const presentation of [{style:'pool',members:['a','b']},{style:'pips',icon:'<img>'},{style:'ring',color:'red'},{style:'removed-energy'},{style:'ring',x:0}])assert.throws(()=>inventoryOperation(ledger,{...add,row:{...row,presentation}},gm),/样式/);
 assert.equal(JSON.stringify(ledger),before);
});
writeFileSync(join(out,'results.json'),JSON.stringify({passed:reports.length,reports,syntheticData:true,realRoomVerified:false},null,2));
console.log(JSON.stringify({passed:reports.length,realRoomVerified:false}));
