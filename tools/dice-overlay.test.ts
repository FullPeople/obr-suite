import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {Roll,Theme} from '../extensions/workbench-dice3d/src/types';
import type {FormulaRow} from '../extensions/workbench-dice3d/src/research/formula';
type Production=typeof import('../extensions/workbench-dice3d/src/shared-overlay-canvas')&typeof import('../extensions/workbench-dice3d/src/cue-renderer')&typeof import('../extensions/workbench-dice3d/src/research/presentation');
const candidate:Production=await import(new URL('./candidate.mjs',import.meta.url).href);
const reference:Production=await import(new URL('./reference.mjs',import.meta.url).href);
const tests:{name:string;passed:boolean;error?:string}[]=[];
function check(name:string,fn:()=>void){try{fn();tests.push({name,passed:true});}catch(error){tests.push({name,passed:false,error:String(error)});}}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let frameTime=0;
Object.defineProperty(globalThis,'performance',{value:{now:()=>frameTime},configurable:true});
Object.defineProperty(globalThis,'window',{value:globalThis,configurable:true});
Object.defineProperty(globalThis,'devicePixelRatio',{value:1.5,writable:true,configurable:true});

class Element{
 tagName:string;children:Element[]=[];parent:Element|null=null;style:Record<string,string>={};className='';textContent='';title='';src='';alt='';animations:unknown[]=[];clientWidth=640;clientHeight=480;
 constructor(tag:string){this.tagName=tag;}
 classList={
  contains:(name:string)=>this.className.split(' ').includes(name),
  add:(name:string)=>{this.classList.toggle(name,true);},
  toggle:(name:string,enabled:boolean)=>{const classes=new Set(this.className.split(' ').filter(Boolean));if(enabled)classes.add(name);else classes.delete(name);this.className=[...classes].join(' ');return enabled;},
 };
 append(...elements:Element[]){for(const element of elements){element.remove();element.parent=this;this.children.push(element);}}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
 querySelector(selector:string):Element|null{for(const child of this.children){if(selector.startsWith('.')?child.classList.contains(selector.slice(1)):child.tagName===selector)return child;const nested=child.querySelector(selector);if(nested)return nested;}return null;}
 animate(frames:unknown,options:unknown){this.animations.push({frames,options});}
 snapshot():unknown{return{tag:this.tagName,classes:this.className,text:this.textContent,title:this.title,src:this.src,alt:this.alt,animations:this.animations,children:this.children.map(child=>child.snapshot())};}
}
const defaults=()=>({transform:[1,0,0,1,0,0],globalAlpha:1,fillStyle:'#000000',strokeStyle:'#000000',font:'10px sans-serif',textAlign:'start',textBaseline:'alphabetic',lineWidth:1,lineCap:'butt',lineJoin:'miter',miterLimit:10,shadowBlur:0,shadowColor:'rgba(0, 0, 0, 0)',shadowOffsetX:0,shadowOffsetY:0,lineDashOffset:0,lineDash:[]});
class Canvas extends Element{
 private w=300;private h=150;state:any=defaults();stack:any[]=[];path:unknown[]=[];paint:unknown[]=[];clears=0;transforms=0;writes=0;failPaint=false;failClear=false;listeners=new Map<string,Set<(event:any)=>void>>();
 ctx:any=new Proxy({}, {
  get:(_target,name:string)=>{
   if(name in this.state)return this.state[name];
   const methods:Record<string,(...args:any[])=>any>={
    save:()=>this.stack.push(structuredClone(this.state)),restore:()=>{const old=this.stack.pop();if(old)this.state=old;},
    setTransform:(...matrix:number[])=>{this.transforms++;this.state.transform=matrix;},
    translate:(x:number,y:number)=>{const [a,b,c,d,e,f]=this.state.transform;this.state.transform=[a,b,c,d,e+a*x+c*y,f+b*x+d*y];},
    scale:(x:number,y:number)=>{const [a,b,c,d,e,f]=this.state.transform;this.state.transform=[a*x,b*x,c*y,d*y,e,f];},
    clearRect:(...args:number[])=>{if(this.failClear){this.failClear=false;throw Error('injected clear failure');}this.clears++;assert.deepEqual(this.state.transform,[1,0,0,1,0,0]);assert.deepEqual(args,[0,0,this.width,this.height]);this.paint=[];},
    beginPath:()=>{this.path=[];},setLineDash:(values:number[])=>{this.state.lineDash=[...values];},
   };
   if(name in methods)return methods[name];
   if(['moveTo','lineTo','quadraticCurveTo','ellipse','arc','roundRect','rect','closePath'].includes(name))return(...args:any[])=>{this.path.push([name,args]);};
   if(['fill','stroke','fillText','strokeText','fillRect','strokeRect','drawImage','putImageData'].includes(name))return(...args:any[])=>{
    this.paint.push(structuredClone({name,args,state:this.state,path:['fill','stroke'].includes(name)?this.path:undefined}));
    if(this.failPaint){this.failPaint=false;throw Error('injected paint failure');}
   };
   throw Error('unimplemented canvas method '+name);
  },set:(_target,name:string,value)=>{this.state[name]=value;return true;},
 });
 constructor(){super('canvas');}
 get width(){return this.w;}set width(value:number){this.w=value;this.reset();}
 get height(){return this.h;}set height(value:number){this.h=value;this.reset();}
 reset(){this.writes++;this.state=defaults();this.stack=[];this.path=[];this.paint=[];}
 getContext(kind:string){assert.equal(kind,'2d');return this.ctx;}
 addEventListener(name:string,listener:(event:any)=>void){let listeners=this.listeners.get(name);if(!listeners){listeners=new Set();this.listeners.set(name,listeners);}listeners.add(listener);}
 removeEventListener(name:string,listener:(event:any)=>void){this.listeners.get(name)?.delete(listener);}
 dispatch(name:string){for(const listener of this.listeners.get(name)||[])listener({preventDefault(){}});}
}
Object.defineProperty(globalThis,'document',{value:{createElement:(tag:string)=>tag==='canvas'?new Canvas():new Element(tag)},configurable:true});
const canvas=(stage:Element,kind:string)=>stage.children.find(child=>child.className===kind) as Canvas|undefined;
const row=(overrides:Partial<FormulaRow>={}):FormulaRow=>({formula:'2d6+3',index:0,total:10,operation:'',events:[],compute:()=>10,dice:[{id:'a',kind:'d6',raw:3,value:3,sign:1,kept:true,flags:[]},{id:'b',kind:'d6',raw:4,value:4,sign:1,kept:true,flags:[]}],...overrides});
const roll=(data:FormulaRow):Roll=>({version:2,request:{id:'fixture',source:'test',name:'Research',kind:'mixed',count:data.dice.length,theme:'godot_blue_cat_eye',seed:1,bodyColor:'#aabbcc'},kinds:data.dice.map(d=>d.kind),results:data.dice.map(d=>d.raw),fps:120,frames:1,poses:new Float32Array(data.dice.flatMap((_d,i)=>[i-.5,.25,.1,0,0,0,1])),contacts:[],physicsMs:1,steps:1,collisions:0,duration:1});
const theme={glyph:[.8,.7,.4]} as Theme;
function fixture(api= candidate,data=row(),stage=new Element('section'),connected=false){
 const card=new Element('article');if(connected)stage.append(card);
 const projection={width:stage.clientWidth,height:stage.clientHeight,pixelsPerDie:120},r=roll(data),ids=data.dice.map(d=>d.id);
 const cue=api.formulaCue(r,ids,data,projection,theme);
 const show=new api.FormulaShow(stage as any,r,ids,data,card as any,()=>projection);
 return{api,data,stage,card,projection,cue,show,draw(age:number,appear=1){frameTime=age*1000;api.beginOverlayFrame(stage as any);show.draw(age,cue,appear);}};
}
const ages=[0,.25,.99,1,1.1,1.4,2,2.99,3,3.01,3.08,3.159,3.16,3.17,3.25,3.4,3.58,3.6,3.7,3.9,4,4.2,4.4,4.8,5,5.6,6,7,3.25,.1,3.58];
function trace(api:Production,data:FormulaRow,connected:boolean,configure?:(f:ReturnType<typeof fixture>)=>void){
 const f=fixture(api,data,undefined,connected),frames:any[]=[];
 configure?.(f);
 for(const age of ages){f.draw(age);frames.push(structuredClone({age,card:f.card.snapshot(),slot:f.show.slotPosition(),cue:canvas(f.stage,'cue-canvas')?.paint||[],effects:canvas(f.stage,'research-effects')?.paint||[]}));}
 const result=digest(frames);f.show.destroy();assert.equal(f.stage.children.filter(c=>c.tagName==='canvas').length,0);return result;
}
check('plain formula allocates cue eagerly but never a research-effects surface',()=>{
 const f=fixture();assert(canvas(f.stage,'cue-canvas'));assert.equal(canvas(f.stage,'research-effects'),undefined);
 for(const age of ages)f.draw(age);assert.equal(canvas(f.stage,'research-effects'),undefined);assert(canvas(f.stage,'cue-canvas')!.paint.length);f.show.destroy();assert.equal(f.stage.children.length,0);
});
check('constants and arithmetic still keep cue and DOM without an effects surface',()=>{
 const f=fixture(candidate,row({dice:[],formula:'3*4',total:12,operation:'×4'}));assert(canvas(f.stage,'cue-canvas'));assert.equal(canvas(f.stage,'research-effects'),undefined);f.draw(f.cue.finalReveal);assert.equal(f.card.querySelector('.inline-total')!.textContent,'12');assert(f.card.classList.contains('complete'));f.show.destroy();
});
check('discarded die allocates effects even without rule events',()=>{
 const data=row();data.dice[0].kept=false;data.total=7;const f=fixture(candidate,data);assert(canvas(f.stage,'research-effects'));f.draw(2);assert(canvas(f.stage,'research-effects')!.paint.some((paint:any)=>paint.args[0]==='舍弃'));assert(f.card.querySelector('.die-chip')!.classList.contains('discarded'));f.show.destroy();
});
check('any rule event preserves eager effects allocation',()=>{
 for(const kind of ['adv','dis','same','burst','reroll','max','min','future-rule']){const f=fixture(candidate,row({events:[{kind,dice:['a','b'],label:kind}]}));assert(canvas(f.stage,'research-effects'),kind);f.draw(2);assert(canvas(f.stage,'research-effects')!.paint.length,kind);f.show.destroy();}
});
check('plain and effect-bearing rolls share cue but only effect-bearing rolls own effects',()=>{
 const stage=new Element('section'),plain=fixture(candidate,row(),stage),a=fixture(candidate,row({events:[{kind:'same',dice:['a','b'],label:'同值'}]}),stage),b=fixture(candidate,row({events:[{kind:'max',dice:['a'],label:'最大值'}]}),stage);
 const fx=canvas(stage,'research-effects'),cue=canvas(stage,'cue-canvas');assert.equal(stage.children.length,2);a.show.destroy();a.show.destroy();assert.equal(canvas(stage,'research-effects'),fx);b.show.destroy();assert.equal(canvas(stage,'research-effects'),undefined);assert.equal(canvas(stage,'cue-canvas'),cue);plain.draw(3.25);assert(cue!.paint.length);plain.show.destroy();assert.equal(stage.children.length,0);
});
check('scene containers, reroll and replay retain independent lifetimes',()=>{
 const a=fixture(),b=fixture(candidate,row({events:[{kind:'reroll',dice:['a','b'],label:'重掷'}]}));assert.notEqual(canvas(a.stage,'cue-canvas'),canvas(b.stage,'cue-canvas'));a.show.destroy();assert.equal(a.stage.children.length,0);assert.equal(b.stage.children.length,2);b.show.destroy();const replay=fixture(candidate,row(),a.stage);assert(canvas(a.stage,'cue-canvas'));assert.equal(canvas(a.stage,'research-effects'),undefined);replay.show.destroy();
});
check('plain formula preserves attached research card DOM and every painted command',()=>{assert.equal(trace(candidate,row(),true),trace(reference,row(),true));});
check('plain formula preserves detached Suite card state and every painted command',()=>{assert.equal(trace(candidate,row(),false),trace(reference,row(),false));});
check('all rule effects and discarded labels preserve every painted command and DOM state',()=>{
 const data=row({events:['adv','dis','same','burst','reroll','max','min'].map(kind=>({kind,dice:['a','b'],label:kind}))});data.dice[0].kept=false;data.dice[1].flags=['同值'];data.total=7;assert.equal(trace(candidate,data,true),trace(reference,data,true));
});
check('eager cue resize and DPR sizing remain unchanged with no research surface',()=>{
 const f=fixture();f.draw(0);const cue=canvas(f.stage,'cue-canvas')!;assert.equal(cue.width,960);assert.equal(cue.height,720);f.stage.clientWidth=801;f.stage.clientHeight=601;(globalThis as any).devicePixelRatio=2;f.draw(.1);assert.equal(cue.width,1602);assert.equal(cue.height,1202);assert.deepEqual(cue.state.transform,[2,0,0,2,0,0]);assert.equal(cue.style.width,'801px');f.show.destroy();(globalThis as any).devicePixelRatio=1.5;
});

