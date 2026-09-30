// Static card-only patch. The host, dice, services and private data are not rebuilt.
import {resolve,join} from 'node:path';
import {existsSync,mkdirSync,cpSync,copyFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
assert(process.env.DND_CARD_WEB_ROOT,'Set DND_CARD_WEB_ROOT to the reviewed Web checkout');
const web=resolve(process.env.DND_CARD_WEB_ROOT),requireWeb=createRequire(join(web,'package.json'));
const output=resolve(process.env.DND_CARD_PATCH_OUT||join(root,'dist-workbench-dev'));
assert(!existsSync(output),'Refusing to overwrite an existing candidate');
for(const name of ['workbench','card-viewer']){
 const target=join(output,name);mkdirSync(target,{recursive:true});cpSync(join(web,'dist'),target,{recursive:true});
 copyFileSync(join(web,'LICENSE'),join(target,'LICENSE'));copyFileSync(join(web,'docs/LICENSING.md'),join(target,'LICENSING.md'));
}
for(const name of ['manifest.json','manifest-dev.json','announcement.md'])copyFileSync(join(root,'public',name),join(output,name));
const {build}=await import(pathToFileURL(requireWeb.resolve('rolldown')).href);
await build({input:join(web,'src/platform/legacyPlayerBridge.ts'),platform:'browser',output:{file:join(output,'card-viewer/bridge.js'),format:'esm',codeSplitting:false},logLevel:'warn'});
console.log('Scoped workbench and legacy viewer patch ready: '+output);
