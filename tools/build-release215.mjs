/** Build a selectable release-215 host overlay, NOT a complete static site.
 * Includes the production Vite HTML/assets and rebuilt workbench-dice panels.
 * Existing server public assets, manifests, workbench/card-viewer, workbench-panels,
 * and especially the released dice3d/ subtree must be retained by the publisher.
 * No packaging, deployment, manifest mutation or recursive public copy occurs here.
 * A fresh output is required on each run; set DND_SUITE_RELEASE_OUT to rerun.
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
const out=resolve(process.env.DND_SUITE_RELEASE_OUT||'C:/CodexArtifacts/release215-build/suite-host');
const evidence=out+'.build-evidence';
assert(existsSync(join(deps,'node_modules')),'Existing Suite dependencies are required; this script never installs packages');
assert(!existsSync(out)&&!existsSync(evidence),'Refusing to overwrite a build; select a fresh DND_SUITE_RELEASE_OUT');
assert(out!==root&&!root.startsWith(out+'/')&&!root.startsWith(out+'\\'),'Output must not contain the source checkout');
mkdirSync(evidence,{recursive:true});
const requireDeps=createRequire(join(deps,'package.json'));
const {build:bundle}=await import(pathToFileURL(requireDeps.resolve('rolldown')).href);
const {build}=await import(pathToFileURL(requireDeps.resolve('vite')).href);
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const path=join(directory,entry.name);return entry.isDirectory()?files(path):entry.isFile()?[path]:[];}).sort();}
function sourceSnapshot(){return Object.fromEntries([
 ...files(join(root,'src')),...files(join(root,'extensions/workbench-dice3d/src')),
 ...readdirSync(root).filter(name=>name.endsWith('.html')).map(name=>join(root,name)),
 ...['vite.config.ts','tools/build-workbench-dice.mjs','tools/workbench-dice3d-vite.ts','tools/workbench-dice3d-history.mjs'].map(name=>join(root,name)),
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
// dependency resolution. This does not build or copy the dice3d renderer/assets.
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

for(const input of Object.values(original.build.rollupOptions.input))assert(existsSync(join(out,basename(input))),'Missing production HTML: '+input);
for(const name of ['index.html','index.js','quick.html','quick.js'])assert(existsSync(join(out,'workbench-dice',name)),'Missing workbench-dice output: '+name);
const emitted=files(out).map(file=>({path:relative(out,file).replaceAll('\\','/'),bytes:statSync(file).size,sha256:sha(file)}));
assert(emitted.every(file=>/^[^/]+\.html$/.test(file.path)||file.path.startsWith('assets/')||file.path.startsWith('workbench-dice/')),'Unexpected file outside the allowed host overlay');
assert(!existsSync(join(out,'dice3d'))&&!existsSync(join(out,'manifest.json'))&&!existsSync(join(out,'manifest-dev.json')),'Protected renderer/manifests must not be emitted');
for(const name of ['index.js','quick.js']){
 const code=readFileSync(join(out,'workbench-dice',name),'utf8');
 assert(code.includes('dice3d.status')&&code.includes('dice3d-loading')&&code.includes('bridgeReady'),'Missing reviewed dice-loading bridge in '+name);
}
assert.deepEqual(sourceSnapshot(),sources,'Runtime source changed during the build; rerun into a fresh directory');
const receipt={kind:'suite-host-overlay',release:215,base:'/suite-dev/',sourceRoot:root,dependencyRoot:deps,output:out,copyPublicDir:false,completeStaticSite:false,retainedServerSubtrees:['dice3d','workbench','card-viewer','workbench-panels'],manifestsIncluded:false,productionHtml:Object.keys(original.build.rollupOptions.input),files:emitted};
writeFileSync(join(evidence,'release-overlay-receipt.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify({output:out,evidence,files:emitted.length,rootHtml:receipt.productionHtml.length,workbenchDice:true,dice3d:false,completeStaticSite:false},null,2));
