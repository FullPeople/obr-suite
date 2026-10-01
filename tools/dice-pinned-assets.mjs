import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

// Both manifests are authority for immutable bytes, including the vendor files
// outside asset-hashes.json. Only the exact hash-proven LF form may be emitted.
export function verifyDiceAssets(root,{normalize=false}={}){
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const assets=JSON.parse(readFileSync(join(root,'asset-hashes.json'),'utf8'));
 const vendor=JSON.parse(readFileSync(join(root,'vendor/lock.json'),'utf8'));
 const locks={...assets,...Object.fromEntries(Object.entries(vendor.files).map(([name,digest])=>['vendor/'+name,digest]))};
 const changes=[];
 for(const [name,expected] of Object.entries(locks)){
  const path=join(root,name),bytes=readFileSync(path),actual=sha(bytes);
  if(actual===expected)continue;
  const normalized=Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
  if(!normalize||sha(normalized)!==expected)throw Error('Pinned dice asset mismatch: '+name+' expected='+expected+' actual='+actual);
  writeFileSync(path,normalized);changes.push({path:name,sourceSha256:actual,emittedSha256:expected,conversion:'CRLF to locked LF'});
 }
 return {verified:Object.keys(locks).length,changes};
}
