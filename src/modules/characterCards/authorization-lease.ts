export const CLOUD_AUTHORIZATION_MS=6000;
export type AuthorizationPhase='checking'|'verified'|'readonly'|'expired';
export type AuthorizationRead={scope:string;epoch:number;sequence:number;startedAt:number};

/** Authorization is renewed by an accepted read, never by a write receipt. */
export function authorizationLease(scope:()=>string,changed:()=>void,ttl=CLOUD_AUTHORIZATION_MS){
 let identity=scope(),generation=0,readEpoch=0,readSequence=0,verifiedAt:number|undefined,writable=false,phase:AuthorizationPhase='checking';
 let timer:ReturnType<typeof setTimeout>|undefined;
 let latestRead:AuthorizationRead|undefined;
 const cancel=()=>{clearTimeout(timer);timer=undefined;};
 const invalidate=(next:AuthorizationPhase='checking')=>{cancel();generation++;readEpoch++;latestRead=undefined;verifiedAt=undefined;writable=false;phase=next;changed();};
 const synchronize=()=>{const next=scope();if(next!==identity){identity=next;invalidate();}};
 const fresh=()=>verifiedAt!==undefined&&Date.now()>=verifiedAt&&Date.now()-verifiedAt<ttl;
 const expire=()=>{synchronize();if(verifiedAt!==undefined&&!fresh()&&phase!=='expired'){cancel();generation++;writable=false;phase='expired';changed();}};
 const arm=()=>{cancel();if(verifiedAt===undefined)return;timer=setTimeout(expire,Math.max(0,ttl-(Date.now()-verifiedAt)));(timer as unknown as {unref?:()=>void}).unref?.();};
 const accepts=(read:AuthorizationRead)=>{synchronize();return read===latestRead&&read.scope===identity&&read.epoch===readEpoch&&read.sequence===readSequence;};
 const verify=(expected:string,startedAt:number,write:boolean)=>{synchronize();if(expected!==identity)return false;generation++;verifiedAt=startedAt;writable=write;phase=fresh()?(write?'verified':'readonly'):'expired';if(!fresh())writable=false;arm();changed();return writable;};
 return {
  check(){synchronize();expire();return writable&&fresh();},
  snapshot(){synchronize();expire();return {generation,verifiedAt,phase};},
  beginRead():AuthorizationRead{synchronize();return latestRead=Object.freeze({scope:identity,epoch:readEpoch,sequence:++readSequence,startedAt:Date.now()});},
  accepts,
  verifyRead(read:AuthorizationRead,write:boolean){if(!accepts(read))return false;verify(read.scope,read.startedAt,write);return true;},
  verify,
  invalidate,
  stop:cancel,
 };
}
