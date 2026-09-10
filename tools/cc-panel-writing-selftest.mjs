/**
 * Real panel write continuations, delayed SDK/API and file-picker regressions; no room/service traffic.
 * Usage: node tools/cc-panel-writing-selftest.mjs [repository-root]
 * Requires the repository dependencies (rolldown) and Playwright outside the product.
 * PLAYWRIGHT_PATH (or PLAYWRIGHT_PACKAGE) may name a package path. BROWSER_PATH may
 * select Edge/Chrome; otherwise a local Windows browser or Playwright Chromium is used.
 * Generated bundle, JSON observations and PNGs are retained in a unique OS temp folder.
 * The child character-sheet iframe is an inert fixture: this checks panel ownership
 * and lifecycle, not the independent full character sheet or a live Owlbear room.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repo = resolve(process.argv[2] || fileURLToPath(new URL('../', import.meta.url)));
const output = mkdtempSync(join(tmpdir(), 'cc-panel-writing-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['src/modules/characterCards/panel-page.ts', 'cc-panel.html', 'src/i18n.ts', 'src/i18n-portal.ts', 'src/icons.ts', 'src/asset-base.ts', 'src/settings.ts'];
const manifest = { source: repo, capturedAt: new Date().toISOString(), files: {} };
for (const file of files) {
  const bytes = readFileSync(join(repo, file));
  manifest.files[file] = { sha256: hash(bytes), bytes: bytes.length };
}
writeFileSync(join(output, 'source-manifest.json'), JSON.stringify(manifest, null, 2));
const { build } = await import(pathToFileURL(join(repo, 'node_modules/rolldown/dist/index.mjs')));
const require = createRequire(import.meta.url);
const bundledPlaywright = join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || process.env.PLAYWRIGHT_PACKAGE || (existsSync(bundledPlaywright) ? bundledPlaywright : 'playwright'));
const browserPath = process.env.BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync);
const sdk = `
const m=window.panelAudit;
const copy=x=>structuredClone(x);
const listen=(kind,cb)=>{(m.listeners[kind]??=new Set()).add(cb);return()=>m.listeners[kind].delete(cb);};
m.emit=(kind,value)=>{for(const cb of [...(m.listeners[kind]??[])]){try{Promise.resolve(cb(copy(value))).catch(e=>m.errors.push(String(e)))}catch(e){m.errors.push(String(e))}}};
m.releaseRead=(index)=>{const p=m.reads[index];p.released=true;p.resolve(copy(p.value));};
m.rejectReady=()=>{const p=m.readyReads.find(p=>!p.released);p.released=true;p.reject(Error('Controlled initial readiness failure after metadata'))};
m.releaseReady=()=>{const p=m.readyReads.find(p=>!p.released);p.released=true;p.resolve(p.value)};
m.changeRole=(role,id=m.playerId)=>{m.role=role;m.playerId=id;m.emit('player',{role,id,name:m.name});};
m.remote=(meta)=>{m.metadata=copy(meta);m.scenes[m.sceneId]=copy(meta);m.emit('metadata',meta)};
m.switchScene=(id,meta)=>{m.ready=false;m.emit('scene-ready',false);m.sceneId=id;m.metadata=copy(meta);m.scenes[id]=copy(meta);m.ready=true;m.emit('scene-ready',true)};
m.commitWrite=(index)=>{const p=m.writes[index];if(p.committed)throw Error('Already committed');p.committed=true;m.scenes[p.sceneAtCall]={...m.scenes[p.sceneAtCall],...copy(p.value)};if(m.sceneId===p.sceneAtCall){m.metadata=copy(m.scenes[p.sceneAtCall]);m.emit('metadata',m.metadata)}};
m.releaseWrite=(index)=>{const p=m.writes[index];if(!p.committed)m.commitWrite(index);p.acknowledged=true;p.resolve()};
m.rejectWrite=(index)=>{const p=m.writes[index];p.acknowledged=true;p.reject(Error('Controlled metadata write rejection'))};
m.releaseAPI=(index,value=m.apiResponse,status=200)=>{const p=m.apiCalls[index];if(p.released)return;p.released=true;p.resolve(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}))};
const OBR={
 onReady(cb){queueMicrotask(()=>Promise.resolve(cb()).then(()=>m.booted=true).catch(e=>m.errors.push(String(e))))},
 room:{get id(){return m.roomId}},
 player:{getName:async()=>m.name,getId:async()=>m.playerId,getRole:async()=>m.role,onChange:cb=>listen('player',cb)},
 party:{getPlayers:async()=>copy(m.players),onChange:cb=>listen('party',cb)},
 scene:{isReady:()=>{const value=m.ready;return m.holdReady?new Promise((resolve,reject)=>m.readyReads.push({value,resolve,reject,released:false})):Promise.resolve(value)},onReadyChange:cb=>listen('scene-ready',cb),
  getMetadata(){const value=copy(m.metadata);return new Promise(resolve=>{m.reads.push({value,resolve,released:!m.holdReads});if(!m.holdReads)resolve(value)})},
  setMetadata(value){const index=m.writes.length;return new Promise((resolve,reject)=>{m.writes.push({sceneAtCall:m.sceneId,roleAtCall:m.role,closedAtCall:m.closed,value:copy(value),committed:false,acknowledged:false,resolve,reject});if(!m.holdCommits)m.commitWrite(index);if(!m.holdWriteAcks){m.writes[index].acknowledged=true;resolve()}})},
  onMetadataChange:cb=>listen('metadata',cb)},
 modal:{open:async value=>m.modalCalls.push(['open',copy(value)]),close:async value=>{m.modalCalls.push(['close',value]);if(m.rejectClose)throw Error('Controlled host modal.close failure')}},
 broadcast:{sendMessage:async(...args)=>m.broadcasts.push({scene:m.sceneId,role:m.role,closed:m.closed,maximized:document.body.classList.contains('maximized'),panelOpenKey:localStorage.getItem('com.obr-suite/cc-panel-open'),subscriptions:Object.fromEntries(Object.entries(m.listeners).map(([k,v])=>[k,v.size])),modalCalls:m.modalCalls,args:copy(args)}),onMessage:(name,cb)=>listen('broadcast:'+name,cb)},
 notification:{show:async message=>m.notifications.push(message)}
};
window.fetch=(input,init={})=>new Promise((resolve,reject)=>{const url=String(input),method=init.method||'GET';const files=init.body instanceof FormData?[...init.body.entries()].map(([k,v])=>({field:k,name:v.name,size:v.size})):undefined;const entry={url,method,sceneAtCall:m.sceneId,roleAtCall:m.role,closedAtCall:m.closed,body:typeof init.body==='string'?init.body:undefined,files,resolve,reject,released:false,aborted:false};m.apiCalls.push(entry);if(init.signal){const abort=()=>{entry.aborted=true;if(m.honorAbort&&!entry.released){entry.released=true;reject(new DOMException('Aborted','AbortError'))}};if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true})};if(method==='DELETE'&&m.autoDelete){entry.released=true;resolve(new Response('{}',{status:200}))}});
window.addEventListener('unhandledrejection',e=>{m.errors.push(String(e.reason));e.preventDefault()});
export default OBR;`;
const language = `export const getLocalLang=()=>window.panelAudit.lang;
export const onLangChange=cb=>{window.panelAudit.langListeners.add(cb);return()=>window.panelAudit.langListeners.delete(cb)};
window.changePanelLang=lang=>{window.panelAudit.lang=lang;for(const cb of window.panelAudit.langListeners)cb(lang)};`;
await build({ input: join(repo,'src/modules/characterCards/panel-page.ts'),
  transform: { define: { 'import.meta.env.BASE_URL': JSON.stringify('/') } },
  plugins: [{ name: 'panel-isolation', resolveId(id, importer) {
    if (id === '@owlbear-rodeo/sdk') return '\0panel-sdk';
    if (importer?.replaceAll('\\', '/').endsWith('/characterCards/panel-page.ts') && id === '../../state') return '\0panel-language';
    if (importer?.replaceAll('\\', '/').endsWith('/characterCards/panel-page.ts') && id === './xlsx-shield-state') return '\0panel-shield';
  }, load(id) {
    if (id === '\0panel-sdk') return sdk;
    if (id === '\0panel-language') return language;
    if (id === '\0panel-shield') return 'export const reconcileUploadedCardShieldState=async()=>false;';
  }}], output: { file: join(output, 'panel.js'), format: 'iife' } });

const html = readFileSync(join(repo,'cc-panel.html'), 'utf8').replace(/<script type="module"[^>]*><\/script>/g, '<script src="/panel.js"></script>');
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/panel.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(readFileSync(join(output, 'panel.js'))); }
  if (url.pathname === '/cc-fullscreen.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end('<!doctype html><html><body style="background:#1c2030;color:#fff;font:22px sans-serif;padding:24px"><p>Isolated card iframe</p><pre id="target"></pre><script>document.querySelector("#target").textContent=location.search</script></body></html>');
  }
  if (url.pathname === '/panel') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
  res.statusCode = 404; res.end('Isolated audit: no resource');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
const findings = [];
const card = (id, name, visibility = 'public', owners = []) => ({ id, name, visibility, owner_ids: owners, uploader: 'Fixture author', uploaded_at: '2026-09-08T00:00:00Z', url: '/not-used/' + id });
const list = [card('a', 'Public Hero'), card('p', 'Assigned Hero', 'owners', ['player-a']), card('d', 'Hidden NPC', 'dm')];
async function open(options = {}, viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => console.error('Isolated page error:', error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.addInitScript(({ options, list }) => {
    window.panelAudit = { role: 'GM', playerId: 'gm-1', name: 'Fixture GM', roomId: 'audit-room', lang: 'en', ready: true,
      metadata: { 'com.character-cards/list': list }, players: [{ id: 'player-a', role: 'PLAYER' }],
      listeners: {}, langListeners: new Set(), reads: [], roles: [], readyReads: [], writes: [], fetches: [], errors: [],
      sceneId:'scene-a',scenes:{},apiCalls:[],apiResponse:{id:'created',name:'Created card',url:'https://obr.dnd.center/characters/audit-room/created/index.html',visibility:'public',uploader:'Fixture',uploaded_at:'2026-09-08T00:00:00Z'},closed:false,honorAbort:false,rejectClose:false,holdWriteAcks:false,holdCommits:false,autoDelete:true,modalCalls: [], broadcasts: [], notifications: [], booted: false, holdReads: false, holdRole: false, holdReady: false, ...options };
    window.panelAudit.scenes[window.panelAudit.sceneId]=structuredClone(window.panelAudit.metadata);
    if (options.activeCard) localStorage.setItem('character-cards/state/audit-room', JSON.stringify({ activeCardId: options.activeCard, scrollY: 0, maximized: true }));
  }, { options, list });
  await page.goto(origin + '/panel');
  return page;
}
async function boot(page) { await page.waitForFunction(() => window.panelAudit.booted || window.panelAudit.errors.length); const errors = await page.evaluate(() => window.panelAudit.errors); if (errors.length) throw Error(errors.join('\n')); await tick(page); }
async function state(page){return page.evaluate(()=>{const m=window.panelAudit,plain=p=>Object.fromEntries(Object.entries(p).filter(([,v])=>typeof v!=='function'));return{
 scene:m.sceneId,role:m.role,closed:m.closed,maximized:document.body.classList.contains('maximized'),panelOpenKey:localStorage.getItem('com.obr-suite/cc-panel-open'),subscriptions:Object.fromEntries(Object.entries(m.listeners).map(([k,v])=>[k,v.size])),modalCalls:m.modalCalls,
 rows:[...document.querySelectorAll('#list .card')].map(e=>({id:e.dataset.id,name:e.querySelector('.card-name')?.textContent,visibilityTitle:e.querySelector('.card-vis')?.title,visuallyPrivate:e.classList.contains('is-hidden')})),
 frames:[...document.querySelectorAll('#viewer iframe')].map(e=>({id:e.dataset.id,shown:getComputedStyle(e).display!=='none'})),
 metadata:m.metadata,scenes:m.scenes,writes:m.writes.map(plain),apiCalls:m.apiCalls.map(plain),broadcasts:m.broadcasts,
 errorText:document.querySelector('#error')?.textContent,statusText:document.querySelector('#status')?.textContent,errors:m.errors
}})}
async function snap(page, name) { await page.screenshot({ path: join(output, name + '.png') }); return state(page); }
async function tick(page) { await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30))); }
async function paste(page,name='Draft from scene A'){
 const apiBefore=await page.evaluate(()=>window.panelAudit.apiCalls.length);
 await page.locator('#btnPasteJson').click();await page.locator('#ccPasteOverlay textarea').fill(JSON.stringify({identity:{name},abilities:{}}));await page.locator('#ccPasteOverlay button').last().click();await page.waitForFunction(n=>window.panelAudit.apiCalls.length===n+1,apiBefore);
}
async function upload(page,files=[{name:'fixture.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('isolated upload fixture; fake service only')}]){
 const chooserPromise=page.waitForEvent('filechooser');await page.locator('#btnLinkLocal').click();const chooser=await chooserPromise;await chooser.setFiles(files);await page.waitForFunction(()=>window.panelAudit.apiCalls.length>=1);
}
async function deleteByUI(page,id){await page.locator('#list [data-id="'+id+'"]').hover();page.once('dialog',d=>d.accept());await page.locator('#list [data-id="'+id+'"] .card-del').click()}
async function toggleByUI(page,id){await page.locator('#list [data-id="'+id+'"]').hover();await page.locator('#list [data-id="'+id+'"] .card-vis').click()}
const checks=[];
const rowIds=s=>s.rows.map(c=>c.id).sort().join(',');
const metadataIds=s=>s.metadata['com.character-cards/list'].map(c=>c.id).sort().join(',');
function check(name,pass,details){checks.push({name,pass:!!pass,details});}
function checkBroadcast(name,s,id){const sent=s.broadcasts.filter(b=>b.args[0]==='com.obr-suite/cc-card-updated');check(name+': canonical LOCAL/REMOTE data.json payload',sent.length===2&&sent.map(b=>b.args[2].destination).sort().join(',')==='LOCAL,REMOTE'&&sent.every(b=>b.args[1].cardId===id&&b.args[1].roomId==='audit-room'&&b.args[1].url==='https://obr.dnd.center/characters/audit-room/'+encodeURIComponent(id)+'/data.json'),sent);}
async function capture(page,scenario){const s=await state(page);findings.push({scenario,state:s});check(scenario+': no unexpected script errors',s.errors.length===0,s.errors);return s;}
async function replaceScene(page){await page.evaluate(()=>window.panelAudit.switchScene('scene-b',{'com.character-cards/list':[{id:'b',name:'Only scene B',visibility:'public',url:'/fake/b/'}]}));await tick(page);}
const xlsx={name:'replacement.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('Isolated picker fixture; no real spreadsheet parser or service')};
try{
 browser=await chromium.launch({headless:true,...(browserPath?{executablePath:browserPath}:{})});
 // By default fake fetch records abort but still delivers a late response.
 // Guards must remain effective even when an already-started server job cannot stop.
 const json=await open({metadata:{'com.character-cards/list':[card('a','Scene A')]}});await boot(json);await paste(json);await replaceScene(json);await json.evaluate(()=>window.panelAudit.releaseAPI(0));await tick(json);const jsonAfter=await capture(json,'old JSON response after scene replacement');
 check('old JSON response cannot write or broadcast into new scene',jsonAfter.writes.length===0&&jsonAfter.broadcasts.length===0&&rowIds(jsonAfter)==='b'&&metadataIds(jsonAfter)==='b'&&jsonAfter.frames.length===0,jsonAfter);check('scene replacement signals cancellation to fake API',jsonAfter.apiCalls[0].aborted,jsonAfter.apiCalls);await json.close();

 for(const ending of ['scene','pagehide']){
  const batch=await open({metadata:{'com.character-cards/list':[card('a','A')]}});await boot(batch);await upload(batch,[{...xlsx,name:'one.xlsx'},{...xlsx,name:'two.xlsx'}]);
  if(ending==='scene')await replaceScene(batch);else await batch.evaluate(()=>{window.panelAudit.closed=true;dispatchEvent(new Event('pagehide'))});
  await batch.evaluate(()=>window.panelAudit.releaseAPI(0));await tick(batch);const bs=await capture(batch,'pending XLSX batch canceled by '+ending);
  check('XLSX '+ending+' cancellation stops queued files and metadata',bs.apiCalls.length===1&&bs.writes.length===0&&bs.broadcasts.length===0,bs);await batch.close();
 }

 for(const ending of ['scene','revoke','pagehide']){
  const picker=await open({metadata:{'com.character-cards/list':[card('a','Refresh target')]}});await boot(picker);const chosen=picker.waitForEvent('filechooser');await picker.locator('#list [data-id="a"]').hover();await picker.locator('#list [data-id="a"] .card-refresh').click();const chooser=await chosen;
  if(ending==='scene')await replaceScene(picker);else if(ending==='revoke')await picker.evaluate(()=>{const m=window.panelAudit;m.changeRole('PLAYER','player-a');m.remote({'com.character-cards/list':[{id:'a',name:'Now DM only',visibility:'dm',url:'/fake/a/'}]})});else await picker.evaluate(()=>{window.panelAudit.closed=true;dispatchEvent(new Event('pagehide'))});
  await chooser.setFiles(xlsx);await tick(picker);const ps=await capture(picker,'file picker returned after '+ending);
  check('stale '+ending+' file choice sends no service or metadata write',ps.apiCalls.length===0&&ps.writes.length===0&&ps.broadcasts.length===0,ps);await picker.close();
 }

 // A real modal Cancel closes just the paste overlay, not the whole panel.
 const cancel=await open();await boot(cancel);await paste(cancel);await cancel.locator('#ccPasteOverlay button').first().click();await cancel.evaluate(()=>window.panelAudit.releaseAPI(0));await tick(cancel);const cs=await capture(cancel,'JSON overlay canceled while service pending');
 check('canceling JSON overlay blocks later scene attachment',cs.apiCalls.length===1&&cs.apiCalls[0].aborted&&cs.writes.length===0&&cs.broadcasts.length===0&&(await cancel.locator('#ccPasteOverlay').count())===0,cs);await cancel.close();

 const staleDraft=await open();await boot(staleDraft);await staleDraft.locator('#btnPasteJson').click();await staleDraft.locator('#ccPasteOverlay textarea').fill('{"identity":{"name":"Unsubmitted old-scene draft"}}');await replaceScene(staleDraft);
 if(await staleDraft.locator('#ccPasteOverlay').count()){const btn=staleDraft.locator('#ccPasteOverlay button').last();if(await btn.isEnabled())await btn.click();}await tick(staleDraft);const draftAfter=await capture(staleDraft,'unsubmitted JSON draft from previous scene');check('old-scene JSON overlay cannot submit into replacement scene',draftAfter.apiCalls.length===0&&draftAfter.writes.length===0&&metadataIds(draftAfter)==='b',draftAfter);await staleDraft.close();

 for(const newer of ['scene','same-scene-metadata']){
  const del=await open({holdWriteAcks:true,metadata:{'com.character-cards/list':[card('a','Delete A'),card('c','Keep C')]}});await boot(del);await deleteByUI(del,'a');await del.waitForFunction(()=>window.panelAudit.writes.length===1);
  if(newer==='scene')await replaceScene(del);else await del.evaluate(()=>window.panelAudit.remote({'com.character-cards/list':[{id:'c',name:'Keep C',visibility:'public',url:'/fake/c/'},{id:'remote',name:'Other player newly added',visibility:'public',url:'/fake/remote/'}]}));
  await del.evaluate(()=>window.panelAudit.releaseWrite(0));await tick(del);const ds=await capture(del,'delete acknowledgement after newer '+newer);const expected=newer==='scene'?'b':'c,remote';
  check('delete old ACK retains '+newer+' authoritative list',rowIds(ds)===expected&&metadataIds(ds)===expected&&ds.writes.length===1,ds);
  if(newer==='scene')check('old-scene delete acknowledgement cannot start server DELETE',ds.apiCalls.length===0,ds.apiCalls);else check('valid same-scene deletion still reaches server DELETE',ds.apiCalls.length===1&&ds.apiCalls[0].method==='DELETE',ds.apiCalls);await del.close();
 }

 const failure=await open({holdCommits:true,holdWriteAcks:true,metadata:{'com.character-cards/list':[card('a','Visibility target')]}});await boot(failure);await toggleByUI(failure,'a');await failure.waitForFunction(()=>window.panelAudit.writes.length===1);await failure.evaluate(()=>window.panelAudit.rejectWrite(0));await tick(failure);await failure.evaluate(()=>window.changePanelLang('zh'));const failed=await capture(failure,'visibility write rejected');
 check('rejected visibility write keeps actual public state and shows error',failed.metadata['com.character-cards/list'][0].visibility==='public'&&!failed.rows[0].visuallyPrivate&&failed.errorText.length>0,failed);await failure.close();

 const player=await open({role:'PLAYER',playerId:'player-a',metadata:{'com.character-cards/list':[card('a','Public existing')]}});await boot(player);await paste(player);await player.evaluate(()=>window.panelAudit.releaseAPI(0));await player.waitForFunction(()=>window.panelAudit.writes.length===1);await tick(player);const created=await capture(player,'ordinary PLAYER creates public card');check('ordinary PLAYER can still create and open a public card',rowIds(created)==='a,created'&&created.frames.some(f=>f.id==='created'&&f.shown)&&created.writes[0].roleAtCall==='PLAYER',created);checkBroadcast('new public card from index.html server entry',created,'created');await player.close();

 // A newer received metadata event must beat a stale getMetadata response.
 const readRace=await open({metadata:{'com.character-cards/list':[card('a','A')]}});await boot(readRace);await readRace.evaluate(()=>window.panelAudit.holdReads=true);await toggleByUI(readRace,'a');await readRace.waitForFunction(()=>window.panelAudit.reads.some(p=>!p.released));
 await readRace.evaluate(()=>{const m=window.panelAudit;m.remote({'com.character-cards/list':[{id:'a',name:'A',visibility:'public'},{id:'remote',name:'New card while read pending',visibility:'public'}]});m.releaseRead(m.reads.findIndex(p=>!p.released))});await readRace.waitForFunction(()=>window.panelAudit.writes.length===1);await tick(readRace);const readMerged=await capture(readRace,'metadata event during mutation latest-read');
 check('mutation uses newer event and preserves remote card',metadataIds(readMerged)==='a,remote'&&readMerged.metadata['com.character-cards/list'].find(c=>c.id==='a').visibility==='dm',readMerged);await readRace.close();

 // This is one panel's queue. It does not model or claim cross-client CAS.
 const queue=await open({holdWriteAcks:true,metadata:{'com.character-cards/list':[card('a','A'),card('b','B')]}});await boot(queue);await toggleByUI(queue,'a');await queue.waitForFunction(()=>window.panelAudit.writes.length===1);await toggleByUI(queue,'b');await tick(queue);const whileQueued=await state(queue);
 check('one-panel mutation queue has only one outstanding SDK write',whileQueued.writes.length===1,whileQueued.writes);
 await queue.evaluate(()=>{const m=window.panelAudit;m.remote({'com.character-cards/list':[{id:'a',name:'A',visibility:'dm'},{id:'b',name:'B',visibility:'public'},{id:'remote',name:'Remote during first ACK',visibility:'public'}]});m.holdWriteAcks=false;m.releaseWrite(0)});await queue.waitForFunction(()=>window.panelAudit.writes.length===2);await tick(queue);const queuedAfter=await capture(queue,'queued independent card edit with newer metadata');
 check('queued edit preserves both edits and newly received remote card',metadataIds(queuedAfter)==='a,b,remote'&&['a','b'].every(id=>queuedAfter.metadata['com.character-cards/list'].find(c=>c.id===id).visibility==='dm'),queuedAfter);await queue.close();

 const duplicate=await open({metadata:{'com.character-cards/list':[card('a','Refresh target')]}});await boot(duplicate);const chooserEvents=[];duplicate.on('filechooser',c=>chooserEvents.push(c));await duplicate.locator('#list [data-id="a"]').hover();await duplicate.locator('#list [data-id="a"] .card-refresh').click();await duplicate.waitForTimeout(30);
 if(await duplicate.locator('#list [data-id="a"] .card-refresh').isEnabled())await duplicate.locator('#list [data-id="a"] .card-refresh').click();await tick(duplicate);check('same-card refresh reserves work before file picker returns',chooserEvents.length===1,{filePickers:chooserEvents.length});
 await chooserEvents[0].setFiles(xlsx);await duplicate.waitForFunction(()=>window.panelAudit.apiCalls.length===1);
 await duplicate.locator('#list [data-id="a"]').hover();if(await duplicate.locator('#list [data-id="a"] .card-refresh').isEnabled())await duplicate.locator('#list [data-id="a"] .card-refresh').click();await tick(duplicate);const duplicatePending=await state(duplicate);check('same-card refresh while service pending does not open or send duplicate',chooserEvents.length===1&&duplicatePending.apiCalls.length===1,{filePickers:chooserEvents.length,apiCalls:duplicatePending.apiCalls});
 await duplicate.evaluate(()=>window.panelAudit.releaseAPI(0,{id:'a',name:'Refreshed target',url:'https://obr.dnd.center/characters/audit-room/a/index.html',uploader:'Fixture',uploaded_at:'2026-09-08T00:00:00Z'}));await duplicate.waitForFunction(()=>window.panelAudit.writes.length===1);await tick(duplicate);const refreshed=await capture(duplicate,'single same-card refresh completes');checkBroadcast('refreshed card from index.html server entry',refreshed,'a');await duplicate.close();

 // Include one normal aborting-fetch branch as well as the stronger late-reply cases.
 const aborting=await open({honorAbort:true});await boot(aborting);await paste(aborting);await replaceScene(aborting);await tick(aborting);const aborted=await capture(aborting,'fetch respects AbortSignal on scene change');check('honored AbortSignal ends request without extra work',aborted.apiCalls[0].aborted&&aborted.apiCalls[0].released&&aborted.writes.length===0&&aborted.broadcasts.length===0,aborted);await aborting.close();


 const ownerRevoke=await open({role:'PLAYER',playerId:'player-a',metadata:{'com.character-cards/list':[card('a','Owner target','owners',['player-a'])]}});await boot(ownerRevoke);const ownerChooser=ownerRevoke.waitForEvent('filechooser');await ownerRevoke.locator('#list [data-id="a"]').hover();await ownerRevoke.locator('#list [data-id="a"] .card-refresh').click();await(await ownerChooser).setFiles(xlsx);await ownerRevoke.waitForFunction(()=>window.panelAudit.apiCalls.length===1);
 await ownerRevoke.evaluate(()=>window.panelAudit.remote({'com.character-cards/list':[{id:'a',name:'Reassigned target',visibility:'owners',owner_ids:['player-b'],url:'/fake/a/'}]}));await ownerRevoke.evaluate(()=>window.panelAudit.releaseAPI(0,{id:'a',name:'Old refreshed name',visibility:'public',url:'/fake/a/'}));await tick(ownerRevoke);const revoked=await capture(ownerRevoke,'refresh reply after owner revoked without a role change');check('owner revocation stops metadata and broadcast after already-sent refresh',revoked.apiCalls.length===1&&revoked.apiCalls[0].aborted&&revoked.writes.length===0&&revoked.broadcasts.length===0&&revoked.rows.length===0&&revoked.metadata['com.character-cards/list'][0].owner_ids[0]==='player-b',revoked);await ownerRevoke.close();

 const newQueue=await open({holdWriteAcks:true,metadata:{'com.character-cards/list':[card('a','A')]}});await boot(newQueue);await toggleByUI(newQueue,'a');await newQueue.waitForFunction(()=>window.panelAudit.writes.length===1);await replaceScene(newQueue);await newQueue.evaluate(()=>window.panelAudit.holdWriteAcks=false);await toggleByUI(newQueue,'b');await newQueue.waitForFunction(()=>window.panelAudit.writes.length===2);const beforeOldAck=await state(newQueue);check('old-scene ACK does not block new-scene queue',!beforeOldAck.writes[0].acknowledged&&beforeOldAck.writes[1].sceneAtCall==='scene-b'&&beforeOldAck.writes[1].acknowledged,beforeOldAck.writes);await newQueue.evaluate(()=>window.panelAudit.releaseWrite(0));await tick(newQueue);const afterOldAck=await capture(newQueue,'new-scene mutation completes before old-scene ACK');check('late old ACK does not undo new-scene completed mutation',rowIds(afterOldAck)==='b'&&metadataIds(afterOldAck)==='b'&&afterOldAck.metadata['com.character-cards/list'][0].visibility==='dm',afterOldAck);await newQueue.close();

 const closeUI=await open();await boot(closeUI);await upload(closeUI);await closeUI.locator('#closeBtn').click();await closeUI.evaluate(()=>window.panelAudit.releaseAPI(0));await tick(closeUI);const closeState=await capture(closeUI,'close button remains usable during pending XLSX upload');const closedModal=await closeUI.evaluate(()=>window.panelAudit.modalCalls.some(c=>c[0]==='close'));check('busy close button closes modal and stops old upload continuation',closedModal&&closeState.apiCalls[0].aborted&&closeState.writes.length===0&&closeState.broadcasts.length===0,closeState);await closeUI.close();

 // A newer metadata snapshot can legitimately precede the initial readiness
 // reply. The earlier reading regression keeps its iframe; writes must also
 // become available once that same-scene query confirms true.
 const earlyMeta=await open({holdReady:true,activeCard:'a',metadata:{'com.character-cards/list':[card('a','Already displayed')]}});await earlyMeta.waitForFunction(()=>window.panelAudit.readyReads.length===1);await earlyMeta.evaluate(()=>window.panelAudit.emit('metadata',window.panelAudit.metadata));await tick(earlyMeta);await earlyMeta.evaluate(()=>{window.earlyFrame=document.querySelector('#viewer iframe');window.panelAudit.releaseReady()});await tick(earlyMeta);
 const earlyEnabled=await earlyMeta.locator('#btnPasteJson').isEnabled();if(earlyEnabled){await earlyMeta.locator('#btnPasteJson').click();await earlyMeta.locator('#ccPasteOverlay textarea').fill('{"identity":{"name":"After early metadata"}}');await earlyMeta.locator('#ccPasteOverlay button').last().click();}await tick(earlyMeta);const earlyWrite=await capture(earlyMeta,'new creation after metadata precedes initial ready query');const sameEarlyFrame=await earlyMeta.evaluate(()=>window.earlyFrame===document.querySelector('#viewer iframe'));check('initial ready confirmation enables writes without reloading early card',earlyEnabled&&earlyWrite.apiCalls.length===1&&sameEarlyFrame,{earlyEnabled,sameEarlyFrame,...earlyWrite});await earlyMeta.close();


 // The host data changes while notification delivery is delayed. Destructive
 // post-file-picker and post-ACK requests still need a fresh snapshot preflight.
 for(const hidden of [true,false]){
  const preflight=await open({role:'PLAYER',playerId:'player-a',metadata:{'com.character-cards/list':[card('a','Initially available')]}});await boot(preflight);const fp=preflight.waitForEvent('filechooser');await preflight.locator('#list [data-id="a"]').hover();await preflight.locator('#list [data-id="a"] .card-refresh').click();const fc=await fp;
  await preflight.evaluate(hidden=>{const m=window.panelAudit;m.metadata={'com.character-cards/list':hidden?[{id:'a',name:'Now hidden',visibility:'dm',url:'/fake/a/'}]:[]};m.scenes[m.sceneId]=structuredClone(m.metadata)},hidden);
  await fc.setFiles(xlsx);await tick(preflight);const checked=await capture(preflight,'refresh preflight discovers '+(hidden?'hidden':'missing')+' target without event');check('refresh preflight prevents POST and clears stale '+(hidden?'hidden':'missing')+' row',checked.apiCalls.length===0&&checked.writes.length===0&&checked.rows.length===0,checked);await preflight.close();
 }
 const readded=await open({holdWriteAcks:true,metadata:{'com.character-cards/list':[card('a','Deletion candidate')]}});await boot(readded);await deleteByUI(readded,'a');await readded.waitForFunction(()=>window.panelAudit.writes.length===1);
 await readded.evaluate(()=>{const m=window.panelAudit;m.metadata={'com.character-cards/list':[{id:'a',name:'Re-added while ACK pending',visibility:'public',url:'/fake/a/'}]};m.scenes[m.sceneId]=structuredClone(m.metadata);m.releaseWrite(0)});await tick(readded);const restored=await capture(readded,'delete preflight discovers card re-added without event');check('delete ACK does not issue server DELETE for a re-added card',restored.apiCalls.length===0&&metadataIds(restored)==='a'&&rowIds(restored)==='a',restored);await readded.close();


 const failedEarlyReady=await open({holdReady:true,activeCard:'a',metadata:{'com.character-cards/list':[card('a','Already displayed before ready failure')]}});await failedEarlyReady.waitForFunction(()=>window.panelAudit.readyReads.length===1);
 await failedEarlyReady.evaluate(()=>window.panelAudit.emit('metadata',window.panelAudit.metadata));await tick(failedEarlyReady);await failedEarlyReady.evaluate(()=>{window.frameBeforeReadyFailure=document.querySelector('#viewer iframe');window.panelAudit.rejectReady()});await tick(failedEarlyReady);const afterReadyFailure=await state(failedEarlyReady);const retryAvailable=await failedEarlyReady.locator('#error button').count();const sameAfterFailure=await failedEarlyReady.evaluate(()=>window.frameBeforeReadyFailure===document.querySelector('#viewer iframe'));
 check('metadata before rejected readiness still shows retry and keeps original iframe',retryAvailable===1&&afterReadyFailure.errorText.includes('Could not load')&&sameAfterFailure&&afterReadyFailure.frames.some(f=>f.id==='a'&&f.shown),afterReadyFailure);
 if(retryAvailable){await failedEarlyReady.evaluate(()=>window.panelAudit.holdReady=false);await failedEarlyReady.locator('#error button').click();await tick(failedEarlyReady);}
 const retryWriteEnabled=await failedEarlyReady.locator('#btnPasteJson').isEnabled();const sameAfterRetry=await failedEarlyReady.evaluate(()=>window.frameBeforeReadyFailure===document.querySelector('#viewer iframe'));
 if(retryWriteEnabled){await failedEarlyReady.locator('#btnPasteJson').click();await failedEarlyReady.locator('#ccPasteOverlay textarea').fill('{"identity":{"name":"After same-page readiness retry"}}');await failedEarlyReady.locator('#ccPasteOverlay button').last().click();await tick(failedEarlyReady);}
 const earlyRetryState=await capture(failedEarlyReady,'metadata before rejected initial readiness can retry and then write');check('same-page readiness retry enables creation without replacing displayed iframe',retryWriteEnabled&&sameAfterRetry&&!earlyRetryState.errorText&&earlyRetryState.apiCalls.length===1,earlyRetryState);await failedEarlyReady.close();


 for(const lang of ['en','zh']){
  const failedClose=await open({lang,rejectClose:true,metadata:{'com.character-cards/list':[card('a','A before close failure')]}});await boot(failedClose);await upload(failedClose);await failedClose.locator('#closeBtn').click();await tick(failedClose);const rejectedClose=await snap(failedClose,'close-failed-'+lang);
  check('failed close restores '+lang+' usable maximized panel and subscriptions',rejectedClose.maximized&&rejectedClose.panelOpenKey==='1'&&rejectedClose.subscriptions.player===1&&rejectedClose.subscriptions.metadata===1&&rejectedClose.subscriptions['scene-ready']===1&&rejectedClose.errorText===(lang==='en'?'Could not close the window. Please try again.':'窗口关闭失败，请再试一次。'),rejectedClose);
  await failedClose.evaluate(()=>window.panelAudit.releaseAPI(0));await tick(failedClose);const oldCloseOp=await state(failedClose);check('failed close does not revive previously canceled '+lang+' upload',oldCloseOp.apiCalls[0].aborted&&oldCloseOp.writes.length===0&&oldCloseOp.broadcasts.length===0,oldCloseOp);
  await failedClose.evaluate(()=>window.panelAudit.remote({'com.character-cards/list':[{id:'a',name:'A before close failure',visibility:'public'},{id:'remote',name:'Read event after close failure',visibility:'public'}]}));await tick(failedClose);check('failed close keeps '+lang+' metadata event handling active',rowIds(await state(failedClose))==='a,remote');
  await paste(failedClose,'New request after failed close');await snap(failedClose,'paste-creation-'+lang);await failedClose.evaluate(()=>window.panelAudit.releaseAPI(1));await failedClose.waitForFunction(()=>window.panelAudit.writes.length===1);await tick(failedClose);const closeRecovered=await capture(failedClose,'failed host modal.close recovers '+lang+' read and write UI');check('failed close permits a fresh '+lang+' creation without old continuation',metadataIds(closeRecovered)==='a,created,remote'&&closeRecovered.writes.length===1&&closeRecovered.apiCalls.length===2,closeRecovered);await failedClose.close();
 }

 for(const invalidation of ['role','failed-close']){
  const sameQueue=await open({holdWriteAcks:true,rejectClose:invalidation==='failed-close',metadata:{'com.character-cards/list':[card('a','Old GM visibility target'),card('b','Public refresh target')]}});await boot(sameQueue);await toggleByUI(sameQueue,'a');await sameQueue.waitForFunction(()=>window.panelAudit.writes.length===1);
  if(invalidation==='role')await sameQueue.evaluate(()=>window.panelAudit.changeRole('PLAYER','player-a'));else{await sameQueue.locator('#closeBtn').click();await tick(sameQueue);}
  const pendingPicker=sameQueue.waitForEvent('filechooser');await sameQueue.locator('#list [data-id="b"]').hover();await sameQueue.locator('#list [data-id="b"] .card-refresh').click();await(await pendingPicker).setFiles(xlsx);await sameQueue.waitForFunction(()=>window.panelAudit.apiCalls.length===1);await sameQueue.evaluate(()=>window.panelAudit.releaseAPI(0,{id:'b',name:'Refreshed B',url:'https://obr.dnd.center/characters/audit-room/b/index.html',uploader:'Fixture',uploaded_at:'2026-09-08T00:00:00Z'}));await tick(sameQueue);const stillWaiting=await state(sameQueue);
  check('same-scene '+invalidation+' cannot bypass pending SDK acknowledgement',stillWaiting.writes.length===1&&!stillWaiting.writes[0].acknowledged,stillWaiting.writes);
  await sameQueue.evaluate(()=>{const m=window.panelAudit;m.remote({'com.character-cards/list':[{id:'a',name:'Old GM visibility target',visibility:'dm'},{id:'b',name:'Public refresh target',visibility:'public'},{id:'remote',name:'Arrived before queue released',visibility:'public'}]});m.holdWriteAcks=false;m.releaseWrite(0)});await sameQueue.waitForFunction(()=>window.panelAudit.writes.length===2);await tick(sameQueue);const queueRecovered=await capture(sameQueue,'same-scene '+invalidation+' retains SDK write queue');
  check('same-scene '+invalidation+' queued refresh merges newest data after old ACK',metadataIds(queueRecovered)==='a,b,remote'&&queueRecovered.metadata['com.character-cards/list'].find(c=>c.id==='b').name==='Refreshed B'&&queueRecovered.writes[1].roleAtCall===(invalidation==='role'?'PLAYER':'GM'),queueRecovered);await sameQueue.close();
 }

 const escape=await open();await boot(escape);await paste(escape);await escape.keyboard.press('Escape');await tick(escape);const escaped=await state(escape);check('Escape closes only JSON overlay and keeps main panel active',(await escape.locator('#ccPasteOverlay').count())===0&&escaped.modalCalls.length===0&&escaped.maximized&&escaped.subscriptions.metadata===1,escaped);
 await escape.evaluate(()=>window.panelAudit.releaseAPI(0));await tick(escape);const escapedOld=await state(escape);check('Escape cancellation blocks old JSON response attachment',escapedOld.apiCalls[0].aborted&&escapedOld.writes.length===0&&escapedOld.broadcasts.length===0,escapedOld);
 await paste(escape,'Fresh JSON after Escape');await escape.evaluate(()=>window.panelAudit.releaseAPI(1));await escape.waitForFunction(()=>window.panelAudit.writes.length===1);await tick(escape);const afterEscape=await capture(escape,'JSON Escape cancels only overlay; fresh creation still works');check('Escape leaves main panel available for new JSON creation',afterEscape.frames.some(f=>f.id==='created'&&f.shown)&&afterEscape.modalCalls.length===0,afterEscape);await escape.close();

 // Restoring a readable metadata snapshot cannot erase the last way to
 // confirm scene readiness. Check both the opposite event order and an old
 // false reply contradicted by newer metadata; each must recover without reload.
 for (const order of ['rejection-before-metadata','false-after-metadata']) {
  const retryPage=await open({holdReady:true,ready:order!=='false-after-metadata',activeCard:'a',metadata:{'com.character-cards/list':[card('a','Readable while connection unconfirmed')]}});
  await retryPage.waitForFunction(()=>window.panelAudit.readyReads.length===1);
  await retryPage.evaluate(order=>{const m=window.panelAudit;if(order==='rejection-before-metadata')m.rejectReady();},order);
  await tick(retryPage);
  await retryPage.evaluate(()=>window.panelAudit.emit('metadata',window.panelAudit.metadata));await tick(retryPage);
  await retryPage.evaluate(order=>{window.readableFrame=document.querySelector('#viewer iframe');if(order==='false-after-metadata')window.panelAudit.releaseReady();},order);
  await tick(retryPage);const pending=await state(retryPage),hasRetry=await retryPage.locator('#error button').count();
  check(order+' retains readable card plus usable readiness retry',pending.frames.some(f=>f.id==='a'&&f.shown)&&hasRetry===1&&!(await retryPage.locator('#btnPasteJson').isEnabled()),pending);
  if(hasRetry){await retryPage.evaluate(()=>{window.panelAudit.ready=true;window.panelAudit.holdReady=false});await retryPage.locator('#error button').click();await tick(retryPage);}
  const restored=await capture(retryPage,order+' recovers without replacing readable iframe');
  check(order+' retry enables writes and preserves iframe',!restored.errorText&&(await retryPage.locator('#btnPasteJson').isEnabled())&&(await retryPage.evaluate(()=>window.readableFrame===document.querySelector('#viewer iframe'))),restored);
  await retryPage.close();
 }

 const finalHashes=Object.fromEntries(Object.keys(manifest.files).map(f=>[f,hash(readFileSync(join(repo,f)))]));
 check('product source unchanged during test',Object.keys(manifest.files).every(f=>finalHashes[f]===manifest.files[f].sha256),finalHashes);
 const result={scenarios:findings.length,pass:checks.filter(c=>c.pass).length,fail:checks.filter(c=>!c.pass).length};
 const report={manifest,finalHashes,browser:await browser.version(),result,checks,findings,limits:['No real room or API traffic','Child iframe is an inert local fixture','XLSX parser/shield reconcile is not exercised','Synthetic pagehide keeps the document alive to check explicit guards','Already-started remote POST may have committed even when its signal is aborted','Local queue tests do not establish cross-client atomicity or CAS']};
 writeFileSync(join(output,'observations.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,result,failed:checks.filter(c=>!c.pass),finalHashes},null,2));if(result.fail)process.exitCode=1;
}catch(error){writeFileSync(join(output,'incomplete.json'),JSON.stringify({error:String(error?.stack||error),findings,checks},null,2));console.error('Partial diagnostics:',output);throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
