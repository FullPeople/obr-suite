interface CompletedTableSnapshot {
 table:{id:string;stage:string;seats:readonly {playerId:string}[]}|null;
 selfPlayerId:string;game:{id:string;phase:string}|null;
}
/** Legacy archives bind their immutable game seats to the table's seat list.
 * Exit/re-entry therefore only changes this page's presentation. It must never
 * send an ended Leave to an older host or rewrite the archive to fake a lobby. */
export class CompletedTableNavigation<V extends CompletedTableSnapshot> {
 private current?:V;private key='';private dismissed?:string;
 constructor(private namespace:string){}
 private remember(gameId:string|undefined){this.dismissed=gameId;try{if(gameId)sessionStorage.setItem(this.key,gameId);else sessionStorage.removeItem(this.key);}catch{}}
 update(view:V):V {
  const key=`three-dragon-completed-navigation:${this.namespace}:${view.table?.id??''}:${view.selfPlayerId}`;
  if(key!==this.key){this.key=key;this.dismissed=undefined;try{this.dismissed=sessionStorage.getItem(key)||undefined;}catch{}}
  this.current=view;
  // A new lobby or game is a new shared activity. Only this exact completed
  // result is dismissed; later games are shown normally, retaining legacy seats.
  if(this.dismissed&&(view.table?.stage==='lobby'||view.game&&(view.game.id!==this.dismissed||view.game.phase!=='ended')))this.remember(undefined);
  return this.project();
 }
 private project():V {
  const view=this.current!;
  return view.game?.id===this.dismissed&&view.table?{...view,game:null,table:{...view.table,seats:view.table.seats.filter(seat=>seat.playerId!==view.selfPlayerId)}}:view;
 }
 command(type:string):V|undefined {
  const view=this.current;if(!view?.table||view.table.stage!=='ended'||view.game?.phase!=='ended')return;
  if(type==='leave'){this.remember(view.game.id);return this.project();}
  if(type==='join'&&this.dismissed===view.game.id){this.remember(undefined);return this.project();}
 }
}
