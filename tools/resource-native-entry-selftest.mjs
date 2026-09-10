// Actual resource module + installed SDK APIs + actual ModuleLifecycle.
// Only the host bus and local language store are substituted; resource writes are forbidden.
// Run: node tools/resource-native-entry-selftest.mjs [--verify-mutations]
import assert from 'node:assert/strict';
import { build } from 'rolldown';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const source=resolve('src/modules/resourceTracker/index.ts'), fixture=resolve('tools/fixtures/resource-native-entry-sdk.ts');
const out=mkdtempSync(join(tmpdir(),'resource-native-entry-'));
const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'), sourceHash=hash();
const mutation=process.argv.find(arg=>arg.startsWith('--mutation='))?.split('=')[1];
const mutations={
  'remove-for-language':['    await OBR.tool.create({ id: PANEL_TOOL_ID,','    if (toolTouched) await OBR.tool.remove(PANEL_TOOL_ID);\n    await OBR.tool.create({ id: PANEL_TOOL_ID,'],
  'native-without-serialization':['const result = toolSerial.then(work);','const result = work();'],
  'panel-without-serialization':['const result = panelSerial.then(work);','const result = work();'],
  'forget-failed-remove':['  await OBR.tool.remove(PANEL_TOOL_ID);','  toolTouched = false;\n  await OBR.tool.remove(PANEL_TOOL_ID);'],
  'swallow-native-errors':['  return result;\n}\nasync function removeOwnedTool','  return toolSerial;\n}\nasync function removeOwnedTool'],
  'stale-label-cache':['    toolLabel = undefined;','    /* mutation: retain the last acknowledged label */'],
  'ignore-same-role-event':['      roleObserved = true;','      /* mutation: unchanged-role event loses to initial snapshot */'],
};
const expectedFailures={
  'remove-for-language':'Chinese GM setup registers the original single tool directly, once',
  'native-without-serialization':'old create acknowledgement cannot remove or replace the restarted native entry',
  'panel-without-serialization':'reopen after synchronous page-close marker timed out',
  'forget-failed-remove':'manager retry removes the still-owned ID after a failed teardown',
  'swallow-native-errors':'Missing expected rejection.',
  'stale-label-cache':'revert locale after lost reply timed out',
  'ignore-same-role-event':'same-value GM event supersedes the old initial role snapshot without losing or creating an unauthorized entry',
};
let mutationApplied=false;
const warnings=[];console.warn=(...args)=>warnings.push(args.map(String).join(' '));
globalThis.window=new EventTarget();window.location=globalThis.location={origin:'https://fixture.invalid'};
const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
await build({input:'resource-entry-probe',platform:'node',plugins:[{name:'native-host',resolveId(id){if(id==='resource-entry-probe')return '\0entry';if(id==='@owlbear-rodeo/sdk'||/^(\.\.\/)+state$/.test(id))return fixture;},load(id){if(id==='\0entry')return `export * from ${JSON.stringify(source)};export {fixture} from ${JSON.stringify(fixture)};export {ModuleLifecycle} from ${JSON.stringify(resolve('src/utils/moduleLifecycle.ts'))};`;},transform(code,id){code=code.replaceAll('\r\n','\n');if(mutation&&id.replaceAll('\\','/').endsWith('/resourceTracker/index.ts')){const [before,after]=mutations[mutation]??[];if(!before||code.split(before).length!==2)throw new Error(`mutation anchor missing or ambiguous: ${mutation}`);mutationApplied=true;code=code.replace(before,after);}return code.replaceAll('import.meta.env.BASE_URL','"/"');}}],output:{file:join(out,'probe.mjs'),format:'esm'}});
if(mutation){if(!mutationApplied)throw new Error(`mutation was not applied: ${mutation}`);process.stderr.write(`OBR_MUTATION_READY ${mutation}\n`);}
const {setupResourceTracker:setup,teardownResourceTracker:teardown,fixture:f,ModuleLifecycle}=await import(pathToFileURL(join(out,'probe.mjs')).href);
const TOOL='com.obr-suite/resources/tracker-tool',PANEL='com.obr-suite/resources/tracker-panel',KEY='com.obr-suite/resources/panel-open';
const CREATE='OBR_TOOL_CREATE',REMOVE='OBR_TOOL_REMOVE',OPEN='OBR_MODAL_OPEN',CLOSE='OBR_MODAL_CLOSE';
const delay=ms=>new Promise(done=>setTimeout(done,ms));
async function until(fn,reason='host'){const end=Date.now()+1800;while(!fn()){assert.ok(Date.now()<end,`${reason} timed out`);await delay(2);}}
const count=(type,id)=>f.calls.filter(call=>call.type===type&&(!id||call.data.id===id)).length;
const settle=()=>delay(10),click=()=>f.event('OBR_TOOL_EVENT_CLICK',{id:TOOL,context:{activeTool:f.activeTool,metadata:f.metadata}});
const held=()=>until(()=>f.release),release=()=>{assert.ok(f.release);f.release();};
const label=()=>f.tools.get(TOOL)?.icons[0].label,checks=[];
const check=(value,message)=>{assert.ok(value,message);checks.push(message);};
async function clean(){await teardown();await settle();check(!f.tools.size&&!f.modals.has(PANEL)&&f.listeners('language')===0&&f.listeners('OBR_PLAYER_EVENT_CHANGE')===0&&f.listeners('OBR_SCENE_EVENT_READY_CHANGE')===0,'teardown cleans the owned native entry and panel and releases session subscriptions');}

