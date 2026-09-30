/** Unborn meshes must never enter either colour or shadow passes. A launched offscreen die may
 * still be simulated, but does not cast a premature shadow into the visible desktop. */
export function diePresence(age:number,birth:number,x:number,y:number,radius:number,width:number,height:number){
  const visible=age>=birth;
  return{visible,castShadow:visible&&x+radius>=0&&x-radius<=width&&y+radius>=0&&y-radius<=height};
}
