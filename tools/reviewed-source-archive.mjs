import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve} from 'node:path';

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
 const verify=()=>{
  if(git('rev-parse','HEAD').toString().trim()!==revision||git('diff','--cached','--name-only',revision).length)throw Error('Source revision or index changed');
  for(const row of tree){
   if(!lstatSync(row.location).isFile()||realpathSync(row.location)!==row.location)throw Error('Source file must be a regular in-repository file');
   const bytes=readFileSync(row.location),blob=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
   if(blob!==row.blob)throw Error('Tracked source bytes differ from commit: '+row.path);
  }
 };
 verify();git('archive','--format=zip','--output='+output,revision);
 const listed=execFileSync('tar',['-tf',output],{encoding:'utf8',maxBuffer:16*1024*1024}).trim().split(/\r?\n/).filter(path=>path&&!path.endsWith('/')).sort();
 if(JSON.stringify(listed)!==JSON.stringify(tree.map(row=>row.path).sort()))throw Error('Source archive file list differs from the complete commit');
 verify();
 return {revision,trackedFiles:tree.length,archiveSha256:createHash('sha256').update(readFileSync(output)).digest('hex')};
}
