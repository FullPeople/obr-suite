import {acquireOverlayCanvas} from './shared-overlay-canvas';
/**
 * The result show, ported from Desktop Dice' screen-space cue in `floating_bubble_window.cpp`.
 *
 * Everything here is drawn in the layer's screen pixels, exactly like the native Direct2D pass: the
 * beam is a straight accelerating projectile with a recoil, a three-layer soft energy body, a head
 * flare, a glyph wipe where it leaves the die, 72 independently-lived particles, and a central
 * aggregation slot whose number only ever accrues on an arrival. A maximum-face hit adds the 60 ms
 * visual hit-stop, the full-screen tint and the directional impact lines — none of which may touch
 * physics, the authoritative time or the values.
 */
import type {Roll,Theme} from './types';
import {type Cue,type CueBeam,BEAM_AFTERGLOW,BEAM_RECOIL,TOTAL_PULSE,totalAt,latestColorAt} from './cue';

const smoothstep=(t:number)=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x)};
const linePoint=(ax:number,ay:number,bx:number,by:number,t:number):[number,number]=>
  [ax+(bx-ax)*t,ay+(by-ay)*t];
const rgba=(c:[number,number,number],alpha:number)=>`rgba(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)},${Math.max(0,Math.min(1,alpha))})`;
const whiten=(c:[number,number,number],amount:number):[number,number,number]=>
  [c[0]+(1-c[0])*amount,c[1]+(1-c[1])*amount,c[2]+(1-c[2])*amount];
const keyline=(c:[number,number,number]):[number,number,number]=>c[0]*.2126+c[1]*.7152+c[2]*.0722>.5?[.025,.03,.04]:[1,1,1];

/** splitmix64, matching the native's particle noise source. */
function noise(seed:bigint,index:number):number{
  const MASK=(1n<<64n)-1n;
  let value=(seed^(BigInt(index)*0x9e3779b97f4a7c15n))&MASK;
  value=((value^(value>>30n))*0xbf58476d1ce4e5b9n)&MASK;
  value=((value^(value>>27n))*0x94d049bb133111ebn)&MASK;
  value=value^(value>>31n);
  return Number(BigInt.asUintN(64,value)>>11n)/9007199254740992*2-1;
}
interface Particle{spawn:number;life:number;lateral:number;size:number}
const PARTICLES_PER_BEAM=72;
const BEAM_WIDTHS=[30,11,3.8],BEAM_ALPHAS=[0.11,0.42,0.98],BEAM_SEGMENTS=30;
const IMPACT_ANGLES=[-0.78,-0.22,0.31,0.86];

