import type {PhysicalHop} from '../physical-hop';
import type {Roll} from '../types';
export const DECISION_DELAY=.35,DECISION_FADE=.65,HOP_CHARGE=.26,HOP_TAIL=.35;
export const decisionProgress=(age:number,at:number)=>Math.max(0,Math.min(1,(age-at)/DECISION_FADE));
export type ClampKind='max'|'min';
export interface HopStage{hop:PhysicalHop;start:number;rules:{id:string;kind:ClampKind;label:string;from:number;to:number}[]}
export interface ClampEpisode{id:string;kind:ClampKind;label:string;from:number;to:number;surface:number;floor:[number,number];start:number;launch:number;land:number;end:number}
export interface RuleTimeline{decisionAt:number;births:number[];clamps:ClampEpisode[]}
export interface PhysicalEntry{roll:Roll;ids:string[];offset:number;births:number[]}

/** Preserve original roll samples/results. Only a separate, constrained physical hop is appended. */
export function appendRuleHops<T extends PhysicalEntry>(entry:T,stages:HopStage[]):T&{timeline:RuleTimeline}{
  const {roll,ids,offset}=entry,lookup=new Map(ids.map((id,i)=>[id,i]));
  const relevant=stages.filter(stage=>stage.hop.ids.some(id=>lookup.has(id))),clamps:ClampEpisode[]=[];
  for(const stage of relevant)for(const rule of stage.rules)if(lookup.has(rule.id)){
    const i=stage.hop.ids.indexOf(rule.id);clamps.push({...rule,surface:stage.hop.surfaces[i],floor:[stage.hop.poses[i*7],stage.hop.poses[i*7+2]],start:stage.start-offset-HOP_CHARGE,launch:stage.start-offset,land:stage.start-offset+stage.hop.landings[i],end:stage.start-offset+stage.hop.duration+HOP_TAIL});
  }
  const timeline:RuleTimeline={decisionAt:roll.duration+DECISION_DELAY,births:entry.births,clamps};
  if(!relevant.length)return{...entry,timeline};
  const duration=Math.ceil(Math.max(roll.duration,...clamps.map(c=>c.end))*120)/120,frames=Math.round(duration*120)+1,count=ids.length,poses=new Float32Array(frames*count*7);
  for(let f=0;f<frames;f++){const source=Math.min(f,roll.frames-1)*count*7;poses.set(roll.poses.subarray(source,source+count*7),f*count*7);}
  const contacts=[...roll.contacts];
  for(const stage of relevant){const {hop}=stage,startFrame=Math.round((stage.start-offset)*120),tags=new Map<number,number>();
    for(const [source,id] of hop.ids.entries()){const target=lookup.get(id);if(target===undefined)continue;tags.set(source+1,target+1);
      for(let f=startFrame;f<frames;f++){const sample=Math.min(f-startFrame,hop.frames-1),from=(sample*hop.ids.length+source)*7;poses.set(hop.poses.subarray(from,from+7),(f*count+target)*7);}
    }
    for(const c of hop.contacts)if(tags.has(c.a))contacts.push({...c,t:c.t+stage.start-offset,a:tags.get(c.a)!,b:tags.get(c.b)??0,seq:contacts.length});
  }
  return{...entry,timeline,roll:{...roll,poses,frames,duration,contacts:contacts.sort((a,b)=>a.t-b.t),collisions:contacts.length,
    physicsMs:roll.physicsMs+relevant.reduce((n,s)=>n+s.hop.physicsMs,0)}};
}
