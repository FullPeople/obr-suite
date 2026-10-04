import test from 'node:test';
import assert from 'node:assert/strict';
import {installDicePassBudget,PAINT_METHODS} from './dice-pass-runtime.mjs';
function fixture(config){
  const originals={config:globalThis.__dicePassConfig,budget:globalThis.__dicePassBudget,renderer:globalThis.__diceProfileRenderer,observer:globalThis.PerformanceObserver};
  globalThis.__dicePassConfig={gpu:false,...config};globalThis.PerformanceObserver=class{static supportedEntryTypes=[];};
  const count={clear:0,render:0,region:0,paint:0,state:0,show:0,audio:0},context={setTransform(){count.state++;}};
  for(const method of PAINT_METHODS)context[method]=function(){assert.equal(this,context);count.paint++;};
  const gl={domElement:{addEventListener(){},removeEventListener(){}},info:{render:{calls:0,triangles:0,lines:0,points:0},autoReset:true},getContext:()=>({isContextLost:()=>false}),shadowMap:{render(){}},render(){count.render++;this.info.render={calls:0,triangles:0,lines:0,points:0};this.shadowMap.render();this.info.render.calls=4;}};
  const renderer={gl,active:[],emit(){},drawFrame(){const p=globalThis.__dicePassBudget;context.setTransform();context.clearRect();count.show++;context.stroke();context.fillText();p.glPass(()=>{count.region++;count.clear++;gl.render();});this.emit('render-retimed',{roll:'r',start:1});}};
  const probe=installDicePassBudget(renderer);probe.wrap2D(context,'cue-canvas');
  return{renderer,probe,count,context,restore(){probe.gpu.dispose();globalThis.__dicePassConfig=originals.config;globalThis.__dicePassBudget=originals.budget;globalThis.__diceProfileRenderer=originals.renderer;globalThis.PerformanceObserver=originals.observer;}};
}
test('no-GL skips entire region including clear, while 2D and logical work execute',()=>{const f=fixture({noGL:true});try{f.renderer.drawFrame();assert.equal(f.count.clear,0);assert.equal(f.count.region,0);assert.equal(f.count.render,0);assert.equal(f.count.show,1);assert.equal(f.count.paint,3);assert.equal(f.probe.frames[0].glPassSkipped,1);assert.equal(f.probe.frames[0].retimes,1);}finally{f.restore();}});
test('no-2D suppresses paints and clear but preserves state APIs, show and GL',()=>{const f=fixture({no2D:true});try{f.renderer.drawFrame();assert.equal(f.count.paint,0);assert.equal(f.count.state,1);assert.equal(f.count.show,1);assert.equal(f.count.clear,1);assert.equal(f.count.render,1);assert.equal(f.probe.frames[0].canvas['cue-canvas'].attempted.clearRect,1);assert.deepEqual(f.probe.frames[0].canvas['cue-canvas'].executed,{});}finally{f.restore();}});
test('baseline preserves receiver and values, per-frame counts and asynchronous audio samples',()=>{const f=fixture({});try{f.probe.audioStart('r',123,false);f.renderer.drawFrame();f.probe.audioStart('r',223,true);f.renderer.drawFrame();assert.equal(f.count.paint,6);assert.equal(f.count.render,2);assert.equal(f.probe.frames[0].audioRestarts,0);assert.equal(f.probe.frames[1].audioRestarts,1);assert(f.probe.frames[0].nextFrameMs>=0);assert.equal(f.probe.frames[1].nextFrameMs,null);assert.equal(f.probe.audio.length,2);assert.equal(f.probe.gpu.records[1].frame,1);}finally{f.restore();}});