export class CueRenderer{
  private canvas:HTMLCanvasElement;
  private ctx:CanvasRenderingContext2D;private releaseCanvas:()=>void;private markCanvasDirty:()=>void;
  private particles=new Map<number,Particle[]>();
  private seed:bigint;
  private targetSlot:[number,number]=[0,0];
  private currentSlot:[number,number]=[0,0];
  private previousFrame=0;
  private anchor?:()=>{x:number;y:number}|undefined;private anchorLabel='';
  setAnchor(read:()=>{x:number;y:number}|undefined,label:string){this.anchor=read;this.anchorLabel=label;}
  constructor(private container:HTMLElement,rollId:string,private playerName:string,private playerColor?:string){
    const layer=acquireOverlayCanvas(container,'cue-canvas');this.canvas=layer.canvas;this.ctx=layer.context;this.releaseCanvas=layer.release;this.markCanvasDirty=layer.markDirty;
    let hash=0n;
    for(const ch of rollId)hash=(hash*131n+BigInt(ch.charCodeAt(0)))&((1n<<64n)-1n);
    this.seed=hash;
  }
  setSlotOffset(x:number,y=0){this.targetSlot=[x,y]}
  slotPosition(){return [...this.currentSlot]}
  destroy(){this.releaseCanvas()}
  private size(){
    const ratio=Math.min(2,window.devicePixelRatio||1);
    const w=this.container.clientWidth,h=this.container.clientHeight;
    if(this.canvas.width!==Math.round(w*ratio)||this.canvas.height!==Math.round(h*ratio)){
      this.canvas.width=Math.round(w*ratio);this.canvas.height=Math.round(h*ratio);
    }
    this.canvas.style.width=w+'px';this.canvas.style.height=h+'px';
    this.ctx.setTransform(ratio,0,0,ratio,0,0);
    return{w,h};
  }
  private beamParticles(beam:CueBeam):Particle[]{
    const cached=this.particles.get(beam.dieIndex);
    if(cached)return cached;
    const list:Particle[]=[];
    for(let i=0;i<PARTICLES_PER_BEAM;i++){
      const spawn=Math.max(0,Math.min(1,(i+0.5+noise(this.seed,i*3)*0.38/2)/PARTICLES_PER_BEAM));
      const unit=(noise(this.seed,i*3+1)+1)/2;
      list.push({spawn,life:0.42+0.40*unit,lateral:noise(this.seed,i*3+2),size:2.6+4.2*unit});
    }
    this.particles.set(beam.dieIndex,list);
    return list;
  }
  /** Draws one frame of the show. `appear` is the layer opacity the native ties to card life. */
  draw(elapsed:number,cue:Cue,appear:number){
    const {w,h}=this.size();
    const ctx=this.ctx;

    const frame=performance.now(),dt=this.previousFrame?Math.min(.05,(frame-this.previousFrame)/1000):1/60;
    this.previousFrame=frame;
    const approach=1-Math.exp(-dt/0.095);
    for(let axis=0;axis<2;axis++)this.currentSlot[axis]+=(this.targetSlot[axis]-this.currentSlot[axis])*approach;
    if(elapsed<cue.settled||appear<=0)return;
    // Concurrent rolls get the native's equal horizontal slots so their totals never stack.
    const point=this.anchor?.();if(this.anchor&&!point)return;
    const centerX=point?.x??w*0.5+this.currentSlot[0],centerY=point?.y??h*0.5+this.currentSlot[1];
    const centerAge=elapsed-cue.firstBeam;
    const centerOpacity=appear*smoothstep(Math.max(0,centerAge)/0.18)*(1-smoothstep(Math.max(0,(elapsed-cue.finalBeamEnd))/0.28));
    if(centerOpacity>0.01)this.markCanvasDirty();
    // Nameplate is behind the flying modifier, never an occluder over its launch point.
    if(centerOpacity>0.01&&!this.anchor){
      const pendingModifier=cue.modifier&&elapsed<cue.modifier.start;
      ctx.save();ctx.fillStyle=rgba([8/255,10/255,13/255],centerOpacity*0.76);
      ctx.beginPath();ctx.roundRect(centerX-116,centerY+51,232,pendingModifier?68:41,13);ctx.fill();
      ctx.font='500 26px Inter,"Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle=rgba([1,1,1],centerOpacity*0.96);ctx.fillText(this.playerName,centerX,centerY+71,212);
      if(pendingModifier){ctx.font='700 22px Inter,"Microsoft YaHei",sans-serif';ctx.fillText(cue.modifier!.text??`${cue.modifier!.value>0?'+':''}${cue.modifier!.value}`,centerX,centerY+98,212)}
      ctx.restore();
    }
    let maximumHit=0;
    let latestColor:null|[number,number,number]=null;
    // Modifiers are real flying numbers, with the same recoil/acceleration/particle lifetime.
    // Their origin follows this roll's smoothly moving aggregation slot, not a global centre.
    const flights:CueBeam[]=[...cue.beams];
    if(cue.modifier)flights.push({...cue.modifier,dieIndex:-1,kind:'modifier',text:cue.modifier.text??`${cue.modifier.value>0?'+':''}${cue.modifier.value}`,
      ordinal:cue.beams.length,maximumFace:false,sourceX:centerX,sourceY:centerY+98});
    for(const beam of flights){
      const window=beam.reveal+BEAM_AFTERGLOW;
      if(elapsed<beam.start||elapsed>window)continue;
      this.markCanvasDirty();
      const sourceAge=elapsed-beam.start;
      const flightPhase=Math.max(0,Math.min(1,(sourceAge-beam.recoil)/beam.travel));
      const progress=Math.pow(flightPhase,3.45);
      const dx=centerX-beam.sourceX,dy=centerY-beam.sourceY;
      const length=Math.hypot(dx,dy)||1;
      const recoilDistance=beam.maximumFace?42:31;
      const launchX=beam.sourceX-dx/length*recoilDistance,launchY=beam.sourceY-dy/length*recoilDistance;
      const decay=elapsed<=beam.reveal?1:1-smoothstep((elapsed-beam.reveal)/BEAM_AFTERGLOW);
      // Recoil: the projectile pulls back before it fires, and the die's glyph is wiped as it leaves.
      const recoilPhase=Math.min(1,sourceAge/BEAM_RECOIL);
      const headX=sourceAge<BEAM_RECOIL?launchX+(beam.sourceX-launchX)*(1-smoothstep(recoilPhase)):linePoint(launchX,launchY,centerX,centerY,progress)[0];
      const headY=sourceAge<BEAM_RECOIL?launchY+(beam.sourceY-launchY)*(1-smoothstep(recoilPhase)):linePoint(launchX,launchY,centerX,centerY,progress)[1];
      if(sourceAge<BEAM_RECOIL){
        const phase=recoilPhase;
        ctx.save();
        ctx.lineCap='round';
        ctx.strokeStyle=rgba(beam.color,0.18+0.12*phase);
        ctx.lineWidth=18-8*phase;
        ctx.beginPath();ctx.moveTo(beam.sourceX,beam.sourceY);ctx.lineTo(headX,headY);ctx.stroke();
        ctx.strokeStyle=rgba(whiten(beam.color,0.58),0.72+0.24*phase);
        ctx.lineWidth=4.8;
        ctx.beginPath();ctx.moveTo(beam.sourceX,beam.sourceY);ctx.lineTo(headX,headY);ctx.stroke();
        const glow=(beam.maximumFace?13:9)*(0.72+0.28*phase)*1.8;
        ctx.fillStyle=rgba(beam.color,(0.42+0.35*phase)*0.28);
        ctx.beginPath();ctx.arc(headX,headY,glow,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=rgba(whiten(beam.color,1),0.94);
        ctx.beginPath();ctx.arc(headX,headY,glow*0.42,0,Math.PI*2);ctx.fill();
        ctx.restore();
      }
      // The GL material performs the native UV-mask glyph wipe; no floating white slash here.
      // Three-layer soft energy body, drawn as tapered segments between the tail and the head.
      const tailStart=Math.max(0,progress-0.26);
      if(progress>0.001&&(progress<1||decay>0.02)){
        for(let layer=0;layer<3;layer++){
          ctx.save();
          ctx.lineCap='round';
          ctx.strokeStyle=rgba(whiten(beam.color,layer===2?0.72:0),BEAM_ALPHAS[layer]);
          ctx.lineWidth=BEAM_WIDTHS[layer];
          for(let segment=0;segment<BEAM_SEGMENTS;segment++){
            const t0=tailStart+(progress-tailStart)*(segment/BEAM_SEGMENTS);
            const t1=tailStart+(progress-tailStart)*((segment+1)/BEAM_SEGMENTS);
            const taper=smoothstep(segment/BEAM_SEGMENTS)*smoothstep(Math.min(1,(progress-t0)*7+0.32));
            ctx.globalAlpha=appear*BEAM_ALPHAS[layer]/BEAM_ALPHAS[layer]*taper*decay;
            ctx.globalAlpha=appear*taper*decay;
            const [x0,y0]=linePoint(launchX,launchY,centerX,centerY,t0);
            const [x1,y1]=linePoint(launchX,launchY,centerX,centerY,t1);
            if(t0<progress){ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke()}
          }
          ctx.restore();
        }
        // Head flare.
        ctx.save();ctx.lineCap='round';
        const [hx0,hy0]=linePoint(launchX,launchY,centerX,centerY,Math.max(0,progress-0.035));
        ctx.strokeStyle=rgba(beam.color,0.28*appear);ctx.lineWidth=beam.maximumFace?24:17;
        ctx.beginPath();ctx.moveTo(hx0,hy0);ctx.lineTo(headX,headY);ctx.stroke();
        ctx.strokeStyle=rgba(whiten(beam.color,0.82),0.82*appear);ctx.lineWidth=beam.maximumFace?5.8:4;
        ctx.beginPath();ctx.moveTo(hx0,hy0);ctx.lineTo(headX,headY);ctx.stroke();
        ctx.restore();
      }
      // 72 particles with independent spawn times, lifetimes, drift and decay.
      for(const particle of this.beamParticles(beam)){
        const spawnTime=beam.start+beam.recoil+particle.spawn*beam.travel*0.88;
        const age=elapsed-spawnTime;
        if(age<0||age>particle.life)continue;
        const lifePhase=age/particle.life;
        const along=Math.max(0,Math.min(1,particle.spawn+age/beam.travel*0.46));
        const [px,py]=linePoint(launchX,launchY,centerX,centerY,along);
        const lateral=particle.lateral*30*smoothstep(lifePhase);
        const forward=10*lifePhase;
        const axisX=dx/length,axisY=dy/length;
        const x=px-axisY*lateral+axisX*forward,y=py+axisX*lateral+axisY*forward;
        const alpha=appear*Math.sin(Math.min(1,lifePhase*2.4)*Math.PI/2)*(1-smoothstep(lifePhase))*0.86;
        if(alpha<=0.01)continue;
        ctx.save();
        ctx.fillStyle=rgba(beam.color,alpha*0.28);
        ctx.beginPath();ctx.arc(x,y,particle.size*3.6,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=rgba(whiten(beam.color,0.62),alpha);ctx.lineWidth=particle.size;ctx.lineCap='round';
        ctx.beginPath();ctx.moveTo(x-axisX*particle.size*2.2,y-axisY*particle.size*2.2);
        ctx.lineTo(x+axisX*particle.size*1.2,y+axisY*particle.size*1.2);ctx.stroke();
        ctx.restore();
      }
      // The die's own number rides the projectile head.
      if(sourceAge<=beam.recoil+beam.travel){
        ctx.save();
        ctx.font='600 46px CinzelVariable,Georgia,serif';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle=rgba([0.015,0.020,0.028],appear*0.90);
        ctx.fillText(beam.text,headX+3,headY+3);
        const graphic=cue.inkStyle==='sketch'||cue.inkStyle==='comic';
        ctx.lineWidth=graphic?3.6:1.4;ctx.strokeStyle=rgba(keyline(beam.color),appear*(graphic?.96:.68));
        ctx.strokeText(beam.text,headX,headY);
        ctx.fillStyle=rgba(beam.color,appear);
        ctx.fillText(beam.text,headX,headY);
        ctx.restore();
      }
      // Maximum-face arrival: 60 ms peak held, then a short decay.
      const hitAge=elapsed-beam.reveal;
      if(beam.maximumFace&&hitAge>=0&&hitAge<=0.22)
        maximumHit=Math.max(maximumHit,hitAge<=0.06?1:1-smoothstep((hitAge-0.06)/0.16));
      if(stepped(beam.reveal,elapsed))latestColor=beam.color;
    }
    if(centerOpacity>0.01){
      const shown=totalAt(cue,elapsed);
      let pulse=0;
      for(let i=0;i<cue.reveals.length;i++){
        const age=elapsed-cue.reveals[i];
        if(age<0)break;
        const final=Math.abs(cue.reveals[i]-cue.finalReveal)<1e-4;
        const scale=1+Math.sin(Math.min(1,age/TOTAL_PULSE)*Math.PI)*(final?0.18:0.105);
        if(age<=TOTAL_PULSE)pulse=Math.max(pulse,scale-1);
      }
      const centerScale=1+pulse*1.35+maximumHit*0.42;
      const color:[number,number,number]=this.playerColor?[1,3,5].map(i=>parseInt(this.playerColor!.slice(i,i+2),16)/255) as [number,number,number]:[0.92,0.84,0.62];
      ctx.save();
      ctx.translate(centerX,centerY);ctx.scale(centerScale,centerScale);ctx.translate(-centerX,-centerY);
      ctx.font=this.anchor?'700 30px CinzelVariable,Georgia,serif':'600 92px CinzelVariable,Georgia,serif';
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle=rgba([0,0,0],centerOpacity*0.58);
      ctx.fillText(String(shown),centerX+4,centerY+4);
      const graphic=cue.inkStyle==='sketch'||cue.inkStyle==='comic';
      ctx.lineWidth=graphic?4:3;ctx.strokeStyle=rgba(keyline(color),centerOpacity*.96);
      ctx.strokeText(String(shown),centerX,centerY);
      ctx.fillStyle=rgba(color,centerOpacity);
      ctx.fillText(String(shown),centerX,centerY);
      if(this.anchor){ctx.font='600 13px "Microsoft YaHei",sans-serif';ctx.lineWidth=3;ctx.strokeText(this.anchorLabel,centerX,centerY+25);ctx.fillText(this.anchorLabel,centerX,centerY+25);}
      ctx.restore();
    }
    // Hit-stop dressing: a brief tint plus directional impact lines, never a pause in physics.
    if(maximumHit>0.01){
      const color=latestColorAt(cue,elapsed)||[0.92,0.84,0.62];
      const impactAlpha=centerOpacity*maximumHit;
      ctx.save();
      ctx.fillStyle=rgba(color,impactAlpha*0.075);
      ctx.fillRect(0,0,w,h);
      ctx.strokeStyle=rgba(color,impactAlpha*0.48);ctx.lineWidth=5*maximumHit;ctx.lineCap='round';
      for(const angle of IMPACT_ANGLES){
        const inner=54,outer=220+90*maximumHit;
        ctx.beginPath();
        ctx.moveTo(centerX+Math.cos(angle)*inner,centerY+Math.sin(angle)*inner);
        ctx.lineTo(centerX+Math.cos(angle)*outer,centerY+Math.sin(angle)*outer);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
/** True when this frame is the first at or after `reveal`. */
const stepped=(reveal:number,elapsed:number)=>elapsed>=reveal&&elapsed-reveal<1/30;
