import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve('.'),out=resolve('.local-evidence/dice-render-resources');mkdirSync(out,{recursive:true});
const source=path=>JSON.stringify(resolve(root,'extensions/workbench-dice3d/src',path));
writeFileSync(out+'/entry.ts',`export {CueRenderer} from ${source('cue-renderer.ts')};export {DiceRenderer} from ${source('renderer.ts')};export {FormulaShow} from ${source('research/presentation.ts')};export * as T from ${JSON.stringify(resolve('node_modules/three/build/three.module.js'))};`);
await build({input:out+'/entry.ts',platform:'node',output:{file:out+'/fixture.mjs',format:'esm'}});
const {CueRenderer,DiceRenderer,FormulaShow,T}=await import(pathToFileURL(out+'/fixture.mjs').href);

// This is the established splitmix64 particle definition, independent of cache layout.
const noise=(seed,index)=>{const mask=(1n<<64n)-1n;let value=(seed^(BigInt(index)*0x9e3779b97f4a7c15n))&mask;value=((value^(value>>30n))*0xbf58476d1ce4e5b9n)&mask;value=((value^(value>>27n))*0x94d049bb133111ebn)&mask;value^=value>>31n;return Number(BigInt.asUintN(64,value)>>11n)/9007199254740992*2-1;};
let particleChecks=0;
for(let seed=0n;seed<24n;seed++){
  const show=Object.assign(Object.create(CueRenderer.prototype),{seed}),expected=[];
  for(let i=0;i<72;i++){const spawn=Math.max(0,Math.min(1,(i+0.5+noise(seed,i*3)*0.38/2)/72)),unit=(noise(seed,i*3+1)+1)/2;expected.push({spawn,life:0.42+0.40*unit,lateral:noise(seed,i*3+2),size:2.6+4.2*unit});}
  const first=show.beamParticles();assert.deepEqual(first,expected);
  for(let beam=-1;beam<20;beam++){assert.equal(show.beamParticles(),first);assert.deepEqual(show.beamParticles(),expected);particleChecks++;}
}

const scene=new T.Scene(),dice=new T.Group(),warmPrograms=new T.Group(),camera=new T.OrthographicCamera();scene.add(dice);
const geometry=new T.BoxGeometry(),warm=[],owners=[];let geometryDisposals=0,decorationDisposals=0;
geometry.addEventListener('dispose',()=>geometryDisposals++);
for(let i=0;i<112;i++){
  const owner=new T.MeshPhysicalMaterial(),mesh=new T.Mesh(geometry,owner),decoration=new T.ShaderMaterial();decoration.addEventListener('dispose',()=>decorationDisposals++);
  const outline=new T.Mesh(geometry,decoration);outline.userData.diceDecoration=true;mesh.add(outline);dice.add(mesh);warm.push(mesh);owners.push(owner);
}
const renderer={warmPrograms,scene,camera};DiceRenderer.prototype.retainWarmPrograms.call(renderer,warm);
assert.equal(warmPrograms.children.length,112);assert.equal(warmPrograms.parent,null);assert.equal(dice.children.length,0);assert.equal(decorationDisposals,0);assert.equal(geometryDisposals,0);
const calls=[];renderer.gl={compileAsync:async(...args)=>calls.push(args)};await DiceRenderer.prototype.compileRestoredPrograms.call(renderer);
assert.deepEqual(calls,[[warmPrograms,camera,scene],[scene,camera]]);assert.equal(warmPrograms.parent,null);
for(const owner of owners)owner.dispose();assert.equal(decorationDisposals,112);assert.equal(geometryDisposals,0);assert.equal(warmPrograms.children.length,0);
for(const owner of owners)owner.dispose();assert.equal(decorationDisposals,112);

