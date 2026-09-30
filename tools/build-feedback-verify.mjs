// Verify the isolated Suite source using an existing dependency installation.
// Public assets are not copied; this output is build evidence, not a release package.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),deps=process.env.DND_SUITE_DEPS_ROOT,out=process.env.DND_SUITE_VERIFY_OUT;
assert(deps&&out,'Set dependency root and a new verification output directory');assert(!existsSync(out),'Refusing to overwrite evidence');mkdirSync(out,{recursive:true});
const requireDeps=createRequire(join(deps,'package.json')),ts=requireDeps('typescript');
let config=readFileSync(join(root,'vite.config.ts'),'utf8');
for(const id of ['vite','@preact/preset-vite','@vitejs/plugin-basic-ssl'])config=config.replace(`from "${id}"`,`from ${JSON.stringify(pathToFileURL(requireDeps.resolve(id)).href)}`);
config=config.replaceAll('__dirname',JSON.stringify(root)).replaceAll('preact()', '(preact.default||preact)()').replaceAll('basicSsl()', '(basicSsl.default||basicSsl)()');
const filename=join(out,'verification-config.mjs'),{build:bundle}=await import(pathToFileURL(requireDeps.resolve('rolldown')).href);
await bundle({input:join(root,'vite.config.ts'),platform:'node',external:id=>id.startsWith('node:')||id.startsWith('file:')||id==='path',plugins:[{name:'isolated-config',load(id){if(resolve(id)===join(root,'vite.config.ts'))return {code:config,moduleType:'ts'};}}],output:{file:filename,format:'esm'},logLevel:'warn'});
process.env.SUITE_BASE='suite-dev';process.env.SUITE_CHANNEL='dev';
const original=(await import(pathToFileURL(filename).href)).default({command:'build',mode:'production'}),{build}=await import(pathToFileURL(requireDeps.resolve('vite')).href);
await build({...original,root,configFile:false,cacheDir:join(out,'cache'),plugins:[{name:'isolated-dependencies',enforce:'pre',async resolveId(id,importer){if(importer?.replaceAll('\\','/').startsWith(root.replaceAll('\\','/'))&&!id.startsWith('.')&&!id.startsWith('/')&&!id.includes(':')&&!id.startsWith('\0'))return this.resolve(id,join(deps,'dependency-resolution.js'),{skipSelf:true});}},...original.plugins],build:{...original.build,outDir:join(out,'assets-build'),copyPublicDir:false}});
