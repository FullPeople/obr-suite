/** Dice-result history only; unrelated resource/audit histories keep their own policy. */
export const DICE_HISTORY_LIMIT=100;
export type DiceHistoryVisibility='all'|'self'|'gm'|'players';
export type DiceHistoryViewer={playerId:string;role:string};
export type DiceHistoryAccess={rollerId?:string;hidden?:boolean;visibility?:DiceHistoryVisibility};
export function canSeeDiceHistory(row:DiceHistoryAccess,viewer:DiceHistoryViewer):boolean{
 const scope=row.visibility??(row.hidden?'gm':'all');
 if(!['all','self','gm','players'].includes(scope))return false;
 if(scope==='all')return !row.hidden;
 if(!viewer.playerId||!['GM','PLAYER'].includes(viewer.role))return false;
 return row.rollerId===viewer.playerId||scope==='gm'&&viewer.role==='GM'||scope==='players'&&viewer.role==='PLAYER';
}
export type DiceHistoryRow=DiceHistoryAccess&{rollId:string;ts:number;dice:unknown[];total:number};
/** Filter before capping, dedupe by immutable roll ID, and never regress a reveal.
 * Equal timestamps retain arrival order; delayed older messages cannot displace newer rolls. */
export function storedDiceHistory<T extends DiceHistoryRow>(rows:readonly T[]):T[]{
 const unique=new Map<string,T>();
 for(const row of rows){
  if(!row||typeof row.rollId!=='string'||!row.rollId||!Array.isArray(row.dice)||!Number.isFinite(row.total)||!Number.isFinite(row.ts))continue;
  const prior=unique.get(row.rollId);
  if(!prior||prior.hidden&&!row.hidden)unique.set(row.rollId,row);
 }
 return [...unique.values()].sort((a,b)=>b.ts-a.ts).slice(0,DICE_HISTORY_LIMIT);
}

/** Viewer projection never mutates the private archive. */
export function diceHistory<T extends DiceHistoryRow>(rows:readonly T[],viewer:DiceHistoryViewer):T[]{return storedDiceHistory(rows.filter(row=>row&&canSeeDiceHistory(row,viewer)));}
