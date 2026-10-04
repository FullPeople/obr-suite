import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {posix,resolve} from 'node:path';
import ts from 'typescript';

export const BASELINE='2e2ddb1f642e1375cffda45efad9584b33100008';
export const REVIEWED_BLOBS=[
 ['de39d86690d9e4955727e252d30d2124a4fd82cd','5d31879ff4a12b0098d65bba1d8c1d2a3cb7edd6','49cb73187cf6f7dcc29cb629d44bbe9dceef0192'],
 ['2a1d090db94ee48e68ad3a5b86ee3318fbe021d9','65055f2acc84d3101ee2ddde8654dc910e1ba226','38a81464e7974c154e744a4bbefff2458c44362a'],
];
export const PRODUCT_PATHS=['extensions','src','public','vite.config.ts','package.json','package-lock.json'];
export const ALLOWED_CHANGES=['shared-overlay-canvas.ts','cue-renderer.ts','research/presentation.ts'].map(p=>'extensions/workbench-dice3d/src/'+p).sort();
const ENTRY=['shared-overlay-canvas','cue-renderer','research/presentation','research/formula','research/rule-timeline'];
const PREFIX='\0dice-canvas-visual/';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export function validateCandidate(candidate='HEAD'){
 assert(candidate==='HEAD'||/^[0-9a-f]{40}$/.test(candidate),'DICE_CANVAS_CANDIDATE must be HEAD or an explicit full commit SHA');
 const head=git('rev-parse','HEAD');candidate=candidate==='HEAD'?head:candidate;
 assert.equal(git('rev-parse',candidate+'^{commit}'),candidate,'candidate must be an exact commit');
 assert.equal(git('merge-base',BASELINE,candidate),BASELINE,'candidate must descend from immutable baseline');
 const changed=git('diff','--name-only',BASELINE,candidate,'--',...PRODUCT_PATHS).split('\n').filter(Boolean).sort();
 assert(changed.length>0,'candidate must include a product change');
 assert(changed.every(p=>ALLOWED_CHANGES.includes(p)),'unknown product drift: '+changed.join(', '));
 const productBlobs=ALLOWED_CHANGES.map(path=>({path,blob:git('rev-parse',candidate+':'+path)}));
 assert(REVIEWED_BLOBS.some(blobs=>blobs.every((blob,i)=>blob===productBlobs[i].blob)),
  'unreviewed candidate product blobs; review source before updating the harness allowlist');
 return{head,baseline:BASELINE,candidate,changed,productBlobs};
}
export function pinnedSource(revision,path){return execFileSync('git',['show',revision+':'+path],{encoding:'utf8'});}
export function resolveRelative(importer,specifier,exists){
 assert(specifier.startsWith('.'),'only relative imports belong in the pinned tree');
 const path=posix.normalize(posix.join(posix.dirname(importer),specifier));
 assert(!path.startsWith('../')&&!posix.isAbsolute(path),'pinned import escaped repository');
 for(const candidate of [path,path+'.ts',path+'.tsx',path+'/index.ts'])if(exists(candidate))return candidate;
 throw Error('unresolved pinned source: '+importer+' -> '+specifier);
}
export function createPinnedPlugin(candidate){
 const revisions=validateCandidate(candidate),records=new Map(),trees={};candidate=revisions.candidate;
 for(const [side,revision]of Object.entries({baseline:BASELINE,candidate}))trees[side]=new Set(git('ls-tree','-r','--name-only',revision).split('\n'));
 const idFor=(side,path)=>PREFIX+side+'/'+path;
 const parse=id=>{if(!id.startsWith(PREFIX))return null;const value=id.slice(PREFIX.length),slash=value.indexOf('/');return{side:value.slice(0,slash),path:value.slice(slash+1)};};
 const plugin={name:'dice-canvas-visual-pinned-sources',enforce:'pre',
  async resolveId(id,importer){
   if(id==='dice-canvas-visual:metadata')return '\0dice-canvas-visual-metadata.js';
   if(id==='dice-canvas-visual:styles')return idFor('baseline','extensions/workbench-dice3d/src/research/research.css');
   for(const side of ['baseline','candidate'])if(id==='dice-canvas-visual:'+side)return idFor(side,'entry.js');
   const owner=importer&&parse(importer);if(!owner)return;
   if(id.startsWith('.'))return idFor(owner.side,resolveRelative(owner.path,id,p=>trees[owner.side].has(p)));
   if(id.startsWith('dice-canvas-source:'))return idFor(owner.side,id.slice('dice-canvas-source:'.length));
   assert(!id.startsWith('/')&&!id.startsWith('\0'),'unexpected absolute source dependency '+id);
   return this.resolve(id,resolve('tools/dice-canvas-visual-runtime.ts'),{skipSelf:true});
  },
  load(id){
   if(id==='\0dice-canvas-visual-metadata.js')return 'export default '+JSON.stringify(revisions);
   const item=parse(id);if(!item)return;
   if(item.path==='entry.js')return ENTRY.map(p=>`export * from 'dice-canvas-source:extensions/workbench-dice3d/src/${p}.ts';`).join('\n');
   const revision=item.side==='baseline'?BASELINE:candidate;
   assert(trees[item.side].has(item.path),'missing pinned source '+item.path);
   const source=pinnedSource(revision,item.path);records.set(item.side+':'+item.path,{side:item.side,revision,path:item.path,sha256:sha256(source)});
   if(item.path.endsWith('.css'))return source;
   assert(item.path.endsWith('.ts')||item.path.endsWith('.tsx'),'unsupported pinned module '+item.path);
   // Transpile only TypeScript syntax. No product control flow or expressions are rewritten.
   return ts.transpileModule(source,{fileName:item.path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:true}}).outputText;
  },
 };
 return{plugin,revisions,records};
}
