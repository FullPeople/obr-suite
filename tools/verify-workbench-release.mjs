import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
const version=process.argv[2]||'1.0.170-dev';
const base='https://obr.dnd.center/suite-dev/',hash=b=>createHash('sha256').update(b).digest('hex');
const inventory=JSON.parse(readFileSync('dist-workbench-dev/release-hashes.json','utf8'));
const paths=Object.keys(inventory).filter(p=>/\.(?:html|js|css)$/.test(p)||p==='manifest-dev.json'||p==='workbench/source.zip'||p==='workbench/suite-source.zip'||p==='exe_icon.png'||p.startsWith('supporter-avatars/')||p.startsWith('supporters.'));
let next=0,checked=0;const failures=[];
const concurrency=Math.max(1,Math.min(8,Number(process.env.VERIFY_CONCURRENCY)||4));
async function verifyFile(p){
  for(let attempt=0;attempt<3;attempt++){
    let bytes;
    try{
      const response=await fetch(base+p,{cache:'no-store',signal:AbortSignal.timeout(p.endsWith('.zip')?240000:60000)});
      if(!response.ok)throw Error('HTTP '+response.status);
      bytes=Buffer.from(await response.arrayBuffer());
    }catch(e){
      if(attempt===2)throw e;
      console.warn('Retrying public GET:',p,e.message);
      continue;
    }
    // A content mismatch is a release failure, never a retryable network error.
    if(hash(bytes)!==inventory[p])throw Error('hash mismatch');
    return;
  }
}
await Promise.all(Array.from({length:concurrency},async()=>{while(next<paths.length){const p=paths[next++];try{await verifyFile(p);checked++;}catch(e){failures.push(p+': '+e.message);}}}));
if(failures.length)throw Error(JSON.stringify(failures));
const manifest=await (await fetch(base+'manifest-dev.json',{cache:'no-store'})).json();if(manifest.version!==version)throw Error('manifest version mismatch');
const stable=await (await fetch('https://obr.dnd.center/suite/manifest.json',{cache:'no-store'})).json();if(stable.version!=='1.3.5')throw Error('stable version changed');
const host=randomBytes(36).toString('hex'),client=randomBytes(36).toString('hex'),session=hash(host),url=role=>base+'relay?'+new URLSearchParams({session,role});
const request=(role,secret,body)=>fetch(url(role),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000)});
let r=await request('host',host,{register:true,clientKey:client});if(r.status!==200)throw Error('relay registration failed');
const nonce=randomBytes(8).toString('hex');r=await request('host',host,{type:'deployment-probe',nonce});if(r.status!==200)throw Error('relay send failed');r=await request('client',client);const messages=await r.json();if(!messages.some(m=>m.nonce===nonce))throw Error('relay delivery failed');
r=await request('host',client);if(r.status!==401)throw Error('relay host boundary failed');
r=await request('client',client,{deleteCard:{room:'invalid.path',card:''}});if(r.status!==403)throw Error('client delete boundary failed');
r=await request('host',host,{deleteCard:{room:'invalid.path',card:''}});if(r.status!==400)throw Error('delete path validation failed');
const key='release_'+version.replace(/[^a-z0-9]/gi,'_')+'_'+nonce;
r=await request('client',client,{sharedDocument:{key,operation:'read'}});if(r.status!==403)throw Error('client shared-document boundary failed');
const outcomes=await Promise.all([1,2].map(n=>request('host',host,{sharedDocument:{key,operation:'write',expected:0,data:{probe:nonce,value:n}}}).then(r=>r.status)));if(outcomes.sort().join(',')!=='200,409')throw Error('durable CAS failed: '+outcomes);
r=await request('host',host,{sharedDocument:{key,operation:'read'}});const document=await r.json();if(document.revision!==1||document.data.probe!==nonce)throw Error('durable document read failed');
const record={version:manifest.version,public_files_matched:checked,source_archives_verified:true,stable_version:stable.version,relay:'registration, delivery, host isolation, delete validation and durable document CAS passed',probe_document:key,real_room_verified:false};writeFileSync('workbench-test-output/public-'+version+'.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));
