import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BASELINE,validateCandidate,resolveRelative,createPinnedPlugin,pinnedSource,sha256} from './dice-canvas-visual-source.mjs';
const REVIEWED_CANDIDATE=process.env.DICE_CANVAS_CANDIDATE||'HEAD';
test('reviewed product blobs are mandatory; short and unknown candidates fail closed',()=>{
 for(const value of ['bc540f7','0'.repeat(40)])assert.throws(()=>validateCandidate(value));
 assert.throws(()=>validateCandidate(BASELINE),/product change/);
 assert(validateCandidate(REVIEWED_CANDIDATE).changed.length>0);
});
test('relative source closure cannot fall back to working tree or escape repository',()=>{
 const exists=p=>p==='a/b.ts';assert.equal(resolveRelative('a/c.ts','./b',exists),'a/b.ts');
 assert.throws(()=>resolveRelative('a/c.ts','./unknown',exists),/unresolved/);
 assert.throws(()=>resolveRelative('a/c.ts','../../secret',exists),/escaped/);
 assert.throws(()=>resolveRelative('a/c.ts','three',exists),/relative/);
});
test('variant identity, dependency closure and source digests remain independent',async()=>{
 const {plugin,records}=createPinnedPlugin(REVIEWED_CANDIDATE);
 const base=await plugin.resolveId('dice-canvas-visual:baseline');const candidate=await plugin.resolveId('dice-canvas-visual:candidate');assert.notEqual(base,candidate);
 assert.match(plugin.load(base),/research\/formula.ts/);
 const path='extensions/workbench-dice3d/src/shared-overlay-canvas.ts';
 for(const [entry,revision]of [[base,BASELINE],[candidate,validateCandidate(REVIEWED_CANDIDATE).candidate]]){
  const id=await plugin.resolveId('dice-canvas-source:'+path,entry);const code=plugin.load(id);
  assert(!code.includes('type Layer='));assert.equal(records.get((entry===base?'baseline':'candidate')+':'+path).sha256,sha256(pinnedSource(revision,path)));
  assert.equal(code.includes('markDirty'),pinnedSource(revision,path).includes('markDirty'));
 }
});
