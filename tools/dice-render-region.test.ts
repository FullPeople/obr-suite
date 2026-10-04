import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DiceRenderRegion,withRenderRegion,type RenderRegion} from '../extensions/workbench-dice3d/src/render-region';
import {addSketchOutline} from '../extensions/workbench-dice3d/src/dice-materials';
let checks=0,points=0;
const check=(name:string,work:()=>void)=>{if(process.env.DND_DICE_REGION_CHECK&&!name.includes(process.env.DND_DICE_REGION_CHECK))return;work();checks++;console.log('PASS '+name);};
let seed=20261004;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
function fixture(width=1280,height=800,pixelRatio=1){
 const scene=new T.Scene(),camera=new T.OrthographicCamera(),ppd=Math.min(210,Math.max(120,Math.min(width,height)*.13));
 const halfW=width*.5/ppd,halfH=height*.5/ppd;Object.assign(camera,{left:-halfW,right:halfW,top:halfH*1.24,bottom:-halfH*.76,near:.1,far:150});camera.updateProjectionMatrix();camera.position.set(0,Math.cos(.1745329252)*44,-Math.sin(.1745329252)*44);camera.lookAt(0,0,0);
 const space=new T.Group();space.scale.x=-1;scene.add(space);
 const light=new T.DirectionalLight();light.position.set(-2.4,9,4.2);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.5,far:40});light.shadow.bias=-.0003;light.shadow.normalBias=.02;scene.add(light);
 const ground=new T.Mesh(new T.PlaneGeometry(38,22),new T.ShadowMaterial({opacity:.32}));ground.rotation.x=-Math.PI/2;ground.position.y=-.015;ground.receiveShadow=true;scene.add(ground);
 const region=new DiceRenderRegion(scene,camera,light,ground),view={width,height,pixelsPerDie:ppd,pixelRatio};
 const add=(geometry=new T.BoxGeometry())=>{const material=new T.MeshPhysicalMaterial();material.userData.time={value:0};const body=new T.Mesh(geometry,material);body.castShadow=true;addSketchOutline(body,geometry);region.register(body);space.add(body);return body;};
 return{scene,camera,space,light,ground,region,view,add};
}
const contains=(r:RenderRegion|null,p:T.Vector3,f:ReturnType<typeof fixture>)=>{
 assert(r,'expected bounded ordinary dice');const q=p.clone().project(f.camera),x=(q.x+1)*f.view.width/2,y=(q.y+1)*f.view.height/2;
 if(x>=0&&x<=f.view.width&&y>=0&&y<=f.view.height){assert(x>=r.x-1e-7&&x<=r.x+r.width+1e-7&&y>=r.y-1e-7&&y<=r.y+r.height+1e-7,JSON.stringify({r,x,y,p}));points++;}
};
check('empty / invisible / unborn / exit clears to zero region',()=>{const f=fixture();assert.deepEqual(f.region.get(f.view),{x:0,y:0,width:0,height:0});const m=f.add();m.visible=false;assert.equal(f.region.get(f.view)!.width,0);m.visible=true;assert(f.region.get(f.view)!.width>0);m.removeFromParent();assert.equal(f.region.get(f.view)!.width,0);});
check('visible unknown mesh, point, sprite, vortex or child mask falls back; hidden additions do not',()=>{for(const extra of [new T.Mesh(new T.BoxGeometry()),new T.Points(new T.BufferGeometry()),new T.Sprite()]){const f=fixture(),m=f.add();m.add(extra);assert.equal(f.region.get(f.view),null);extra.visible=false;assert(f.region.get(f.view));extra.visible=true;const group=new T.Group();group.name='rule-vortex';group.add(extra);f.space.add(group);assert.equal(f.region.get(f.view),null);group.visible=false;assert(f.region.get(f.view));}});
check('changed owned geometry/material/outline transform and custom depth are full fallback',()=>{for(const change of [(m:T.Mesh)=>m.geometry=new T.BoxGeometry(),(m:T.Mesh)=>m.material=new T.MeshBasicMaterial(),(m:T.Mesh)=>m.children[0].position.x=1,(m:T.Mesh)=>m.geometry.getAttribute('position').needsUpdate=true,(m:T.Mesh)=>m.customDepthMaterial=new T.MeshDepthMaterial()]){const f=fixture(),m=f.add();change(m);assert.equal(f.region.get(f.view),null);}});
check('background, fog, extra shadow light, invalid view/light use full fallback',()=>{for(const change of [(f:ReturnType<typeof fixture>)=>f.scene.background=new T.Color('red'),f=>f.scene.fog=new T.Fog('white',1,100),f=>{const l=new T.DirectionalLight();l.castShadow=true;f.scene.add(l);},f=>f.view.pixelRatio=NaN,f=>f.light.position.set(1,0,0),f=>f.light.shadow.mapSize.x=0]){const f=fixture();f.add();change(f);assert.equal(f.region.get(f.view),null);}});
check('multi-roll union, late entry and new camera/DPR recompute without stale bounds',()=>{const f=fixture(),a=f.add(),b=f.add();a.position.set(-2,1,0);b.position.set(2,2,0);const both=f.region.get(f.view)!;a.visible=false;const only=f.region.get(f.view)!;assert(both.width>only.width);b.position.x=100;b.castShadow=false;assert.equal(f.region.get(f.view)!.width,0);b.position.x=0;b.castShadow=true;const back=f.region.get(f.view)!;assert(back.width>0);f.camera.zoom=1.5;f.camera.updateProjectionMatrix();f.view.pixelRatio=1.5;const zoom=f.region.get(f.view)!;assert(zoom.width>back.width);});
check('real viewport resize, portrait camera and DPR changes keep current body inside',()=>{const f=fixture(),m=f.add();m.position.set(1,2,0);f.region.get(f.view);Object.assign(f.view,{width:360,height:850,pixelsPerDie:120,pixelRatio:1.5});Object.assign(f.camera,{left:-1.5,right:1.5,top:850/240*1.24,bottom:-850/240*.76});f.camera.updateProjectionMatrix();const r=f.region.get(f.view);contains(r,m.position.clone().applyMatrix4(f.space.matrixWorld),f);assert(r&&r.x+r.width<=360&&r.y+r.height<=850);});
check('projection includes caster height; viewport exclusion follows castShadow presence',()=>{const f=fixture(),m=f.add();m.position.set(5.8,8,0);m.castShadow=true;const withShadow=f.region.get(f.view)!;m.castShadow=false;const noShadow=f.region.get(f.view)!;assert(withShadow.width>noShadow.width);m.visible=false;assert.equal(f.region.get(f.view)!.width,0);});
const catalog=JSON.parse(readFileSync('extensions/workbench-dice3d/public/assets/catalog.json','utf8'));
for(const [kind,asset] of Object.entries(catalog.dice) as [string,{model:string}][]){
 const bytes=readFileSync('extensions/workbench-dice3d/public/'+asset.model),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const geometry=(gltf.scene.getObjectByName('RenderMesh') as T.Mesh).geometry.clone();geometry.scale(40,40,40);
 check(kind+' actual vertices, animated outlines and light-ray shadows fit at randomized poses/viewports',()=>{
  for(let sample=0;sample<12;sample++){
   const dims=[[360,850,.75],[1280,800,1],[1920,1080,1.5],[800,600,2]][sample%4],f=fixture(...dims as [number,number,number]),m=f.add(geometry);
   m.position.set((random()-.5)*7,.4+random()*4,(random()-.5)*4);m.quaternion.setFromEuler(new T.Euler(random()*6,random()*6,random()*6));m.scale.setScalar(.8+random()*.4);
   f.light.position.set(-2.4+(random()-.5)*2,8+random()*3,4.2+(random()-.5)*2);
   const r=f.region.get(f.view),p=geometry.getAttribute('position'),normal=new T.Vector3(0,1,0),d=f.light.position.clone().negate().normalize();
   const right=new T.Vector3().crossVectors(d,normal).normalize(),up=new T.Vector3().crossVectors(right,d).normalize();
   for(let i=0;i<p.count;i++){
    const local=new T.Vector3().fromBufferAttribute(p,i),world=local.clone().applyMatrix4(m.matrixWorld);contains(r,world,f);
    const shell=local.clone().addScaledVector(local.clone().normalize(),2.25/f.view.pixelsPerDie).applyMatrix4(m.matrixWorld);contains(r,shell,f);
    const line=local.clone().multiplyScalar(1.002).addScalar(.003*(i%2?1:-1)).applyMatrix4(m.matrixWorld);contains(r,line,f);
    // An independently constructed worst-case PCF/bilinear sample and normal offset.
    const texel=14/2048,angle=random()*Math.PI*2,filter=(Math.abs(f.light.shadow.radius)+1)*texel;
    const source=world.clone().addScaledVector(right,Math.cos(angle)*filter).addScaledVector(up,Math.sin(angle)*filter).addScaledVector(normal,f.light.shadow.normalBias*(i%2?1:-1));
    const shadow=source.addScaledVector(d,(-.015-source.y)/d.y);contains(r,shadow,f);
   }
   for(const child of [...m.children]){(child as T.Mesh).material.dispose();m.remove(child);}m.material.dispose();
  }
 });
 geometry.dispose();
}
function stateFixture(){
 let rect=new T.Vector4(4,5,600,700),test=true,colorMask=true,savedAlpha=0,glClear=[0,0,0,0],pixel=[.8,.2,.1,1];
 const calls:any[]=[];
 const renderer={autoClear:true,
  getScissor:(v:T.Vector4)=>v.copy(rect),getScissorTest:()=>test,
  setScissor:(x:T.Vector4|number,y?:number,w?:number,h?:number)=>{rect=x instanceof T.Vector4?x.clone():new T.Vector4(x,y,w,h);calls.push(['scissor',...rect.toArray()]);},
  setScissorTest:(v:boolean)=>{test=v;calls.push(['test',v]);},
  getClearAlpha:()=>savedAlpha,setClearAlpha:(alpha:number)=>{savedAlpha=alpha;glClear=[0,0,0,alpha];calls.push(['clearAlpha',alpha]);},
  state:{buffers:{color:{setMask:(value:boolean)=>{colorMask=value;calls.push(['colorMask',value]);}}}},
  clear:(...args:boolean[])=>{calls.push(['clear',test,...args]);if(!test&&colorMask)pixel=[...glClear];}
 };
 return{renderer,calls,rect:()=>rect,test:()=>test,pixel:()=>pixel,paint:()=>pixel=[.8,.2,.1,1],staleClear:(rgba:number[])=>glClear=rgba};
}
check('full clear precedes scissor; normal, empty and fallback restore complete state',()=>{for(const region of [{x:20,y:30,width:40,height:50},{x:0,y:0,width:0,height:0},null]){const f=stateFixture();withRenderRegion(f.renderer as any,region,()=>{assert.equal(f.renderer.autoClear,false);assert.equal(f.test(),region!==null);f.calls.push(['render']);});assert.deepEqual(f.calls.slice(0,4),[['test',false],['clearAlpha',0],['colorMask',true],['clear',false,true,true,true]]);assert.deepEqual(f.rect().toArray(),[4,5,600,700]);assert.equal(f.test(),true);assert.equal(f.renderer.autoClear,true);}});
check('exception restores scissor and previous autoClear=false',()=>{const f=stateFixture();f.renderer.autoClear=false;assert.throws(()=>withRenderRegion(f.renderer as any,{x:1,y:2,width:3,height:4},()=>{throw Error('draw failed')}),/draw failed/);assert.deepEqual(f.rect().toArray(),[4,5,600,700]);assert.equal(f.test(),true);assert.equal(f.renderer.autoClear,false);});
check('next full clear recovers from an interrupted colorWrite=false depth-mask draw',()=>{const f=stateFixture();assert.throws(()=>withRenderRegion(f.renderer as any,null,()=>{f.paint();f.renderer.state.buffers.color.setMask(false);throw Error('mask draw failed');}),/mask draw failed/);f.staleClear([1,1,1,1]);withRenderRegion(f.renderer as any,{x:0,y:0,width:0,height:0},()=>{});assert.deepEqual(f.pixel(),[0,0,0,0]);assert.deepEqual(f.rect().toArray(),[4,5,600,700]);assert.equal(f.test(),true);assert.equal(f.renderer.autoClear,true);});
check('first clear synchronizes context-restored or interrupted-shadow clear color/alpha',()=>{for(const rgba of [[0,0,0,1],[1,1,1,1]]){const f=stateFixture();f.staleClear(rgba);withRenderRegion(f.renderer as any,{x:0,y:0,width:0,height:0},()=>{});assert.deepEqual(f.pixel(),[0,0,0,0]);assert.equal(f.renderer.getClearAlpha(),0);}});
console.log(JSON.stringify({checks,passed:checks,containedActualVertexSamples:points,realModels:true,realGPU:false,pixelEquality:'Not established by Node; CI RGBA comparison required'}));
