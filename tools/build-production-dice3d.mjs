import {build,loadConfigFromFile} from 'vite';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {verifyDiceAssets} from './dice-pinned-assets.mjs';
import {inventory,manifestName,productionHostFiles,verifyProductionDice} from './dice-production-package.mjs';

const root=resolve(import.meta.dirname,'..'),web=process.env.DND_CARD_WEB_ROOT&&resolve(process.env.DND_CARD_WEB_ROOT);
if(!web)throw Error('Set DND_CARD_WEB_ROOT to the exact paired Web checkout');
const revision=directory=>execFileSync('git',['rev-parse','HEAD'],{cwd:directory,encoding:'utf8'}).trim();
const sourceCommit=revision(root),webCommit=revision(web);
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim())
 throw Error('Production dice requires committed, clean Suite source');
const output=resolve(process.argv[2]||join(root,'dist-workbench-dev/dice3d'));
if(output!==join(root,'dist-workbench-dev/dice3d'))throw Error('Production dice output must be in the dev publishing tree');
const {config}=await loadConfigFromFile({command:'build',mode:'production'},join(root,'extensions/workbench-dice3d/vite.config.ts'));
// Use the product config directly. The latency/SDK diagnostic builder is excluded.
await build({...config,configFile:false,mode:'production',build:{...config.build,outDir:output,emptyOutDir:true}});
const locks=verifyDiceAssets(output,{normalize:true});
const host=resolve(output,'..'),hostVersion=JSON.parse(readFileSync(join(host,'manifest-dev.json'),'utf8')).version;
writeFileSync(join(output,manifestName),JSON.stringify({schemaVersion:1,production:true,instrumented:false,sourceDirty:false,sourceCommit,webCommit,hostVersion,hostFiles:productionHostFiles(host),pinnedAssets:locks.verified,lockedLfConversions:locks.changes,files:inventory(output)},null,2)+'\n');
console.log(JSON.stringify(verifyProductionDice(output,{sourceCommit,webCommit})));