check('cue skips transparent-frame clears before settling, before first beam and after final fade',()=>{
 const f=fixture(),cue=canvas(f.stage,'cue-canvas')!;
 for(const age of [0,.5,1,2,2.999])f.draw(age);assert.equal(cue.clears,0);assert.equal(cue.paint.length,0);
 f.draw(3.25);assert(cue.paint.length);assert.equal(cue.clears,0);
 f.draw(8);assert.equal(cue.paint.length,0);assert.equal(cue.clears,1);f.draw(9);f.draw(10);assert.equal(cue.clears,1);f.show.destroy();
});
check('effects skip transparent windows then clear their final contribution exactly once',()=>{
 const f=fixture(candidate,row({events:[{kind:'same',dice:['a','b'],label:'同值'}]})),fx=canvas(f.stage,'research-effects')!;
 for(const age of [0,.5,1])f.draw(age);assert.equal(fx.clears,0);f.draw(2);assert(fx.paint.length);assert.equal(fx.clears,0);f.draw(8);assert.equal(fx.paint.length,0);assert.equal(fx.clears,1);f.draw(9);assert.equal(fx.clears,1);f.show.destroy();
});
check('shared dirtiness survives painted roll departure while another roll has not started',()=>{
 const stage=new Element('section'),a=fixture(candidate,row(),stage),b=fixture(candidate,row(),stage),cue=canvas(stage,'cue-canvas')!;
 a.draw(3.25);assert(cue.paint.length);a.show.destroy();b.draw(.1);assert.equal(cue.paint.length,0);assert.equal(cue.clears,1);b.draw(.2);assert.equal(cue.clears,1);b.show.destroy();assert.equal(stage.children.length,0);
});
check('multiple contributors in one frame all remain visible and clear as one layer',()=>{
 const stage=new Element('section'),a=fixture(candidate,row(),stage),b=fixture(candidate,row(),stage),cue=canvas(stage,'cue-canvas')!;
 candidate.beginOverlayFrame(stage as any);frameTime=3250;a.show.draw(3.25,a.cue,1);const count=cue.paint.length;b.show.draw(3.25,b.cue,1);assert.equal(cue.paint.length,count*2);assert.equal(cue.clears,0);candidate.beginOverlayFrame(stage as any);assert.equal(cue.paint.length,0);assert.equal(cue.clears,1);candidate.beginOverlayFrame(stage as any);assert.equal(cue.clears,1);a.show.destroy();b.show.destroy();
});
check('missing anchors and zero appear do not dirty a transparent cue',()=>{
 const stage=new Element('section'),show=new candidate.CueRenderer(stage as any,'anchored','Research'),cue=canvas(stage,'cue-canvas')!,r=roll(row()),plan=candidate.formulaCue(r,['a','b'],row(),{width:640,height:480,pixelsPerDie:120},theme);
 show.setAnchor(()=>undefined,'token');candidate.beginOverlayFrame(stage as any);show.draw(3.25,plan,1);candidate.beginOverlayFrame(stage as any);assert.equal(cue.clears,0);show.setAnchor(()=>({x:123,y:234}),'token');show.draw(3.25,plan,0);candidate.beginOverlayFrame(stage as any);assert.equal(cue.clears,0);show.draw(3.25,plan,1);assert(cue.paint.length);candidate.beginOverlayFrame(stage as any);assert.equal(cue.clears,1);show.destroy();
});
check('a failed paint is marked before the exception and cleared on the next empty frame',()=>{
 for(const kind of ['cue-canvas','research-effects']){const f=fixture(candidate,kind==='cue-canvas'?row():row({events:[{kind:'same',dice:['a','b'],label:'同值'}]})),surface=canvas(f.stage,kind)!;
  surface.failPaint=true;assert.throws(()=>f.draw(kind==='cue-canvas'?3.25:2),/injected paint failure/);assert(surface.paint.length);const before=surface.clears;f.draw(0);assert.equal(surface.paint.length,0);assert.equal(surface.clears,before+1);f.draw(.1);assert.equal(surface.clears,before+1);f.show.destroy();
 }
});
check('a failed clear remains dirty and retries the next frame',()=>{
 const f=fixture(),cue=canvas(f.stage,'cue-canvas')!;f.draw(3.25);cue.failClear=true;assert.throws(()=>f.draw(0),/injected clear failure/);assert(cue.paint.length);f.draw(.1);assert.equal(cue.paint.length,0);assert.equal(cue.clears,1);f.draw(.2);assert.equal(cue.clears,1);f.show.destroy();
});
check('context restoration invalidates even a previously clean layer and listeners are released',()=>{
 const f=fixture(),cue=canvas(f.stage,'cue-canvas')!;f.draw(0);assert.equal(cue.clears,0);cue.dispatch('contextlost');cue.dispatch('contextrestored');f.draw(.1);assert.equal(cue.paint.length,0);assert.equal(cue.clears,1);f.draw(.2);assert.equal(cue.clears,1);f.show.destroy();assert.equal([...cue.listeners.values()].reduce((n,listeners)=>n+listeners.size,0),0);
});
check('resize, DPR and restored canvas do not suppress the next paint or leak across scenes',()=>{
 const f=fixture(),other=fixture(),cue=canvas(f.stage,'cue-canvas')!;f.draw(3.25);f.stage.clientWidth=801;f.stage.clientHeight=601;f.projection.width=801;f.projection.height=601;(globalThis as any).devicePixelRatio=2;f.draw(3.4);assert.equal(cue.width,1602);assert.equal(cue.height,1202);assert(cue.paint.length);assert.deepEqual((cue.paint[0] as any).state.transform,[2,0,0,2,0,0]);other.draw(.1);assert.equal(canvas(other.stage,'cue-canvas')!.clears,0);cue.reset();cue.dispatch('contextrestored');f.draw(3.58);assert(cue.paint.length);f.draw(0);assert.equal(cue.paint.length,0);const before=cue.clears;f.draw(.1);assert.equal(cue.clears,before);f.show.destroy();other.show.destroy();(globalThis as any).devicePixelRatio=1.5;
});
check('anchored totals, graphic ink and maximum-face impacts preserve all paint and moving slots',()=>{
 const data=row();data.dice[0].raw=data.dice[0].value=6;data.total=13;
 for(const anchored of [false,true]){const configure=(f:ReturnType<typeof fixture>)=>{f.show.setSlotOffset(90,-20);f.cue.inkStyle='comic';if(anchored)f.show.setAnchor(()=>({x:123,y:234}),'token');};assert.equal(trace(candidate,data,true,configure),trace(reference,data,true,configure));}
});
check('discarded-only rule surface is marked and clears after its final label',()=>{
 const data=row();data.dice[0].kept=false;data.total=7;const f=fixture(candidate,data),fx=canvas(f.stage,'research-effects')!;f.draw(2);assert(fx.paint.length);f.draw(8);assert.equal(fx.paint.length,0);assert.equal(fx.clears,1);f.draw(9);assert.equal(fx.clears,1);f.show.destroy();
});
check('effect layer dirtiness survives owner release and an event-bearing peer still waiting',()=>{
 const stage=new Element('section'),data=row({events:[{kind:'same',dice:['a','b'],label:'同值'}]}),a=fixture(candidate,data,stage),b=fixture(candidate,data,stage),fx=canvas(stage,'research-effects')!;a.draw(2);assert(fx.paint.length);a.show.destroy();b.draw(0);assert.equal(fx.paint.length,0);assert.equal(fx.clears,1);b.draw(.5);assert.equal(fx.clears,1);b.show.destroy();assert.equal(stage.children.length,0);
});
check('restoration listener remains while any owner survives then detaches exactly once',()=>{
 const stage=new Element('section'),a=fixture(candidate,row(),stage),b=fixture(candidate,row(),stage),cue=canvas(stage,'cue-canvas')!;a.show.destroy();assert.equal(cue.listeners.get('contextrestored')!.size,1);cue.dispatch('contextrestored');b.draw(.1);assert.equal(cue.clears,1);b.show.destroy();b.show.destroy();assert.equal(cue.listeners.get('contextrestored')!.size,0);assert.equal(cue.listeners.get('contextlost')!.size,0);
});

