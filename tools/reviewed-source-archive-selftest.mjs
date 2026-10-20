import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {test} from 'node:test';
import {reviewedSourceArchive} from './reviewed-source-archive.mjs';

function fixture(t){
 const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'reviewed-source-'));
 t.after(()=>{assert.equal(dirname(realpathSync(root)),parent);rmSync(root,{recursive:true,force:true});});
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 git('init','-q');git('config','core.autocrlf','false');
 mkdirSync(join(root,'tools'));mkdirSync(join(root,'.github/workflows'),{recursive:true});
 writeFileSync(join(root,'LICENSE'),'Authored license fixture.\n');
 writeFileSync(join(root,'vite.config.ts'),"import './tools/needed.mjs';\n");
 writeFileSync(join(root,'tools/needed.mjs'),'export const original = true;\n');
 writeFileSync(join(root,'.github/workflows/check.yml'),'name: Authored source fixture\n');
 writeFileSync(join(root,'.gitignore'),'.local-evidence/\noutput/\n');
 git('add','.');git('-c','user.name=Source test','-c','user.email=source@example.invalid','commit','-qm','authored fixture');
 mkdirSync(join(root,'.local-evidence'));writeFileSync(join(root,'.local-evidence/private.txt'),'authored private marker');
 writeFileSync(join(root,'untracked.txt'),'authored untracked marker');mkdirSync(join(root,'output'));
 return {root,git,output:join(root,'output/source.zip')};
}
test('contains every committed build/config file and excludes ignored and untracked files',t=>{
 const {root,git,output}=fixture(t),proof=reviewedSourceArchive(root,output);
 assert.equal(proof.revision,git('rev-parse','HEAD').toString().trim());assert.equal(proof.trackedFiles,5);
 const listed=execFileSync('tar',['-tf',output],{encoding:'utf8'}).trim().split(/\r?\n/).filter(path=>!path.endsWith('/')).sort();
 assert.deepEqual(listed,['.github/workflows/check.yml','.gitignore','LICENSE','tools/needed.mjs','vite.config.ts']);
 for(const path of listed)assert.deepEqual(execFileSync('tar',['-xOf',output,path]),readFileSync(join(root,path)));
});
test('rejects a missing tracked helper before creating an archive',t=>{
 const {root,output}=fixture(t);rmSync(join(root,'tools/needed.mjs'));
 assert.throws(()=>reviewedSourceArchive(root,output));assert.equal(existsSync(output),false);
});
test('rejects raw line-ending drift even when Git text normalization reports no change',t=>{
 const {root,git,output}=fixture(t);git('config','core.autocrlf','true');
 writeFileSync(join(root,'tools/needed.mjs'),'export const original = true;\r\n');
 assert.equal(git('diff','--name-only').toString().trim(),'');
 assert.throws(()=>reviewedSourceArchive(root,output),/bytes differ/);assert.equal(existsSync(output),false);
});
test('rejects a staged source change without discarding it or creating an archive',t=>{
 const {root,git,output}=fixture(t);writeFileSync(join(root,'tools/needed.mjs'),'export const original = false;\n');git('add','tools/needed.mjs');
 assert.throws(()=>reviewedSourceArchive(root,output),/index changed/);assert.equal(existsSync(output),false);
 assert.equal(git('diff','--cached','--name-only').toString().trim(),'tools/needed.mjs');
});
test('refuses a Git export filter that silently omits a committed build dependency',t=>{
 const {root,git,output}=fixture(t);writeFileSync(join(root,'.gitattributes'),'tools/needed.mjs export-ignore\n');git('add','.gitattributes');
 git('-c','user.name=Source test','-c','user.email=source@example.invalid','commit','-qm','authored export exclusion');
 assert.throws(()=>reviewedSourceArchive(root,output),/file list differs/);
});
