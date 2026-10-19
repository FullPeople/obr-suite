/** Full bodies are demand-loaded. Directory rows do not authorize warming
 * the entire book; keep only the focused card and its immediate neighbours. */
export function hydrationWindow<T extends {id:string}>(cards:readonly T[],focusId:string|undefined):T[]{
 const at=cards.findIndex(card=>card.id===focusId);if(at<0)return [];
 return [cards[at],cards[at-1],cards[at+1]].filter((card):card is T=>!!card);
}
export function requestedHydration<T extends {id:string}>(cards:readonly T[],window:readonly T[],id:string,recent:ReadonlySet<string>):T[]{
 return window.some(card=>card.id===id)||recent.has(`card:${id}`)?cards.filter(card=>card.id===id):[];
}
