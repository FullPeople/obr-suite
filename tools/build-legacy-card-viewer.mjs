import {build} from 'rolldown';
import {resolve,join} from 'node:path';
import {existsSync,mkdirSync,cpSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
if(!process.env.DND_CARD_WEB_ROOT)throw Error('DND_CARD_WEB_ROOT must point at the reviewed web checkout.');
const web=resolve(process.env.DND_CARD_WEB_ROOT),arg=process.argv.indexOf('--out-dir');
const output=join(root,arg>=0?process.argv[arg+1]:'dist','card-viewer');
if(!existsSync(join(web,'src/platform/legacyPlayerBridge.ts')))throw Error('The web checkout does not contain the native character viewer bridge.');
if(!process.argv.includes('--web-built')){
 execFileSync(process.execPath,[join(web,'node_modules/typescript/bin/tsc'),'-b'],{cwd:web,stdio:'inherit'});
 execFileSync(process.execPath,[join(web,'node_modules/vite/bin/vite.js'),'build'],{cwd:web,stdio:'inherit'});
}
mkdirSync(output,{recursive:true});cpSync(join(web,'dist'),output,{recursive:true});
await build({input:join(web,'src/platform/legacyPlayerBridge.ts'),platform:'browser',output:{file:join(output,'bridge.js'),format:'esm',codeSplitting:false},logLevel:'warn'});
cpSync(join(web,'LICENSE'),join(output,'LICENSE'));cpSync(join(web,'docs/LICENSING.md'),join(output,'LICENSING.md'));
writeFileSync(join(output,'VIEWER-NOTE.txt'),'This bundle reuses the DND Card Web five-page read-only viewer. It does not download the Wiki or accept XLSX.\n');
console.log('Legacy native card viewer ready: '+output);
