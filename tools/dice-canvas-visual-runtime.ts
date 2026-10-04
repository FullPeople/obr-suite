// All runtime production imports are supplied from git by the pinned-source Vite plugin.
// @ts-expect-error Vite test-only virtual module.
import * as baseline from 'dice-canvas-visual:baseline';
// @ts-expect-error Vite test-only virtual module.
import * as candidate from 'dice-canvas-visual:candidate';
// @ts-expect-error Vite test-only virtual module.
import metadata from 'dice-canvas-visual:metadata';
// @ts-expect-error Vite test-only pinned CSS.
import 'dice-canvas-visual:styles';
import {compareRGBA,diffRGBA} from './dice-canvas-visual-pixels.mjs';
import type {Roll,Theme} from '../extensions/workbench-dice3d/src/types';
import type {FormulaRow} from '../extensions/workbench-dice3d/src/research/formula';
import type {HopStage} from '../extensions/workbench-dice3d/src/research/rule-timeline';
type API=typeof import('../extensions/workbench-dice3d/src/research/presentation')&typeof import('../extensions/workbench-dice3d/src/shared-overlay-canvas')&typeof import('../extensions/workbench-dice3d/src/research/formula')&typeof import('../extensions/workbench-dice3d/src/research/rule-timeline');
const apis:API[]=[baseline,candidate],kinds=['cue-canvas','research-effects'] as const;
const theme={glyph:[.8,.7,.4],style:'comic'} as Theme;
const host=document.querySelector('#capture') as HTMLElement;
const style=document.createElement('style');style.textContent='html,body{margin:0;overflow:auto;background:#172127}#capture{display:block;width:max-content}.visual-stage{position:relative;overflow:hidden;background:repeating-conic-gradient(#243744 0% 25%,#304653 0% 50%) 0/32px 32px}.visual-cards{position:relative;padding:12px;width:100%;background:#22282d}.visual-cards:empty{display:none}';document.head.append(style);
let frameClock=1000000;
// Explicit replay clock is diagnostic input for slot interpolation only, never a latency measure.
Object.defineProperty(performance,'now',{configurable:true,value:()=>frameClock});
function assert(condition:unknown,message:string):asserts condition{if(!condition)throw Error(message);}
const hash=async(bytes:Uint8ClampedArray)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))).map(b=>b.toString(16).padStart(2,'0')).join('');
const serial=(value:unknown)=>JSON.stringify(value);
const same=(a:unknown,b:unknown,label:string)=>assert(serial(a)===serial(b),label+' mismatch');
type Spec={id:string;formula:string;values:number[];card?:boolean};
import {formulas} from './dice-canvas-visual-fixtures.mjs';
const effectSpec=formulas.find(s=>s.id==='advantage-discard')!;
class Scene{
 root=document.createElement('section');stage=document.createElement('section');panel=document.createElement('section');width=640;height=480;
 owners:{show:InstanceType<API['FormulaShow']>;card:HTMLElement;cue:ReturnType<API['formulaCue']>;row:FormulaRow;live:boolean}[]=[];
 constructor(public api:API,public showCards=false){
  this.stage.className='visual-stage';this.panel.className='visual-cards';this.root.append(this.stage,this.panel);
  // Detached containers have no layout. These stable fixture dimensions are their viewport input.
  Object.defineProperties(this.stage,{clientWidth:{get:()=>this.width},clientHeight:{get:()=>this.height}});this.resize(640,480);
 }
 resize(width:number,height:number){this.width=width;this.height=height;this.stage.style.width=width+'px';this.stage.style.height=height+'px';this.root.style.width=width+'px';}
 surface(kind:string){return this.stage.querySelector<HTMLCanvasElement>('.'+kind);}
 async add(spec:Spec,suffix=''){
  let index=0;const rows=await this.api.evaluateFormula(this.api.parseFormula(spec.formula),async groups=>groups.map(g=>Array.from({length:g.count},()=>{assert(index<spec.values.length,'deterministic result fixture exhausted');const value=spec.values[index];return{id:'d'+index++,value};})));
  assert(index===spec.values.length,'deterministic results were not consumed exactly');
  for(const row of rows){
   const card=document.createElement('article');card.className='history-card';
   const count=row.dice.length,poses=new Float32Array(row.dice.flatMap((_d,i)=>[((i%5)-2)*.8,.25,Math.floor(i/5)*.8-.9,0,0,0,1]));
   const raw:Roll={version:2,request:{id:'canvas-fixture-'+spec.id+suffix+'-'+row.index,source:'test',name:'Canvas fixture',kind:'mixed',count,theme:'godot_blue_cat_eye',seed:123456,bodyColor:'#aabbcc'},kinds:row.dice.map(d=>d.kind),results:row.dice.map(d=>d.raw),fps:120,frames:1,poses,contacts:[],physicsMs:0,steps:0,collisions:0,duration:1};
   // Actual production timeline builder, with recorded diagnostic hop samples, no physics claim.
   const stages:HopStage[]=row.events.filter(e=>e.kind==='min'||e.kind==='max').map((event,i)=>{
    const id=event.dice[0],n=row.dice.findIndex(d=>d.id===id),pose=poses.slice(n*7,n*7+7),start=1.8+i*.7;
    return{start,rules:[{id,kind:event.kind as 'min'|'max',label:event.label,from:event.from!,to:event.to!}],hop:{ids:[id],kinds:[row.dice[n].kind],fps:120,frames:2,poses:new Float32Array([...pose,...pose]),contacts:[],duration:.2,landings:[.2],surfaces:[event.to!],physicsMs:0}};
   });
   const entry=this.api.appendRuleHops({roll:raw,ids:row.dice.map(d=>d.id),offset:0,births:row.dice.map(()=>0)},stages);
   const projection=()=>({width:this.width,height:this.height,pixelsPerDie:100});
   const cue=this.api.formulaCue(entry.roll,entry.ids,row,projection(),theme);
   const show=new this.api.FormulaShow(this.stage,entry.roll,entry.ids,row,card,projection,entry.timeline);
   show.setSlotOffset(row.index?100:-35,row.index?15:-10);
   this.owners.push({show,card,cue,row,live:true});
  }
 }
 draw(ages:number[],appear=1){this.api.beginOverlayFrame(this.stage);this.owners.forEach((owner,i)=>{if(owner.live)owner.show.draw(ages[i]??ages[0],owner.cue,appear);});}
 destroy(index?:number){this.owners.forEach((owner,i)=>{if(index===undefined||index===i){owner.show.destroy();owner.live=false;}});}
 dom(){return this.owners.map(o=>({card:o.card.outerHTML,slot:o.show.slotPosition(),live:o.live}));}
 async mount(){host.replaceChildren(this.root);if(this.showCards)this.panel.replaceChildren(...this.owners.map(o=>o.card));for(const img of this.panel.querySelectorAll('img'))await img.decode();await document.fonts.ready;}
 unmount(){this.root.remove();for(const owner of this.owners)owner.card.remove();}
}
type Pair=[Scene,Scene];
let active:Pair|null=null;
let results:any={};
let frameIndex=0;
const pair=async(spec:Spec)=>{const p=apis.map(api=>new Scene(api,!!spec.card)) as Pair;await Promise.all(p.map(s=>s.add(spec)));same(p[0].owners.map(o=>({row:o.row,cue:o.cue})),p[1].owners.map(o=>({row:o.row,cue:o.cue})),'parsed rows and cue timelines');return p;};
function getPixels(scene:Scene,kind:string,width:number,height:number){const surface=scene.surface(kind);return surface?surface.getContext('2d')!.getImageData(0,0,width,height).data:new Uint8ClampedArray(width*height*4);}
function extent(p:Pair,kind:string){const a=p[0].surface(kind),b=p[1].surface(kind);if(a&&b)same([a.width,a.height],[b.width,b.height],kind+' backing dimensions');const c=a||b;return[c?.width??1,c?.height??1];}
function png(bytes:Uint8ClampedArray,width:number,height:number){const c=document.createElement('canvas');c.width=width;c.height=height;c.getContext('2d')!.putImageData(new ImageData(bytes as ImageDataArray,width,height),0,0);return c.toDataURL('image/png').split(',')[1];}
async function inspect(p:Pair,label:string,clear=false){
 const dom=p.map(s=>s.dom());
 const record:any={label,index:frameIndex++,devicePixelRatio,domEqual:serial(dom[0])===serial(dom[1]),baselineDomSha256:await hash(new Uint8ClampedArray(new TextEncoder().encode(serial(dom[0])))),candidateDomSha256:await hash(new Uint8ClampedArray(new TextEncoder().encode(serial(dom[1])))),slots:p.map(s=>s.owners.map(o=>o.show.slotPosition())),layers:{}};
 for(const kind of kinds){const [width,height]=extent(p,kind),a=getPixels(p[0],kind,width,height),b=getPixels(p[1],kind,width,height),diff=compareRGBA(a,b);
  record.layers[kind]={width,height,baselinePresent:!!p[0].surface(kind),candidatePresent:!!p[1].surface(kind),...diff,baselineSha256:await hash(a),candidateSha256:await hash(b)};
 }
 results.frames.push(record);
 const invalid=!record.domEqual||Object.values(record.layers).some((d:any)=>!d.equal||(clear&&(d.alphaPixelsA||d.alphaPixelsB)));
 if(invalid){await capture(p,label+'-FAIL');throw Error(label+': exact pixels, DOM/slots, or transparent-clear invariant failed');}
 return record;
}
async function frame(p:Pair,label:string,ages:number[],{appear=1,clear=false}={}){
 frameClock+=1000/60;for(const s of p){assert(!s.stage.isConnected,'stage must be detached during draw');s.draw(ages,appear);}return inspect(p,label,clear);
}
async function capture(p:Pair,label:string){
 active=p;const surfaces:any[]=[];
 for(const kind of kinds){const [width,height]=extent(p,kind),a=getPixels(p[0],kind,width,height),b=getPixels(p[1],kind,width,height);surfaces.push({kind,width,height,baseline:png(a,width,height),candidate:png(b,width,height),diff:png(diffRGBA(a,b),width,height)});}
 const report=await (window as any).visualCapture({label,surfaces,dom:p.map(s=>s.dom())});results.captures.push(report);assert(report.equal,'DOM composition screenshot differs: '+label);
}
const maxExit=(p:Pair)=>Math.max(...p[0].owners.map(o=>o.cue.diceExit));
async function finish(p:Pair,label:string){await frame(p,label+'-cleared',[maxExit(p)+2],{clear:true});await capture(p,label+'-cleared');for(const s of p)s.destroy();await inspect(p,label+'-destroyed',true);for(const s of p)assert(s.stage.querySelectorAll('canvas').length===0,'all final refs must release');await capture(p,label+'-destroyed');}
function schedule(p:Pair){
 const end=maxExit(p)+.5,ages=new Set<number>();for(let i=0;i<=Math.ceil(end*60);i++)ages.add(i/60);
 for(const {cue}of p[0].owners)for(const t of [cue.settled,cue.settled+.35,cue.firstBeam,cue.finalReveal,cue.finalBeamEnd,cue.diceExit,...cue.beams.flatMap(b=>[b.start,b.start+b.recoil,b.reveal,b.reveal+.06])])for(const delta of [-.001,0,.001])if(t+delta>=0)ages.add(t+delta);
 return[...ages].sort((a,b)=>a-b);
}
async function formulaCase(spec:Spec){
 const p=await pair(spec);active=p;
 for(const age of schedule(p)){await frame(p,'age-'+age.toFixed(6),[age]);
  if(age===p[0].owners[0].cue.firstBeam-.001)await capture(p,'before-first-beam');
  if(age===p[0].owners[0].cue.firstBeam+.001)await capture(p,'after-first-beam');
 }
 assert(results.frames.some((f:any)=>f.layers['cue-canvas'].alphaPixelsA>0),'case must paint real cue pixels');
 if(p[0].owners.some(o=>o.row.events.length||o.row.dice.some(d=>!d.kept)))assert(results.frames.some((f:any)=>f.layers['research-effects'].alphaPixelsA>0),'effect case must paint real effects');
 else assert(!p[1].surface('research-effects'),'proved-empty candidate must not allocate effects');
 // Seek backwards on the same live owners, then replay forward. DOM state is compared as-is.
 await frame(p,'seek-before-start',[0],{clear:true});await frame(p,'seek-first-beam',[p[0].owners[0].cue.firstBeam+.25]);await capture(p,'replay-visible');await finish(p,spec.id);
}
async function sharedCase(effect:boolean){
 const spec=effect?effectSpec:formulas[0],p=await pair(spec);active=p;for(const s of p)await s.add(spec,'-peer');
 const age=effect?2:p[0].owners[0].cue.firstBeam+.25;
 await frame(p,'two-contributors',[age,age]);await capture(p,'overlap');
 for(const s of p){for(const kind of kinds)assert(s.stage.querySelectorAll('.'+kind).length<=1,'one shared surface per kind');s.destroy(0);s.destroy(0);}
 await frame(p,'painted-owner-left-pending-peer',[0,0],{clear:true});await capture(p,'pending-peer-no-ghost');
 await frame(p,'peer-starts',[age,age]);await finish(p,'shared-'+(effect?'effects':'cue'));
 // Replay in the same released container proves a new layer lifecycle.
 for(const s of p)await s.add(spec,'-replay');await frame(p,'new-replay-visible',[age,age,age]);await finish(p,'same-container-replay');
}
async function anchorCase(){
 const p=await pair(formulas[1]);active=p;let point:{x:number;y:number}|undefined;
 for(const s of p)s.owners[0].show.setAnchor(()=>point,'token');const age=p[0].owners[0].cue.firstBeam+.25;
 await frame(p,'missing-anchor',[age],{clear:true});point={x:133,y:249};await frame(p,'zero-appear',[age],{appear:0,clear:true});
 await frame(p,'moving-anchored-slot',[age]);point={x:350,y:199};await frame(p,'anchor-moved',[age+.1]);await capture(p,'anchored-visible');
 point=undefined;await frame(p,'anchor-disappears',[age+.2],{clear:true});await finish(p,'anchor');
}
async function resizeCase(){
 const original=devicePixelRatio,p=await pair(effectSpec);active=p;const age=p[0].owners[0].cue.firstBeam+.25;
 await frame(p,'before-resize',[age]);await capture(p,'before-resize');
 for(const [w,h,dpr]of [[801,601,2],[320,240,1.25],[640,480,1]]){
  await (window as any).visualDpr(dpr);assert(devicePixelRatio===dpr,'actual browser DPR override did not take effect');for(const s of p)s.resize(w,h);
  await frame(p,`resize-${w}-${h}-dpr-${dpr}`,[age]);await capture(p,`resize-${w}-${h}-dpr-${dpr}`);
 }
 await (window as any).visualDpr(original);await finish(p,'resize');
}
async function exceptionCase(kind:string,mode:'before'|'after',operation='paint'){
 const p=await pair(kind==='cue-canvas'?formulas[1]:effectSpec);active=p;
 const age=kind==='cue-canvas'?p[0].owners[0].cue.firstBeam+.25:2;
 if(operation==='clear')await frame(p,'paint-before-failed-clear',[age]);
 frameClock+=1000/60;const errors=[];
 for(const s of p){const ctx=s.surface(kind)!.getContext('2d')! as any,methods=operation==='clear'?['clearRect']:['fill','stroke','fillText','strokeText','fillRect'];let fired=false;
  const originals=methods.map(name=>({name,own:Object.getOwnPropertyDescriptor(ctx,name),original:ctx[name]}));
  for(const {name,original}of originals)ctx[name]=function(...args:any[]){if(fired)return original.apply(this,args);fired=true;if(mode==='after')original.apply(this,args);throw Error('injected '+mode+' '+operation);};
  try{s.draw([operation==='clear'?0:age]);errors.push('did not throw');}catch(error){errors.push(String(error));}
  finally{for(const {name,own}of originals)if(own)Object.defineProperty(ctx,name,own);else delete ctx[name];}
  assert(fired,'requested native primitive was never reached');
 }
 same(errors,['Error: injected '+mode+' '+operation,'Error: injected '+mode+' '+operation],'paint/clear exceptions');
 await inspect(p,'synchronous-exception');await capture(p,'after-exception');await frame(p,'retry-empty-frame',[0],{clear:true});await capture(p,'retry-empty-no-ghost');
 await frame(p,'retry-visible',[age]);await finish(p,'exception-'+kind+'-'+mode+'-'+operation);
}
async function contextCase(){
 const p=await pair(effectSpec);active=p;await frame(p,'before-synthetic-restoration',[3.25]);await frame(p,'clean-before-synthetic-restoration',[0],{clear:true});
 const states=[];
 for(const s of p)for(const kind of kinds){const c=s.surface(kind)!;const ctx=c.getContext('2d')!;
  const before=typeof ctx.isContextLost==='function'?ctx.isContextLost():null;
  // This is NOT a real context loss: a backing-store reset + explicitly synthetic events.
  c.width=c.width;ctx.fillStyle='#ff00ff';ctx.fillRect(5,5,8,8);
  c.dispatchEvent(new Event('contextlost'));c.dispatchEvent(new Event('contextrestored'));
  states.push({kind,before,after:typeof ctx.isContextLost==='function'?ctx.isContextLost():null,eventIsTrusted:false,realLossInduced:false,syntheticSentinelPaint:true});
 }
 await inspect(p,'synthetic-sentinel-before-clear');
 results.contextRestoration={genuine:'not induced: no standard Canvas2D force-loss API',syntheticOnly:true,states};
 await frame(p,'synthetic-restored-clean',[0],{clear:true});await capture(p,'synthetic-restored-clean');await frame(p,'synthetic-restored-paint',[3.25]);await finish(p,'synthetic-context-events');
}
async function isolatedCase(){
 const a=await pair(effectSpec),b=await pair(formulas[0]);active=a;
 await frame(a,'scene-A-visible',[3.25]);await frame(b,'scene-B-pending',[0],{clear:true});await capture(b,'other-container-remains-clean');
 for(const s of a)s.destroy();await inspect(a,'scene-A-destroyed',true);
 await frame(b,'scene-B-starts',[3.25]);await finish(b,'independent-container');
}
const lifecycle:Record<string,()=>Promise<void>>={
 'shared-cue':()=>sharedCase(false),'shared-effects':()=>sharedCase(true),'anchors':anchorCase,'resize-dpr':resizeCase,'synthetic-context-events':contextCase,'independent-containers':isolatedCase,
};
for(const kind of kinds)for(const mode of ['before','after'] as const)for(const operation of ['paint','clear'])lifecycle[`exception-${kind}-${mode}-${operation}`]=()=>exceptionCase(kind,mode,operation);
async function run(id:string){
 results={id,metadata,frames:[],captures:[],success:false};frameIndex=0;const spec=formulas.find(s=>s.id===id);
 try{if(spec)await formulaCase(spec);else{assert(lifecycle[id],'unknown case '+id);await lifecycle[id]();}results.success=true;}catch(error){results.error=String(error);results.stack=(error as Error).stack;}
 finally{if(active)for(const s of active){s.unmount();s.destroy();}active=null;host.replaceChildren();}
 return results;
}
async function comparePNGs(a:string,b:string){
 const read=async(value:string)=>{const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();return{width:c.width,height:c.height,bytes:c.getContext('2d')!.getImageData(0,0,c.width,c.height).data};};
 const x=await read(a),y=await read(b);same([x.width,x.height],[y.width,y.height],'screenshot dimensions');return{width:x.width,height:x.height,...compareRGBA(x.bytes,y.bytes),diff:png(diffRGBA(x.bytes,y.bytes),x.width,x.height),baselineSha256:await hash(x.bytes),candidateSha256:await hash(y.bytes)};
}
(window as any).diceCanvasVisual={metadata,cases:[...formulas.map(s=>s.id),...Object.keys(lifecycle)],run,comparePNGs,
 async mount(side:number){assert(active,'no active pair');active.forEach(s=>s.unmount());await active[side].mount();},unmount(){active?.forEach(s=>s.unmount());},
 boundary:'Actual Canvas2D RGBA, production formulas/cues/timeline/card mutations and slots. Fixture poses are deterministic samples, not Jolt. Detached-stage viewport getters and replay clock are test inputs. PNG snapshots settle CSS/WAAPI animations; no animation timing or performance claim.',
};
