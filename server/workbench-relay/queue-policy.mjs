// View snapshots can be rebuilt after reconnect. Commands and receipts cannot.
export const VIEW_TYPES=new Set(['ready','catalog','selection','rolls','directory','access','cacheSnapshot','groupRollState']);
export function coalescedQueue(rows,message,role){
 const same=old=>{
  if(old.type!==message.type)return false;
  if(role==='host'&&VIEW_TYPES.has(message.type))return message.type!=='cacheSnapshot'||old.state?.key===message.state?.key;
  return ['ack','requestPending','requestStatus'].includes(message.type)&&old.requestId===message.requestId;
 };
 return [...rows.filter(row=>!same(row)),message];
}
export function pruneIdleViews(box,now,idleMs=60000){
 if(box.socket?.open||box.wait||now-box.lastSeen<=idleMs)return false;
 const next=box.queue.filter(row=>!VIEW_TYPES.has(row.type));if(next.length===box.queue.length)return false;
 box.queue=next;return true;
}
export function queueLimit(total,view){return view?total-Math.min(65536,Math.floor(total/8)):total;}
