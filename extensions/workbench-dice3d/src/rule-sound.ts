/** Original synthesized cues; no replacement or modification of the pinned dice WAV assets. */
export function ruleSound(kind:'max'|'min',sampleRate:number):Float32Array<ArrayBuffer>{
  const duration=.48,out=new Float32Array(Math.ceil(sampleRate*duration));let phase=0;
  for(let i=0;i<out.length;i++){
    const t=i/sampleRate,u=t/duration,up=kind==='max',frequency=up?210*Math.pow(3.3,u):750*Math.pow(.27,u);
    phase+=2*Math.PI*frequency/sampleRate;
    const envelope=Math.pow(Math.sin(Math.PI*u),1.8)*Math.min(1,t/.035);
    const noise=Math.sin(i*12.9898+Math.sin(i*.057)*78.233);
    out[i]=envelope*(.42*Math.sin(phase)+.14*Math.sin(phase*2.006)+.08*noise*(1-u));
  }
  return out;
}
