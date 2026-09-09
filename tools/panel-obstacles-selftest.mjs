// Execute the exact background obstacle collector AST, with actual registry,
// persistence notifications and Boss placement. Other background startup is not
// executed. This is not a measurement of Owlbear's rendered iframe rectangles.
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import ts from 'typescript';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const out=mkdtempSync(join(tmpdir(),'panel-obstacles-')),source=readFileSync('src/background.ts','utf8');
const ast=ts.createSourceFile('background.ts',source,ts.ScriptTarget.Latest,true);
const selected=ast.statements.filter(node=>{
 if(ts.isFunctionDeclaration(node))return node.name?.text==='refreshBossObstacles';
 if(ts.isVariableStatement(node))return node.declarationList.declarations.some(d=>['obstacleRequest','offBossObstaclePanels','onBossObstacleStorage','offBossObstacleViewport'].includes(d.name.getText(ast)));
 const text=node.getText(ast);return text.startsWith('window.addEventListener("storage", onBossObstacleStorage)')||text.startsWith('window.addEventListener("pagehide",')&&text.includes('obstacleAlive = false');
});
assert.equal(selected.length,7,'collector exact source statements, including storage/viewport/pagehide');
const collector=selected.map(node=>node.getText(ast)).join('\n');writeFileSync(join(out,'reviewed-collector.ts'),collector);
const f=globalThis.__obstacles={values:[],resizes:new Set()};globalThis.window=new EventTarget();
const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
const file=join(out,'collector.mjs');await build({input:'collector',plugins:[{name:'exact-collector',resolveId(id){if(id==='collector')return '\0collector.ts';},load(id){if(id==='\0collector.ts')return `import {openPanelIds,onPanelGeometryChange,setPanelOpen,notifyPanelGeometry}from ${JSON.stringify(resolve('src/utils/panelObstacles.ts'))};import {computePanelBbox,registerPanelBbox,setPanelOffset,getPanelOffset}from ${JSON.stringify(resolve('src/utils/panelLayout.ts'))};import{bossPlacement}from ${JSON.stringify(resolve('src/modules/bossBar/layout.ts'))};const f=globalThis.__obstacles;const setBossBarObstacles=value=>f.values.push(value);const onViewportResize=fn=>{f.resizes.add(fn);return()=>f.resizes.delete(fn);};${collector}\nexport{setPanelOpen,notifyPanelGeometry,registerPanelBbox,setPanelOffset,getPanelOffset,bossPlacement};`;}}],output:{file,format:'esm'},logLevel:'silent'});
const m=await import(pathToFileURL(file).href);const sleep=ms=>new Promise(r=>setTimeout(r,ms));let checks=0;
let reads=0;m.registerPanelBbox('closed',()=>{reads++;return{left:0,top:0,width:900,height:900};});await sleep(55);assert.equal(reads,0);assert.equal(f.values.length,0);checks++;
m.registerPanelBbox('bottom',()=>{reads++;return{left:300+m.getPanelOffset('bottom').dx,top:600,width:600,height:100};});m.setPanelOpen('bottom',true);await sleep(65);assert.equal(reads,1);assert.equal(f.values.at(-1).length,1);assert.ok(m.bossPlacement(1200,800,60,104,f.values.at(-1)).top+60<600);checks++;
for(let i=0;i<25;i++)m.notifyPanelGeometry();await sleep(65);assert.equal(reads,2);checks++;
m.setPanelOffset('bottom',{dx:200,dy:0});await sleep(65);assert.equal(f.values.at(-1)[0].left,500);checks++;
m.setPanelOpen('bottom',false);await sleep(65);assert.deepEqual(f.values.at(-1),[]);assert.equal(m.bossPlacement(1200,800,60,104,[]).top,636);checks++;
let release;m.registerPanelBbox('slow',()=>new Promise(r=>release=r));m.setPanelOpen('slow',true);await sleep(60);assert.equal(typeof release,'function');m.setPanelOpen('slow',false);m.setPanelOpen('bottom',true);await sleep(65);const latest=JSON.stringify(f.values.at(-1)),count=f.values.length;release({left:0,top:0,width:1200,height:800});await sleep(10);assert.equal(f.values.length,count);assert.equal(JSON.stringify(f.values.at(-1)),latest);checks++;
for(const resize of f.resizes)resize();await sleep(65);assert.equal(f.values.length,count+1);checks++;
m.notifyPanelGeometry();window.dispatchEvent(new Event('pagehide'));await sleep(65);assert.equal(f.values.length,count+1);checks++;
const before=f.values.length;m.notifyPanelGeometry();await sleep(65);const lateAfterHide=f.values.length-before;
assert.equal(lateAfterHide,0,'late panel notifications after pagehide cannot restart collection');assert.equal(f.resizes.size,0);checks++;
const moduleFixture=globalThis.__obstacleModules={failClose:false,failOpen:false,opens:0,closes:0,sdk:{}};
moduleFixture.sdk={viewport:{getWidth:async()=>1200,getHeight:async()=>800},player:{getRole:async()=>'GM',onChange:()=>()=>{}},scene:{isReady:async()=>true,onReadyChange:()=>()=>{}},broadcast:{onMessage:()=>()=>{}},popover:{async open(){if(moduleFixture.failOpen)throw Error('open failed');moduleFixture.opens++;},async close(){moduleFixture.closes++;if(moduleFixture.failClose)throw Error('close failed');}}};
const moduleFile=join(out,'open-modules.mjs');await build({input:'open-modules',plugins:[{name:'module-sdk-boundaries',resolveId(id){if(id==='open-modules')return '\0open-modules.ts';if(id==='@owlbear-rodeo/sdk')return '\0sdk';if(id==='../../asset-base')return '\0asset';if(id==='../../utils/viewportAnchor')return '\0viewport';if(id==='../../state')return '\0state';},load(id){
 if(id==='\0sdk')return 'export default globalThis.__obstacleModules.sdk;';if(id==='\0asset')return 'export const assetUrl=p=>p;';if(id==='\0viewport')return 'export const onViewportResize=()=>()=>{};';if(id==='\0state')return 'export const getState=()=>({searchGmOnly:false});export const onStateChange=()=>()=>{};export const refreshFromScene=async()=>{};';
 if(id==='\0open-modules.ts')return `export * from ${JSON.stringify(resolve('src/modules/search/index.ts'))};export * from ${JSON.stringify(resolve('src/modules/perfWindow/index.ts'))};export {openPanelIds}from ${JSON.stringify(resolve('src/utils/panelObstacles.ts'))};`;
}}],output:{file:moduleFile,format:'esm'},logLevel:'silent'});
const modules=await import(pathToFileURL(moduleFile).href);let moduleChecks=0;
await modules.setupSearch();assert.ok(modules.openPanelIds().includes('search'));moduleChecks++;
moduleFixture.failClose=true;await modules.teardownSearch();assert.ok(modules.openPanelIds().includes('search'));moduleFixture.failClose=false;await modules.teardownSearch();assert.ok(!modules.openPanelIds().includes('search'));moduleChecks++;
moduleFixture.failOpen=true;await modules.setupSearch();assert.ok(!modules.openPanelIds().includes('search'));await modules.teardownSearch();moduleFixture.failOpen=false;moduleChecks++;
modules.setPerfWindowVisible(true);await sleep(10);assert.ok(modules.openPanelIds().includes('perf-window'));moduleChecks++;
moduleFixture.failClose=true;await modules.teardownPerfWindow();assert.ok(modules.openPanelIds().includes('perf-window'));moduleFixture.failClose=false;await modules.teardownPerfWindow();assert.ok(!modules.openPanelIds().includes('perf-window'));moduleChecks++;
moduleFixture.failOpen=true;modules.setPerfWindowVisible(true);await sleep(10);assert.ok(!modules.openPanelIds().includes('perf-window'));moduleFixture.failOpen=false;moduleChecks++;
writeFileSync(join(out,'result.json'),JSON.stringify({backgroundSha256:createHash('sha256').update(source).digest('hex'),collectorSha256:createHash('sha256').update(collector).digest('hex'),checks,moduleChecks,lateNotificationsAfterPagehide:lateAfterHide,nativeOwlbear:false,scope:'Exact collector + registry; actual search/perf module open/close with SDK/state ports.'},null,2));
console.log(`${checks} collector/registry + ${moduleChecks} actual module open/close checks passed; late notifications after pagehide: ${lateAfterHide}. Evidence: ${out}`);
