import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {formulas} from './dice-canvas-visual-fixtures.mjs';
import {BASELINE,pinnedSource,validateCandidate} from './dice-canvas-visual-source.mjs';
const revision=validateCandidate(process.env.DICE_CANVAS_CANDIDATE).candidate;
const load=async ref=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(pinnedSource(ref,'extensions/workbench-dice3d/src/research/formula.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const reference=await load(BASELINE),candidate=await load(revision);
for(const spec of formulas)test('production parser consumes exact deterministic outcomes: '+spec.id,async()=>{
 const evaluated=[];
 for(const api of [reference,candidate]){
  let i=0;const rows=await api.evaluateFormula(api.parseFormula(spec.formula),async groups=>groups.map(g=>Array.from({length:g.count},()=>{assert(i<spec.values.length,'result exhausted');return{id:'d'+i,value:spec.values[i++]};})));
  assert.equal(i,spec.values.length);assert(rows.every(r=>r.compute()===r.total));evaluated.push(JSON.parse(JSON.stringify(rows)));
 }
 assert.deepEqual(...evaluated);
 const events=evaluated[0].flatMap(row=>row.events.map(e=>e.kind));
 const expected={'advantage-discard':['adv'],'disadvantage-natural-one':['dis'],'reroll':['reroll'],'sequential-clamps':['min','max'],'same-value':['same'],'burst':['burst'],'repeat-overlap':['adv']};
 for(const kind of expected[spec.id]||[])assert(events.includes(kind),'fixture must exercise '+kind);
 if(spec.id==='plain-20d6')assert.equal(evaluated[0][0].dice.length,20);
 if(spec.id==='repeat-overlap')assert.equal(evaluated[0].length,2);
 if(spec.id==='advantage-discard')assert(evaluated[0][0].dice.some(d=>!d.kept));
});
