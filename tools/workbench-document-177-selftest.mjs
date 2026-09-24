import * as fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {documentStore} from '../server/workbench-relay/documents.mjs';

const output=process.env.WORKBENCH_DOCUMENT_TEST_OUT;
if(!output)throw Error('Set WORKBENCH_DOCUMENT_TEST_OUT to a test output directory.');
await fs.mkdir(resolve(output),{recursive:true});
const root=await fs.mkdtemp(join(resolve(output),'documents-'));
const results=[];
const check=(name,details={})=>{results.push({name,...details});console.log('PASS',name);};
const ioError=code=>Object.assign(Error(`Injected ${code}`),{code});
const source=await fs.readFile(new URL('../server/workbench-relay/documents.mjs',import.meta.url),'utf8');
async function injected(overrides){
 const id='documentIo'+crypto.randomUUID().replaceAll('-','');
 globalThis[id]={...fs,...overrides};
 const replacement=`const {mkdir,readFile,writeFile,rename,unlink}=globalThis.${id};`;
 const code=source.replace("import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';",replacement);
 assert.notEqual(code,source,'filesystem seam must match the real module');
 try{return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).documentStore;}
 finally{delete globalThis[id];}
}
async function directory(label){const path=join(root,label);await fs.mkdir(path);return path;}
async function seed(store,key='inventory_test'){await store({key,operation:'write',expected:0,data:{quantity:6}});}

if(process.platform==='win32'){
 const path=await directory('windows-handle'),store=documentStore(path),key='inventory_test';await seed(store);
 const file=join(path,key+'.json');
 const script=`$f=[IO.File]::Open('${file.replaceAll("'","''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); [Console]::WriteLine('locked'); [Console]::Out.Flush(); Start-Sleep -Milliseconds 350; $f.Dispose()`;
 const child=spawn('powershell.exe',['-NoProfile','-Command',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(`Lock process exited ${code}`)));});
 await new Promise((resolve,reject)=>{child.stdout.on('data',data=>{if(data.toString().includes('locked'))resolve();});child.once('error',reject);child.once('close',code=>reject(Error(`No lock ${code}`)));});
 const start=Date.now(),a=store({key,operation:'write',expected:1,data:{quantity:0}}),b=store({key,operation:'write',expected:1,data:{quantity:100}});
 const outcomesPromise=Promise.allSettled([a,b]);
 const reads=await Promise.all(Array.from({length:12},()=>store({key,operation:'read'})));
 assert.ok(reads.every(read=>read.revision===1&&read.data.quantity===6),'reader sees complete old data during lock');
 const outcomes=await outcomesPromise;await closed;
 assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[0].value.revision,2);
 assert.equal(outcomes[1].status,'rejected');assert.equal(outcomes[1].reason.status,409);
 assert.deepEqual(await store({key,operation:'read'}),{revision:2,data:{quantity:0}});
 assert.equal((await fs.readdir(path)).filter(name=>name.endsWith('.tmp')).length,0);
 check('Windows external read handle recovers with exactly one CAS commit',{elapsedMs:Date.now()-start});
}

{
 const path=await directory('atomic-stress'),store=documentStore(path),key='inventory_stress';
 for(let revision=1;revision<=500;revision++){
  const batch=await Promise.all([store({key,operation:'write',expected:revision-1,data:{revision}}),...Array.from({length:8},()=>store({key,operation:'read'}))]);
  for(const result of batch){assert.ok(result.revision===revision||result.revision===revision-1);assert.equal(result.data?.revision||0,result.revision);}
 }
 assert.equal((await store({key,operation:'read'})).revision,500);
 check('500 writes plus 4,000 overlapping reads expose only complete revisions');
}

