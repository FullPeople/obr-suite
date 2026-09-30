/** Applied only to the new plugin's history/composer output. Shared stable files stay intact. */
export function adapt3dHistory(code){
 code=code.replace('const N = entry.rowStarts?.length ?? 0;','const N = entry._3dRows ? 0 : (entry.rowStarts?.length ?? 0);');
 const start=code.indexOf('function buildRepeatRowCard('),end=code.indexOf('\nfunction buildRepeatStripHtml(',start);
 if(start>=0&&end>start){const part=code.slice(start,end).replace('const modStr = entry.modifier !== 0','const modifier = entry._3dRows?.[rowIdx]?.modifier ?? entry.modifier;\n  const modStr = modifier !== 0').replaceAll('entry.modifier','modifier').replace('?? modifier;','?? entry.modifier;');code=code.slice(0,start)+part+code.slice(end);}
 code=code.replace('const rowTotal = kept.reduce((a, d) => a + (d.subtract ? -d.value : d.value), 0) + entry.modifier;', 'const rowTotal = entry._3dRows?.[r]?.total ?? (kept.reduce((a, d) => a + (d.subtract ? -d.value : d.value), 0) + entry.modifier);');
 code=code.replace('if (history.some((h) => h.rollId === rollId)) {','if (history.some((h) => h.rollId === rollId)) { const index=history.findIndex(h=>h.rollId===rollId); if(history[index].hidden&&!p.entry.hidden){history[index]=p.entry;saveHistory();}');
 code=code.replace('history.unshift(data);','const existing=history.findIndex(h=>h.rollId===data.rollId); if(existing>=0)history[existing]=data;else history.unshift(data);');
 return code;
}
