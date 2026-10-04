// Inherit only immutable visual/physics modules, never the modified protocol's end-to-end verdict.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyDiceAssets} from './dice-pinned-assets.mjs';
export const REFERENCE='3d596cbf032ad2afac0451866e98e885418e27e9';
export const REFERENCE_RUN=37233243394;
export const WEB='fb584043c6bed831b9ca92eab783653770c24fe6';
export const PROTOCOL_ONLY=['extensions/workbench-dice3d/src/controller.ts','extensions/workbench-dice3d/src/types.ts'];
export const MUTABLE_VERIFICATION_FILES=new Set([
 '.github/workflows/dice-safe-resource-profile.yml','.github/workflows/verify-suite.yml',
 'tools/dice-inherited-visual.mjs','tools/dice-inherited-visual.test.mjs',
 'tools/dice-legacy-wire-parity-selftest.mjs','tools/dice-legacy-wire-parity.test.ts',
 'tools/dice-small-inline.test.ts','tools/verify-suite-candidate.mjs',
 'tools/dice-safe-ci-README.md','tools/dice-visual-reference-3d596.json'
]);
// Default-protect the complete tracked tree. Exceptions are exact names, apart from documentation.
export const protectedPath=p=>!p.startsWith('docs/')&&!MUTABLE_VERIFICATION_FILES.has(p);
const PEER_MARKER='export interface Peer {inlineChunkV1?:boolean;inlineRollV1?:boolean;';
export function withoutInlinePeerFields(bytes){const text=bytes.toString('utf8');assert.equal(text.split(PEER_MARKER).length,2,'Reference Peer deletion boundary must be unique');return Buffer.from(text.replace(PEER_MARKER,'export interface Peer {'),'utf8');}
export const EXPECTED_ARTIFACTS=new Map([
 [11314678734,'dice-small-candidate-rgba'],[11314663774,'dice-small-view-390x844-dpr1'],
 [11314658744,'dice-small-view-844x390-dpr3'],[11314484166,'dice-small-baseline-rgba'],
 [11314434195,'dice-small-view-844x390-dpr2'],[11314409290,'dice-small-baseline-render-png'],
 [11314339378,'dice-small-candidate-render-png'],[11314299360,'dice-small-pixel-metrics'],
 [11314224543,'dice-small-view-768x1024-dpr1.5'],[11314199530,'dice-small-view-390x844-dpr3']
].map(([id,name])=>[id,name+'-'+REFERENCE]));
export function verifyManifest(manifest){
 assert.equal(manifest.referenceSuite,REFERENCE);assert.equal(manifest.run,REFERENCE_RUN);assert.equal(manifest.pairedWeb,WEB);assert.equal(manifest.baselineSuite,'308a7ccf0cb70794055ac75170bf112a36989993');assert.equal(manifest.runUrl,'https://github.com/FullPeople/obr-suite/actions/runs/'+REFERENCE_RUN);
 assert(Array.isArray(manifest.artifacts));assert.equal(manifest.artifacts.length,10,'Exactly ten immutable visual artifacts required');assert.equal(new Set(manifest.artifacts.map(a=>a.id)).size,10);assert.equal(new Set(manifest.artifacts.map(a=>a.name)).size,10);
 for(const a of manifest.artifacts){assert(EXPECTED_ARTIFACTS.has(a.id),'Unexpected artifact ID');assert.equal(a.name,EXPECTED_ARTIFACTS.get(a.id));assert.match(a.digest,/^sha256:[a-f0-9]{64}$/);assert(Number.isSafeInteger(a.sizeBytes)&&a.sizeBytes>0&&a.sizeBytes<=32*1024*1024,'Invalid artifact size');assert.equal(a.url,manifest.runUrl+'/artifacts/'+a.id);}
 return manifest;
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function compareInventory(before,after){
 assert.deepEqual([...after.keys()].sort(),[...before.keys()].sort(),'Inherited production/dependency file inventory changed');
 const files=[];for(const [path,bytes]of before){const next=after.get(path),equal=bytes.equals(next),controller=path===PROTOCOL_ONLY[0],types=path===PROTOCOL_ONLY[1],peerFieldsOnly=types&&!equal&&withoutInlinePeerFields(bytes).equals(next);assert(equal||controller||peerFieldsOnly,'Inherited production bytes changed: '+path);files.push({path,referenceSha256:sha(bytes),candidateSha256:sha(next),equal,protocolOnly:controller||types,changePolicy:controller?'controller E2E not inherited':types?'only exact Peer capability-field deletion; all runtime bytes preserved':'exact bytes'});}
 return files;
}
export function verifyReferenceMetadata(run,jobs,artifacts,expectedArtifacts){
 assert.equal(expectedArtifacts.length,10,'Reference metadata requires all ten artifacts');assert.equal(new Set(expectedArtifacts.map(a=>a.id)).size,10);for(const a of expectedArtifacts){assert.equal(a.name,EXPECTED_ARTIFACTS.get(a.id));assert.match(a.digest,/^sha256:[a-f0-9]{64}$/);}
 assert.equal(run.id,REFERENCE_RUN);assert.equal(run.head_sha,REFERENCE);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
 assert.equal(jobs.length,6,'Reference must retain all six successful jobs');for(const j of jobs){assert.equal(j.status,'completed');assert.equal(j.conclusion,'success');}
 for(const name of ['captured_behavior','lifecycle','pixels_and_viewports'])assert(jobs.some(j=>j.name===name),'Missing reference job '+name);
 assert.equal(jobs.filter(j=>j.name.startsWith('paired_timing (')).length,3);
 for(const expected of expectedArtifacts){const actual=artifacts.find(a=>a.id===expected.id);assert(actual,'Missing reference artifact '+expected.id);assert.equal(actual.name,expected.name);assert.equal(actual.digest,expected.digest);assert.equal(actual.size_in_bytes,expected.sizeBytes);assert.equal(actual.expired,false);}
}
export function verifyInheritedVisual({root=resolve('.'),evidence=resolve('.local-evidence/dice-inherited-visual'),webRoot=process.env.DND_CARD_WEB_ROOT}={}){
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024}).trim();assert.equal(git(['rev-parse',REFERENCE+'^{commit}']),REFERENCE);assert(webRoot,'Exact paired Web root required');assert.equal(execFileSync('git',['-C',webRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),WEB);
 const inventory=ref=>execFileSync('git',['ls-tree','-r','-z','--name-only',ref],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024}).split('\0').filter(Boolean).filter(protectedPath).sort();const before=new Map(inventory(REFERENCE).map(path=>[path,execFileSync('git',['show',REFERENCE+':'+path],{cwd:root,maxBuffer:64*1024*1024})]));const after=new Map(inventory('HEAD').map(path=>[path,readFileSync(resolve(root,path))]));
 const files=compareInventory(before,after),assets=verifyDiceAssets(resolve(root,'extensions/workbench-dice3d/public'));assert.equal(assets.verified,59);assert.deepEqual(assets.changes,[]);
 const manifest=verifyManifest(JSON.parse(readFileSync(resolve(root,'tools/dice-visual-reference-3d596.json'),'utf8'))),run=JSON.parse(readFileSync(resolve(evidence,'run.json'),'utf8')),jobs=JSON.parse(readFileSync(resolve(evidence,'jobs.json'),'utf8')).jobs,artifacts=JSON.parse(readFileSync(resolve(evidence,'artifacts.json'),'utf8')).artifacts;verifyReferenceMetadata(run,jobs,artifacts,manifest.artifacts);
 const report={success:true,source:git(['rev-parse','HEAD']),web:WEB,reference:REFERENCE,referenceRun:REFERENCE_RUN,referenceUrl:manifest.runUrl,boundary:'Inherited evidence is limited to byte-identical rendering, projection, materials, textures, preview, physics and assets. Controller E2E and Peer capability types are explicitly excluded from inheritance; all other types.ts bytes are verified unchanged and are exercised by the current capture/lifecycle/landscape jobs. This is not a new run of the 45 end-to-end viewport cases on the safe SHA. No latency result is inherited.',checkedFiles:files.length,unchangedVisualFiles:files.filter(f=>!f.protocolOnly).length,protocolFilesNotInherited:files.filter(f=>f.protocolOnly),assets,files,referenceArtifacts:manifest.artifacts,previouslyInspectedImages:manifest.inspectedImages};mkdirSync(evidence,{recursive:true});writeFileSync(resolve(evidence,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({success:true,checkedFiles:report.checkedFiles,assets:assets.verified,reference:REFERENCE,referenceRun:REFERENCE_RUN,protocolFilesNotInherited:PROTOCOL_ONLY}));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)verifyInheritedVisual();