const restoreFixture=()=>{
  const pending=[],events=[];let lost=false,resumed=0;
  const renderer=Object.assign(Object.create(DiceRenderer.prototype),{contextGeneration:0,contextLost:true,active:[],gl:{getContext:()=>({isContextLost:()=>lost})},emit:(event,detail)=>events.push({event,detail}),compileRestoredPrograms:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
  return{renderer,pending,events,restore:()=>renderer.restoreContext(()=>resumed++),lose:()=>{lost=true;renderer.contextGeneration++;renderer.contextLost=true;},reacquire:()=>{lost=false;},resumed:()=>resumed};
};
let restoreChecks=0;
{
  const f=restoreFixture(),work=f.restore();f.pending[0].resolve();await work;assert.equal(f.resumed(),1);assert.equal(f.events[0].event,'render-context-restored');restoreChecks++;
}
for(const reject of [false,true]){
  const f=restoreFixture(),old=f.restore();f.lose();if(reject)f.pending[0].reject(Error('stale compile'));else f.pending[0].resolve();await old;
  assert.deepEqual(f.events,[]);assert.equal(f.resumed(),0);assert.equal(f.renderer.contextLost,true);restoreChecks++;
}
for(const reject of [false,true]){
  const f=restoreFixture(),old=f.restore();f.lose();f.reacquire();const latest=f.restore();
  if(reject)f.pending[0].reject(Error('old generation'));else f.pending[0].resolve();await old;
  assert.deepEqual(f.events,[]);assert.equal(f.resumed(),0);f.pending[1].resolve();await latest;
  assert.equal(f.events.length,1);assert.equal(f.events[0].event,'render-context-restored');assert.equal(f.resumed(),1);restoreChecks++;
}
{
  const f=restoreFixture(),old=f.restore();f.lose();f.reacquire();const latest=f.restore();f.pending[1].resolve();await latest;f.pending[0].resolve();await old;
  assert.equal(f.events.length,1);assert.equal(f.resumed(),1);restoreChecks++;
}
{
  const f=restoreFixture(),work=f.restore();f.pending[0].reject(Error('current compile'));await work;
  assert.equal(f.events.length,1);assert.equal(f.events[0].event,'error');assert.match(f.events[0].detail.message,/current compile/);assert.equal(f.resumed(),0);restoreChecks++;
}

// Execute FormulaShow itself with observable DOM/canvas objects. The shared base
// cue draw is separately covered by viewport/pixel tests; count its invocation here.
let created=[],baseDraws=0;
class Element{
  constructor(tag){this.tag=tag;this.children=[];this.className='';this.textContent='';this.style={};this.width=0;this.height=0;this.animations=[];this.classes=new Set();this.classList={add:name=>this.classes.add(name),toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};this.ops=[];this.ctx=new Proxy({},{get:(_,method)=>(...args)=>this.ops.push([method,...args]),set:(target,key,value)=>{target[key]=value;return true;}});}
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=undefined;}}
  getContext(){return this.ctx;}
  animate(...args){this.animations.push(args);}
  querySelector(selector){for(const child of this.children){if(selector.startsWith('.')?child.className===selector.slice(1):child.tag===selector)return child;const found=child.querySelector(selector);if(found)return found;}return null;}
}
globalThis.document={createElement:tag=>{const element=new Element(tag);created.push(element);return element;}};globalThis.devicePixelRatio=1;
const originalDraw=CueRenderer.prototype.draw;CueRenderer.prototype.draw=function(){baseDraws++;};
const projection={width:1280,height:800,pixelsPerDie:120},ids=['a','b'];
const roll={request:{id:'resource-test',name:'Synthetic'},frames:1,poses:new Float32Array([0,.1,0,0,0,0,1,1,.1,0,0,0,0,1])};
const makeRow=kind=>({index:0,formula:'1d6+1d6',operation:null,total:7,dice:[{id:'a',kind:'d6',value:3,raw:3,sign:1,kept:kind!=='discard',flags:[]},{id:'b',kind:'d6',value:4,raw:4,sign:1,kept:true,flags:[]}],events:kind==='rule'?[{kind:'same',dice:['a','b'],label:'same pair'}]:[],compute:()=>7});
const cue={settled:1,beams:[{dieIndex:0,reveal:1.6},{dieIndex:1,reveal:1.8}],finalReveal:2,reveals:[1.6,1.8],displayedTotals:[3,7]};
const canvasCount=stage=>stage.children.filter(child=>child.tag==='canvas').length;
const scenarios=[];
try{
  for(const kind of ['ordinary','discard','rule'])for(const history of [true,false]){
    created=[];const stage=new Element('stage'),card=new Element('article'),args=[stage,roll,ids,makeRow(kind),card,()=>projection,undefined];
    if(!history)args.push(false); // Omit the flag to exercise the real default true.
    const show=new FormulaShow(...args),fx=stage.children.find(child=>child.className==='research-effects');
    assert.equal(canvasCount(stage),kind==='ordinary'?1:2);assert.equal(!!fx,kind!=='ordinary');
    assert.equal(created.filter(element=>element.tag==='img').length,history?2:0);assert.equal(card.children.length,history?3:0);
    const before=baseDraws;show.draw(.5,cue,1);assert.equal(baseDraws,before+1);
    assert.equal(fx?.ops.filter(op=>op[0]==='fillText').length||0,0);
    show.draw(1.7,cue,1);
    if(kind==='discard')assert(fx.ops.some(op=>op[0]==='fillText'&&op[1]==='舍弃'));
    if(kind==='rule'){assert(fx.ops.some(op=>op[0]==='fillText'&&op[1]==='same pair'));assert.equal(fx.ops.filter(op=>op[0]==='ellipse').length,2);assert.equal(fx.ops.filter(op=>op[0]==='quadraticCurveTo').length,1);}
    show.draw(2.1,cue,1);if(history){assert.equal(card.querySelector('.inline-total').textContent,'7');assert(card.classes.has('complete'));assert.equal(card.animations.length,1);}else assert.equal(card.children.length,0);
    show.destroy();show.destroy();assert.equal(canvasCount(stage),0);scenarios.push({kind,history});
  }
  const stage=new Element('stage'),make=kind=>new FormulaShow(stage,roll,ids,makeRow(kind),new Element('article'),()=>projection,undefined,false);
  const ordinary=make('ordinary'),first=make('discard'),second=make('rule');assert.equal(canvasCount(stage),2);
  ordinary.destroy();assert.equal(canvasCount(stage),2);first.destroy();assert.equal(canvasCount(stage),2);second.draw(1.7,cue,1);second.destroy();assert.equal(canvasCount(stage),0);
}finally{CueRenderer.prototype.draw=originalDraw;}
const result={passed:true,particleChecks,particlesPerBeam:72,warmMaterialOwners:112,disposedDecorations:decorationDisposals,sharedGeometryDisposals:geometryDisposals,detachedRestoreCompileCalls:calls.length,restoreChecks,formulaScenarios:scenarios,sharedCanvasLifecycle:true,boundary:'Exact particle math, real Three disposal, stale asynchronous restore rejection, and product FormulaShow with modeled DOM/canvas calls. No GPU, browser pixels, real room, or performance claim.'};
writeFileSync(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
