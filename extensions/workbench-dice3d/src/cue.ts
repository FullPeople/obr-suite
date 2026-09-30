/**
 * The result cue timeline, ported from Desktop Dice `result_bubble_plan.h/.cpp` and
 * `presentation_director` (shipped configuration: no dramatic cue, so no slow motion, no camera
 * focus and no tension music). Natural 1/20 keep the impact dressing, not themed glyphs/stingers.
 *
 * The cue is a pure plan derived from the authoritative result: presentation may never rewrite a
 * value, and both the audio hits and the screen-space show read their times from this one object.
 */
import type {Roll, Theme} from './types';
import * as N from './native';
import {hiddenRequest} from './hidden-roll';

export const POST_SETTLE_PAUSE=2.00;
export const FIRST_BEAM_STAGGER=0.50,MINIMUM_BEAM_STAGGER=0.24,BEAM_STAGGER_ACCELERATION=0.025;
export const FIRST_BEAM_TRAVEL=0.42,MINIMUM_BEAM_TRAVEL=0.22,BEAM_TRAVEL_ACCELERATION=0.015;
export const BEAM_RECOIL=0.16,BEAM_AFTERGLOW=0.72,POST_BEAM_DICE_HOLD=1.00;
export const TOTAL_PULSE=0.34,FINAL_COMPLETION=0.58;
export const OUTCOME_COUNT:Record<string,number>={d4:4,d6:6,d8:8,d10:10,d12:12,d20:20,d_percentile:10};

export const staggerForOrdinal=(ordinal:number)=>Math.max(MINIMUM_BEAM_STAGGER,FIRST_BEAM_STAGGER-BEAM_STAGGER_ACCELERATION*(ordinal-1));
export const travelForOrdinal=(ordinal:number)=>Math.max(MINIMUM_BEAM_TRAVEL,FIRST_BEAM_TRAVEL-BEAM_TRAVEL_ACCELERATION*ordinal);
/** d10 and d% show their maximum on the raw 0 face; every other die on its outcome count. */
export const isMaximumFace=(kind:string,value:number)=>kind==='d10'||kind==='d_percentile'?value===0:value===OUTCOME_COUNT[kind];
/** Natural 1 keeps the same heavier impact as natural 20; neither changes its printed number. */
export const hasExtraImpact=(kind:string,value:number)=>isMaximumFace(kind,value)||(kind==='d20'&&value===1);
export const dieTotalValue=(kind:string,value:number)=>kind==='d10'&&value===0?10:value;
export const faceText=(kind:string,value:number)=>kind==='d_percentile'&&value===0?'00':String(value);

export interface CueBeam{dieIndex:number;kind:string;value:number;maximumFace:boolean;text:string;ordinal:number;
  start:number;travel:number;recoil:number;reveal:number;sourceX:number;sourceY:number;color:[number,number,number]}
export interface CueModifier{value:number;start:number;travel:number;recoil:number;reveal:number;color:[number,number,number];text?:string}
export interface Cue{beams:CueBeam[];modifier:CueModifier|null;reveals:number[];displayedTotals:number[];
  firstBeam:number;finalReveal:number;finalBeamEnd:number;diceExit:number;settled:number;total:number;inkStyle?:Theme['style']}
export interface Projection{width:number;height:number;pixelsPerDie:number}

/** The projectile keeps the adaptive face ink; results do not replace it with red/gold. */
export const dieColor=(theme:Theme):[number,number,number]=>theme.glyph as [number,number,number];

/**
 * `source_normalized_y` grows downward in the native sort, so beams fire from the top of the screen
 * first, then leftmost, then the lowest die index.
 */
