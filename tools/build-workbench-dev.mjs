import {resolve,join} from 'node:path';
import {reviewedSourceArchive} from './reviewed-source-archive.mjs';
import {existsSync,cpSync,copyFileSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const web=resolve(process.env.DND_CARD_WEB_ROOT||'D:/Desktop/DND-card-web');
if(!existsSync(join(web,'src/ui/App.tsx')))throw Error('Set DND_CARD_WEB_ROOT to the complete DND Card Web checkout');
const node=process.execPath;
execFileSync(node,[join(web,'node_modules/typescript/bin/tsc'),'-b'],{cwd:web,stdio:'inherit'});
execFileSync(node,[join(web,'node_modules/vite/bin/vite.js'),'build'],{cwd:web,stdio:'inherit'});
execFileSync(node,[join(root,'node_modules/typescript/bin/tsc')],{cwd:root,stdio:'inherit'});
execFileSync(node,[join(root,'node_modules/vite/bin/vite.js'),'build','--outDir','dist-workbench-dev'],{cwd:root,env:{...process.env,SUITE_BASE:'suite-dev',SUITE_CHANNEL:'dev'},stdio:'inherit'});
const output=join(root,'dist-workbench-dev');mkdirSync(join(output,'workbench'),{recursive:true});
// Both install URLs must stay in the dev channel; the public legacy manifest
// is otherwise copied here by Vite with a /suite/ background URL.
copyFileSync(join(output,'manifest-dev.json'),join(output,'manifest.json'));
// Explicit traversal also works across Windows local/network drive boundaries.
function copyTree(source,destination){mkdirSync(destination,{recursive:true});for(const entry of readdirSync(source,{withFileTypes:true})){const from=join(source,entry.name),to=join(destination,entry.name);if(entry.isDirectory())copyTree(from,to);else if(entry.isFile())copyFileSync(from,to);}}
copyTree(join(web,'dist'),join(output,'workbench'));
if(!existsSync(join(output,'workbench/index.html'))||!existsSync(join(output,'workbench/assets')))throw Error('Incomplete workbench build');
cpSync(join(web,'LICENSE'),join(output,'workbench/LICENSE'));cpSync(join(web,'docs/LICENSING.md'),join(output,'workbench/LICENSING.md'));
writeFileSync(join(output,'workbench/BUILD-NOTE.txt'),'Full Suite-dev workbench. DND Card Web source must accompany any redistribution under its project license. No private character data or upstream snapshots are included.\n');
console.log(JSON.stringify({webSource:reviewedSourceArchive(web,join(output,'workbench/source.zip'))}));
console.log(JSON.stringify({suiteSource:reviewedSourceArchive(root,join(output,'workbench/suite-source.zip'))}));
execFileSync(node,[join(root,'tools/build-workbench-dice.mjs')],{cwd:root,stdio:'inherit'});
console.log('Dev bundle ready: '+output);

execFileSync(node,[join(root,'tools/build-workbench-panels.mjs')],{cwd:root,stdio:'inherit'});

execFileSync(node,[join(root,'tools/build-legacy-card-viewer.mjs'),'--web-built','--out-dir','dist-workbench-dev'],{cwd:root,env:{...process.env,DND_CARD_WEB_ROOT:web},stdio:'inherit'});
// 3D source is retained, but this release deliberately ships no physical renderer or Jolt/WASM.
