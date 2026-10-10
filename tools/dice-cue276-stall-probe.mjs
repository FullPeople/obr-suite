import assert from 'node:assert/strict';
/** Deliberately block only the diagnostic browser. Actual product rAF recovery,
 * cue drawing and audio retiming continue unmodified. Never ship this probe. */
export function installCueStallProbe(){
 const rows=[],injected=new Set();window.__cueStallEvidence=rows;
 const original=CanvasRenderingContext2D.prototype.strokeText;
 CanvasRenderingContext2D.prototype.strokeText=function(text,x,y,...args){
  const result=original.call(this,text,x,y,...args),r=window.__diceProfileRenderer;
  if(!r||!this.canvas.classList.contains('cue-canvas')||!this.font.includes('46px'))return result;
  for(const a of r.active){
   const b=a.cue.beams[0],age=(r.last-a.start)/1000;if(!b||String(text)!==b.text||age<b.start||age>b.reveal)continue;
   rows.push({event:'glyph',id:a.roll.request.id,age,reveal:b.reveal,at:performance.now(),x,y});
   const travel=(age-b.start-b.recoil)/b.travel;
   const phase=travel>.22&&travel<.6?'middle':travel>.86&&travel<.985?'arrival':undefined;
   if(phase&&!injected.has(a.roll.request.id+phase)){
    injected.add(a.roll.request.id+phase);const delay=phase==='middle'?85:240,at=performance.now();
    rows.push({event:'stall',id:a.roll.request.id,phase,age,reveal:b.reveal,delay,at});
    while(performance.now()-at<delay){} // Explicit fault injection, bounded to two per roll.
   }
  }
  return result;
 };
}
export function validateCueStalls(rows,id){
 const own=rows.filter(r=>r.id===id||r.id.startsWith(id+':r')),stalls=own.filter(r=>r.event==='stall');
 assert.equal(stalls.length,2,'both the midflight and convergence stalls were actually injected');
 for(const stall of stalls){
  const next=own.find(r=>r.event==='glyph'&&r.at>stall.at+stall.delay-2);
  assert(next,'the real flying glyph must remain visible after each blocked frame');
  assert(next.age-stall.age<.05,'resume with less than 50 ms visual progress after the deliberate stall');
  assert(next.age<stall.reveal,'a blocked convergence frame must not skip directly to the total');
 }
 return{injected:stalls.map(({phase,delay})=>({phase,delay})),actualGlyphSamples:own.filter(r=>r.event==='glyph').length,continuedAfterBothStalls:true};
}
