import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {DiceAssets} from '../extensions/workbench-dice3d/src/asset-loading';
import {ASSET_LOCKS} from '../extensions/workbench-dice3d/src/asset-manifest';
import {diceCatalog} from '../extensions/workbench-dice3d/src/asset-catalog';
import {createDiceMaterial,instanceDiceMaterial} from '../extensions/workbench-dice3d/src/dice-materials';
import {createVerifiedTextureLoader} from '../extensions/workbench-dice3d/src/verified-texture-loader';
import {KINDS,url} from '../extensions/workbench-dice3d/src/types';

const originalFetch=globalThis.fetch,originalTimer=globalThis.setTimeout;
// Only accelerate the existing retry backoff, never the inactivity timeout.
globalThis.setTimeout=((fn:any,ms:number,...args:any[])=>originalTimer(fn,ms===350||ms===700?0:ms,...args)) as any;
const checks:string[]=[],files=new Map<string,Uint8Array>(),requests:string[]=[];
const bytes=(text:string)=>new TextEncoder().encode(text),sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const data=bytes('same immutable image'),otherData=bytes('different immutable image'),hash=sha(data);
const deferred=<A>()=>{let resolve!:(value:A)=>void;const promise=new Promise<A>(r=>resolve=r);return{promise,resolve};};
const record=(name:string)=>checks.push(name);
function fixture(locks:Record<string,string>){
  const assets=new DiceAssets(),paths:string[]=[],read=assets.bytes.bind(assets);assets.locks={...locks};
  assets.bytes=path=>{paths.push(path);return read(path);};return{assets,paths};
}
function texture(){return new T.Texture({width:2048,height:2048} as any);}
function shaderMask(material:T.Material){
  const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};
  material.onBeforeCompile(shader as any,{} as T.WebGLRenderer);
  return(shader.uniforms as any).diceMask.value as T.Texture;
}
globalThis.fetch=(async input=>{
  const requested=new URL(String(input),'https://fixture.invalid').pathname.replace('/suite-dev/dice3d/','');requests.push(requested);
  const body=files.get(requested);return body?new Response(body.slice() as any):new Response('',{status:404});
}) as typeof fetch;
try{
  files.set('a.png',data);files.set('b.png',data);files.set('c.png',otherData);
  const shared=fixture({'a.png':hash,'b.png':hash}),started=deferred<void>(),finish=deferred<void>();let decodes=0,configurations=0;
  const load=createVerifiedTextureLoader(shared.assets,async()=>{
    decodes++;started.resolve();await finish.promise;const result=texture();result.flipY=false;result.anisotropy=8;result.needsUpdate=true;configurations++;return result;
  });
  const a=load('a.png'),b=load('b.png');await started.promise;finish.resolve();
  const [first,alias]=await Promise.all([a,b]);assert.equal(first,alias);assert.equal(decodes,1);assert.equal(configurations,1);assert.equal(first.version,1);
  assert.equal(first.flipY,false);assert.equal(first.anisotropy,8);assert.deepEqual(shared.paths,['a.png','b.png']);
  assert.equal(await load('b.png'),first);assert.deepEqual(shared.paths,['a.png','b.png','b.png']);
  assert.equal(requests.filter(p=>p==='a.png').length,1);assert.equal(requests.filter(p=>p==='b.png').length,1);
  record('concurrent locked aliases verify both paths, share one decode/configuration, and retain per-path download caching');

  const distinct=fixture({'a.png':hash,'c.png':sha(otherData)}),loadDistinct=createVerifiedTextureLoader(distinct.assets,async()=>texture());
  assert.notEqual(await loadDistinct('a.png'),await loadDistinct('c.png'));
  record('different valid content hashes never share a texture');

  const unknown=fixture({}),loadUnknown=createVerifiedTextureLoader(unknown.assets,async()=>texture());
  const unknownA=await loadUnknown('a.png');assert.notEqual(unknownA,await loadUnknown('b.png'));assert.equal(unknownA,await loadUnknown('a.png'));
  record('unlocked identical bytes use path identity, including same-path reuse');

  for(const invalid of ['','a'.repeat(63),'a'.repeat(65),'g'.repeat(64),'sha256:'+hash]){
    const loadInvalid=createVerifiedTextureLoader({locks:{a:invalid,b:invalid},bytes:async()=>data.slice().buffer},async()=>texture());
    assert.notEqual(await loadInvalid('a'),await loadInvalid('b'));
  }
  record('empty, truncated, extended, non-hex and prefixed locks cannot establish content identity');

  const unverified=deferred<ArrayBuffer>(),pending=deferred<void>();let pendingCalls=0;
  const loadPending=createVerifiedTextureLoader({locks:{a:hash,b:hash},bytes:path=>path==='a'?Promise.resolve(data.slice().buffer):(pending.resolve(),unverified.promise)},async()=>{pendingCalls++;return texture();});
  const ready=await loadPending('a');let aliasResolved=false;
  const pendingAlias=loadPending('b').then(value=>{aliasResolved=true;return value;});await pending.promise;await Promise.resolve();assert.equal(aliasResolved,false);
  unverified.resolve(data.slice().buffer);assert.equal(await pendingAlias,ready);assert.equal(pendingCalls,1);
  record('a cached hash cannot return before the requesting alias finishes verification');

  files.set('corrupt.png',bytes('corrupt image'));
  const corrupt=fixture({'a.png':hash,'corrupt.png':hash}),loadCorrupt=createVerifiedTextureLoader(corrupt.assets,async()=>{decodes++;return texture();});
  const valid=await loadCorrupt('a.png'),beforeCorrupt=decodes;
  await assert.rejects(loadCorrupt('corrupt.png'),/E_DICE_ASSET.*attempt=3\/3.*SHA-256 mismatch/);
  assert.equal(decodes,beforeCorrupt);assert.equal(requests.filter(p=>p==='corrupt.png').length,3);
  files.set('corrupt.png',data);assert.equal(await loadCorrupt('corrupt.png'),valid);assert.equal(decodes,beforeCorrupt);
  record('a corrupt locked alias exhausts real DiceAssets integrity retries, then recovers without invalidating the good texture');

  const missing=fixture({'a.png':hash,'missing.png':hash}),loadMissing=createVerifiedTextureLoader(missing.assets,async()=>texture());
  const present=await loadMissing('a.png');await assert.rejects(loadMissing('missing.png'),/E_DICE_ASSET.*HTTP 404/);
  assert.equal(requests.filter(p=>p==='missing.png').length,1);files.set('missing.png',data);assert.equal(await loadMissing('missing.png'),present);
  record('a missing locked alias cannot bypass a real 404, and remains retryable when restored');

  const retryAssets=fixture({'a.png':hash,'b.png':hash}),retryStarted=deferred<void>(),retryFinish=deferred<void>();let attempts=0;
  const loadRetry=createVerifiedTextureLoader(retryAssets.assets,async()=>{attempts++;if(attempts===1){retryStarted.resolve();await retryFinish.promise;throw Error('decode failed');}return texture();});
  const initialRetry=loadRetry('a.png');await retryStarted.promise;
  // The second path has its own successful verification before joining the failing decode.
  await retryAssets.assets.bytes('b.png');const aliasRetry=loadRetry('b.png');await Promise.resolve();retryFinish.resolve();
  const failed=await Promise.allSettled([initialRetry,aliasRetry]);assert(failed.every(r=>r.status==='rejected'&&/decode failed/.test(String(r.reason))));assert.equal(attempts,1);
  const [retryA,retryB]=await Promise.all([loadRetry('a.png'),loadRetry('b.png')]);assert.equal(retryA,retryB);assert.equal(attempts,2);
  record('concurrent decode failure evicts its content entry and both verified aliases share a successful retry');

  let synchronousAttempts=0;
  const loadSynchronous=createVerifiedTextureLoader(shared.assets,()=>{if(++synchronousAttempts===1)throw Error('configuration failed');return Promise.resolve(texture());});
  await assert.rejects(loadSynchronous('a.png'),/configuration failed/);assert.equal(await loadSynchronous('a.png'),await loadSynchronous('b.png'));assert.equal(synchronousAttempts,2);
  record('a synchronous decoder/configuration failure is also evicted and retryable');

  const movingLock=deferred<ArrayBuffer>(),mutable={locks:{a:hash,b:hash},bytes:(path:string)=>path==='a'?movingLock.promise:Promise.resolve(data.slice().buffer)};
  const loadMutable=createVerifiedTextureLoader(mutable,async()=>texture()),changing=loadMutable('a');mutable.locks.a=sha(otherData);movingLock.resolve(data.slice().buffer);
  assert.notEqual(await changing,await loadMutable('b'));
  record('a lock changed during verification falls back to path identity');

  const createLocal=(anisotropy:number)=>createVerifiedTextureLoader(shared.assets,async()=>{const result=texture();result.anisotropy=anisotropy;return result;});
  const contextA=createLocal(8),contextB=createLocal(4),ownedA=await contextA('a.png'),ownedB=await contextB('b.png');
  assert.notEqual(ownedA,ownedB);assert.equal(ownedA.anisotropy,8);assert.equal(ownedB.anisotropy,4);
  record('separate renderer/preview loaders never share textures or sampler state, even with the same DiceAssets');

  const catalog=diceCatalog(),paths=[...new Set(Object.values(catalog.themes).flatMap(theme=>Object.values(theme.masks)))];
  const groups=new Map<string,string[]>(),assetRows=paths.map(path=>{
    const file=readFileSync('extensions/workbench-dice3d/public/'+path),digest=sha(file);
    assert.equal(digest,ASSET_LOCKS[path]);assert.match(digest,/^[0-9a-f]{64}$/);
    assert.equal(file.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const width=file.readUInt32BE(16),height=file.readUInt32BE(20);assert.equal(width,2048);assert.equal(height,2048);
    groups.set(digest,[...(groups.get(digest)||[]),path]);files.set(path,new Uint8Array(file));return{path,sha256:digest,fileBytes:file.length,width,height};
  });
  assert.equal(paths.length,19);assert.equal(groups.size,7);assert.deepEqual([...groups.values()].map(group=>group.length).sort(),[1,3,3,3,3,3,3]);
  record('all 19 runtime PNG paths match immutable file locks and form exactly 7 binary content groups');

  const actual=fixture({...ASSET_LOCKS});let actualDecodes=0,actualConfigurations=0;
  // Node reference-identity test, not an image decoder or a WebGL/pixel test.
  const loadActual=createVerifiedTextureLoader(actual.assets,async buffer=>{
    actualDecodes++;const header=new DataView(buffer),result=new T.Texture({width:header.getUint32(16),height:header.getUint32(20)} as any);
    result.flipY=false;result.anisotropy=8;result.needsUpdate=true;actualConfigurations++;return result;
  });
  const materials=await Promise.all(Object.values(catalog.themes).flatMap(theme=>KINDS.map(async kind=>{
    const mask=await loadActual(theme.masks[kind]),base=createDiceMaterial(theme,mask),instance=instanceDiceMaterial(base,theme,'#334455');
    assert.equal(shaderMask(base),mask);assert.equal(shaderMask(instance),mask);return{theme,kind,base,instance,mask};
  })));
  const masks=new Set(materials.map(row=>row.mask));assert.equal(materials.length,35);assert.equal(masks.size,7);assert.equal(actualDecodes,7);assert.equal(actualConfigurations,7);
  assert.equal(actual.paths.length,35);assert.equal(new Set(actual.paths).size,19);
  for(const kind of KINDS)assert.equal(new Set(materials.filter(row=>row.kind===kind).map(row=>row.mask)).size,1);
  for(const mask of masks){assert.equal(mask.version,1);assert.equal(mask.flipY,false);assert.equal(mask.anisotropy,8);}
  materials[0].instance.userData.time.value=42;assert.equal(materials[0].base.userData.time.value,0);assert.equal(materials[1].instance.userData.time.value,0);
  record('35 real Three base materials and 35 instances reference 7 textures while retaining independent material uniforms');

  // Fresh shader callback only; this does not create or restore a real WebGL context.
  for(const row of materials){
   const first:any={uniforms:{},vertexShader:'',fragmentShader:''};row.instance.onBeforeCompile(first,undefined as any);
   const state=row.instance.userData;state.time.value=17;state.glyphWipe.value=.37;
   const restored:any={uniforms:{},vertexShader:'',fragmentShader:''};row.instance.onBeforeCompile(restored,undefined as any);
   assert.equal(restored.uniforms.diceMask.value,row.mask);
   assert.equal(restored.uniforms.diceTime,state.time);assert.equal(restored.uniforms.diceWipe,state.glyphWipe);
   assert.notEqual(restored.uniforms.diceTime,row.base.userData.time);assert.equal(row.mask.version,1);
  }
  record('review: a fresh shader compile retains borrowed texture identity and the instance-owned mutable uniforms');

  let disposed=0;for(const mask of masks)mask.addEventListener('dispose',()=>disposed++);
  materials[0].instance.dispose();materials[0].base.dispose();assert.equal(disposed,0);
  const surviving=materials.find(row=>row!==materials[0]&&row.mask===materials[0].mask)!;assert.equal(shaderMask(surviving.instance),materials[0].mask);
  for(const row of materials.slice(1)){row.instance.dispose();row.base.dispose();}assert.equal(disposed,0);
  // Only the texture owner explicitly disposes a unique texture; borrowers never do.
  for(const mask of masks)mask.dispose();assert.equal(disposed,7);
  record('disposing base/instance material borrowers leaves shared masks intact; explicit owner disposal occurs once per unique texture');

  const renderer=readFileSync('extensions/workbench-dice3d/src/renderer.ts','utf8'),preview=readFileSync('extensions/workbench-dice3d/src/skin-preview.ts','utf8');
  assert(renderer.includes('createVerifiedTextureLoader(this.assets,async bytes=>{const mask=await decodeGlyphTexture(bytes);'));
  assert(preview.includes('createVerifiedTextureLoader(assets,async bytes=>{const t=new T.Texture(await createImageBitmap(new Blob([bytes])))'));
  assert(!preview.includes('decodeGlyphTexture'));assert(!renderer.includes('new Map<string,Promise<T.Texture>>'));assert(!preview.includes('new Map<string,Promise<T.Texture>>'));
  record('renderer uses its existing red decoder and preview retains its existing RGBA ImageBitmap decoder');

  console.log(JSON.stringify({success:true,checks,scope:'Node integrity, concurrency and real Three material reference tests only; no browser decode, rendered pixels, GPU or process memory measurement',
    runtime:{materialAssignments:materials.length,verifiedPaths:paths.length,uniqueBinaryHashes:groups.size,textureObjectsFromStubDecoder:actualDecodes,configurations:actualConfigurations},
    theoreticalOverlayRedBase:{bytesBefore:19*2048*2048,bytesAfter:7*2048*2048,bytesAvoided:12*2048*2048},
    assetRows,contentGroups:[...groups].map(([sha256,paths])=>({sha256,paths}))},null,2));
}finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer;}
