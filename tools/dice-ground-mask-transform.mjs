const replaceOnce=(code,from,to)=>{if(code.split(from).length!==2)throw Error('Ground mask source boundary changed: '+from);return code.replace(from,to);};
/** Append an instrumented clone. Baseline class and withRenderRegion stay byte-for-byte original. */
export function transformGroundMaskRegion(code){
 const start=code.indexOf('export class DiceRenderRegion {'),end=code.indexOf('\ntype RegionRenderer=');
 if(start<0||end<start)throw Error('Ground mask region class boundary changed');
 let clone=code.slice(start,end).replace('export class DiceRenderRegion {',`export class DiceGroundMaskRenderRegion {
  groundMaskValid=false;
  groundMaskRectangles:RenderRegion[]=[];
  groundMaskLights:T.Light[]=[];`);
 clone=replaceOnce(clone,'    const {width,height,pixelsPerDie,pixelRatio}=view;',`    this.groundMaskValid=false;this.groundMaskRectangles=[];this.groundMaskLights=[];
    const {width,height,pixelsPerDie,pixelRatio}=view;`);
 clone=replaceOnce(clone,'    this.scene.traverseVisible(object=>{',`    this.scene.traverseVisible(object=>{
      if((object as T.Light).isLight)this.groundMaskLights.push(object as T.Light);
      if(!isGroundMaskObjectSafe(object,this.ground,this.light))unsafe=true;`);
 clone=replaceOnce(clone,'    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;',`    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    let bodyMinX=Infinity,bodyMinY=Infinity,bodyMaxX=-Infinity,bodyMaxY=-Infinity;
    const rectangles:RenderRegion[]=[];`);
 clone=replaceOnce(clone,'      minX=Math.min(minX,sx);maxX=Math.max(maxX,sx);minY=Math.min(minY,sy);maxY=Math.max(maxY,sy);',`      minX=Math.min(minX,sx);maxX=Math.max(maxX,sx);minY=Math.min(minY,sy);maxY=Math.max(maxY,sy);
      bodyMinX=Math.min(bodyMinX,sx);bodyMaxX=Math.max(bodyMaxX,sx);bodyMinY=Math.min(bodyMinY,sy);bodyMaxY=Math.max(bodyMaxY,sy);`);
 clone=replaceOnce(clone,'    for(const body of bodies){',`    for(const body of bodies){
      bodyMinX=Infinity;bodyMinY=Infinity;bodyMaxX=-Infinity;bodyMaxY=-Infinity;`);
 clone=replaceOnce(clone,'    if(!bodies.length)return{x:0,y:0,width:0,height:0};',`    if(!bodies.length){this.groundMaskValid=true;return{x:0,y:0,width:0,height:0};}`);
 const lastCorner='      for(let corner=0;corner<8;corner++)add(point.set(corner&4?expanded.max.x:expanded.min.x,corner&2?expanded.max.y:expanded.min.y,corner&1?expanded.max.z:expanded.min.z).applyMatrix4(body.matrixWorld));';
 clone=replaceOnce(clone,lastCorner,`${lastCorner}
      const bodyPad=4+2/pixelRatio;
      const bx=Math.max(0,Math.min(width,Math.floor(bodyMinX-bodyPad))),by=Math.max(0,Math.min(height,Math.floor(bodyMinY-bodyPad)));
      const br=Math.max(bx,Math.min(width,Math.ceil(bodyMaxX+bodyPad))),bt=Math.max(by,Math.min(height,Math.ceil(bodyMaxY+bodyPad)));
      rectangles.push({x:bx,y:by,width:br-bx,height:bt-by});`);
 clone=replaceOnce(clone,'    return{x,y,width:right-x,height:top-y};',`    this.groundMaskRectangles=rectangles;this.groundMaskValid=true;
    return{x,y,width:right-x,height:top-y};`);
 return code+`\nimport {isGroundMaskObjectSafe} from '../../../tools/dice-ground-mask-runtime';\n`+clone+'\n';
}
export function transformGroundMaskRenderer(code){
 code=replaceOnce(code,"import {DiceRenderRegion,withRenderRegion} from './render-region';",`import {DiceRenderRegion,DiceGroundMaskRenderRegion,withRenderRegion} from './render-region';
import {DiceGroundMask} from '../../../tools/dice-ground-mask-runtime';`);
 code=replaceOnce(code,'  private renderRegion!:DiceRenderRegion;',`  private renderRegion!:DiceRenderRegion;
  private groundMask!:DiceGroundMask;`);
 code=replaceOnce(code,'    this.renderRegion=new DiceRenderRegion(this.scene,this.camera,key,ground);',`    const groundMaskMode=(globalThis as any).__diceGroundMaskMode==='candidate'?'candidate':'baseline';
    this.renderRegion=groundMaskMode==='candidate'?new DiceGroundMaskRenderRegion(this.scene,this.camera,key,ground):new DiceRenderRegion(this.scene,this.camera,key,ground);
    this.groundMask=new DiceGroundMask(this.gl,this.scene,this.camera,key,ground,this.renderRegion as any,groundMaskMode);
    (globalThis as any).__diceGroundMask=this.groundMask;`);
 code=replaceOnce(code,'    withRenderRegion(this.gl,this.renderRegion.get({...this.projection,pixelRatio:this.gl.getPixelRatio()}),()=>{this.gl.render(this.scene,this.camera);});',`    const groundMaskView={...this.projection,pixelRatio:this.gl.getPixelRatio()};
    const groundMaskRegion=this.renderRegion.get(groundMaskView);
    this.groundMask.update(groundMaskView,groundMaskRegion);
    withRenderRegion(this.gl,groundMaskRegion,()=>{this.gl.render(this.scene,this.camera);});`);
 code=replaceOnce(code,'this.contextLost=false;void this.gl.compileAsync(this.scene,this.camera)', 'this.contextLost=false;this.groundMask.prepareContextRestore();void this.gl.compileAsync(this.scene,this.camera)');
 return code;
}
export function groundMaskTransform(){return{name:'dice-ground-mask-tools-only',enforce:'pre',transform(code,id){
 const file=id.split('?')[0].replaceAll('\\','/');
 if(file.endsWith('/extensions/workbench-dice3d/src/render-region.ts'))return transformGroundMaskRegion(code);
 if(file.endsWith('/extensions/workbench-dice3d/src/renderer.ts'))return transformGroundMaskRenderer(code);
}};}