await Promise.all([setup(),setup()]);
check(label()==='资源追踪'&&count(CREATE)===1&&count(REMOVE)===0,'Chinese GM setup registers the original single tool directly, once');
check(f.listeners('language')===1&&f.listeners('OBR_PLAYER_EVENT_CHANGE')===1&&f.tools.get(TOOL).icons[0].filter.roles.join()==='GM','duplicate setup shares subscriptions and the native entry remains GM-filtered');
await f.scene(true);await settle();await click();await until(()=>f.modals.has(PANEL));
const panel=f.modals.get(PANEL),beforeCalls=f.calls.length;
check(panel.config.url==='https://fixture.invalid/resource-tracker.html'&&panel.config.width===1152&&panel.config.height===736&&panel.config.hideBackdrop&&panel.config.hidePaper,'installed SDK click preserves the original overview URL, bounded dimensions and canvas-friendly presentation');
await f.language('en');await until(()=>label()==='Resource tracker');
check(f.calls.slice(beforeCalls).filter(call=>call.type.startsWith('OBR_TOOL')).map(call=>call.type).join()===CREATE,'live English update uses same-ID create without unregistering the toolbar entry');
check(f.modals.get(PANEL)===panel&&panel.draft==='unconfirmed resource value','language update does not reopen the overview or replace its unfinished edit state');
const identical=f.calls.length;await f.language('en');await settle();check(f.calls.length===identical,'same-language notifications do no native work');
f.failAfterApply=CREATE;await f.language('zh');await until(()=>!f.failAfterApply);await settle();
check(label()==='资源追踪','host-applied locale updates can still return a rejected acknowledgement');
const lostAckCreates=count(CREATE),lostAckRemoves=count(REMOVE);await f.language('en');await until(()=>label()==='Resource tracker','revert locale after lost reply');
check(count(CREATE)===lostAckCreates+1&&count(REMOVE)===lostAckRemoves&&f.modals.get(PANEL)===panel&&panel.draft==='unconfirmed resource value','reverting after a lost locale reply refreshes the same ID and preserves the overview draft');
await f.changeRole('PLAYER');await until(()=>!f.modals.has(PANEL));const revokedCalls=f.calls.length;await click();await f.language('zh');await settle();
check(f.calls.length===revokedCalls&&f.tools.get(TOOL).icons[0].filter.roles.join()==='GM','role loss hides the native entry and prevents retained SDK callbacks reopening the GM panel');
await f.changeRole('GM');await until(()=>label()==='资源追踪');await click();await until(()=>f.modals.has(PANEL));
// The existing overview page uses this synchronous same-client marker on close.
f.modals.delete(PANEL);localStorage.removeItem(KEY);const reopenCount=count(OPEN,PANEL);await click();await until(()=>count(OPEN,PANEL)===reopenCount+1,'reopen after synchronous page-close marker');
check(f.modals.has(PANEL),'the existing page-close marker still permits reopening with one native click');
await clean();const stopped=f.calls.length;await f.language('en');await f.changeRole('GM');await f.scene(false);await click();await settle();check(f.calls.length===stopped,'language, role, scene and SDK clicks are inert after module teardown');

