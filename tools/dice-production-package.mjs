import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {verifyDiceAssets} from './dice-pinned-assets.mjs';

export const manifestName='production-build.json';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function inventory(root){
 const files={};
 function walk(directory,prefix=''){
  for(const entry of readdirSync(directory,{withFileTypes:true})){
   assert(!entry.isSymbolicLink(),'Linked production file: '+entry.name);
   const relative=prefix+entry.name,path=join(directory,entry.name);
   if(entry.isDirectory())walk(path,relative+'/');
   else if(entry.isFile()&&relative!==manifestName)files[relative]=digest(readFileSync(path));
  }
 }
 walk(root);return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
export function verifyProductionDice(root,{sourceCommit,webCommit}={}){
 root=resolve(root);
 for(const file of ['overlay.html','skin-preview.html',manifestName,'asset-hashes.json','vendor/lock.json'])
  assert(statSync(join(root,file)).isFile(),'Missing production dice file: '+file);
 const manifest=JSON.parse(readFileSync(join(root,manifestName),'utf8'));
 assert.equal(manifest.production,true);assert.equal(manifest.instrumented,false);
 assert.equal(manifest.sourceDirty,false,'Production dice was built from dirty source');
 assert.match(manifest.sourceCommit,/^[a-f0-9]{40}$/);assert.match(manifest.webCommit,/^[a-f0-9]{40}$/);
 if(sourceCommit)assert.equal(manifest.sourceCommit,sourceCommit,'Wrong Suite source binding');
 if(webCommit)assert.equal(manifest.webCommit,webCommit,'Wrong paired Web source binding');
 assert.deepEqual(inventory(root),manifest.files,'Incomplete or changed production dice package');
 const locks=verifyDiceAssets(root);assert.equal(locks.verified,manifest.pinnedAssets);
 const scripts=Object.keys(manifest.files).filter(name=>name.endsWith('.js'));
 assert(scripts.some(name=>name.includes('physics.worker-')),'Missing production physics worker');
 for(const entry of ['overlay.html','skin-preview.html']){
  const html=readFileSync(join(root,entry),'utf8');
  const refs=[...html.matchAll(/(?:src|href)="(\/suite-dev\/dice3d\/[^"?#]+)(?:[?#][^"]*)?"/g)].map(m=>m[1].slice('/suite-dev/dice3d/'.length));
  assert(refs.some(name=>name.endsWith('.js')),'Missing production entry script: '+entry);
  for(const name of refs)assert(name in manifest.files,'Missing HTML dependency: '+name);
 }
 for(const name of scripts)
  assert(!/__diceProfile|__diceTailEvent|__diceRenderedFrames|__diceVisibleProbe|__diceFrameCosts/.test(readFileSync(join(root,name),'utf8')),'Diagnostic instrumentation in production: '+name);
 return {sourceCommit:manifest.sourceCommit,webCommit:manifest.webCommit,files:Object.keys(manifest.files).length,pinnedAssets:locks.verified,production:true,instrumented:false};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))
 console.log(JSON.stringify(verifyProductionDice(resolve(process.argv[2]||'dist-workbench-dev/dice3d'))));
