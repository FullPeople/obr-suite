import type {Plugin} from 'vite';

/** Build-time adapter: old/stable source and runtime are not edited or published. */
export function workbenchDice3dPlugin(enabled:boolean):Plugin{
 return{name:'workbench-light-dice',enforce:'pre',transform(code,id){if(!enabled)return;
  const path=id.replaceAll('\\','/');if(path.endsWith('/src/modules/dice/index.ts')){
   // Renderer/history persist even if the old dice-tool module is disabled.
   code=code.replace('if (WORKBENCH_DEV) { teardownWorkbenchDice(); return; }','if (WORKBENCH_DEV) { return; }');
   code="import {submitLightDice,submitLightCompat} from '../../workbench/dice-light-submit';\n"+code;
   code=code.replace('export async function handleQuickRoll(req: QuickRollRequest,identity?:QuickRollIdentity): Promise<void> {','export async function handleQuickRoll(req: QuickRollRequest,identity?:QuickRollIdentity): Promise<void> { await submitLightDice(req); return;');
   code=code.replace(/(\}\): Promise<string> \{)(\r?\n  if \(!opts\.dice\.length\))/, '$1\n  return submitLightCompat(opts);$2');
   if(!code.includes('return submitLightCompat(opts);')||!code.includes('await submitLightDice(req); return;'))throw Error('Light dice adapter no longer matches shared entries');
   const at=code.indexOf('export function normalizePayload'),end=code.indexOf('\nfunction clamp(',at);let normal=code.slice(at,end);
   normal=normal.replace('value: clamp(die.value, 1, sidesOf(die.type)),','value: Number.isSafeInteger(die.value) && Math.abs(die.value)<=1e9 ? die.value : clamp(die.value, 1, sidesOf(die.type)),');
   code=code.slice(0,at)+normal+code.slice(end);
  }
  if(path.endsWith('/src/modules/dice/history-page.ts')){
   code=code.replace('pendingEntries.set(data.rollId, { entry: data, timer });','clearTimeout(pendingEntries.get(data.rollId)?.timer);pendingEntries.set(data.rollId, { entry: data, timer });commitPending(data.rollId);');
   code=code.replace(/(applyI18nDom\(lang\);\r?\n  render\(\);\r?\n)(\}\);)/,'$1  void OBR.broadcast.sendMessage(\'com.obr-suite/dice-light-history-request\',{}, {destination:\'LOCAL\'});\n$2');

  }return code;
 }};
}