// Initial identity and language changes never register under a stale role.
f.role='PLAYER';f.ready=false;await setup();check(!f.tools.size,'initial player setup never registers a GM entry');await f.changeRole('GM');await until(()=>f.tools.has(TOOL));await clean();
f.role='GM';f.hold='OBR_PLAYER_GET_ROLE';const staleRole=setup();await held();await f.changeRole('PLAYER');release();await staleRole;check(!f.tools.size,'a later player event supersedes the slow initial GM read');await clean();
f.role='GM';f.hold='OBR_PLAYER_GET_ROLE';const pendingRole=setup();await held();await f.language('zh');await teardown();release();await pendingRole;check(!f.tools.size,'initial role replies after teardown cannot register a late native entry');await clean();
for(const retainedRole of ['GM','PLAYER']){
  f.role=retainedRole;await setup();await clean();
  f.role=retainedRole==='GM'?'PLAYER':'GM';f.hold='OBR_PLAYER_GET_ROLE';const pendingSameRole=setup();await held();
  await f.changeRole(retainedRole);release();await pendingSameRole;
  check(f.tools.has(TOOL)===(retainedRole==='GM'),`same-value ${retainedRole} event supersedes the old initial role snapshot without losing or creating an unauthorized entry`);
  await clean();
}
f.role='GM';

// Old creates and removes drain in order across immediate restart.
f.hold=CREATE;const oldStart=setup();await held();const oldStop=teardown(),newStart=setup();await f.language('en');await settle();release();await Promise.all([oldStart,oldStop,newStart]);await settle();
check(f.tools.size===1&&label()==='Resource tracker','old create acknowledgement cannot remove or replace the restarted native entry');
await f.scene(true);await click();await until(()=>f.modals.has(PANEL),'new SDK callback');check(f.modals.has(PANEL),'the callback left in the installed SDK after restart belongs to the live module');await clean();
f.ready=false;await setup();f.hold=CREATE;await f.language('zh');await held();await f.language('en');await f.language('zh');release();await until(()=>label()==='资源追踪');await settle();check(label()==='资源追踪','rapid locales while same-ID creation is pending converge to the last language');await clean();

// Panel requests share their own serial queue, so old cleanup never closes a new window.
f.ready=true;await setup();f.hold='OBR_VIEWPORT_GET_WIDTH';const widthOpens=count(OPEN,PANEL);await click();await held();const stopWidth=teardown();release();await stopWidth;check(count(OPEN,PANEL)===widthOpens,'a viewport reply after teardown cannot dispatch even a temporary overview open');await clean();
await setup();f.hold=OPEN;f.holdId=PANEL;await click();await held();const stopOpen=teardown();await setup();await click();const afterPending=f.calls.length;release();await stopOpen;await until(()=>f.modals.has(PANEL),'replacement overview after old open');await settle();
check(f.modals.has(PANEL)&&f.calls.slice(afterPending).filter(call=>call.data.id===PANEL).map(call=>call.type).join()===`${CLOSE},${OPEN}`,'late old overview open is cleaned before the new window opens, without closing its replacement');await clean();
await setup();f.hold=OPEN;f.holdId=PANEL;await click();await held();await f.scene(false);await f.scene(true);await click();release();await until(()=>f.modals.has(PANEL));await settle();check(f.modals.has(PANEL),'scene changes while a panel open is pending preserve only the new-scene overview');await clean();
await setup();f.hold=OPEN;f.holdId=PANEL;await click();await held();await f.changeRole('PLAYER');release();await until(()=>f.release===null);await settle();check(!f.modals.has(PANEL),'role revocation drains and closes an already-dispatched overview open');await clean();
f.role='GM';await setup();f.hold='OBR_VIEWPORT_GET_WIDTH';const rapidOpens=count(OPEN,PANEL);await click();await held();await click();release();await settle();check(count(OPEN,PANEL)===rapidOpens&&!f.modals.has(PANEL),'two fast clicks cancel a pending overview open without creating duplicate windows');await clean();

// Close errors preserve authoritative open state and allow the same action to retry.
await setup();await click();await until(()=>f.modals.has(PANEL));const unchangedPanel=f.modals.get(PANEL),beforeFailOpen=count(OPEN,PANEL);f.fail=CLOSE;f.failId=PANEL;await click();await until(()=>!f.fail);await settle();
check(f.modals.get(PANEL)===unchangedPanel&&localStorage.getItem(KEY)==='1','failed overview close preserves its window, draft and synchronous open marker');
await click();await until(()=>!f.modals.has(PANEL));check(count(OPEN,PANEL)===beforeFailOpen&&localStorage.getItem(KEY)===null,'the next tool click retries closing without reopening or clearing the draft first');await clean();
f.ready=false;f.failAfterApply=CREATE;await assert.rejects(setup(),/controlled lost reply/);check(f.tools.has(TOOL),'fixture reproduces host registration before a rejected create acknowledgement');await clean();