export function buildCue(roll:Roll,projection:Projection,theme:Theme):Cue{
  const count=roll.kinds.length,frames=roll.frames,poses=roll.poses;
  const settled=roll.duration;
  const entries=roll.kinds.map((kind,index)=>{
    const offset=((frames-1)*count+index)*7;
    const [x,y,z]=[poses[offset],poses[offset+1],poses[offset+2]];
    const [sx,sy]=N.projectVisual(projection,x,y,z);
    return{index,kind,value:roll.results[index],x:sx/projection.width,y:sy/projection.height,sx,sy};
  });
  const ordered=[...entries].sort((a,b)=>(a.y!==b.y?a.y-b.y:a.x!==b.x?a.x-b.x:a.index-b.index));
  const beams:CueBeam[]=[];
  let cursor=settled+POST_SETTLE_PAUSE;
  ordered.forEach((entry,ordinal)=>{
    if(ordinal>0)cursor+=staggerForOrdinal(ordinal);
    const travel=travelForOrdinal(ordinal);
    beams.push({dieIndex:entry.index,kind:entry.kind,value:entry.value,maximumFace:hasExtraImpact(entry.kind,entry.value),
      text:faceText(entry.kind,entry.value),ordinal,start:cursor,travel,recoil:BEAM_RECOIL,reveal:cursor+BEAM_RECOIL+travel,
      sourceX:entry.sx,sourceY:entry.sy,color:dieColor(theme)});
  });
  const contributing=entries.reduce((sum,entry)=>sum+dieTotalValue(entry.kind,entry.value),0);
  const modifierValue=roll.request?.modifier??0;
  const primaryTotal=contributing+modifierValue;
  let modifier:CueModifier|null=null;
  if(modifierValue!==0){
    // The bonus is a distinct last act, even for large pools whose flights overlap.
    cursor=Math.max(cursor+staggerForOrdinal(entries.length),...beams.map(beam=>beam.reveal+.16));
    const travel=travelForOrdinal(entries.length);
    modifier={value:modifierValue,start:cursor,travel,recoil:BEAM_RECOIL,reveal:cursor+BEAM_RECOIL+travel,color:dieColor(theme)};
  }
  // The displayed total starts at zero and only ever accrues on an arrival.
  const events=[...beams.map(beam=>({reveal:beam.reveal,delta:dieTotalValue(beam.kind,beam.value)})),
    ...(modifier?[{reveal:modifier.reveal,delta:modifier.value}]:[])].sort((a,b)=>a.reveal-b.reveal);
  let running=0;const reveals=events.map(event=>event.reveal);const displayedTotals=events.map(event=>running+=event.delta);
  const finalReveal=events.length?events[events.length-1].reveal:settled+POST_SETTLE_PAUSE;
  const finalBeamEnd=finalReveal+BEAM_AFTERGLOW;
  // A private bonus or natural face must not leak through how long question dice remain visible.
  const diceExit=hiddenRequest(roll.request)?hiddenDiceExit(roll):finalBeamEnd+POST_BEAM_DICE_HOLD;
  if(roll.masked)return{beams:[],modifier:null,reveals:[],displayedTotals:[],firstBeam:settled+POST_SETTLE_PAUSE,finalReveal:diceExit-POST_BEAM_DICE_HOLD,finalBeamEnd:diceExit-POST_BEAM_DICE_HOLD,diceExit,settled,total:0,inkStyle:theme.style};
  return{beams,modifier,reveals,displayedTotals,firstBeam:settled+POST_SETTLE_PAUSE,finalReveal,finalBeamEnd,diceExit,settled,total:primaryTotal,inkStyle:theme.style};
}
export function hiddenDiceExit(roll:Roll){const n=roll.kinds.length;let cursor=roll.duration+POST_SETTLE_PAUSE;for(let i=1;i<n;i++)cursor+=staggerForOrdinal(i);
  const reveal=cursor+BEAM_RECOIL+travelForOrdinal(n-1),bonus=Math.max(cursor+staggerForOrdinal(n),reveal+.16);
  return bonus+BEAM_RECOIL+travelForOrdinal(n)+BEAM_AFTERGLOW+POST_BEAM_DICE_HOLD;}
/** The cumulative total shown at `elapsed`: the last arrival at or before it, or zero. */
export const totalAt=(cue:Cue,elapsed:number)=>{
  let value=0;
  for(let i=0;i<cue.reveals.length;i++){if(cue.reveals[i]<=elapsed)value=cue.displayedTotals[i];else break}
  return value;
};
export const latestColorAt=(cue:Cue,elapsed:number):[number,number,number]|null=>{
  const all=[...cue.beams.map(beam=>({reveal:beam.reveal,color:beam.color})),
    ...(cue.modifier?[{reveal:cue.modifier.reveal,color:cue.modifier.color}]:[])];
  let color:null|[number,number,number]=null;
  for(const item of all){if(item.reveal<=elapsed)color=item.color;else break}
  return color;
};
