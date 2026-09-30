import {KINDS,type Catalog,type Request,type Roll,type Viewport} from './types';
import {desktopGroundBounds,makeProjection,unionBounds,VISUAL_PER_METER} from './native';
import {physicalKinds} from './physics-kinds';
const footprint=(catalog:Catalog,kind:typeof KINDS[number])=>Math.PI*Math.pow(Math.max(...catalog.dice[kind].hull.map(v=>Math.hypot(...v)))/VISUAL_PER_METER,2);
/** A batch must leave room to tumble, not merely enough room for already aligned faces. The
 * camera fits these published bounds; no hidden enlarged off-screen floor and no changed hulls. */
export function incomingBounds(request:Request,catalog:Catalog,view:Viewport,retainedKinds:typeof KINDS[number][]=[],explicitKinds?:typeof KINDS[number][]){
  const b=desktopGroundBounds(makeProjection(view.w,view.h));
  const area=[...retainedKinds,...physicalKinds(request,explicitKinds)].reduce((n,k)=>n+footprint(catalog,k),0);
  const factor=Math.max(1,Math.sqrt(area/((b.maxX-b.minX)*(b.maxZ-b.minZ)*.24)));
  // Keep the projection origin unchanged, so different screen aspects show the same world.
  return{minX:b.minX*factor,maxX:b.maxX*factor,minZ:b.minZ*factor,maxZ:b.maxZ*factor};
}
/** Conservative free-floor budget, not a different dice scale or an invisible enlarged product
 * table. Saturated floors wait for a visible roll to leave instead of publishing piles/flyaways. */
export function floorBudget(request:Request,retained:Roll[],catalog:Catalog,view:Viewport){
  let bounds=incomingBounds(request,catalog,view,retained.flatMap(r=>r.kinds));
  for(const roll of retained)if(roll.bounds)bounds=unionBounds(bounds,roll.bounds);
  const floor=(bounds.maxX-bounds.minX)*(bounds.maxZ-bounds.minZ);
  const area=(kind:typeof KINDS[number])=>footprint(catalog,kind);
  const incoming=Array.from({length:request.count},(_,i)=>request.kind==='mixed'?KINDS[i%KINDS.length]:request.kind).reduce((n,k)=>n+area(k),0);
  const occupied=retained.reduce((n,roll)=>n+roll.kinds.reduce((a,k)=>a+area(k),0),0);
  const visible=retained.reduce((n,roll)=>n+roll.kinds.length,request.count);
  return{allowed:visible<=300&&(retained.length===0||incoming+occupied<=floor*.60),coverage:(incoming+occupied)/floor,floor,incoming,occupied};
}
