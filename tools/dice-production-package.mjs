import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {verifyDiceAssets} from './dice-pinned-assets.mjs';
import {gunzipSync} from 'node:zlib';

export const manifestName='production-build.json';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function inventory(root){
 const files={};
 function walk(directory,prefix=''){
  for(const entry of readdirSync(directory,{withFileTypes:true})){
   assert(!entry.isSymbolicLink(),'Linked production file: '+entry.name);
   const relative=prefix+entry.name,path=join(directory,entry.name);
   if(entry.isDirectory())walk(path,relative+'/');
   else if(entry.isFile()){
    if(relative.endsWith('.gz'))assert.deepEqual(gunzipSync(readFileSync(path)),readFileSync(path.slice(0,-3)),'Stale gzip companion: '+relative);
    else if(relative!==manifestName)files[relative]=digest(readFileSync(path));
   }
  }
 }
 walk(root);return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
export function productionHostFiles(root){
 const names=['background.html','manifest-dev.json',...readdirSync(join(root,'assets')).filter(name=>/\.(js|css)$/.test(name)).map(name=>'assets/'+name)];
 return Object.fromEntries(names.sort().map(name=>[name,digest(readFileSync(join(root,name)))]));
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
 const host=resolve(root,'..');
 assert.deepEqual(productionHostFiles(host),manifest.hostFiles,'Incomplete or changed production host dependencies');
 assert(Object.keys(manifest.hostFiles).some(name=>/^assets\/physics\.worker-.+\.js$/.test(name)),'Missing production host physics worker');
 assert.equal(JSON.parse(readFileSync(join(host,'manifest-dev.json'),'utf8')).version,manifest.hostVersion);
 for(const entry of ['overlay.html','skin-preview.html']){
  const html=readFileSync(join(root,entry),'utf8');
  const refs=[...html.matchAll(/(?:src|href)="(\/suite-dev\/dice3d\/[^"?#]+)(?:[?#][^"]*)?"/g)].map(m=>m[1].slice('/suite-dev/dice3d/'.length));
  assert(refs.some(name=>name.endsWith('.js')),'Missing production entry script: '+entry);
  for(const name of refs)assert(name in manifest.files,'Missing HTML dependency: '+name);
 }
 for(const [directory,names] of [[root,scripts],[host,Object.keys(manifest.hostFiles).filter(name=>name.endsWith('.js'))]])for(const name of names)
  assert(!/__diceProfile|__diceTailEvent|__diceRenderedFrames|__diceVisibleProbe|__diceFrameCosts/.test(readFileSync(join(directory,name),'utf8')),'Diagnostic instrumentation in production: '+name);
 return {sourceCommit:manifest.sourceCommit,webCommit:manifest.webCommit,files:Object.keys(manifest.files).length,pinnedAssets:locks.verified,production:true,instrumented:false};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))
 console.log(JSON.stringify(verifyProductionDice(resolve(process.argv[2]||'dist-workbench-dev/dice3d'))));
