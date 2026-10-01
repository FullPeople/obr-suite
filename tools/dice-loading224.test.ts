import assert from 'node:assert/strict';
import {DiceAssets} from '../extensions/workbench-dice3d/src/asset-loading';
const originalFetch=globalThis.fetch,originalTimer=globalThis.setTimeout;
// Accelerate only the test clock; production keeps a 30-second inactivity budget.
globalThis.setTimeout=((fn:any,ms:number,...args:any[])=>originalTimer(fn,Math.min(ms,15),...args)) as any;
const checks:string[]=[];
try{
  let calls=0;
  globalThis.fetch=(async()=>{calls++;return new Response('ready');}) as typeof fetch;
  const shared=new DiceAssets(),first=shared.bytes('fixture.txt');
  assert.equal(shared.bytes('fixture.txt'),first);await first;await shared.bytes('fixture.txt');assert.equal(calls,1);
  checks.push('concurrent and successful requests share one download');

  calls=0;globalThis.fetch=(async()=>{calls++;return new Response('',{status:503});}) as typeof fetch;
  const recoverable=new DiceAssets();await assert.rejects(recoverable.bytes('fixture.txt'),/attempt=3\/3.*HTTP 503/);assert.equal(calls,3);
  globalThis.fetch=(async()=>{calls++;return new Response('recovered');}) as typeof fetch;
  assert.equal(new TextDecoder().decode(await recoverable.bytes('fixture.txt')),'recovered');assert.equal(calls,4);
  checks.push('failed downloads are evicted and can recover in the same loader');

  calls=0;globalThis.fetch=(async()=>{calls++;return new Response('',{status:404});}) as typeof fetch;
  await assert.rejects(new DiceAssets().bytes('missing.txt'),/attempt=1\/3.*HTTP 404/);assert.equal(calls,1);
  checks.push('permanent HTTP failures do not consume three retries');

  calls=0;globalThis.fetch=((_url,init)=>new Promise((_resolve,reject)=>{calls++;init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});})) as typeof fetch;
  const timedOut=new DiceAssets();await assert.rejects(timedOut.bytes('stalled.txt'),/attempt=3\/3: E_DICE_TIMEOUT 等待响应头超过 30 秒/);assert.equal(calls,3);
  globalThis.fetch=(async()=>new Response('back online')) as typeof fetch;
  assert.equal(new TextDecoder().decode(await timedOut.bytes('stalled.txt')),'back online');
  checks.push('stalled headers time out with a clear reason and remain retryable');

  calls=0;globalThis.fetch=(async(_url,init)=>{calls++;return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));init!.signal!.addEventListener('abort',()=>controller.error(init!.signal!.reason),{once:true});}}));}) as typeof fetch;
  await assert.rejects(new DiceAssets().bytes('stalled-body.txt'),/attempt=3\/3: E_DICE_TIMEOUT 等待文件数据超过 30 秒/);assert.equal(calls,3);
  checks.push('a stalled response body retains the bounded inactivity timeout');

  calls=0;globalThis.fetch=(async()=>{calls++;return new Response('corrupt vendor');}) as typeof fetch;
  await assert.rejects(new DiceAssets().bytes('vendor/jolt-physics.wasm.js'),/attempt=3\/3.*SHA-256 mismatch/);assert.equal(calls,3);
  checks.push('bundled locks still reject corrupted engine bytes');
  console.log(JSON.stringify({success:true,checks},null,2));
}finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer;}
