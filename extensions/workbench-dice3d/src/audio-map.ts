/**
 * Contact → sound mapping, ported from Desktop Dice `audio_event_mapper.h/.cpp`.
 *
 * Sounds may only ever come from the sorted contact trace: nothing here reacts to an animation
 * timer, and a contact that fails the gate is silenced rather than guessed at.
 */
import type {Contact} from './types';
import * as N from './native';

export const AUDIO_MAPPING={
  minimumImpactSpeed:0.025,
  minimumEstimatedImpulse:0.00020,
  lightToMediumImpulse:0.00120,
  mediumToHeavyImpulse:0.00350,
  mergeWindowSeconds:0.040,
  significantChangeRatio:0.55,
  minimumRollingAngularSpeed:0.35,
  /** Native m/s at full rolling loudness; the pose track is in visual units (1 = 0.025 m). */
  rollingFullActivitySurfaceSpeed:0.45*N.VISUAL_PER_METER,
  rollingMaximumVolume:0.24,
};
export type ImpactStrength='light'|'medium'|'heavy';
export const IMPACT_VOICES=8,RESULT_HIT_VOICES=4;

export interface AudioImpact{t:number;surface:0|1;strength:ImpactStrength;gain:number;pan:number;merged:number}
export interface ImpactPlan{impacts:AudioImpact[];suppressed:number;merged:number;pairs:number}

const classify=(impulse:number):ImpactStrength=>
  impulse>=AUDIO_MAPPING.mediumToHeavyImpulse?'heavy':impulse>=AUDIO_MAPPING.lightToMediumImpulse?'medium':'light';
/** clamp(0.12 + sqrt(impulse / 0.0035) * 0.62, 0.12, 1.0): saturates at impulse >= 0.00705. */
const impactGain=(impulse:number)=>
  Math.max(0.12,Math.min(1.0,0.12+Math.sqrt(impulse/AUDIO_MAPPING.mediumToHeavyImpulse)*0.62));
/** clamp(1 / (1 + 0.035*|z|/0.025 + 0.015*max(0,y/0.025)), 0.72, 1.0); contacts carry visual units. */
const distanceAttenuation=(y:number,z:number)=>
  Math.max(0.72,Math.min(1.0,1/(1+Math.abs(z)*0.035+Math.max(0,y)*0.015)));

/**
 * `project` maps a contact position (visual units) to the layer's normalized screen x in [-1,1].
 * The plan is a stable sort by (time, die_a, die_b, sequence) with same-pair rattles inside 40 ms
 * merged into one peak-winning hit.
 */
export function buildImpactPlan(contacts:Contact[],project:(x:number,y:number,z:number)=>number):ImpactPlan{
  const sorted=[...contacts].sort((a,b)=>
    a.t!==b.t?a.t-b.t:a.a!==b.a?a.a-b.a:a.b!==b.b?a.b-b.b:a.seq-b.seq);
  const impacts:AudioImpact[]=[];
  const open=new Map<string,AudioImpact & {speed:number;impulse:number}>();
  let suppressed=0,merged=0;
  for(const contact of sorted){
    if(contact.speed<AUDIO_MAPPING.minimumImpactSpeed||contact.impulse<AUDIO_MAPPING.minimumEstimatedImpulse){suppressed++;continue}
    const key=`${contact.kind}:${contact.a}:${contact.b}`;
    const existing=open.get(key);
    const significant=existing&&(
      contact.impulse>existing.impulse*(1+AUDIO_MAPPING.significantChangeRatio)||
      contact.speed>existing.speed*(1+AUDIO_MAPPING.significantChangeRatio));
    if(existing&&contact.t-existing.t<=AUDIO_MAPPING.mergeWindowSeconds&&!significant){
      existing.merged++;
      merged++;
      // The peak wins: a merged event keeps the loudest contact of the rattle.
      if(contact.impulse>existing.impulse){
        existing.impulse=contact.impulse;existing.speed=contact.speed;existing.t=contact.t;
        existing.surface=contact.kind;existing.strength=classify(contact.impulse);
        existing.gain=impactGain(contact.impulse)*distanceAttenuation(contact.y,contact.z);
        existing.pan=project(contact.x,contact.y,contact.z);
      }
      continue;
    }
    const impact={t:contact.t,surface:contact.kind,strength:classify(contact.impulse),
      gain:impactGain(contact.impulse)*distanceAttenuation(contact.y,contact.z),
      pan:project(contact.x,contact.y,contact.z),merged:0,speed:contact.speed,impulse:contact.impulse};
    open.set(key,impact);
    impacts.push(impact);
  }
  return{impacts:impacts.sort((a,b)=>a.t-b.t),suppressed,merged,pairs:open.size};
}

/** Native rolling activity: needs ground support and a real spin, normalized by surface speed. */
export function rollingActivity(grounded:boolean,linearSpeed:number,angularSpeed:number,boundingRadius:number):number{
  if(!grounded||angularSpeed<AUDIO_MAPPING.minimumRollingAngularSpeed)return 0;
  const surface=linearSpeed+angularSpeed*boundingRadius;
  return Math.max(0,Math.min(1,surface/AUDIO_MAPPING.rollingFullActivitySurfaceSpeed));
}
/** Beam hit: heavy clip on a maximum face, medium otherwise, with a rising pitch and gain cadence. */
export const resultHitGain=(ordinal:number,maximumFace:boolean)=>
  maximumFace?0.92:0.46+Math.min(0.30,ordinal*0.025);
export const resultHitRate=(ordinal:number)=>Math.min(1.24,1+ordinal*0.018);
export const UI_EMPHASIS_GAIN=0.28;
