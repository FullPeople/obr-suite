import * as T from 'three';

export interface RenderRegion {x:number;y:number;width:number;height:number}
type View={width:number;height:number;pixelsPerDie:number;pixelRatio:number};
type Owned={body:T.Mesh;geometry:T.BufferGeometry;position:T.BufferAttribute|T.InterleavedBufferAttribute;version:number;material:T.Material|T.Material[]};
const finite=(...values:number[])=>values.every(Number.isFinite);
const IDENTITY=new T.Matrix4();
const identity=(o:T.Object3D)=>o.matrix.equals(IDENTITY);

/** Only the immutable dice and their known local-space outlines have bounded shaders.
 * Unknown visible drawables (including rule vortices/depth masks) keep the full viewport.
 * Bounds are rebuilt from the current matrices/presence, never from the final roll pose. */
export class DiceRenderRegion {
  private owned=new WeakMap<T.Object3D,Owned>();
  constructor(private scene:T.Scene,private camera:T.OrthographicCamera,private light:T.DirectionalLight,private ground:T.Mesh){}
  register(body:T.Mesh){
    for(const object of [body,...body.children]){
      const geometry=(object as T.Mesh).geometry,position=geometry?.getAttribute('position');
      if(position)this.owned.set(object,{body,geometry,position,version:position instanceof T.InterleavedBufferAttribute?position.data.version:position.version,material:(object as T.Mesh).material});
    }
  }
  /** null means full viewport; a zero rectangle means a transparent empty frame. */
  get(view:View):RenderRegion|null {
    const {width,height,pixelsPerDie,pixelRatio}=view;
    if(!finite(width,height,pixelsPerDie,pixelRatio)||Math.min(width,height,pixelsPerDie,pixelRatio)<=0||!this.camera.isOrthographicCamera||this.scene.background!==null||this.scene.fog!==null||this.scene.overrideMaterial!==null)return null;
    const material=this.ground.material;
    if(!(this.ground.geometry instanceof T.PlaneGeometry)||!(material instanceof T.ShadowMaterial)||material.color.getHex()!==0||this.ground.castShadow)return null;
    this.scene.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);this.light.target.updateWorldMatrix(true,false);
    const bodies:T.Mesh[]=[];let unsafe=false;
    this.scene.traverseVisible(object=>{
      if((object as T.Light).isLight&&(object as T.Light).castShadow&&object!==this.light)unsafe=true;
      const drawable=object as T.Mesh;
      if(!drawable.isMesh&&!(object as T.Line).isLine&&!(object as T.Points).isPoints&&!(object as T.Sprite).isSprite)return;
      if(object===this.ground)return;
      const known=this.owned.get(object),position=drawable.geometry?.getAttribute('position');
      if(!known||drawable.geometry!==known.geometry||drawable.material!==known.material||position!==known.position||
        (position instanceof T.InterleavedBufferAttribute?position.data.version:position?.version)!==known.version||
        (object!==known.body&&(object.parent!==known.body||!identity(object)))||drawable.customDepthMaterial||drawable.customDistanceMaterial){unsafe=true;return;}
      if(object===known.body)bodies.push(known.body);
    });
    if(unsafe)return null;
    const projection=new T.Matrix4().multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);
    if(!projection.elements.every(Number.isFinite))return null;
    const planeNormal=new T.Vector3(0,0,1).applyNormalMatrix(new T.Matrix3().getNormalMatrix(this.ground.matrixWorld));
    const planePoint=new T.Vector3().setFromMatrixPosition(this.ground.matrixWorld);
    const direction=new T.Vector3().setFromMatrixPosition(this.light.target.matrixWorld).sub(new T.Vector3().setFromMatrixPosition(this.light.matrixWorld)).normalize();
    const denominator=planeNormal.dot(direction),shadow=this.light.shadow,sc=shadow.camera;
    if(!finite(denominator,shadow.radius,shadow.bias,shadow.normalBias,sc.left,sc.right,sc.top,sc.bottom,sc.near,sc.far,sc.zoom)||Math.abs(denominator)<.05||sc.zoom<=0||sc.far<=sc.near)return null;
    const mapWidth=Math.min(shadow.mapSize.x,shadow.map?.width??Infinity),mapHeight=Math.min(shadow.mapSize.y,shadow.map?.height??Infinity);
    if(!finite(mapWidth,mapHeight)||Math.min(mapWidth,mapHeight)<=0)return null;
    // PCF's disk plus hardware bilinear footprint, normal/depth bias, then the
    // conservative norm of projection along the light ray onto the receiver plane.
    const texel=Math.max(Math.abs(sc.right-sc.left)/mapWidth,Math.abs(sc.top-sc.bottom)/mapHeight)/sc.zoom;
    const shadowPad=(Math.SQRT2*(Math.abs(shadow.radius)+2)*texel+Math.abs(shadow.normalBias)+Math.abs(shadow.bias)*(sc.far-sc.near))*(1+1/Math.abs(denominator));
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    // Per-call scratch avoids per-corner allocations for large simultaneous rolls.
    const projected=new T.Vector3(),offset=new T.Vector3(),point=new T.Vector3(),delta=new T.Vector3(),expanded=new T.Box3();
    const project=(point:T.Vector3)=>{
      const p=projected.copy(point).applyMatrix4(projection);
      if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.z)){unsafe=true;return;}
      const sx=(p.x+1)*width*.5,sy=(p.y+1)*height*.5;
      minX=Math.min(minX,sx);maxX=Math.max(maxX,sx);minY=Math.min(minY,sy);maxY=Math.max(maxY,sy);
    };
    const add=(point:T.Vector3,pad=0)=>{
      if(!pad){project(point);return;}
      // A world-axis box also covers the bias/filter margin at oblique camera angles.
      for(let corner=0;corner<8;corner++)project(offset.set(point.x+(corner&4?pad:-pad),point.y+(corner&2?pad:-pad),point.z+(corner&1?pad:-pad)));
    };
    for(const body of bodies){
      const geometry=body.geometry;
      if(!geometry.boundingBox)geometry.computeBoundingBox();
      const box=geometry.boundingBox;
      if(!box||box.isEmpty()||!finite(box.min.x,box.min.y,box.min.z,box.max.x,box.max.y,box.max.z)||!body.matrixWorld.elements.every(Number.isFinite))return null;
      // Sketch shell <=2.25/pixelScale; dynamic shells <=2/pixelScale.
      // Sketch lines use position*1.002 plus <=.003 on each local axis.
      const outline=2.5/pixelsPerDie+.002*Math.max(Math.abs(box.min.x),Math.abs(box.min.y),Math.abs(box.min.z),Math.abs(box.max.x),Math.abs(box.max.y),Math.abs(box.max.z))+.004;
      for(let corner=0;corner<8;corner++){
        point.set(corner&4?box.max.x:box.min.x,corner&2?box.max.y:box.min.y,corner&1?box.max.z:box.min.z).applyMatrix4(body.matrixWorld);
        if(body.castShadow&&this.ground.visible&&this.light.visible&&this.light.castShadow){
          const distance=planeNormal.dot(delta.copy(planePoint).sub(point))/denominator;
          add(point.addScaledVector(direction,distance),shadowPad);
        }
      }
      expanded.copy(box).expandByScalar(outline);
      for(let corner=0;corner<8;corner++)add(point.set(corner&4?expanded.max.x:expanded.min.x,corner&2?expanded.max.y:expanded.min.y,corner&1?expanded.max.z:expanded.min.z).applyMatrix4(body.matrixWorld));
    }
    if(unsafe)return null;
    if(!bodies.length)return{x:0,y:0,width:0,height:0};
    // MSAA/line rasterization and logical-to-physical scissor rounding at any DPR.
    const pad=4+2/pixelRatio;
    const x=Math.max(0,Math.min(width,Math.floor(minX-pad))),y=Math.max(0,Math.min(height,Math.floor(minY-pad)));
    const right=Math.max(x,Math.min(width,Math.ceil(maxX+pad))),top=Math.max(y,Math.min(height,Math.ceil(maxY+pad)));
    return{x,y,width:right-x,height:top-y};
  }
}

type RegionRenderer=Pick<T.WebGLRenderer,'getScissor'|'getScissorTest'|'setScissor'|'setScissorTest'|'clear'|'autoClear'|'getClearAlpha'|'setClearAlpha'|'state'>;
/** Clear the entire old frame before clipping, including the last die's exit.
 * Three restores this scissor after its unchanged full-size shadow pass. */
export function withRenderRegion(renderer:RegionRenderer,region:RenderRegion|null,render:()=>void){
  const saved=renderer.getScissor(new T.Vector4()),test=renderer.getScissorTest(),autoClear=renderer.autoClear;
  try{
    renderer.setScissorTest(false);
    // Match WebGLBackground before manual clear, including after context restore or
    // an interrupted shadow/depth-mask pass left a stale clear color or write mask.
    renderer.setClearAlpha(renderer.getClearAlpha());renderer.state.buffers.color.setMask(true);
    renderer.clear(true,true,true);renderer.autoClear=false;
    if(region){renderer.setScissor(region.x,region.y,region.width,region.height);renderer.setScissorTest(true);}
    render();
  }finally{renderer.autoClear=autoClear;renderer.setScissor(saved);renderer.setScissorTest(test);}
}
