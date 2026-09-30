/** Owlbear player colours are CSS hex. Dice remain opaque; an optional alpha byte is ignored,
 * not interpreted as permission to hide a die. Never silently substitute a theme on bad input. */
export function normalizePlayerColor(value){
  if(typeof value!=='string'||!/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value.trim()))throw Error('枭熊玩家颜色格式无效');
  const hex=value.trim().slice(1).toLowerCase();
  return '#'+(hex.length<=4?hex.slice(0,3).split('').map(c=>c+c).join(''):hex.slice(0,6));
}
/** Missing colour is only for the standalone preview; actual Owlbear startup requires getColor. */
export const validBodyColor=value=>value===undefined||(typeof value==='string'&&/^#[a-f\d]{6}$/.test(value));
