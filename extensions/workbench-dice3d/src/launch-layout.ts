import * as N from './native';
import type {Kind} from './types';

/** Plan empty landing regions before simulating or reading any face values. This changes only
 * the throw's initial conditions: Jolt owns every subsequent pose, collision and result. */
export function spreadTargets(bounds:N.Bounds,count:number,occupied:number[][],seed:bigint,radius:number):number[][]{
  const random=new N.DeterministicRandom(seed^0x1be8a054cef62b39n),margin=radius*1.6;
  const width=bounds.maxX-bounds.minX-2*margin,depth=bounds.maxZ-bounds.minZ-2*margin;
  if(width<=0||depth<=0)throw Error('物理桌面过小，无法容纳锁定尺寸骰子');
  const columns=Math.max(3,Math.ceil(Math.sqrt(count*5*width/depth))),rows=Math.max(3,Math.ceil(count*5/columns));
  const candidates:number[][]=[];
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)candidates.push([
    bounds.minX+margin+width*(x+.5+random.range(-.32,.32))/columns,0,
    bounds.minZ+margin+depth*(y+.5+random.range(-.32,.32))/rows]);
  const chosen:number[][]=[],used=[...occupied];
  for(let i=0;i<count;i++){
    let best=Number(random.next64()%BigInt(candidates.length)),clearance=-1;
    for(let j=0;j<candidates.length;j++){
      const p=candidates[j];let nearest=used.length?Infinity:random.unit();
      for(const other of used)nearest=Math.min(nearest,(p[0]-other[0])**2+(p[2]-other[2])**2);
      if(nearest>clearance){best=j;clearance=nearest}
    }
    const [p]=candidates.splice(best,1);chosen.push(p);used.push(p);
  }
  return chosen;
}

export function distributedThrow(seed:bigint,layoutSeed:bigint,kind:Kind,bounds:N.Bounds,index:number,count:number,
  target:number[],radius:number,previous:{previous:number[];radius:number}[]):N.InitialThrow&{edge:N.EntryEdge}{
  const random=new N.DeterministicRandom(seed^0x3352d78074fd16d1n);
  const edges:N.EntryEdge[]=['left','right','bottom','top'];
  const distances=[target[0]-bounds.minX,bounds.maxX-target[0],target[2]-bounds.minZ,bounds.maxZ-target[2]];
  const edge=count>1?edges[distances.indexOf(Math.min(...distances))]:N.selectEntryEdge(layoutSeed);
  const initial=N.makeOffscreenInitialThrow(seed,layoutSeed,kind,bounds,edge,index,count);
  const axis=edge==='left'||edge==='right'?0:2,lateral=axis===0?2:0,positive=edge==='left'||edge==='bottom';
  initial.target=[...target] as [number,number,number];
  initial.position[axis]=(axis===0?(positive?bounds.minX:bounds.maxX):(positive?bounds.minZ:bounds.maxZ))+(positive?-1:1)*(radius+.006);
  initial.position[lateral]=target[lateral]+random.range(-.004,.004);
  initial.position[1]=random.range(.055,.075)+(index%2)*.035;
  const dx=target[0]-initial.position[0],dz=target[2]-initial.position[2],distance=Math.hypot(dx,dz);
  const vy=random.range(.10,.20),support=N.PHYSICS[kind].nominal*.4;
  const minimumFlight=distance/1.05;
  initial.position[1]=Math.max(initial.position[1],support+4.905*minimumFlight**2-vy*minimumFlight);
  // Height tiers separate entry spheres. Do not move them farther off screen and compensate
  // with arbitrarily large horizontal launch speeds (the former high-count missile source).
  for(let attempt=0;attempt<=previous.length;attempt++){
    if(!previous.some(d=>Math.hypot(...d.previous.map((x,i)=>x-initial.position[i]))<radius+d.radius))break;
    initial.position[1]+=radius*2.1;
  }
  // Keep the same gravity/time unit and cap entry energy even for a large fitted table.
  const flight=(vy+Math.sqrt(vy*vy+19.62*Math.max(.005,initial.position[1]-support)))/9.81;
  // A throw continues to travel while it rolls/brakes after first contact. Aiming the airborne
  // path at the final free patch sent every die past it and back into a neighbour's patch.
  const deceleration=Math.sqrt(N.PHYSICS[kind].friction*.8)*9.81*.72;
  const horizontal=-deceleration*flight+Math.sqrt((deceleration*flight)**2+2*deceleration*distance);
  initial.linear=[dx/(distance||1)*horizontal,vy,dz/(distance||1)*horizontal];
  // Spin follows the actual direction of this launch, with a small unbiased sideways component.
  const spin=random.range(13,22)*N.initialAngularSpeedScale(kind),length=distance||1;
  initial.angular=[dz/length*spin,random.range(-1,1),-dx/length*spin];
  return{...initial,edge};
}
