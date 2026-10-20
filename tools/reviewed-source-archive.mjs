import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {inflateRawSync} from 'node:zlib';

const gitBlob=bytes=>createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
/** Git writes UTF-8 ZIP paths. Read the directory and bodies directly because
 * Windows tar prints names in the console code page, not necessarily UTF-8. */
function verifyArchive(bytes,tree,revision){
 let end=-1;
 for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(bytes.readUInt32LE(at)===0x06054b50&&at+22+bytes.readUInt16LE(at+20)===bytes.length){end=at;break;}
 if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==bytes.readUInt16LE(end+10)||bytes.subarray(end+22).toString()!==revision)throw Error('Source archive has an invalid commit directory');
 const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16),expected=new Map(tree.map(row=>[row.path,row.blob])),found=new Set();
 if(count===65535||start+size!==end)throw Error('Unsupported source archive directory');
 let at=start;
 for(let index=0;index<count;index++){
  if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)throw Error('Source archive directory entry is invalid');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),compressed=bytes.readUInt32LE(at+20),length=bytes.readUInt32LE(at+24),nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42);
  if(flags&1||compressed===0xffffffff||length===0xffffffff||local===0xffffffff||at+46+nameLength+extra+comment>end)throw Error('Unsupported source archive entry');
  const nameBytes=bytes.subarray(at+46,at+46+nameLength),path=new TextDecoder('utf-8',{fatal:true}).decode(nameBytes);
  if(!path.endsWith('/')){
   if(!expected.has(path)||found.has(path)||local+30>start||bytes.readUInt32LE(local)!==0x04034b50)throw Error('Source archive file list differs from the complete commit');
   const localName=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),body=local+30+localName+localExtra;
   if(!bytes.subarray(local+30,local+30+localName).equals(nameBytes)||body+compressed>start)throw Error('Source archive local entry differs');
   const packed=bytes.subarray(body,body+compressed),raw=method===0?packed:method===8?inflateRawSync(packed,{maxOutputLength:Math.max(1,length)}):undefined;
   if(!raw||raw.length!==length||gitBlob(raw)!==expected.get(path))throw Error('Source archive bytes differ from commit: '+path);
   found.add(path);
  }
  at+=46+nameLength+extra+comment;
 }
 if(at!==end||found.size!==expected.size)throw Error('Source archive file list differs from the complete commit');
}

/** Archive committed public source only; local caches and player files have no
 * part in this file list. Verify raw working bytes because text filters can
 * report a normalized checkout as clean while the build read different bytes. */
export function reviewedSourceArchive(sourceRoot,destination){
 const root=realpathSync(sourceRoot),output=resolve(destination);
 if(!output.endsWith('.zip')||realpathSync(dirname(output))!==dirname(output))throw Error('Source archive requires a real output directory and a zip filename');
 if(existsSync(output)&&(!lstatSync(output).isFile()||realpathSync(output)!==output))throw Error('Source archive output must be a regular file');
 const git=(...args)=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,maxBuffer:16*1024*1024});
 const revision=git('rev-parse','HEAD').toString().trim();
 const tree=git('ls-tree','-r','-z',revision).toString().split('\0').filter(Boolean).map(line=>{
  const split=line.indexOf('\t'),[mode,type,blob]=line.slice(0,split).split(' '),path=line.slice(split+1);
  const location=resolve(root,path),within=relative(root,location);
  if(!['100644','100755'].includes(mode)||type!=='blob'||!within||within==='..'||within.startsWith('../')||within.startsWith('..\\')||isAbsolute(within))throw Error('Unsupported tracked source entry');
  return {path,blob,location};
 });
 if(!tree.length||tree.some(row=>row.location===output))throw Error('Source archive cannot replace tracked source');
 const attributes=execFileSync('git',['--no-replace-objects','check-attr','--cached','-z','--stdin','export-ignore','export-subst'],{cwd:root,input:tree.map(row=>row.path).join('\0')+'\0',maxBuffer:16*1024*1024}).toString().split('\0');
 for(let i=0;i+2<attributes.length;i+=3)if(!['unspecified','unset'].includes(attributes[i+2]))throw Error('Source archive export attributes would omit or rewrite committed bytes');
 const verify=()=>{
  if(git('rev-parse','HEAD').toString().trim()!==revision||git('diff','--cached','--name-only',revision).length)throw Error('Source revision or index changed');
  for(const row of tree){
   if(!lstatSync(row.location).isFile()||realpathSync(row.location)!==row.location)throw Error('Source file must be a regular in-repository file');
   const bytes=readFileSync(row.location),blob=gitBlob(bytes);
   if(blob!==row.blob)throw Error('Tracked source bytes differ from commit: '+row.path);
  }
 };
 verify();git('archive','--format=zip','--output='+output,revision);
 verifyArchive(readFileSync(output),tree,revision);
 verify();
 return {revision,trackedFiles:tree.length,archiveSha256:createHash('sha256').update(readFileSync(output)).digest('hex')};
}
