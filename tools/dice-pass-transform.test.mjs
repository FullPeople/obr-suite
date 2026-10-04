import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {transformSource,variantFlags,VARIANTS} from './dice-pass-transform.mjs';
import {phaseFor,PAINT_METHODS} from './dice-pass-runtime.mjs';
import {distribution,compareCases} from './dice-pass-summary.mjs';
const source=file=>readFileSync(file,'utf8');
const renderer='extensions/workbench-dice3d/src/renderer.ts',presentation='extensions/workbench-dice3d/src/research/presentation.ts';
const transformed=file=>transformSource(source(file),'/'+file,'/diagnostic-runtime.mjs');
test('all seven exact source boundaries transform without changing source files',()=>{
  for(const file of [renderer,presentation,'extensions/workbench-dice3d/src/shared-overlay-canvas.ts','extensions/workbench-dice3d/src/controller.ts','extensions/workbench-dice3d/src/audio-mixer.ts','src/workbench/dice3d.ts','src/workbench/dice3d-verify.ts']){
    const before=source(file),result=transformed(file);assert.notEqual(result,before);assert.equal(source(file),before);
    const compiled=ts.transpileModule(result,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},reportDiagnostics:true});assert.deepEqual(compiled.diagnostics,[]);
  }
  assert.equal(transformSource('let ordinary=1;','/src/other.ts','/test.mjs'),null);
});
test('drift fails closed and no-GL guard wraps the complete region/clear path',()=>{
  const before=source(renderer);assert.throws(()=>transformSource(before.replace('withRenderRegion(this.gl,','changed(this.gl,'),'/'+renderer,'/test.mjs'),/boundary changed/);
  const result=transformed(renderer);assert(result.includes('__dicePassBudget.glPass(()=>{withRenderRegion(this.gl,this.renderRegion.get('));assert(result.includes('this.gl.getContext().finish()'),'original warm initialization is untouched');
  assert(result.indexOf('installDicePassBudget(this)')>result.lastIndexOf('this.gl.getContext().finish()'));
});
test('flags are bounded and phase boundaries describe real cue age',()=>{
  assert.equal(VARIANTS.length,6);assert.throws(()=>variantFlags('product-fast'),/Unknown/);assert.deepEqual(variantFlags('no-GL+no-2D'),{noGL:true,no2D:true,noDetachedDOM:false});
  const cue={settled:1,firstBeam:3,finalReveal:4,finalBeamEnd:4.72,diceExit:5.72};
  assert.deepEqual([-.1,0,1,3,4,5.01,5.8].map(a=>phaseFor(a,cue)),['scheduled','physics','settled-wait','gathering','afterglow-fade','tail-hold','complete']);
  assert(PAINT_METHODS.includes('clearRect'));assert(PAINT_METHODS.includes('stroke'));assert(!PAINT_METHODS.includes('setTransform'));assert(!PAINT_METHODS.includes('getImageData'));
});
function exerciseCard({noDetachedDOM,connected=false}){
  const counts={writes:0,queries:0,animations:0,superDraws:0,fx:0,cardChecks:0};
  class Element{
    constructor(tag='div'){this.tag=tag;this.children=[];this.isConnected=connected;this.classList={toggle:()=>counts.writes++,add:()=>counts.writes++};}
    set textContent(value){this.text=value;counts.writes++;}set title(value){this.titleValue=value;counts.writes++;}
    append(...children){this.children.push(...children);}querySelector(selector){counts.queries++;return this.children.find(c=>selector==='b'?c.tag==='b':c.className===selector.slice(1));}
    animate(){counts.animations++;}
  }
  const ctx=new Proxy({}, {get:(_target,key)=>typeof key==='string'?()=>counts.fx++:undefined,set:()=>true});
  class CueRenderer{draw(){counts.superDraws++;}destroy(){}}
  const js=ts.transpileModule(transformed(presentation),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*;\n/gm,'').replaceAll('export ','');
  const create=new Function('CueRenderer','acquireOverlayCanvas','url','decisionProgress','DECISION_DELAY','projectVisual','totalAt','document',js+'\nreturn FormulaShow;');
  const FormulaShow=create(CueRenderer,()=>({canvas:{width:0,height:0},context:ctx,release(){}}),s=>s,(age,at)=>Math.max(0,Math.min(1,(age-at)/.65)),.35,()=>[10,20],(cue,age)=>age>=cue.finalReveal?6:0,{createElement:tag=>new Element(tag)});
  const oldConfig=globalThis.__dicePassBudget,oldDPR=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;globalThis.__dicePassBudget={allowCardWrites(card){counts.cardChecks++;return !(noDetachedDOM&&!card.isConnected);}};
  try{
    const row={formula:'1d6',total:6,dice:[{id:'d',kind:'d6',value:6,raw:3,sign:1,kept:false,flags:[]}],events:[{kind:'reroll',dice:['d'],label:'重掷'}]},roll={request:{id:'fixed',name:'Host',bodyColor:'#28b1fa'},frames:1,poses:new Float32Array([0,0,0,0,0,0,1])};
    const card=new Element('article'),show=new FormulaShow(new Element(),roll,['d'],row,card,()=>({width:1280,height:800}));
    for(const key of Object.keys(counts))counts[key]=0;
    const cue={settled:1,firstBeam:3,finalReveal:4,finalBeamEnd:4.72,diceExit:5.72,beams:[{dieIndex:0,reveal:4}]};
    for(const age of [0,2,4,5])show.draw(age,cue,1);
    return{counts,latest:show.latest,finished:show.finished};
  }finally{globalThis.__dicePassBudget=oldConfig;globalThis.devicePixelRatio=oldDPR;}
}
test('detached DOM suppression preserves CueRenderer, research FX and transition bookkeeping',()=>{
  const baseline=exerciseCard({noDetachedDOM:false}),omitted=exerciseCard({noDetachedDOM:true}),attached=exerciseCard({noDetachedDOM:true,connected:true});
  assert(baseline.counts.writes>0);assert(baseline.counts.queries>0);assert(baseline.counts.animations>0);assert.equal(omitted.counts.writes,0);assert.equal(omitted.counts.queries,0);assert.equal(omitted.counts.animations,0);
  assert.equal(omitted.counts.superDraws,4);assert.equal(omitted.counts.fx,baseline.counts.fx);assert(omitted.counts.fx>4);assert.equal(omitted.latest,baseline.latest);assert.equal(omitted.finished,baseline.finished);assert.deepEqual(attached,baseline);
});
test('summary excludes null GPU/last-frame intervals and detects changed authoritative bytes',()=>{
  assert.deepEqual(distribution([null,undefined,2,3,NaN]),{count:2,median:3,p95:3,max:3,mean:2.5});
  const make=(hash,label)=>({label,expression:'20d6',trace:false,clientCount:1,repeat:1,variant:'test',clients:[{index:0,raw:{rolls:[{poseSha256:hash}]},sdk:{results:[{data:{total:3,dice:[3]}}]}}]});
  assert.equal(compareCases([make('a','first'),make('a','second')]).invariants.valid,true);assert.equal(compareCases([make('a','first'),make('b','second')]).invariants.valid,false);
});
