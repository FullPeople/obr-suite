/** Build the reviewable release-217 host overlay and BOTH dice applications.
 * Fresh host/worker, workbench-dice and dice3d runtime/pinned assets are emitted.
 * Other deployed applications, root public assets and manifests are preserved;
 * this does not package, publish, install dependencies or mutate a server.
 * Every run requires a new output; source hashes must remain unchanged.
 */
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,statSync} from 'node:fs';
import {resolve,join,dirname,basename,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
const depInput=resolve(process.env.DND_SUITE_DEPS_ROOT||'F:/CodexWork/2026-09-27/feedback/suite');
const deps=basename(depInput)==='node_modules'?dirname(depInput):depInput;
const out=resolve(process.env.DND_SUITE_RELEASE_OUT||'F:/DND-card-217-evidence-20261001/release217-build/suite-host');
const evidence=out+'.build-evidence';
assert(existsSync(join(deps,'node_modules')),'Existing Suite dependencies are required; this script never installs packages');
assert(!existsSync(out)&&!existsSync(evidence),'Refusing to overwrite a build; select a fresh DND_SUITE_RELEASE_OUT');
assert(out!==root&&!root.startsWith(out+'/')&&!root.startsWith(out+'\\'),'Output must not contain the source checkout');
mkdirSync(evidence,{recursive:true});
const requireDeps=createRequire(join(deps,'package.json'));
const {build:bundle}=await import(pathToFileURL(requireDeps.resolve('rolldown')).href);
const {build}=await import(pathToFileURL(requireDeps.resolve('vite')).href);
const {parse:parseJavaScript}=requireDeps('@babel/parser');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const path=join(directory,entry.name);return entry.isDirectory()?files(path):entry.isFile()?[path]:[];}).sort();}
function sourceSnapshot(){return Object.fromEntries([
 ...files(join(root,'src')),...files(join(root,'extensions/workbench-dice3d/src')),...files(join(root,'extensions/workbench-dice3d/public')),
 ...readdirSync(root).filter(name=>name.endsWith('.html')).map(name=>join(root,name)),
 ...readdirSync(join(root,'public'),{withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>join(root,'public',entry.name)),
 ...['package.json','package-lock.json'].filter(name=>existsSync(join(root,name))).map(name=>join(root,name)),
 ...['vite.config.ts','tools/build-workbench-dice.mjs','tools/workbench-dice3d-vite.ts','tools/workbench-dice3d-history.mjs','tools/build-release217.mjs','tools/build-workbench-dice3d-release.mjs','extensions/workbench-dice3d/overlay.html','extensions/workbench-dice3d/skin-preview.html','extensions/workbench-dice3d/vite.config.ts'].map(name=>join(root,name)),
].sort().map(file=>[relative(root,file).replaceAll('\\','/'),sha(file)]));}
const sources=sourceSnapshot();
writeFileSync(join(evidence,'source-sha256.json'),JSON.stringify(sources,null,2));
process.env.SUITE_BASE='suite-dev';process.env.SUITE_CHANNEL='dev';
let config=readFileSync(join(root,'vite.config.ts'),'utf8');
for(const id of ['vite','@preact/preset-vite','@vitejs/plugin-basic-ssl']){
 const before=config;config=config.replace(`from "${id}"`,`from ${JSON.stringify(pathToFileURL(requireDeps.resolve(id)).href)}`);
 assert(config!==before,`Config dependency adapter no longer matches ${id}`);
}
config=config.replaceAll('__dirname',JSON.stringify(root)).replaceAll('preact()', '(preact.default||preact)()').replaceAll('basicSsl()', '(basicSsl.default||basicSsl)()');
const configFile=join(evidence,'release-config.mjs');
await bundle({input:join(root,'vite.config.ts'),platform:'node',external:id=>id.startsWith('node:')||id.startsWith('file:')||id==='path',plugins:[{name:'isolated-release-config',load(id){if(resolve(id)===join(root,'vite.config.ts'))return {code:config,moduleType:'ts'};}}],output:{file:configFile,format:'esm'},logLevel:'warn'});
const original=(await import(pathToFileURL(configFile).href)).default({command:'build',mode:'production'});
const sourcePrefix=root.replaceAll('\\','/')+'/';
const dependencyPlugin={name:'isolated-release-dependencies',enforce:'pre',async resolveId(id,importer){if(importer?.replaceAll('\\','/').startsWith(sourcePrefix)&&!id.startsWith('.')&&!id.startsWith('/')&&!id.includes(':')&&!id.startsWith('\0'))return this.resolve(id,join(deps,'dependency-resolution.js'),{skipSelf:true});}};
await build({...original,root,configFile:false,cacheDir:join(evidence,'cache'),plugins:[dependencyPlugin,...original.plugins],build:{...original.build,outDir:out,emptyOutDir:false,copyPublicDir:false}});

// Reuse the reviewed dice-panel adapter unchanged, relocating only its roots and
// dependency resolution. The separate renderer is rebuilt immediately below.
const diceSource=join(root,'tools/build-workbench-dice.mjs');
let dice=readFileSync(diceSource,'utf8');
const replaceRequired=(from,to)=>{assert(dice.includes(from),'Dice builder adapter no longer matches: '+from);dice=dice.replace(from,to);};
replaceRequired("from 'rolldown'",'from '+JSON.stringify(pathToFileURL(requireDeps.resolve('rolldown')).href));
replaceRequired("from './workbench-dice3d-history.mjs'",'from '+JSON.stringify(pathToFileURL(join(root,'tools/workbench-dice3d-history.mjs')).href));
replaceRequired("const root=resolve(import.meta.dirname,'..')",'const root='+JSON.stringify(root));
replaceRequired('plugins,output:',`plugins:[...plugins,{name:'isolated-dice-dependencies',async resolveId(id,importer){if(importer&&!id.startsWith('.')&&!id.startsWith('/')&&!id.includes(':')&&!id.startsWith('\\0'))return this.resolve(id,${JSON.stringify(join(deps,'dependency-resolution.js'))},{skipSelf:true});}}],transform:{target:['chrome109','edge109','firefox102','safari15.4']},output:`);
process.env.WORKBENCH_DICE_OUT=join(out,'workbench-dice');
const diceRunner=join(evidence,'build-workbench-dice.mjs');writeFileSync(diceRunner,dice);
await import(pathToFileURL(diceRunner).href);

// Do not reuse the old 216 renderer subtree: 217 changes playback, R8 atlases,
// group trajectories and protocol. The public payload is pinned static assets,
// never room data, and belongs only to this dice3d application.
process.env.DND_SUITE_DEPS=deps;process.env.DND_DICE3D_OUT=join(out,'dice3d');
await import(pathToFileURL(join(root,'tools/build-workbench-dice3d-release.mjs')).href);
for(const name of ['overlay.html','skin-preview.html','asset-hashes.json','assets/catalog.json'])assert(existsSync(join(out,'dice3d',name)),'Missing fresh dice3d output: '+name);
const buildSource=readFileSync(join(root,'extensions/workbench-dice3d/src/types.ts'),'utf8');
const runtimeBuild=buildSource.match(/\bBUILD\s*=\s*['"]([^'"]+)['"]/)?.[1];
assert.match(runtimeBuild,/^suite-3d-\d+$/,'Unexpected dice runtime protocol');


// Git autocrlf may expand a pinned text asset in a Windows checkout. Restore
// the exact locked bytes only when CRLF -> LF proves the expected hash; never
// rewrite the source or relax a mismatch for binary/arbitrary changed content.
const pinned=JSON.parse(readFileSync(join(out,'dice3d/asset-hashes.json'),'utf8')),pinnedTextNormalization=[];
for(const [name,digest]of Object.entries(pinned)){
 const file=join(out,'dice3d',name);assert(existsSync(file),'Missing pinned dice asset: '+name);const before=sha(file);if(before===digest)continue;
 assert(/\.(?:txt|json|js|mjs|svg|css|html|md)$/.test(name),'Changed pinned binary asset: '+name);
 const normalized=Buffer.from(readFileSync(file,'utf8').replaceAll('\r\n','\n'),'utf8'),after=createHash('sha256').update(normalized).digest('hex');
 assert.equal(after,digest,'Pinned asset differs beyond Windows line endings: '+name);
 writeFileSync(file,normalized);pinnedTextNormalization.push({path:'dice3d/'+name,sourceSha256:before,emittedSha256:after,conversion:'CRLF to locked LF'});
}

for(const input of Object.values(original.build.rollupOptions.input))assert(existsSync(join(out,basename(input))),'Missing production HTML: '+input);
for(const name of ['index.html','index.js','quick.html','quick.js'])assert(existsSync(join(out,'workbench-dice',name)),'Missing workbench-dice output: '+name);
const emitted=files(out).map(file=>({path:relative(out,file).replaceAll('\\','/'),bytes:statSync(file).size,sha256:sha(file)}));
assert(emitted.every(file=>/^[^/]+\.html$/.test(file.path)||file.path.startsWith('assets/')||file.path.startsWith('workbench-dice/')||file.path.startsWith('dice3d/')),'Unexpected file outside the allowed host overlay');
assert(!existsSync(join(out,'manifest.json'))&&!existsSync(join(out,'manifest-dev.json')),'Manifests are a separate reviewed publishing input');
for(const name of ['index.js','quick.js']){
 const code=readFileSync(join(out,'workbench-dice',name),'utf8');
 assert(code.includes('dice3d.status')&&code.includes('dice3d-loading')&&code.includes('bridgeReady'),'Missing reviewed dice-loading bridge in '+name);
}
const workers=emitted.filter(file=>/^assets\/physics\.worker-[^/]+\.js$/.test(file.path));
assert(workers.length>0,'Current host physics worker was not emitted');
const rendererScripts=emitted.filter(file=>file.path.startsWith('dice3d/assets/')&&file.path.endsWith('.js'));
assert(rendererScripts.some(file=>readFileSync(join(out,file.path),'utf8').includes('glyphBytes')),'Fresh R8 glyph implementation missing from renderer');
assert(emitted.some(file=>file.path.startsWith('assets/')&&file.path.endsWith('.js')&&readFileSync(join(out,file.path),'utf8').includes(runtimeBuild)),'Host did not embed the new dice protocol build');

// Static reference closure: every local HTML/CSS/ESM/worker import must either
// exist in the emitted overlay or be explicitly recorded as a retained public
// asset. Runtime SDK URLs, relay endpoints and external CDNs are not downloads.
const references=[],retained=new Map(),missing=[];
function reference(from,value,kind){
 if(!value||/^(?:#|data:|blob:|https?:|mailto:|javascript:)/i.test(value))return;
 if(value.includes('${')||value.includes('{{'))return;
 let target;try{target=new URL(value,'https://local.invalid/suite-dev/'+from);}catch{return;}
 if(target.origin!=='https://local.invalid')return;
 if(!target.pathname.startsWith('/suite-dev/')){missing.push({from,value,kind,reason:'outside suite-dev base'});return;}
 const name=decodeURIComponent(target.pathname.slice('/suite-dev/'.length)),file=join(out,name),record={from,reference:value,path:name,kind};
 if(existsSync(file)&&statSync(file).isFile()){references.push({...record,scope:'emitted'});return;}
 const prior=join(root,'public',name);
 if(existsSync(prior)&&statSync(prior).isFile()){references.push({...record,scope:'retained-public'});retained.set(name,{path:name,bytes:statSync(prior).size,sha256:sha(prior)});return;}
 missing.push(record);
}
for(const file of emitted){
 if(!/\.(?:html|css|js|mjs)$/.test(file.path))continue;
 const code=readFileSync(join(out,file.path),'utf8');
 if(file.path.endsWith('.html'))for(const match of code.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi))reference(file.path,match[1],'html');
 if(file.path.endsWith('.css'))for(const match of code.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi))reference(file.path,match[1],'css');
 if(/\.m?js$/.test(file.path)){
  const ast=parseJavaScript(code,{sourceType:'unambiguous',createImportExpressions:true}),pending=[ast];
  while(pending.length){const node=pending.pop();if(!node||typeof node!=='object')continue;
   if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source?.type==='StringLiteral')reference(file.path,node.source.value,'esm');
   if(node.type==='ImportExpression'&&node.source?.type==='StringLiteral')reference(file.path,node.source.value,'dynamic-import');
   if(node.type==='NewExpression'&&node.callee?.name==='URL'&&node.arguments?.[0]?.type==='StringLiteral'&&node.arguments?.[1]?.type==='MemberExpression'&&node.arguments[1].object?.type==='MetaProperty'&&node.arguments[1].property?.name==='url')reference(file.path,node.arguments[0].value,'url');
   for(const value of Object.values(node))if(Array.isArray(value))pending.push(...value);else if(value&&typeof value==='object')pending.push(value);
  }
 }
}
for(const [name,digest]of Object.entries(pinned)){assert(/^[a-f0-9]{64}$/.test(digest),'Invalid pinned asset hash');const file=join(out,'dice3d',name);assert(existsSync(file),'Missing pinned dice asset: '+name);assert.equal(sha(file),digest,'Pinned dice asset changed: '+name);}
const catalog=JSON.parse(readFileSync(join(out,'dice3d/assets/catalog.json'),'utf8'));
function catalogAssets(value){if(typeof value==='string'&&/^(?:assets|vendor)\//.test(value))reference('dice3d/catalog-reference',value,'dice-catalog');else if(Array.isArray(value))value.forEach(catalogAssets);else if(value&&typeof value==='object')Object.values(value).forEach(catalogAssets);}
catalogAssets(catalog);
const referenceReceipt={allPassed:missing.length===0,checked:references.length,pinnedAssets:Object.keys(pinned).length,retainedPublicAssets:[...retained.values()],missing,references};
writeFileSync(join(evidence,'static-reference-report.json'),JSON.stringify(referenceReceipt,null,2));
assert.equal(missing.length,0,'Missing local static references; inspect '+join(evidence,'static-reference-report.json'));
assert.deepEqual(sourceSnapshot(),sources,'Runtime source changed during the build; rerun into a fresh directory');
const receipt={kind:'suite-host-overlay',release:217,base:'/suite-dev/',sourceRoot:root,dependencyRoot:deps,output:out,copyPublicDir:false,completeStaticSite:false,rebuiltSubtrees:['assets','workbench-dice','dice3d'],retainedServerSubtrees:['workbench','card-viewer','workbench-panels','three-dragon','viewport-fx','buff-fx','supporter-avatars'],retentionPolicy:'merge only emitted host files; replace dice3d and workbench-dice only; preserve every other deployed path',runtimeBuild,pinnedTextNormalization,physicsWorkers:workers,staticReferences:{allPassed:true,literalHtmlCssEsmWorkerReferences:true,dynamicSdkAndNetworkPathsNotResolved:true,checked:references.length,pinnedAssets:Object.keys(pinned).length,retainedPublicAssets:[...retained.values()]},manifestsIncluded:false,productionHtml:Object.keys(original.build.rollupOptions.input),files:emitted};
writeFileSync(join(evidence,'release-overlay-receipt.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify({output:out,evidence,files:emitted.length,rootHtml:receipt.productionHtml.length,workbenchDice:true,dice3d:true,runtimeBuild,pinnedAssets:Object.keys(pinned).length,staticReferences:references.length,completeStaticSite:false},null,2));