{
 let writes=0,renames=0;const make=await injected({writeFile:async(...args)=>{writes++;return fs.writeFile(...args);},rename:async(...args)=>{if(++renames<=2)throw ioError('EPERM');return fs.rename(...args);}});
 const path=await directory('transient'),store=make(path);
 if(process.platform==='win32'){
  assert.equal((await store({key:'inventory_test',operation:'write',expected:0,data:{quantity:3}})).revision,1);
  assert.equal(writes,1);assert.equal(renames,3);
  check('transient Windows rename retries reuse one temporary write and revision');
 }else{
  await assert.rejects(store({key:'inventory_test',operation:'write',expected:0,data:{quantity:3}}),error=>error.code==='EPERM');assert.equal(renames,1);
  check('non-Windows filesystem errors are not retried');
 }
}

{
 const path=await directory('permission');await seed(documentStore(path));let writes=0,renames=0;
 const make=await injected({writeFile:async(...args)=>{writes++;return fs.writeFile(...args);},rename:async()=>{renames++;throw ioError('EACCES');}}),store=make(path),start=Date.now();
 await assert.rejects(store({key:'inventory_test',operation:'write',expected:1,data:{quantity:0}}),error=>error.code==='EACCES'&&error.storagePhase==='rename'&&error.renameAttempts===renames);
 assert.equal(writes,1);assert.equal(renames,process.platform==='win32'?7:1);assert.ok(Date.now()-start<3000);
 assert.deepEqual(await documentStore(path)({key:'inventory_test',operation:'read'}),{revision:1,data:{quantity:6}});
 assert.equal((await fs.readdir(path)).filter(name=>name.endsWith('.tmp')).length,0);
 check('persistent permission failure is bounded and preserves original revision',{renameAttempts:renames});
}

{
 const path=await directory('disk-full');await seed(documentStore(path));let writes=0,renames=0;
 const make=await injected({writeFile:async(file)=>{writes++;await fs.writeFile(file,'partial');throw ioError('ENOSPC');},rename:async()=>{renames++;}});
 await assert.rejects(make(path)({key:'inventory_test',operation:'write',expected:1,data:{quantity:0}}),error=>error.code==='ENOSPC'&&error.storagePhase==='write');
 assert.equal(writes,1);assert.equal(renames,0);assert.equal((await fs.readdir(path)).filter(name=>name.endsWith('.tmp')).length,0);
 assert.equal((await documentStore(path)({key:'inventory_test',operation:'read'})).revision,1);
 check('disk full never retries or replaces the existing document');
}

{
 const path=await directory('cleanup');await seed(documentStore(path));
 const make=await injected({writeFile:async()=>{throw ioError('ENOSPC');},unlink:async()=>{throw ioError('EACCES');}});
 await assert.rejects(make(path)({key:'inventory_test',operation:'write',expected:1,data:{quantity:0}}),error=>error.code==='ENOSPC'&&error.cleanupCode==='EACCES');
 check('cleanup failure preserves primary storage error and records secondary code');
}

{
 const path=await directory('postcommit');let cleanups=0;
 const make=await injected({unlink:async()=>{cleanups++;throw ioError('EPERM');}});
 const saved=await make(path)({key:'inventory_test',operation:'write',expected:0,data:{quantity:1}});
 assert.equal(saved.revision,1);assert.equal(cleanups,0);
 check('successful atomic commit does not run fallible cleanup');
}

{
 const path=await directory('corrupt');await fs.writeFile(join(path,'inventory_test.json'),'{');
 await assert.rejects(documentStore(path)({key:'inventory_test',operation:'write',expected:0,data:{quantity:1}}),error=>error instanceof SyntaxError&&error.storagePhase==='parse');
 assert.equal(await fs.readFile(join(path,'inventory_test.json'),'utf8'),'{');
 check('corrupt existing data is diagnosed instead of overwritten');
}
await fs.writeFile(join(resolve(output),'results.json'),JSON.stringify({platform:process.platform,checks:results.length,root,results},null,2));
console.log(`PASS ${results.length} document storage checks`);
