/** A hidden tab or a long main-thread task may skip seconds of rAF. Advance at
 * most 100 ms of visible presentation in that gap; authoritative results and
 * physics samples are unchanged. All rolls receive the same frame boundary. */
export function recoverPlaybackStart(start:number,previous:number,current:number,maxGap=100){
 if(current<=start)return start;
 const previousVisible=Math.max(start,previous||start),gap=current-previousVisible;
 return gap>maxGap?start+gap-maxGap:start;
}
