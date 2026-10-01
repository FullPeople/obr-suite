import {acquireOverlayCanvas} from '../shared-overlay-canvas';
import * as T from 'three';
import {CueRenderer} from '../cue-renderer';
import {buildCue,type Cue,type Projection,staggerForOrdinal,travelForOrdinal,BEAM_RECOIL,BEAM_AFTERGLOW,totalAt} from '../cue';
import {projectVisual} from '../native';
import type {Roll,Theme} from '../types';
import {url} from '../types';
import type {FormulaRow,ResearchDie} from './formula';
import {DECISION_DELAY,decisionProgress,type RuleTimeline} from './rule-timeline';

export function formulaCue(roll:Roll,ids:string[],row:FormulaRow,projection:Projection,theme:Theme):Cue{
  const cue=buildCue(roll,projection,theme),byId=new Map(row.dice.map(d=>[d.id,d]));
  cue.beams=cue.beams.filter(beam=>byId.get(ids[beam.dieIndex])?.kept);
  let cursor=cue.firstBeam;
  cue.beams.forEach((beam,ordinal)=>{const d=byId.get(ids[beam.dieIndex])!;if(ordinal)cursor+=staggerForOrdinal(ordinal);
    Object.assign(beam,{ordinal,text:String(d.value*d.sign),start:cursor,travel:travelForOrdinal(ordinal),reveal:cursor+BEAM_RECOIL+travelForOrdinal(ordinal)});
  });
  const base=cue.beams.reduce((n,b)=>{const d=byId.get(ids[b.dieIndex])!;return n+d.value*d.sign},0),delta=row.total-base;
  if(delta!==0||row.operation){cursor=Math.max(cursor+staggerForOrdinal(cue.beams.length),...cue.beams.map(b=>b.reveal+.16));const travel=travelForOrdinal(cue.beams.length);
    const text=row.operation||`${delta>0?'+':''}${delta}`;
    cue.modifier={value:delta,text,start:cursor,travel,recoil:BEAM_RECOIL,reveal:cursor+BEAM_RECOIL+travel,color:theme.glyph as [number,number,number]};
  }else cue.modifier=null;
  const events=cue.beams.map(b=>{const d=byId.get(ids[b.dieIndex])!;return{t:b.reveal,delta:d.value*d.sign}});
  if(cue.modifier)events.push({t:cue.modifier.reveal,delta});events.sort((a,b)=>a.t-b.t);
  let sum=0;cue.reveals=events.map(e=>e.t);cue.displayedTotals=events.map(e=>sum+=e.delta);cue.total=row.total;
  cue.finalReveal=events.at(-1)?.t??cue.firstBeam;cue.finalBeamEnd=cue.finalReveal+BEAM_AFTERGLOW;cue.diceExit=cue.finalBeamEnd+1;
  if(sum!==row.total)throw Error('公式演出时间线与计算结果不一致');return cue;
}
export function dimDiscarded(ids:string[],row:FormulaRow,decisionAt:number){
  const byId=new Map(row.dice.map(d=>[d.id,d])),original=new WeakMap<T.Mesh,{color:T.Color;ink:T.Color}>();
  return(age:number,meshes:T.Mesh[])=>{for(let i=0;i<meshes.length;i++){const mesh=meshes[i],mat=mesh.material as T.MeshPhysicalMaterial;
    let saved=original.get(mesh);if(!saved){saved={color:mat.color.clone(),ink:mat.userData.glyphColor.value.clone()};original.set(mesh,saved)}
    const d=byId.get(ids[i]),fade=d&&!d.kept?decisionProgress(age,decisionAt):0;
    mat.color.copy(saved.color).multiplyScalar(1-fade*.8);mat.userData.glyphColor.value.copy(saved.ink).multiplyScalar(1-fade*.45);
  }};
}
/** Research visual phases and compact 2D-style history, wrapped around the exact same number rush. */
export class FormulaShow extends CueRenderer{
  private fx:HTMLCanvasElement;private context:CanvasRenderingContext2D;private chips=new Map<string,HTMLElement>();private total:HTMLElement;
  private releaseFx:()=>void;
  private latest=-1;private finished=false;
  constructor(private stage:HTMLElement,roll:Roll,private ids:string[],private row:FormulaRow,private card:HTMLElement,private projection:()=>Projection,private timeline?:RuleTimeline){
    super(stage,roll.request.id,roll.request.name,roll.request.bodyColor);
    const layer=acquireOverlayCanvas(stage,'research-effects');this.fx=layer.canvas;this.context=layer.context;this.releaseFx=layer.release;
    const caption=document.createElement('div');caption.className='formula-caption';caption.textContent=row.formula.replaceAll('*','×');card.append(caption);
    const inline=document.createElement('div');inline.className='formula-inline';
    for(const d of row.dice){const chip=document.createElement('span');chip.className='die-chip';chip.title=`${d.kind} · ${d.flags.join(' / ')||'计入'}`;
      const image=document.createElement('img');image.src=url(`research-assets/${d.kind}.png`);image.alt=d.kind;
      const number=document.createElement('b');number.textContent='·';chip.append(image,number);inline.append(chip);this.chips.set(d.id,chip);}
    const operator=document.createElement('b');operator.className='operation';const base=row.dice.filter(d=>d.kept).reduce((n,d)=>n+d.value*d.sign,0),delta=row.total-base;
    operator.textContent=row.operation||(delta?`${delta>0?'+':''}${delta}`:'');inline.append(operator);
    const equal=document.createElement('span');equal.className='equals';equal.textContent='=';this.total=document.createElement('strong');this.total.className='inline-total';this.total.textContent='0';inline.append(equal,this.total);card.append(inline);
    const note=document.createElement('small');note.className='rule-note';note.textContent='等待真实落地';card.append(note);
    this.roll=roll;
  }
  private roll:Roll;
  override draw(age:number,cue:Cue,appear:number){
    super.draw(age,cue,appear);
    const p=this.projection(),ctx=this.context,ratio=Math.min(devicePixelRatio,1.5);
    if(this.fx.width!==Math.round(p.width*ratio)||this.fx.height!==Math.round(p.height*ratio)){this.fx.width=Math.round(p.width*ratio);this.fx.height=Math.round(p.height*ratio)}
    ctx.setTransform(ratio,0,0,ratio,0,0);
    const decisionAt=this.timeline?.decisionAt??cue.settled+DECISION_DELAY,fade=decisionProgress(age,decisionAt),landed=age>=decisionAt,phase=Math.max(0,age-decisionAt),arrived=new Set(cue.beams.filter(b=>age>=b.reveal).map(b=>this.ids[b.dieIndex]));
    const eventStart=(event:FormulaRow['events'][number])=>event.kind==='max'||event.kind==='min'?this.timeline?.clamps.find(c=>c.kind===event.kind&&c.id===event.dice[0]&&c.label===event.label)?.start??decisionAt:decisionAt;
    const visibleEvents=this.row.events.filter(e=>age>eventStart(e));
    this.card.querySelector('.rule-note')!.textContent=visibleEvents.map(e=>e.label+(e.physicalNote?`（${e.physicalNote}）`:'')).join(' · ')||(landed?'真实落地 → 数字汇集 → 加值到账':'等待真实落地');
    const point=(id:string)=>{const index=this.ids.indexOf(id),o=((this.roll.frames-1)*this.ids.length+index)*7;return projectVisual(p,this.roll.poses[o],this.roll.poses[o+1],this.roll.poses[o+2]);};
    const alpha=fade*Math.max(0,1-(age-cue.finalReveal)/.8);
    for(const d of this.row.dice){const chip=this.chips.get(d.id)!;
      chip.classList.toggle('discarded',fade>0&&!d.kept);chip.classList.toggle('same',landed&&d.flags.includes('同值'));chip.classList.toggle('arrived',arrived.has(d.id));
      const label=chip.querySelector('b')!;label.textContent=!landed?'·':!d.kept?String(d.raw):arrived.has(d.id)?`${d.sign<0?'−':''}${d.value}`:'·';
      if(d.raw!==d.value)chip.title=`实骰 ${d.raw} → 按规则 ${d.value}`;
      if(!alpha)continue;const [x,y]=point(d.id);
      if(!d.kept){ctx.save();ctx.globalAlpha=alpha;ctx.font='600 15px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.lineWidth=4;ctx.strokeStyle='#101920';ctx.fillStyle='#a5afba';ctx.strokeText('舍弃',x,y+42);ctx.fillText('舍弃',x,y+42);ctx.restore();}
    }
    for(const event of this.row.events){const eventAge=age-eventStart(event),eventAlpha=decisionProgress(age,eventStart(event))*Math.max(0,1-(age-cue.finalReveal)/.8);if(!eventAlpha)continue;
      const color=event.kind==='burst'?'#ffc773':event.kind==='reroll'?'#cda7ff':event.kind==='dis'?'#ec9d91':'#9bead3',points=event.dice.map(point);
      ctx.save();ctx.globalAlpha=eventAlpha*.85;ctx.strokeStyle=color;ctx.shadowColor=color;ctx.shadowBlur=12;ctx.lineWidth=2;
      if(event.kind!=='max'&&event.kind!=='min')for(const [i,[x,y]] of points.entries()){const radius=45+Math.sin(phase*5+i)*4;ctx.beginPath();ctx.ellipse(x,y,radius,radius*.64,phase*.22,phase*1.6,phase*1.6+Math.PI*1.7);ctx.stroke();}
      if(event.kind==='same'||event.kind==='burst'||event.kind==='reroll')for(let i=1;i<points.length;i++){
        const [a,b]=[points[i-1],points[i]];ctx.setLineDash([5,8]);ctx.lineDashOffset=-phase*28;
        ctx.beginPath();ctx.moveTo(...a);ctx.quadraticCurveTo((a[0]+b[0])/2,(a[1]+b[1])/2-45-Math.sin(phase*3)*10,...b);ctx.stroke();ctx.setLineDash([]);
      }
      const superseded=(event.kind==='max'||event.kind==='min')&&this.timeline?.clamps.some(c=>event.dice.includes(c.id)&&c.start>eventStart(event)+.001&&age>=c.start);
      if(eventAge<2.0&&!superseded&&points[0]){ctx.shadowBlur=0;ctx.font='600 16px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.lineWidth=5;ctx.strokeStyle='#152029';ctx.fillStyle=color;
        const [x,y]=points[0];ctx.strokeText(event.label,x,y-55);ctx.fillText(event.label,x,y-55);}
      ctx.restore();
    }
    const total=totalAt(cue,age);if(total!==this.latest){this.latest=total;this.total.textContent=String(total);this.total.animate([{transform:'scale(1.23)'},{transform:'scale(1)'}],{duration:280,easing:'ease-out'});}
    if(!this.finished&&age>=cue.finalReveal){this.finished=true;this.card.classList.add('complete');this.card.animate([{boxShadow:'inset 0 0 0 2px #6faf9180'},{boxShadow:'inset 0 0 0 2px #6faf9100'}],{duration:500});}
  }
  override destroy(){super.destroy();this.releaseFx();}
}
