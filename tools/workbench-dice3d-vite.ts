import type {Plugin} from 'vite';
import {adapt3dHistory} from './workbench-dice3d-history.mjs';
/** Build-time adapter: old/stable source and runtime are not edited or published. */
export function workbenchDice3dPlugin(enabled:boolean):Plugin{
 return{name:'workbench-dice3d-only',enforce:'pre',transform(code,id){if(!enabled)return;
  const path=id.replaceAll('\\','/');if(path.endsWith('/src/modules/dice/index.ts')){
   // Renderer/history persist even if the old dice-tool module is disabled.
   code=code.replace('if (WORKBENCH_DEV) { teardownWorkbenchDice(); return; }','if (WORKBENCH_DEV) { return; }');
   code="import {submitDice3d,submitCompat3d} from '../../workbench/dice-submit';\n"+code;
   code=code.replace('export async function handleQuickRoll(req: QuickRollRequest,identity?:QuickRollIdentity): Promise<void> {','export async function handleQuickRoll(req: QuickRollRequest,identity?:QuickRollIdentity): Promise<void> { if (!readFixedRoll()) { await submitDice3d(req); return; }');
   code=code.replace(/(\}\): Promise<string> \{)(\r?\n  if \(!opts\.dice\.length\))/, '$1\n  return submitCompat3d(opts);$2');
   if(!code.includes('return submitCompat3d(opts);')||!code.includes('await submitDice3d(req); return;'))throw Error('3D adapter no longer matches the shared dice entry contract');
   const at=code.indexOf('export function normalizePayload'),end=code.indexOf('\nfunction clamp(',at);let normal=code.slice(at,end);
   normal=normal.replace('value: clamp(die.value, 1, sidesOf(die.type)),','value: typeof (data as any)._3dConnection===\'string\' && Number.isSafeInteger(die.value) && Math.abs(die.value)<=1e9 ? die.value : clamp(die.value, 1, sidesOf(die.type)),');
   normal=normal.replace('itemId: data.itemId ?? null,','_3dConnection: (data as any)._3dConnection, _3dRows: (data as any)._3dRows, itemId: data.itemId ?? null,');code=code.slice(0,at)+normal+code.slice(end);
  }
  if(path.endsWith('/src/modules/dice/history-page.ts')){
   code="let __3dConnection='';\n"+code;
   code=code.replace('OBR.onReady(async () => {','OBR.onReady(async () => { __3dConnection=await OBR.player.getConnectionId();');
   code=code.replace('if (data.hidden && myRole !== "GM" && data.rollerId !== myPlayerId)', 'if ((data as any)._3dConnection!==__3dConnection)');
   code=code.replaceAll('JSON.stringify(history)', 'JSON.stringify(history.filter(h=>!h.hidden))');
   code=code.replace('history=loadHistory();for(const [id,pending]', 'history=[...history.filter(h=>h.hidden&&h._3dConnection===__3dConnection),...loadHistory()];for(const [id,pending]');
   code=code.replace('pending.entry.hidden&&myRole!==\'GM\'&&pending.entry.rollerId!==myPlayerId','pending.entry.hidden&&pending.entry._3dConnection!==__3dConnection&&myRole!==\'GM\'&&pending.entry.rollerId!==myPlayerId');
   code=code.replace('pendingEntries.set(data.rollId, { entry: data, timer });','clearTimeout(pendingEntries.get(data.rollId)?.timer);pendingEntries.set(data.rollId, { entry: data, timer });commitPending(data.rollId);');
   code=code.replaceAll('history = loadHistory();','history = [...history.filter(h=>h.hidden&&h._3dConnection===__3dConnection),...loadHistory()];');
   code=code.replace(/(applyI18nDom\(lang\);\r?\n  render\(\);\r?\n)(\}\);)/,'$1  void OBR.broadcast.sendMessage(\'com.obr-suite/dice3d-history-request\',{}, {destination:\'LOCAL\'});\n$2');
   code=adapt3dHistory(code);
  }return code;
 }};
}
