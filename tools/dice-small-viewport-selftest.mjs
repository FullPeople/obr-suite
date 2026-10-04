import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'rolldown';
const out=resolve(process.env.DND_DICE_EVIDENCE||'.local-evidence/dice-small-viewport'),source=resolve('extensions/workbench-dice3d/src'),pub=resolve('extensions/workbench-dice3d/public');
await mkdir(out,{recursive:true});
const entry=resolve(out,'entry.ts'),bundle=resolve(out,'physics.mjs');await writeFile(entry,`import ${JSON.stringify(source+'/physics.worker.ts')};export {diceCatalog} from ${JSON.stringify(source+'/asset-catalog.ts')};`);
await build({input:entry,platform:'node',external:[/^node:/],plugins:[{name:'local-verified-vendor',async load(id){if(id.replaceAll('\\','/')===(source+'/physics.worker.ts').replaceAll('\\','/')){const code=await readFile(id,'utf8'),expected="new URL(url('vendor/jolt-physics.wasm.js'),self.location.origin).href";assert(code.includes(expected));return code.replace(expected,JSON.stringify(pathToFileURL(pub+'/vendor/jolt-physics.wasm.js').href));}}}],output:{file:bundle,format:'esm'}});
const waiters=new Map();globalThis.self={location:{origin:'https://local.invalid'},postMessage(data){const item=waiters.get(data.id||data.type);if(item){waiters.delete(data.id||data.type);clearTimeout(item.timer);item.resolve(data);}}};
globalThis.fetch=async input=>{const u=new URL(String(input),'https://local.invalid');assert.equal(u.origin,'https://local.invalid');assert(u.pathname.startsWith('/suite-dev/dice3d/'));const file=resolve(pub,u.pathname.slice('/suite-dev/dice3d/'.length));assert(file.startsWith(pub+sep));return new Response(await readFile(file));};
const {diceCatalog}=await import(pathToFileURL(bundle).href),catalog=diceCatalog();
const run=data=>new Promise((resolve,reject)=>{const key=data.request?.id||({warmup:'warm',retain:'retained'})[data.type];if(key){const timer=setTimeout(()=>{waiters.delete(key);reject(Error('physics probe timeout: '+key));},120000);waiters.set(key,{resolve,reject,timer});}self.onmessage({data});if(!key)resolve();});
await run({type:'warmup',catalog,view:{w:1920,h:1080}});
const rolls=[];let serial=0;
for(const sourceView of [[390,844],[844,390],[1024,768],[1920,1080]])for(const count of [1,2,5,9,10])for(const kind of ['mixed','d20']){
 const id='viewport-'+(++serial),request={id,source:'synthetic-profile',name:'Synthetic profile',kind,theme:'ink_sketch',bodyColor:'#76bceb',modifier:5,visibility:'all',count,seed:123456},response=await run({request,catalog,view:{w:sourceView[0],h:sourceView[1]}});assert(!response.error,JSON.stringify(response));
 rolls.push({...response.roll,sourceView});await run({type:'release',id});
}
for(const formula of ['1d100','1d20-999999','1d20*99999','repeat(5,1d6+5)','repeat(5,1d6*99999-999999)']){
 const id='formula-'+(++serial),request={id,source:'synthetic-profile',name:'Long player name · 长名称',kind:'mixed',theme:'ink_sketch',bodyColor:'#76bceb',visibility:'all',count:1,seed:123456,recipe:true,formula},response=await run({request,catalog,view:{w:390,h:844}});assert(!response.error,JSON.stringify(response));rolls.push({...response.roll,sourceView:[390,844]});await run({type:'release',id});
}
await writeFile(out+'/rolls.json',JSON.stringify(rolls.map(r=>({...r,poses:Array.from(r.poses)}))));
// Read-only geometry and production renderer/cue checks. No browser or GPU is created.
await build({input:'tools/dice-small-viewport.test.ts',platform:'node',external:[/^node:/],plugins:process.env.DICE_VIEWPORT_BASELINE?[{name:'immutable-viewport-baseline',async load(id){if(['/renderer.ts','/native.ts','/cue-renderer.ts'].some(end=>id.endsWith('/workbench-dice3d/src'+end))){const {execFileSync}=await import('node:child_process');return execFileSync('git',['show',process.env.DICE_VIEWPORT_BASELINE+':'+id.slice(id.indexOf('extensions/'))],{encoding:'utf8'});}}}]:[],output:{file:out+'/checks.mjs',format:'esm'}});
const {execFileSync}=await import('node:child_process');execFileSync(process.execPath,[out+'/checks.mjs'],{stdio:'inherit',env:{...process.env,DND_DICE_EVIDENCE:out}});
