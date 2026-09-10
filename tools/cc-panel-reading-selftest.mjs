/**
 * Real panel-page.ts DOM and delayed-SDK regression checks; no room/service traffic.
 * Usage: node tools/cc-panel-reading-selftest.mjs [repository-root]
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
const output = mkdtempSync(join(tmpdir(), 'cc-panel-reading-'));
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
m.releaseRead=(index)=>{const p=m.reads[index];if(!p||p.released)throw Error('No pending read '+index);p.released=true;p.resolve(copy(p.value));};
m.rejectRead=(index)=>{const p=m.reads[index];if(!p||p.released)throw Error('No pending read '+index);p.released=true;p.reject(Error('Controlled metadata read failure'));};
m.rejectReady=()=>{const p=m.readyReads.find(p=>!p.released);p.released=true;p.reject(Error('Controlled readiness query failure'));};
m.releaseReady=()=>{const p=m.readyReads.find(p=>!p.released);p.released=true;p.resolve(p.value);};
m.changeRole=(role,id=m.playerId)=>{m.role=role;m.playerId=id;m.emit('player',{role,id,name:m.name});};
m.releaseRole=()=>{const p=m.roles.find(p=>!p.released);p.released=true;p.resolve(p.value);};
const OBR={
 onReady(cb){queueMicrotask(()=>Promise.resolve(cb()).then(()=>m.booted=true).catch(e=>m.errors.push(String(e))))},
 room:{get id(){return m.roomId}},
 player:{getName:async()=>m.name,getId:async()=>m.playerId,getRole:()=>{const value=m.role;return m.holdRole?new Promise(resolve=>m.roles.push({value,resolve,released:false})):Promise.resolve(value)},onChange:cb=>listen('player',cb)},
 party:{getPlayers:async()=>copy(m.players),onChange:cb=>listen('party',cb)},
 scene:{isReady:()=>{const value=m.ready;return m.holdReady?new Promise((resolve,reject)=>m.readyReads.push({value,resolve,reject,released:false})):Promise.resolve(value)},onReadyChange:cb=>listen('scene-ready',cb),
  getMetadata(){const value=copy(m.metadata),index=m.reads.length;return new Promise((resolve,reject)=>{m.reads.push({value,resolve,reject,released:!m.holdReads});if(!m.holdReads)resolve(value)})},
  async setMetadata(value){m.writes.push(copy(value));m.metadata={...m.metadata,...copy(value)};m.emit('metadata',m.metadata)},
  onMetadataChange:cb=>listen('metadata',cb)},
 modal:{open:async value=>m.modalCalls.push(['open',copy(value)]),close:async value=>m.modalCalls.push(['close',value])},
 broadcast:{sendMessage:async(...args)=>m.broadcasts.push(copy(args)),onMessage:(name,cb)=>listen('broadcast:'+name,cb)},
 notification:{show:async message=>m.notifications.push(message)}
};
window.fetch=async (input,init={})=>{m.fetches.push({url:String(input),method:init.method||'GET'});return new Response(JSON.stringify({success:false,error:'Isolated audit: no API traffic'}),{status:503,headers:{'Content-Type':'application/json'}})};
export default OBR;`;
const language = `export const getLocalLang=()=>window.panelAudit.lang;
export const onLangChange=cb=>{window.panelAudit.langListeners.add(cb);return()=>window.panelAudit.langListeners.delete(cb)};
window.changePanelLang=lang=>{window.panelAudit.lang=lang;for(const cb of window.panelAudit.langListeners)cb(lang)};`;
await build({ input: join(repo, 'src/modules/characterCards/panel-page.ts'),
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

const html = readFileSync(join(repo, 'cc-panel.html'), 'utf8').replace(/<script type="module"[^>]*><\/script>/g, '<script src="/panel.js"></script>');
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
      modalCalls: [], broadcasts: [], notifications: [], booted: false, holdReads: false, holdRole: false, holdReady: false, ...options };
    if (options.activeCard) localStorage.setItem('character-cards/state/audit-room', JSON.stringify({ activeCardId: options.activeCard, scrollY: 0, maximized: true }));
  }, { options, list });
  await page.goto(origin + '/panel');
  return page;
}
async function boot(page) { await page.waitForFunction(() => window.panelAudit.booted || window.panelAudit.errors.length); const errors = await page.evaluate(() => window.panelAudit.errors); if (errors.length) throw Error(errors.join('\n')); await tick(page); }
async function state(page) { return page.evaluate(() => ({
  rows: [...document.querySelectorAll('#list .card')].map(e => ({ id: e.dataset.id, name: e.querySelector('.card-name')?.textContent, sub: e.querySelector('.card-sub')?.textContent, visTitle: e.querySelector('.card-vis')?.title })),
  frames: [...document.querySelectorAll('#viewer iframe')].map(e => ({ id: e.dataset.id, shown: getComputedStyle(e).display !== 'none', src: e.src })),
  readyListeners: window.panelAudit.listeners['scene-ready']?.size || 0, metadataListeners: window.panelAudit.listeners.metadata?.size || 0,
  subscriptions: Object.fromEntries(Object.entries(window.panelAudit.listeners).map(([k,v])=>[k,v.size])), langSubscriptions: window.panelAudit.langListeners.size, readCount: window.panelAudit.reads.length, readyReadCount: window.panelAudit.readyReads.length, errorText: document.querySelector('#error')?.textContent, errorButtons: [...document.querySelectorAll('#error button')].map(e=>e.textContent), listHint: document.querySelector('#list .empty-list')?.textContent, role: window.panelAudit.role, emptyText: document.querySelector('#emptyText')?.textContent,
  writes: window.panelAudit.writes, fetches: window.panelAudit.fetches, errors: window.panelAudit.errors
})); }
async function snap(page, name) { await page.screenshot({ path: join(output, name + '.png') }); return state(page); }
async function tick(page) { await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30))); }
const checks=[];
function check(name,pass,details){checks.push({name,pass:!!pass,details});}
const ids=s=>s.rows.map(r=>r.id).sort().join(',');
const visible=s=>s.frames.filter(f=>f.shown).map(f=>f.id).sort().join(',');
async function layout(page){return page.evaluate(()=>{
 const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
 const close=document.querySelector('#closeBtn'),head=document.querySelector('.side-head');
 const cr=close.getBoundingClientRect();
 return{viewport:innerWidth,side:rect(document.querySelector('.side')),head:rect(head),close:rect(close),title:rect(head.querySelector('.title')),titleText:head.querySelector('.title').textContent,
 links:[...document.querySelectorAll('#ccTplRow a')].map(e=>({text:e.textContent,title:e.title,href:e.href,download:e.download,display:getComputedStyle(e).display,rect:rect(e)})),templateRowDisplay:getComputedStyle(document.querySelector('#ccTplRow')).display,
 closeHit:document.elementFromPoint(cr.x+cr.width/2,cr.y+cr.height/2)?.id};});}
function checkLayout(name,l){
 check(name+': close within side and hittable',l.close.right<=l.side.right+0.1&&l.close.x>=l.side.x&&l.closeHit==='closeBtn',l);
 check(name+': both downloads visible within header',l.links.length===2&&l.links.every(a=>a.display!=='none'&&a.rect.width>0&&a.rect.x>=l.side.x&&a.rect.right<=l.side.right+0.1&&a.rect.bottom<=l.head.bottom+0.1),l.links);
 check(name+': title separate from downloads and close',l.title.right<=l.close.x+0.1&&l.links.every(a=>a.rect.y>=l.close.bottom-0.1),l);
}
try{
 browser=await chromium.launch({headless:true,...(browserPath?{executablePath:browserPath}:{})});
 const page=await open();await boot(page);
 for(const lang of ['en','zh']){
  await page.evaluate(lang=>window.changePanelLang(lang),lang);const l=await layout(page),s=await snap(page,'downloads-'+lang+'-1280');
  findings.push({scenario:'downloads-'+lang,layout:l,state:s});checkLayout('downloads-'+lang,l);
  check('downloads-'+lang+': resolved bilingual labels',l.links.every(a=>!a.text.includes('ccPanel')&&a.title&&!a.title.includes('ccPanel'))&&(lang!=='en'||l.links.every(a=>a.text.includes('Chinese')&&a.title.includes('Chinese')&&!/[\u3400-\u9fff]/.test(a.text))),l.links);
 }
 await page.evaluate(()=>window.changePanelLang('en'));await page.setViewportSize({width:520,height:700});
 const narrowLayout=await layout(page);findings.push({scenario:'narrow-520',layout:narrowLayout,state:await snap(page,'downloads-en-520')});checkLayout('narrow-520',narrowLayout);
 const ownersBefore=await state(page);await page.locator('[data-id="p"] .card-vis').click();await tick(page);const ownersAfter=await snap(page,'owners-after-click');
 findings.push({scenario:'owners-toggle-first-click',before:ownersBefore,state:ownersAfter});
 const ownerRow=ownersBefore.rows.find(r=>r.id==='p');check('owners tooltip describes actual next DM-only state',ownerRow.visTitle.includes('DMs and assigned players')&&ownerRow.visTitle.includes('DM')&&!ownerRow.visTitle.includes('Make public')&&ownersAfter.writes.at(-1)['com.character-cards/list'].find(c=>c.id==='p').visibility==='dm',{before:ownerRow,write:ownersAfter.writes.at(-1)});
 await page.close();
 const fast=await open({activeCard:'a'});await boot(fast);await fast.locator('#list [data-id="p"]').click();await fast.locator('#list [data-id="a"]').click();const fs=await state(fast);
 findings.push({scenario:'fast-card-selection-A-B-A',state:fs});check('A-B-A: only final A visible',visible(fs)==='a',fs.frames);
 await fast.evaluate(()=>window.panelAudit.changeRole('PLAYER','player-a'));await tick(fast);const ds=await state(fast);findings.push({scenario:'ordinary-GM-demotion',state:ds});check('GM demotion applies visibility and hides visibility controls',ids(ds)==='a,p'&&ds.rows.every(r=>!r.visTitle),ds);
 await fast.close();
 const early=await open({holdRole:true});await early.waitForFunction(()=>window.panelAudit.roles.length===1);await early.evaluate(()=>{window.panelAudit.changeRole('PLAYER','player-a');window.panelAudit.releaseRole()});await boot(early);const es=await snap(early,'initial-role-race');findings.push({scenario:'demotion-during-initial-role-read',state:es});check('delayed old GM profile cannot undo PLAYER role event',ids(es)==='a,p'&&es.rows.every(r=>!r.visTitle),es);await early.close();
 const missed=await open({holdReads:true});await missed.waitForFunction(()=>window.panelAudit.reads.length===1);const listenersAtEvent=await missed.evaluate(()=>window.panelAudit.listeners.metadata?.size||0);
 await missed.evaluate(()=>{const m=window.panelAudit;m.metadata={'com.character-cards/list':[{id:'new',name:'New scene card',visibility:'public',uploader:'New author',uploaded_at:'2026-09-08T00:00:00Z'}]};m.emit('metadata',m.metadata);m.releaseRead(0)});await boot(missed);const ms=await snap(missed,'initial-metadata-race');findings.push({scenario:'metadata-event-during-initial-read',listenersAtEvent,state:ms});check('metadata subscribed before first read; newer event survives old read',listenersAtEvent===1&&ids(ms)==='new',ms);await missed.close();
 // The frozen code consumes full metadata event snapshots. Preserve the old
 // event sequence, then separately hold an initial read to exercise rollback.
 const revoke=await open({role:'PLAYER',playerId:'player-a',activeCard:'a',metadata:{'com.character-cards/list':[card('a','Owned secret','owners',['player-a'])]}});await boot(revoke);
 const beforeRevoke=await state(revoke);await revoke.evaluate(()=>{const m=window.panelAudit;m.holdReads=true;m.emit('metadata',m.metadata);m.metadata={'com.character-cards/list':[{id:'a',name:'Owned secret',visibility:'dm',owner_ids:[],uploader:'Fixture author',uploaded_at:'2026-09-08T00:00:00Z'}]};m.emit('metadata',m.metadata)});await tick(revoke);const afterRevocation=await snap(revoke,'revocation-rollback');
 findings.push({scenario:'older-authorized-read-after-newer-revocation',adaptation:'Same two metadata events as baseline; current implementation applies snapshots without redundant reads. Delayed initial-read rollback is covered separately.',before:beforeRevoke,afterRevocation});check('direct revocation removes list and iframe without extra reads',visible(beforeRevoke)==='a'&&afterRevocation.rows.length===0&&afterRevocation.frames.length===0&&afterRevocation.readCount===1,afterRevocation);await revoke.close();
 const scene=await open({activeCard:'a'});await boot(scene);await scene.evaluate(()=>{const m=window.panelAudit;m.ready=false;m.emit('scene-ready',false)});await tick(scene);const whileClosed=await state(scene);
 await scene.evaluate(()=>{const m=window.panelAudit;m.metadata={};m.ready=true;m.emit('scene-ready',true);m.emit('metadata',{})});await tick(scene);const afterEmptyScene=await snap(scene,'empty-scene-stale-list');check('closed scene tells player to open a scene in both areas',whileClosed.emptyText==='Open a scene to view character cards.'&&whileClosed.listHint===whileClosed.emptyText,whileClosed);findings.push({scenario:'scene-close-then-empty-scene',whileClosed,afterEmptyScene});check('scene close and empty replacement remove rows and iframe',[whileClosed,afterEmptyScene].every(s=>!s.rows.length&&!s.frames.length),{whileClosed,afterEmptyScene});await scene.close();

 // Additional frozen-candidate regression scenarios.
 const pendingRevoke=await open({role:'PLAYER',playerId:'player-a',activeCard:'a',holdReads:true,metadata:{'com.character-cards/list':[card('a','Owned secret','owners',['player-a'])]}});await pendingRevoke.waitForFunction(()=>window.panelAudit.reads.length===1);
 await pendingRevoke.evaluate(()=>window.panelAudit.emit('metadata',window.panelAudit.metadata));await tick(pendingRevoke);const authorized=await state(pendingRevoke);
 await pendingRevoke.evaluate(()=>{const m=window.panelAudit;m.metadata={'com.character-cards/list':[{id:'a',name:'Owned secret',visibility:'dm',owner_ids:[]}]};m.emit('metadata',m.metadata)});await tick(pendingRevoke);const revoked=await state(pendingRevoke);await pendingRevoke.evaluate(()=>window.panelAudit.releaseRead(0));await boot(pendingRevoke);const oldReleased=await state(pendingRevoke);
 findings.push({scenario:'pending-initial-authorized-read-after-revocation',authorized,revoked,oldReleased});check('pending authorized read cannot revive revoked iframe',visible(authorized)==='a'&&[revoked,oldReleased].every(s=>!s.rows.length&&!s.frames.length),{authorized,revoked,oldReleased});await pendingRevoke.close();

 for(const delayed of ['profile','metadata']){
  const saved=await open({role:'PLAYER',playerId:'player-a',activeCard:'p',holdRole:delayed==='profile',holdReads:delayed==='metadata'});
  await saved.waitForFunction(delayed=>delayed==='profile'?window.panelAudit.roles.length===1:window.panelAudit.reads.length===1,delayed);await tick(saved);const before=await state(saved);
  await saved.evaluate(delayed=>delayed==='profile'?window.panelAudit.releaseRole():window.panelAudit.releaseRead(0),delayed);await boot(saved);const after=await state(saved);
  findings.push({scenario:'initial-selection-restored-after-'+delayed,before,after});check('saved authorized selection waits for '+delayed+' then restores',before.frames.length===0&&visible(after)==='p'&&ids(after)==='a,p',{before,after});await saved.close();
 }
 const denied=await open({role:'PLAYER',playerId:'player-a',activeCard:'d'});await boot(denied);const deniedState=await state(denied);findings.push({scenario:'initial-forbidden-selection-not-restored',state:deniedState});check('saved DM card cannot create player iframe',deniedState.frames.length===0&&ids(deniedState)==='a,p',deniedState);await denied.close();

 for(const lang of ['en','zh']){
  const retry=await open({lang,holdReads:true,activeCard:'a'});await retry.waitForFunction(()=>window.panelAudit.reads.length===1);await retry.evaluate(()=>window.panelAudit.rejectRead(0));await tick(retry);const failed=await snap(retry,'read-error-'+lang);
  check('failed metadata read is distinguished from empty cards ('+lang+')',failed.listHint===''&&failed.emptyText===(lang==='en'?'Could not load the character card list.':'角色卡列表读取失败。'),failed);check('load failure offers '+lang+' retry',failed.errorButtons.length===1&&failed.errorButtons[0]===(lang==='en'?'Retry':'重试')&&failed.frames.length===0,failed);
  await retry.evaluate(()=>window.panelAudit.holdReads=false);await retry.locator('#error button').click();await tick(retry);const recovered=await state(retry);findings.push({scenario:'read-failure-same-page-retry-'+lang,failed,recovered});check('same-page '+lang+' retry restores original selection',recovered.readCount===2&&ids(recovered)==='a,d,p'&&visible(recovered)==='a'&&!recovered.errorText,{failed,recovered});await retry.close();
 }
 const deletion=await open({activeCard:'a'});await boot(deletion);await deletion.evaluate(()=>{const m=window.panelAudit;m.metadata={};m.emit('metadata',{})});await tick(deletion);const deleted=await state(deletion);findings.push({scenario:'metadata-key-deleted-with-scene-still-ready',state:deleted});check('deleted entire list key removes rows and frames',deleted.rows.length===0&&deleted.frames.length===0,deleted);await deletion.close();

 const unload=await open({holdReads:true,holdRole:true,activeCard:'a'});await unload.waitForFunction(()=>window.panelAudit.reads.length===1&&window.panelAudit.roles.length===1);const beforeUnload=await state(unload);await unload.evaluate(()=>{dispatchEvent(new Event('pagehide'));window.panelAudit.releaseRead(0);window.panelAudit.releaseRole()});await tick(unload);const afterUnload=await state(unload);
 // Send every now-unsubscribed authoritative event after unload as a probe.
 await unload.evaluate(()=>{const m=window.panelAudit;m.changeRole('GM');m.emit('metadata',m.metadata);m.emit('scene-ready',true);window.changePanelLang('zh')});await tick(unload);const afterLateEvents=await state(unload);
 findings.push({scenario:'pagehide-invalidates-old-responses-and-unsubscribes',beforeUnload,afterUnload,afterLateEvents});check('role metadata scene and language initially subscribed',beforeUnload.subscriptions.player===1&&beforeUnload.subscriptions.metadata===1&&beforeUnload.subscriptions['scene-ready']===1&&beforeUnload.langSubscriptions===1,beforeUnload.subscriptions);check('pagehide clears every SDK and language subscription',Object.values(afterUnload.subscriptions).every(n=>n===0)&&afterUnload.langSubscriptions===0,afterUnload);check('late pagehide reads and events cannot construct iframe',[afterUnload,afterLateEvents].every(s=>s.rows.length===0&&s.frames.length===0),{afterUnload,afterLateEvents});await unload.close();

 const switcher=await open({holdReads:true,activeCard:'a'});await switcher.waitForFunction(()=>window.panelAudit.reads.length===1);await switcher.evaluate(()=>{const m=window.panelAudit;m.ready=false;m.emit('scene-ready',false);m.metadata={'com.character-cards/list':[{id:'b',name:'Next scene only',visibility:'public'}]};m.ready=true;m.emit('scene-ready',true)});await switcher.waitForFunction(()=>window.panelAudit.reads.length===2);await switcher.evaluate(()=>window.panelAudit.releaseRead(1));await tick(switcher);const newer=await state(switcher);await switcher.evaluate(()=>window.panelAudit.releaseRead(0));await tick(switcher);const older=await state(switcher);findings.push({scenario:'cross-scene-delayed-metadata-cannot-roll-back',newer,older});check('new scene survives older scene read',ids(newer)==='b'&&ids(older)==='b'&&older.frames.length===0,{newer,older});await switcher.close();

 const readiness=await open({holdReady:true,activeCard:'a'});await readiness.waitForFunction(()=>window.panelAudit.readyReads.length===1);await readiness.evaluate(()=>{const m=window.panelAudit;m.ready=false;m.emit('scene-ready',false);m.releaseReady()});await tick(readiness);const readyAfter=await state(readiness);findings.push({scenario:'old-isReady-true-cannot-reopen-closed-scene',state:readyAfter});check('delayed readiness query cannot reopen scene after false event',!readyAfter.rows.length&&!readyAfter.frames.length&&readyAfter.readCount===0,readyAfter);await readiness.close();

 const hidden=await open({activeCard:'a',role:'PLAYER',playerId:'player-a'});await boot(hidden);await hidden.locator('#list [data-id="p"]').click();await hidden.locator('#list [data-id="a"]').click();const hiddenBefore=await state(hidden);await hidden.evaluate(()=>{const m=window.panelAudit;m.metadata={'com.character-cards/list':m.metadata['com.character-cards/list'].filter(c=>c.id!=='p')};m.emit('metadata',m.metadata)});await tick(hidden);const hiddenAfter=await state(hidden);findings.push({scenario:'delete-background-cached-iframe',before:hiddenBefore,after:hiddenAfter});check('delete hidden cached iframe while active card remains',hiddenBefore.frames.length===2&&hiddenAfter.frames.length===1&&visible(hiddenAfter)==='a',hiddenAfter);await hidden.close();


 const failReady=await open({holdReady:true,activeCard:'a'});await failReady.waitForFunction(()=>window.panelAudit.readyReads.length===1);await failReady.evaluate(()=>window.panelAudit.rejectReady());await tick(failReady);const failedReady=await state(failReady);
 await failReady.evaluate(()=>window.changePanelLang('zh'));const readyErrorZh=await snap(failReady,'readiness-error-zh');await failReady.evaluate(()=>window.changePanelLang('en'));const readyErrorEn=await snap(failReady,'readiness-error-en');
 check('failed readiness is distinguished from empty cards',failedReady.listHint===''&&failedReady.emptyText==='Could not load the character card list.',failedReady);check('readiness failure gives in-page retry and no false empty success',failedReady.errorButtons[0]==='Retry'&&failedReady.readCount===0&&failedReady.frames.length===0,failedReady);
 check('switching error language updates text without executing retry',readyErrorZh.errorButtons[0]==='重试'&&/[\u3400-\u9fff]/.test(readyErrorZh.errorText)&&readyErrorEn.errorButtons[0]==='Retry'&&!/[\u3400-\u9fff]/.test(readyErrorEn.errorText)&&readyErrorEn.readyReadCount===1&&readyErrorEn.readCount===0,{readyErrorZh,readyErrorEn});
 await failReady.evaluate(()=>window.panelAudit.holdReady=false);await failReady.locator('#error button').click();await tick(failReady);const readyRecovered=await state(failReady);findings.push({scenario:'initial-isReady-rejection-can-retry-without-ready-event',failedReady,readyErrorZh,readyErrorEn,readyRecovered});check('readiness retry restores saved card in same page',ids(readyRecovered)==='a,d,p'&&visible(readyRecovered)==='a'&&!readyRecovered.errorText&&readyRecovered.readCount===1,readyRecovered);await failReady.close();

 const readyEventRecovery=await open({holdReady:true,activeCard:'a'});await readyEventRecovery.waitForFunction(()=>window.panelAudit.readyReads.length===1);await readyEventRecovery.evaluate(()=>window.panelAudit.rejectReady());await tick(readyEventRecovery);await readyEventRecovery.evaluate(()=>window.panelAudit.emit('metadata',window.panelAudit.metadata));await tick(readyEventRecovery);const recoveredByMetadata=await state(readyEventRecovery);findings.push({scenario:'rejected-readiness-accepts-metadata-but-retains-connection-retry',state:recoveredByMetadata});check('metadata restores reading while unconfirmed scene retains retry',ids(recoveredByMetadata)==='a,d,p'&&visible(recoveredByMetadata)==='a'&&recoveredByMetadata.errorButtons[0]==='Retry',recoveredByMetadata);await readyEventRecovery.close();

 for(const late of ['success','rejection','first-ready-event']){
  const noRebuild=await open({holdReady:true,activeCard:'a'});await noRebuild.waitForFunction(()=>window.panelAudit.readyReads.length===1);await noRebuild.evaluate(()=>window.panelAudit.emit('metadata',window.panelAudit.metadata));await tick(noRebuild);const beforeLate=await state(noRebuild);
  await noRebuild.evaluate(()=>{window.savedFrameNode=document.querySelector('#viewer iframe');window.iframeMutations=[];new MutationObserver(rs=>{for(const r of rs){for(const n of [...r.addedNodes,...r.removedNodes])if(n.nodeName==='IFRAME')window.iframeMutations.push(n.dataset.id)}}).observe(document.querySelector('#viewer'),{childList:true})});
  await noRebuild.evaluate(late=>{const m=window.panelAudit;if(late==='first-ready-event'){m.emit('scene-ready',true);m.releaseReady()}else if(late==='success')m.releaseReady();else m.rejectReady()},late);await tick(noRebuild);const afterLate=await state(noRebuild);const identity=await noRebuild.evaluate(()=>({sameNode:window.savedFrameNode===document.querySelector('#viewer iframe'),mutations:window.iframeMutations}));findings.push({scenario:'metadata-before-slow-isReady-'+late,beforeLate,afterLate,identity});check('late readiness '+late+' cannot reload early authoritative iframe',visible(beforeLate)==='a'&&visible(afterLate)==='a'&&identity.sameNode&&identity.mutations.length===0&&afterLate.readCount===0,{beforeLate,afterLate,identity});check('late readiness '+late+' has the correct retry state',late==='rejection'?afterLate.errorButtons[0]==='Retry':!afterLate.errorText,afterLate);await noRebuild.close();
 }

 const firstReady=await open({holdReady:true,activeCard:'a'});await firstReady.waitForFunction(()=>window.panelAudit.readyReads.length===1);await firstReady.evaluate(()=>window.panelAudit.emit('scene-ready',true));await tick(firstReady);const beforeLateReady=await state(firstReady);await firstReady.evaluate(()=>window.panelAudit.releaseReady());await tick(firstReady);const afterLateReady=await state(firstReady);findings.push({scenario:'first-ready-event-before-initial-ready-query',beforeLateReady,afterLateReady});check('first ready true retains authorized saved card selection',visible(beforeLateReady)==='a'&&visible(afterLateReady)==='a',{beforeLateReady,afterLateReady});await firstReady.close();

 const four=['src/modules/characterCards/panel-page.ts','cc-panel.html','src/i18n.ts','src/settings.ts'];
 const finalHashes=Object.fromEntries(four.map(f=>[f,hash(readFileSync(join(repo,f)))]));
 check('all four product files remained unchanged during the test',four.every(f=>finalHashes[f]===manifest.files[f].sha256),finalHashes);
 for(const f of findings){for(const v of Object.values(f)){if(v&&typeof v==='object'&&Array.isArray(v.errors))check(f.scenario+': no script errors',v.errors.length===0,v.errors)}}
 const summary={manifest,finalHashes,harness:{browser:await browser.version(),actualPanelSource:true,actualI18nAndHtml:true,mocked:['OBR SDK','local language subscription','unused shield reconciliation','child card iframe HTML'],APItraffic:'window.fetch replaced; all external routes blocked',sourceFrozenForReview:false,SDKcontract:'Installed scene.isReady(): Promise<boolean>; onReadyChange(boolean), onMetadataChange(full Metadata), player.onChange(Player); all return unsubscribers.',resources:'RESOURCES is empty; no external-resource performance claim'},findings,checks,result:{scenarios:findings.length,pass:checks.filter(c=>c.pass).length,fail:checks.filter(c=>!c.pass).length}};
 writeFileSync(join(output,'observations.json'),JSON.stringify(summary,null,2));
 console.log(JSON.stringify({output,result:summary.result,failed:checks.filter(c=>!c.pass),finalHashes},null,2));
 if(summary.result.fail)process.exitCode=1;
}catch(error){writeFileSync(join(output,'failure.json'),JSON.stringify({error:String(error?.stack||error),findings,checks},null,2));throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
