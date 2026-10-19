// Run the production scheduler at controlled SDK/read boundaries. No player cards.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
const root=resolve(process.env.SUITE_ROOT||'.'),source=readFileSync(join(root,'src/workbench/background.ts'),'utf8');
const tree=ts.createSourceFile('background.ts',source,ts.ScriptTarget.Latest,true);
function declaration(name){let result;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)result=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);assert.ok(result,`Production function ${name}`);return result;}
const policy=readFileSync(join(root,'src/workbench/hydration-window.ts'),'utf8').replace(/^export /gm,'');
const production=policy+'\n'+['warmCard','pumpHydrations','startHydration','scheduleHydration','hydrate'].map(declaration).join('\n');
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
function fixture(focus='100',count=200,implementation=production){
 const reads=[],published=[],gates=new Map(),list={cards:Array.from({length:count},(_,i)=>({id:String(i),write:true})),items:[],scene:{}};
 const c=vm.createContext({console,Map,Set,Promise,Date,OBR:{room:{id:'fixture'}},BIND:'bind',chosen:focus?'card:'+focus:'',warmFocus:'',warmCards:new Set(),warmSnapshots:new Map(),cardHydrations:new Map(),hydrationQueue:[],backgroundHydrations:0,hydrationWanted:new Set(),documents:new Map(),documentTimes:new Map(),cardInvalidations:new Map(),mutation:0,
  catalog:async()=>list,publishAccess:value=>published.push(value.cards.map(row=>row.id)),refresh:async()=>{},refreshSelection:async()=>{},pushWarmSnapshot:async()=>{},sameValue:(a,b)=>JSON.stringify(a)===JSON.stringify(b),reconcileRuntime:async(_id,_key,_items,_scene,doc)=>doc,
  loadCard:async(id,key)=>{reads.push(id);if(gates.has(id))await gates.get(id).promise;const doc={_suiteRevision:1,name:id};c.documents.set(key,doc);c.documentTimes.set(key,Date.now());return doc;}});
 vm.runInContext(ts.transpileModule(implementation,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,c);
 const block=id=>{let release;const promise=new Promise(r=>release=r);gates.set(id,{promise,release});return release;};
 return {c,list,reads,published,block};
}
const checks=[];
async function check(name,test){try{await test();checks.push({name,passed:true});console.log('PASS '+name);}catch(error){checks.push({name,passed:false,error:error.message});console.log('FAIL '+name+': '+error.message);}}
let comparison;
await check('unchanged 200-card fixture compares baseline 200 reads with candidate 3 reads',async()=>{
 const baseline=process.env.HYDRATION_BASELINE_REF||'e7f22f31e057f88d09532760f8ab337ae7a44e09';
 const text=execFileSync('git',['show',baseline+':src/workbench/background.ts'],{cwd:root,encoding:'utf8',maxBuffer:1024*1024}),tree=ts.createSourceFile('baseline.ts',text,ts.ScriptTarget.Latest,true),names=new Set(['warmCard','pumpHydrations','startHydration','scheduleHydration','hydrate']),declarations=[];
 function visit(node){if(ts.isFunctionDeclaration(node)&&names.has(node.name?.text))declarations.push(node.getText(tree));ts.forEachChild(node,visit);}visit(tree);assert.equal(declarations.length,5);
 const old=fixture('100',200,declarations.join('\n')),current=fixture();await old.c.hydrate();await current.c.hydrate();comparison={baseline,baselineReads:old.reads.length,candidateReads:current.reads.length,directoryRows:current.published[0].length};assert.equal(comparison.baselineReads,200);assert.equal(comparison.candidateReads,3);assert.equal(comparison.directoryRows,200);
});
await check('200-card cold book reads current and two neighbours, while publishing all 200 rows',async()=>{const f=fixture();await f.c.hydrate();assert.deepEqual(f.reads,['100','99','101']);assert.equal(f.published[0].length,200);assert.equal(f.c.warmCards.size,3);});
await check('no focus and non-readable focus never scan the book',async()=>{for(const focus of ['','denied']){const f=fixture(focus);await f.c.hydrate();assert.equal(f.reads.length,0);assert.equal(f.published[0].length,200);}});
await check('book boundaries read only the available neighbour',async()=>{for(const [id,expected] of [['0',['0','1']],['199',['199','198']]]){const f=fixture(id);await f.c.hydrate();assert.deepEqual(f.reads,expected);}});
await check('map token resolves its bound card before choosing neighbours',async()=>{const f=fixture();f.c.chosen='token';f.list.items=[{id:'token',metadata:{bind:'40'}}];await f.c.hydrate();assert.deepEqual(f.reads,['40','39','41']);});
await check('unopened off-window update does not download a body',async()=>{const f=fixture();await f.c.hydrate('160');assert.equal(f.reads.length,0);f.c.warmCards.add('card:160');await f.c.hydrate('160');assert.deepEqual(f.reads,['160']);});
await check('a remembered but no-longer-permitted card cannot be read',async()=>{const f=fixture();f.c.warmCards.add('card:denied');await f.c.hydrate('denied');assert.equal(f.reads.length,0);});
await check('concurrent refreshes share each scheduler job',async()=>{const f=fixture(),release=f.block('100');const a=f.c.hydrate(),b=f.c.hydrate();await flush();assert.equal(f.reads.filter(id=>id==='100').length,1);release();await Promise.all([a,b]);});
await check('new selected card bypasses two unrelated slow background reads',async()=>{const f=fixture(),releaseA=f.block('99'),releaseB=f.block('101');const first=f.c.hydrate();await flush();f.c.chosen='card:150';const next=f.c.hydrate();await flush();assert.ok(f.reads.includes('150'));assert.ok(!f.reads.includes('149'));assert.ok(!f.reads.includes('151'));releaseA();releaseB();await Promise.all([first,next]);assert.ok(f.reads.includes('149')&&f.reads.includes('151'));});
await check('fast jumps discard obsolete queued neighbours before reading them',async()=>{const f=fixture(),releaseA=f.block('99'),releaseB=f.block('101');const first=f.c.hydrate();await flush();f.c.chosen='card:150';const second=f.c.hydrate();await flush();f.c.chosen='card:180';const third=f.c.hydrate();await flush();releaseA();releaseB();await Promise.all([first,second,third]);assert.ok(!f.reads.includes('149')&&!f.reads.includes('151'));assert.ok(f.reads.includes('180')&&f.reads.includes('179')&&f.reads.includes('181'));assert.equal(f.c.cardHydrations.size,0);});
await check('queued explicit refresh of an already visited card survives a focus jump',async()=>{const f=fixture(),releaseA=f.block('99'),releaseB=f.block('101');const first=f.c.hydrate();await flush();f.c.warmCards.add('card:150');const explicit=f.c.hydrate('150');f.c.chosen='card:180';const third=f.c.hydrate();await flush();releaseA();releaseB();await Promise.all([first,explicit,third]);assert.ok(f.reads.includes('150'));});
await check('selection warming initiates neighbours once and retains the 24-entry snapshot limit',async()=>{const f=fixture();f.c.warmCard('card:100');await flush();assert.deepEqual(f.reads,['100','99','101']);f.c.warmCard('card:100');await flush();assert.equal(f.reads.length,3);for(let i=0;i<30;i++){f.c.warmSnapshots.set('card:'+i,{});f.c.warmCard('card:'+i,false);}assert.equal(f.c.warmCards.size,24);assert.equal(f.c.warmSnapshots.has('card:0'),false);});
const out=resolve(process.env.PROFILE_OUT||'.local-evidence/hydration-window');mkdirSync(out,{recursive:true});writeFileSync(join(out,'results.json'),JSON.stringify({syntheticBoundaries:true,realRoomVerified:false,comparison,checks},null,2)+'\n');console.log(`${checks.filter(c=>c.passed).length}/${checks.length} checks passed`);if(checks.some(c=>!c.passed))process.exitCode=1;
