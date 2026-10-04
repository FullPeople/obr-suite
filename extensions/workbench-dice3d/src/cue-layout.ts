/** Screen-space room for the existing total pulse and the complete name/modifier plate.
 * Only their layout changes; projectile paths still begin at the authoritative die positions. */
const PLATE_WIDTH=232,CUE_HEIGHT=260,INSET=8;
export const cueScale=(width:number,height:number,modifier=false)=>Math.max(.001,Math.min(1,(width-INSET*2)/PLATE_WIDTH,
  modifier?Math.min((height-INSET*2-34)/234,(height-INSET*2-47.2)/208):(height-INSET*2)/CUE_HEIGHT));

export function cueSlots(width:number,height:number,count:number,modifier=false){
  if(count<1)return[];
  const legacyColumns=Math.min(count,Math.max(1,Math.floor(width/250)));
  let columns=legacyColumns;
  let score=cueScale(width/columns,height/Math.ceil(count/columns),modifier);
  // Preserve the desktop grid on ties. On a narrow screen, another column can keep a
  // multi-row formula's names readable instead of stacking five complete shows vertically.
  for(let candidate=1;candidate<=count;candidate++){
    const next=cueScale(width/candidate,height/Math.ceil(count/candidate),modifier);
    if(next>score+.001){columns=candidate;score=next;}
  }
  const rows=Math.ceil(count/columns),cellWidth=width/columns,cellHeight=height/rows;
  return Array.from({length:count},(_,index)=>{
    const row=Math.floor(index/columns),inRow=Math.min(columns,count-row*columns);
    const spacing=Math.min(300,columns===legacyColumns?width/(inRow+.25):cellWidth);
    return{x:(index%columns-(inRow-1)*.5)*spacing,
      y:(row-(rows-1)*.5)*(columns===legacyColumns?Math.min(170,height/(rows+1)):Math.min(260,cellHeight)),
      width:inRow>1?Math.min(cellWidth,spacing+INSET*2):cellWidth,height:cellHeight};
  });
}

export function cuePlacement(width:number,height:number,x:number,y:number,slotWidth=width,slotHeight=height,modifier=false){
  const cellWidth=Math.min(width,slotWidth),cellHeight=Math.min(height,slotHeight),scale=cueScale(cellWidth,cellHeight,modifier);
  const centerX=Math.max(cellWidth*.5,Math.min(width-cellWidth*.5,width*.5+x));
  const cellY=Math.max(cellHeight*.5,Math.min(height-cellHeight*.5,height*.5+y));
  // The nameplate extends farther below the number than the pulsed total extends above.
  // Modifier recoil/flare remain full strength, including in compact result slots.
  const bottom=modifier?Math.max(119*scale,98*scale+31+Math.max(26*scale+3,16.2)):119*scale;
  const centerY=Math.max(cellY-cellHeight*.5+INSET+110*scale,Math.min(cellY,cellY+cellHeight*.5-INSET-bottom));
  return{x:centerX,y:centerY,scale,textWidth:Math.max(1,cellWidth-INSET*2)};
}
