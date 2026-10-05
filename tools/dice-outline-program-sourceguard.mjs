import assert from 'node:assert/strict';
import {readFileSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const SUITE_BASE='8e2cd6fd0fe969d36694338457e9e4d3428c1c00';
export const WEB_BASE='46dd3287d11866bff057a428baeac9336c57a978';
export const PROBE_FILES=['.github/workflows/dice-outline-program-probe.yml',...['sourceguard.mjs','instrument.mjs','runtime.mjs','build.mjs','browser.mjs','analysis.mjs','test.mjs','README.md'].map(n=>'tools/dice-outline-program-'+n)];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
function unchanged(root,base,allowed=[]){
 assert.equal(git(root,'rev-parse',base+'^{commit}'),base,'immutable baseline exists');
 const entries=git(root,'ls-tree','-rz','--full-tree',base).split('\0').filter(Boolean);
 for(const entry of entries){const [meta,path]=entry.split('\t'),[mode,type,oid]=meta.split(' ');assert.equal(type,'blob','only ordinary baseline files');assert(lstatSync(resolve(root,path)).isFile(),'baseline file remains a file: '+path);assert.equal(git(root,'hash-object',path),oid,'baseline bytes changed: '+path);assert.equal(mode,'100644','baseline file mode');}
 const extras=git(root,'ls-files','-z').split('\0').filter(p=>p&&!entries.some(e=>e.endsWith('\t'+p)));assert(extras.every(p=>allowed.includes(p)),'unexpected tracked additions: '+extras.join(','));
 return {base,head:git(root,'rev-parse','HEAD'),baselineFiles:entries.length,baselineTree:git(root,'rev-parse',base+'^{tree}'),allBaselineFilesByteIdentical:true};
}
export function verifyOutlineProgramSources({root=resolve('.'),web=process.env.DND_CARD_WEB_ROOT,dependencies=true}={}){
 assert(web,'DND_CARD_WEB_ROOT must name the exact paired Web checkout');
 const suite=unchanged(root,SUITE_BASE,PROBE_FILES);assert.equal(git(web,'rev-parse','HEAD'),WEB_BASE,'exact paired Web HEAD');const pairedWeb=unchanged(web,WEB_BASE);
 const lock=JSON.parse(readFileSync(resolve(root,'package-lock.json'),'utf8'));assert.equal(lock.packages['node_modules/three'].version,'0.186.0');
 const installedThree={version:'0.186.0',lockSha256:sha(readFileSync(resolve(root,'package-lock.json'))),files:{}};
 if(dependencies){assert.equal(JSON.parse(readFileSync(resolve(root,'node_modules/three/package.json'),'utf8')).version,'0.186.0');
  for(const [file,expected] of Object.entries({'build/three.core.js':'9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6','build/three.module.js':'9052042d676cb0fdc1ddfefe193053f34b7ac0513a616fdac4535d49987812ea','src/renderers/webgl/WebGLPrograms.js':'a682663382b1437ab261f74a52f62686b0160605108f1db05639e68f062a945d','src/renderers/webgl/WebGLProgram.js':'3d4e761022105815464c8fce852639ba0f3e307fec0559409b4698db392801b1','src/renderers/WebGLRenderer.js':'9e8740aad691246b31b3704014e8f3bbd38a8e7bf4b1b4d23868541b023cc63a'})){const actual=sha(readFileSync(resolve(root,'node_modules/three',file)));assert.equal(actual,expected,'pinned installed Three bytes: '+file);installedThree.files[file]=actual;}
 }
 return {suite,pairedWeb,installedThree};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const result=verifyOutlineProgramSources();const out=resolve(process.env.DND_DICE_EVIDENCE||'.local-evidence/dice-outline-program');mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'sourceguard.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