f.ready=true;await setup();f.failAfterApply=OPEN;f.fail=CLOSE;f.failId=PANEL;await click();await until(()=>!f.failAfterApply&&!f.fail);await settle();
check(f.modals.has(PANEL)&&localStorage.getItem(KEY)!=='1','a lost panel-open acknowledgement plus rejected cleanup retains uncertain window ownership');
const uncertainOpens=count(OPEN,PANEL);f.fail=CLOSE;f.failId=PANEL;await click();await until(()=>!f.fail);await settle();
check(count(OPEN,PANEL)===uncertainOpens&&f.modals.has(PANEL),'retry cannot overwrite an unconfirmed live panel when its cleanup still fails');
await click();await until(()=>count(OPEN,PANEL)===uncertainOpens+1);check(f.modals.has(PANEL)&&localStorage.getItem(KEY)==='1','once uncertain cleanup succeeds, the next panel open records confirmed state');await clean();f.ready=false;

const manager=new ModuleLifecycle({resourceTracker:{setup,teardown}},{retryDelays:[]});
for(const type of [CREATE,'OBR_PLAYER_GET_ROLE','OBR_PLAYER_GET_CONNECTION_ID','OBR_SCENE_IS_READY']){
  f.fail=type;await manager.setDesired({resourceTracker:true});
  check(manager.snapshot()[0].status==='error'&&!f.tools.size&&f.listeners('language')===0,`${type} failure is observable by the manager and partial startup is cleaned`);
  await manager.retry('resourceTracker');check(manager.snapshot()[0].status==='on'&&f.tools.size===1,`existing manager retry recovers ${type} without duplicate registrations`);
  await manager.setDesired({resourceTracker:false});
}
await manager.setDesired({resourceTracker:true});f.fail=REMOVE;await manager.setDesired({resourceTracker:false});
check(manager.snapshot()[0].status==='error'&&f.tools.has(TOOL),'failed native removal reports error instead of claiming the module is off');
await manager.retry('resourceTracker');check(manager.snapshot()[0].status==='off'&&!f.tools.size,'manager retry removes the still-owned ID after a failed teardown');
f.ready=true;await manager.setDesired({resourceTracker:true});await click();await until(()=>f.modals.has(PANEL));f.fail=CLOSE;f.failId=PANEL;await manager.setDesired({resourceTracker:false});
check(manager.snapshot()[0].status==='error'&&f.modals.has(PANEL)&&localStorage.getItem(KEY)==='1','failed overview cleanup preserves ownership and propagates failure to the manager');
await manager.retry('resourceTracker');check(manager.snapshot()[0].status==='off'&&!f.modals.has(PANEL)&&localStorage.getItem(KEY)===null,'manager retry completes the retained overview cleanup without reopening any window');await clean();
check(!f.calls.some(call=>/OBR_TOOL_(ACTIVATE|MODE|ACTION)|OBR_PLAYER_SELECT|OBR_SCENE_ITEMS_UPDATE|OBR_SCENE_SET_METADATA|OBR_BROADCAST_SEND_MESSAGE/.test(call.type))&&f.activeTool==='rodeo.owlbear.tool/move'&&f.activeMode==='move-mode'&&f.selection.join()==='selected-token','the full run does not activate tools, add modes/actions, change selection or write resources/network data');
check(hash()===sourceHash,'product source remains unchanged for the complete run');
const mutationResults=[];
if(process.argv.includes('--verify-mutations'))for(const name of Object.keys(mutations)){
  const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),`--mutation=${name}`],{encoding:'utf8',timeout:25000,windowsHide:true});
  const failure=child.stderr.match(/^AssertionError(?: \[ERR_ASSERTION\])?: ([^\r\n]+)/m)?.[1];
  const ready=child.stderr.split(/\r?\n/).includes(`OBR_MUTATION_READY ${name}`);
  assert.ok(child.status!==0&&!child.error&&ready&&!/Build failed|mutation anchor|mutation was not applied/.test(child.stderr)&&failure===expectedFailures[name],`mutation not caught by expected runtime assertion: ${name}\n${child.stdout}\n${child.stderr}`);
  writeFileSync(join(out,`mutation-${name}.log`),child.stdout+child.stderr);mutationResults.push({name,caught:true,buildSucceeded:true,appliedExactlyOnce:true,failure});
}
writeFileSync(join(out,'result.json'),JSON.stringify({passed:checks.length,checks,mutationResults,sourceHash,warnings,actualSDK:'ToolApi/ModalApi/PlayerApi/ViewportApi/BroadcastApi/SceneApi 3.1.0',actualLifecycle:true,realHost:false},null,2));
console.log(`PASS ${checks.length} resource native entry checks; ${mutationResults.length} mutations caught. Evidence: ${out}`);
