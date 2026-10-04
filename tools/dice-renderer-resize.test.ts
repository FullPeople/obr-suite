import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as T from 'three';
import {DiceRenderer} from '../extensions/workbench-dice3d/src/renderer';
const output=process.env.DND_DICE_EVIDENCE||'.cache/dice-renderer-resize';mkdirSync(output,{recursive:true});
const three=readFileSync('node_modules/three/src/renderers/WebGLRenderer.js','utf8');
// Execute the installed Three methods verbatim, with a canvas/viewport double.
// This counts actual width/height setter calls; no WebGL context or GPU is used.
const methods=['getPixelRatio','setPixelRatio','getSize','setSize'].map(name=>{
 const begin=three.indexOf(`this.${name} = function`),end=three.indexOf('\n\t\t};',begin);assert(begin>=0&&end>begin,name);return three.slice(begin,end+6);
}).join('\n');
function fixture(width=640,height=480,ratio=1.5){
 let canvasWidth=300,canvasHeight=150;const writes:any[]=[],viewport:any[]=[],events:any[]=[];
 const canvas={get width(){return canvasWidth},set width(value:number){canvasWidth=value;writes.push({axis:'width',value});},get height(){return canvasHeight},set height(value:number){canvasHeight=value;writes.push({axis:'height',value});},style:{}};
 const gl:any={domElement:canvas,setViewport:(...args:any[])=>viewport.push(args)};
 new Function('canvas','xr','output','warn',`let _width=300,_height=150,_pixelRatio=1;${methods}`).call(gl,canvas,{isPresenting:false},null,()=>{});
 gl.setPixelRatio(ratio);writes.length=0;viewport.length=0;
 const container={clientWidth:width,clientHeight:height},camera=new T.OrthographicCamera();let matrices=0;
 const update=camera.updateProjectionMatrix.bind(camera);camera.updateProjectionMatrix=()=>{matrices++;update();};
 const renderer:any=Object.create(DiceRenderer.prototype);
 Object.assign(renderer,{gl,container,camera,rendererSize:new T.Vector2(),projection:{width:0,height:0,pixelsPerDie:120},targetPixelsPerDie:120,active:[],ready:false,reslot:()=>{},wake:()=>{},emit:(event:string,detail:any)=>events.push({event,detail})});
 return {renderer,gl,container,canvas,writes,viewport,events,matrices:()=>matrices,reset:()=>{writes.length=0;viewport.length=0;events.length=0;}};
}
const tests:any[]=[];const check=(name:string,fn:()=>void)=>{try{fn();tests.push({name,passed:true});}catch(error){tests.push({name,passed:false,error:String(error)});}};
check('installed Three setSize repeats both backing-store writes even at equal size',()=>{const f=fixture();f.gl.setSize(640,480,false);f.reset();f.gl.setSize(640,480,false);assert.deepEqual(f.writes,[{axis:'width',value:960},{axis:'height',value:720}]);});
check('initial layout sets correct logical and backing sizes exactly once',()=>{const f=fixture();f.renderer.layout();assert.equal(f.writes.length,2);assert.deepEqual(f.gl.getSize(new T.Vector2()).toArray(),[640,480]);assert.equal(f.canvas.width,960);assert.equal(f.canvas.height,720);});
check('repeated equal layouts do not write canvas dimensions or reset viewport',()=>{const f=fixture();f.renderer.layout();f.reset();const matrices=f.matrices();f.renderer.layout();f.renderer.layout();assert.equal(f.writes.length,0);assert.equal(f.viewport.length,0);assert.equal(f.matrices(),matrices+2,'camera layout still updates');});
check('active bounds change still updates fit and projection without resizing canvas',()=>{const f=fixture();f.renderer.layout();const before=f.renderer.targetPixelsPerDie;f.reset();f.renderer.active=[{released:false,roll:{bounds:{minX:-30,maxX:30,minZ:-20,maxZ:20}}}];f.renderer.layout();assert(f.renderer.targetPixelsPerDie<before);assert.equal(f.renderer.projection.pixelsPerDie,f.renderer.targetPixelsPerDie);assert.equal(f.writes.length,0);});
check('released animation retains current projection while target fit changes',()=>{const f=fixture();f.renderer.layout();const before=f.renderer.projection.pixelsPerDie;f.reset();f.renderer.active=[{released:true,roll:{bounds:{minX:-30,maxX:30,minZ:-20,maxZ:20}}}];f.renderer.layout();assert(f.renderer.targetPixelsPerDie<before);assert.equal(f.renderer.projection.pixelsPerDie,before);assert.equal(f.writes.length,0);});
check('real width and height changes each resize once and emit viewport',()=>{const f=fixture();f.renderer.layout();f.reset();f.container.clientWidth=801;f.renderer.resize();assert.equal(f.writes.length,2);assert.equal(f.canvas.width,1201);assert.equal(f.canvas.height,720);assert.deepEqual(f.gl.getSize(new T.Vector2()).toArray(),[801,480]);assert.equal(f.events.length,1);f.reset();f.container.clientHeight=601;f.renderer.resize();assert.equal(f.writes.length,2);assert.equal(f.canvas.height,901);assert.equal(f.events.length,1);f.reset();f.renderer.resize();assert.equal(f.writes.length,0);assert.equal(f.events.length,0);});
check('different logical size is corrected even when rounded physical size matches',()=>{const f=fixture(640,480,1);f.renderer.layout();f.gl.setSize(640.25,480,false);f.reset();f.renderer.layout();assert.equal(f.writes.length,2);assert.deepEqual(f.gl.getSize(new T.Vector2()).toArray(),[640,480]);assert.equal(f.canvas.width,640);});
check('quality changes preserve Three DPR resizing without a duplicate layout resize',()=>{Object.defineProperty(globalThis,'devicePixelRatio',{value:2,configurable:true});const f=fixture();f.renderer.layout();f.reset();f.renderer.quality(1);assert.equal(f.gl.getPixelRatio(),1);assert.equal(f.canvas.width,640);assert.equal(f.writes.length,2);f.reset();f.renderer.quality(2);assert.equal(f.gl.getPixelRatio(),2);assert.equal(f.canvas.width,1280);assert.equal(f.writes.length,2);});
check('repeated quality call preserves existing explicit setPixelRatio behavior',()=>{Object.defineProperty(globalThis,'devicePixelRatio',{value:2,configurable:true});const f=fixture(640,480,1);f.renderer.layout();f.reset();f.renderer.quality(1);assert.equal(f.writes.length,2,'one explicit Three DPR resize remains');});
check('external DPR change is honored and layout does not immediately repeat it',()=>{const f=fixture();f.renderer.layout();f.reset();f.gl.setPixelRatio(2);assert.equal(f.writes.length,2);f.reset();f.renderer.layout();assert.equal(f.writes.length,0);assert.equal(f.canvas.width,1280);assert.equal(f.canvas.height,960);});
check('invalidated backing dimensions are repaired despite unchanged logical size',()=>{const f=fixture();f.renderer.layout();f.canvas.width=0;f.canvas.height=0;f.reset();f.renderer.layout();assert.equal(f.writes.length,2);assert.equal(f.canvas.width,960);assert.equal(f.canvas.height,720);});
check('zero-size container clamps to one and later real size is not suppressed',()=>{const f=fixture(0,0,1);f.renderer.layout();assert.equal(f.canvas.width,1);assert.equal(f.canvas.height,1);f.reset();f.renderer.layout();assert.equal(f.writes.length,0);f.container.clientWidth=640;f.container.clientHeight=480;f.renderer.resize();assert.equal(f.writes.length,2);assert.equal(f.canvas.width,640);assert.equal(f.canvas.height,480);});
check('clear preserves camera relayout without resizing an unchanged canvas',()=>{const f=fixture();f.renderer.layout();f.reset();const matrices=f.matrices();f.renderer.clear();assert.equal(f.matrices(),matrices+1);assert.equal(f.writes.length,0);});
const report={boundary:'Node production DiceRenderer layout/resize/quality/clear with installed Three sizing methods and canvas setters; no real GPU, context restoration, pixels or performance gain measured.',threeRevision:T.REVISION,checks:tests.length,passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,tests};writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