function measurePlain20(api:Production){
 const dice=Array.from({length:20},(_,i)=>({id:'d'+i,kind:'d6' as const,raw:i%6+1,value:i%6+1,sign:1,kept:true,flags:[]})),data=row({formula:'20d6',dice,total:dice.reduce((n,d)=>n+d.value,0)});
 const f=fixture(api,data),cue=canvas(f.stage,'cue-canvas')!,fx=canvas(f.stage,'research-effects'),hash=createHash('sha256');let paintCommands=0;
 for(let i=0;i<646;i++){const age=(f.cue.diceExit+.2)*i/645;f.draw(age);paintCommands+=cue.paint.length+(fx?.paint.length||0);hash.update(JSON.stringify({cue:cue.paint,effects:fx?.paint||[],card:f.card.snapshot(),slot:f.show.slotPosition()}));}
 const result={frames:646,canvases:f.stage.children.filter(child=>child.tagName==='canvas').length,cueClears:cue.clears,effectsClears:fx?.clears||0,paintCommands,paintAndDOMHash:hash.digest('hex')};f.show.destroy();return result;
}
const counts={reference:measurePlain20(reference),candidate:measurePlain20(candidate)};
check('646-frame 20d6 contract retains every paint command and DOM state',()=>{assert.equal(counts.candidate.paintCommands,counts.reference.paintCommands);assert.equal(counts.candidate.paintAndDOMHash,counts.reference.paintAndDOMHash);assert.equal(counts.candidate.canvases,1);assert.equal(counts.candidate.effectsClears,0);assert(counts.candidate.cueClears<counts.reference.cueClears);});

const report={boundary:'Pure Node production FormulaShow/CueRenderer/shared layer with a Canvas/DOM state double and baseline painted-command hashes. No actual Canvas pixels, browser compositing, GPU, or user-visible performance measured. The 646-frame fixture is synthetic and its clear counts are not a latency or experience metric.',checks:tests.length,passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,counts,tests};
writeFileSync(join(process.env.DND_DICE_EVIDENCE!, 'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
