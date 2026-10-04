import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compareInventory,verifyReferenceMetadata,verifyManifest,protectedPath,withoutInlinePeerFields,REFERENCE,REFERENCE_RUN,PROTOCOL_ONLY} from './dice-inherited-visual.mjs';
const map=entries=>new Map(entries.map(([p,s])=>[p,Buffer.from(s)]));
const originalTypes="export const KINDS=['d6'];\nexport interface Peer {inlineChunkV1?:boolean;inlineRollV1?:boolean;id:string}\nexport const ASSET_VERSION='v';\nexport const url=()=>'/suite-dev/';\nexport const now=()=>performance.now();\n";
test('complete tracked inventory protects actual build imports, root HTML and unknown future dependencies',()=>{
 const paths=['tools/workbench-dice3d-vite.ts','tools/workbench-dice3d-history.mjs','tools/workbench-announcement.mjs','dice-panel.html','dice-quick-popup.html','some-new-build-helper.mjs','extensions/other/runtime.ts','package-lock.json'];
 for(const path of paths){assert(protectedPath(path),path+' must be selected');const before=map([[path,'before']].filter(([p])=>protectedPath(p))),after=map([[path,'after']].filter(([p])=>protectedPath(p)));assert.throws(()=>compareInventory(before,after),/production bytes changed/);}
 for(const path of ['docs/result.md','tools/dice-inherited-visual.mjs','.github/workflows/dice-safe-resource-profile.yml'])assert(!protectedPath(path));
 assert(protectedPath('tools/another-verification-helper.mjs'));assert(protectedPath('.github/workflows/another-workflow.yml'));
});
test('only controller or exact Peer field deletion may differ; types runtime remains protected',()=>{
 const paths=['extensions/workbench-dice3d/src/renderer.ts','extensions/workbench-dice3d/src/native.ts','extensions/workbench-dice3d/src/skin-preview.ts','extensions/workbench-dice3d/src/physics.worker.ts','extensions/workbench-dice3d/public/asset-hashes.json'];
 const before=map([...paths.map(p=>[p,'original']),[PROTOCOL_ONLY[0],'controller'],[PROTOCOL_ONLY[1],originalTypes]]);assert.equal(compareInventory(before,new Map(before)).length,paths.length+2);
 for(const path of paths){const after=new Map(before);after.set(path,Buffer.from('changed'));assert.throws(()=>compareInventory(before,after),/production bytes changed/);}
 const changed=new Map(before);changed.set(PROTOCOL_ONLY[0],Buffer.from('new controller'));changed.set(PROTOCOL_ONLY[1],withoutInlinePeerFields(Buffer.from(originalTypes)));compareInventory(before,changed);
 for(const token of ['KINDS','ASSET_VERSION','url','now']){const bad=new Map(changed);bad.set(PROTOCOL_ONLY[1],Buffer.from(bad.get(PROTOCOL_ONLY[1]).toString().replace(token,token+'_changed')));assert.throws(()=>compareInventory(before,bad),/production bytes changed/);}
 assert.throws(()=>withoutInlinePeerFields(Buffer.from(originalTypes+originalTypes)),/unique/);
 const missing=new Map(before);missing.delete(paths[0]);assert.throws(()=>compareInventory(before,missing),/inventory changed/);const extra=new Map(before);extra.set('new-source.ts',Buffer.from('new'));assert.throws(()=>compareInventory(before,extra),/inventory changed/);
});
const manifest=JSON.parse(readFileSync(new URL('./dice-visual-reference-3d596.json',import.meta.url),'utf8'));
test('manifest cannot substitute identity, empty/duplicate artifacts, invalid hashes or sizes',()=>{
 verifyManifest(manifest);const clone=()=>structuredClone(manifest);
 for(const field of ['referenceSuite','run','pairedWeb','baselineSuite','runUrl']){const bad=clone();bad[field]='wrong';assert.throws(()=>verifyManifest(bad));}
 const empty=clone();empty.artifacts=[];assert.throws(()=>verifyManifest(empty));const duplicate=clone();duplicate.artifacts[1]=duplicate.artifacts[0];assert.throws(()=>verifyManifest(duplicate));
 for(const mutation of [{id:999},{name:'wrong'},{digest:''},{digest:'sha256:bad'},{sizeBytes:0},{sizeBytes:33*1024*1024}]){const bad=clone();Object.assign(bad.artifacts[0],mutation);assert.throws(()=>verifyManifest(bad));}
});
test('failed, wrong-SHA, incomplete or expired historical evidence cannot be inherited',()=>{
 const run={id:REFERENCE_RUN,head_sha:REFERENCE,status:'completed',conclusion:'success'},jobs=['captured_behavior','lifecycle','pixels_and_viewports','paired_timing (phone-a)','paired_timing (phone-b)','paired_timing (tablet)'].map(name=>({name,status:'completed',conclusion:'success'})),artifacts=manifest.artifacts.map(a=>({id:a.id,name:a.name,digest:a.digest,size_in_bytes:a.sizeBytes,expired:false}));
 verifyReferenceMetadata(run,jobs,artifacts,manifest.artifacts);assert.throws(()=>verifyReferenceMetadata(run,jobs,artifacts,[]));
 for(const mutation of [{head_sha:'wrong'},{status:'in_progress'},{conclusion:'failure'}])assert.throws(()=>verifyReferenceMetadata({...run,...mutation},jobs,artifacts,manifest.artifacts));
 assert.throws(()=>verifyReferenceMetadata(run,jobs.slice(1),artifacts,manifest.artifacts));assert.throws(()=>verifyReferenceMetadata(run,[{...jobs[0],conclusion:'failure'},...jobs.slice(1)],artifacts,manifest.artifacts));
 for(const mutation of [{expired:true},{digest:'sha256:wrong'},{size_in_bytes:124}])assert.throws(()=>verifyReferenceMetadata(run,jobs,[{...artifacts[0],...mutation},...artifacts.slice(1)],manifest.artifacts));assert.throws(()=>verifyReferenceMetadata(run,jobs,[],manifest.artifacts));
});
