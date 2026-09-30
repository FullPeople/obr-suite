// Read-only model turntable. No Controller, physics, random result or room broadcast.
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {DiceAssets} from './asset-loading';
import {materialCatalog,STYLE_CHOICES} from './material-styles';
import {createDiceMaterial,instanceDiceMaterial,addSketchOutline,disposeDiceDecorations} from './dice-materials';
import {normalizePlayerColor} from './player-color.mjs';
import {KINDS,url,type Catalog,type ThemeID,type Kind} from './types';

const channel='workbench-dice-preview/v1',status=document.getElementById('status')!;
let style:ThemeID='ink_sketch',color='#50525b',active=false,loaded=false,catalog:Catalog,frame=0;
const geometry=new Map<Kind,T.BufferGeometry>(),bases=new Map<string,T.MeshPhysicalMaterial>(),meshes:T.Mesh[]=[],group=new T.Group();
const gl=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'}),scene=new T.Scene(),camera=new T.PerspectiveCamera(32,1,.1,50);
gl.setPixelRatio(Math.min(devicePixelRatio,1.5));gl.setClearColor(0,0);gl.outputColorSpace=T.SRGBColorSpace;gl.toneMapping=T.ACESFilmicToneMapping;document.body.prepend(gl.domElement);
scene.add(group,new T.HemisphereLight(0xffffff,0x738099,1.35));
const key=new T.DirectionalLight(0xfffaf2,2.2);key.position.set(-2.4,9,4.2);scene.add(key);
const rim=new T.DirectionalLight(0xe2edff,.65);rim.position.set(3,4.4,-5);scene.add(rim);
const pmrem=new T.PMREMGenerator(gl),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04).texture;scene.environment=environment;room.dispose();pmrem.dispose();
const report=(error:unknown)=>{status.textContent='3D 展示加载失败：'+String(error);document.body.dataset.previewError=String(error);parent.postMessage({channel,error:String(error)},location.origin);};
function resize(){const w=Math.max(1,innerWidth),h=Math.max(1,innerHeight);gl.setSize(w,h,false);camera.aspect=w/h;camera.position.set(0,5.4,7.6).multiplyScalar(Math.max(1,1.55/camera.aspect));camera.lookAt(0,0,0);camera.updateProjectionMatrix();}
function rebuild(){
 for(const mesh of meshes){disposeDiceDecorations(mesh);(mesh.material as T.Material).dispose();group.remove(mesh);}meshes.length=0;
 const theme=catalog.themes[style];
 for(const [i,kind] of KINDS.entries()){
  const geo=geometry.get(kind)!,mat=instanceDiceMaterial(bases.get(`${style}:${kind}`)!,theme,color),mesh=new T.Mesh(geo,mat),row=i<4?0:1,col=row?i-4:i,count=row?3:4;
  mesh.position.set((col-(count-1)/2)*1.34,0,(row-.5)*1.5);mesh.rotation.set(.12+i*.17,.4+i*.55,.10);if(theme.style==='sketch')addSketchOutline(mesh,geo);
  group.add(mesh);meshes.push(mesh);
 }
 document.body.dataset.previewTheme=style;document.body.dataset.previewColor=color;
}
function draw(time:number){frame=0;if(!active||!loaded)return;const age=time/1000;group.rotation.y=Math.sin(age*.16)*.22;
 for(const [i,mesh] of meshes.entries()){const mat=mesh.material as T.MeshPhysicalMaterial;mat.userData.time.value=age;mesh.rotation.y=.4+i*.55+age*.12;}
 gl.render(scene,camera);frame=requestAnimationFrame(draw);
}
function wake(){if(active&&loaded&&!frame)frame=requestAnimationFrame(draw);}
addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin||event.data?.channel!==channel)return;try{
 const data=event.data;if(!STYLE_CHOICES.some(s=>s.id===data.theme))throw Error('未知预览材质：'+String(data.theme));
 const nextColor=normalizePlayerColor(data.color),changed=style!==data.theme||color!==nextColor;style=data.theme;color=nextColor;active=data.active===true;
 if(loaded&&changed)rebuild();if(!active&&frame){cancelAnimationFrame(frame);frame=0;}wake();
}catch(error){report(error);}});
new ResizeObserver(resize).observe(document.body);resize();
gl.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();active=false;report('WebGL 上下文丢失，请重新打开皮肤页');});
addEventListener('pagehide',()=>{cancelAnimationFrame(frame);for(const mesh of meshes){disposeDiceDecorations(mesh);(mesh.material as T.Material).dispose();}for(const geo of geometry.values())geo.dispose();for(const mat of bases.values())mat.dispose();environment.dispose();gl.dispose();},{once:true});
async function init(){
 const assets=new DiceAssets(p=>{status.textContent=`正在准备 3D 展示… ${p.done}/${p.total}`;});assets.locks=await assets.json<Record<string,string>>('asset-hashes.json');catalog=materialCatalog(await assets.json<Catalog>('assets/catalog.json'));
 assets.plan([...KINDS.map(k=>catalog.dice[k].model),...Object.values(catalog.themes).flatMap(t=>Object.values(t.masks))]);
 const loader=new GLTFLoader(),textures=new Map<string,Promise<T.Texture>>();
 await Promise.all(KINDS.map(async kind=>{const model=await loader.parseAsync(await assets.bytes(catalog.dice[kind].model),url(''));const mesh=model.scene.getObjectByName('RenderMesh') as T.Mesh;
  if(!mesh?.isMesh||!mesh.geometry.getAttribute('uv1'))throw Error('预览模型缺少数字 UV：'+kind);const geo=mesh.geometry.clone();geo.scale(40,40,40);geo.setAttribute('diceGlyph',geo.getAttribute('uv1'));geometry.set(kind,geo);
 }));
 await Promise.all(Object.values(catalog.themes).flatMap(theme=>KINDS.map(async kind=>{const path=theme.masks[kind];let mask=textures.get(path);if(!mask){mask=assets.bytes(path).then(async bytes=>{const t=new T.Texture(await createImageBitmap(new Blob([bytes])));t.needsUpdate=true;t.flipY=false;t.anisotropy=Math.min(8,gl.capabilities.getMaxAnisotropy());return t;});textures.set(path,mask);}bases.set(`${theme.id}:${kind}`,createDiceMaterial(theme,await mask));})));
 rebuild();await gl.compileAsync(scene,camera);loaded=true;gl.render(scene,camera);status.textContent='';document.body.dataset.previewReady='true';parent.postMessage({channel,ready:true},location.origin);wake();
}
void init().catch(report);
