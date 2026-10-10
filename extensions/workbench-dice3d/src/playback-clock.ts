/** A hidden tab or a long main-thread task may skip seconds of rAF. Advance at
 * most 100 ms of visible presentation in that gap; authoritative results and
 * physics samples are unchanged. All rolls receive the same frame boundary. */
export function recoverPlaybackStart(start:number,previous:number,current:number,maxGap=100){
 if(current<=start)return start;
 const previousVisible=Math.max(start,previous||start),gap=current-previousVisible;
 return gap>maxGap?start+gap-maxGap:start;
}
/** A short blocked frame can consume most of a 220 ms number flight. During
 * that act, resume with one ordinary frame instead of jumping 100 ms ahead.
 * Normal 20+ fps playback, future release barriers and the physics act retain
 * their established clock. Callers retime the shared audio plan with this start. */
export function recoverCuePlaybackStart(start:number,previous:number,current:number,firstBeam:number,finalReveal:number){
 if(current<=start)return start;
 const visible=Math.max(start,previous||start),gap=current-visible;
 const before=(visible-start)/1000,after=(current-start)/1000;
 if(gap>50&&before<=finalReveal&&after>=firstBeam)return start+gap-1000/60;
 return recoverPlaybackStart(start,previous,current);
}
