import {KINDS,type Kind,type Request} from './types';

/** Explicit lists are worker-local physics input, not an extension of the room wire protocol. */
export function physicalKinds(request:Pick<Request,'kind'|'count'>,explicit?:readonly Kind[]):Kind[]{
  if(!Number.isInteger(request.count)||request.count<1||request.count>100)throw Error('单次数量必须是 1–100');
  if(explicit!==undefined){
    if(!Array.isArray(explicit)||explicit.length!==request.count||explicit.some(kind=>!KINDS.includes(kind)))throw Error('物理批次骰型列表与数量不符或包含未知骰型');
    return [...explicit];
  }
  if(request.kind!=='mixed'&&!KINDS.includes(request.kind))throw Error('未知物理骰型');
  return Array.from({length:request.count},(_,i)=>request.kind==='mixed'?KINDS[i%KINDS.length]:request.kind);
}
