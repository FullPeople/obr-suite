import assert from 'node:assert/strict';
import { build } from 'rolldown';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const repo = resolve(import.meta.dirname, '../../../../../..');
const output = mkdtempSync(join(tmpdir(), 'tda-stage-'));
const sourceFiles = ['index.ts', 'types.ts', 'textures.ts', 'layout.ts', 'stage-selftest.mjs'];
const sourcePins = () => Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(join(import.meta.dirname, file))).digest('hex')]));
const initialPins = sourcePins();
const mutant = process.argv.find(arg => arg.startsWith('--mutant='))?.split('=')[1];
const mutations = {
  idle: ['if (motions.size || revealCue) requestFrame();', 'requestFrame();', 'settled scene has no continuous render loop'],
  pending: ['if (pending?.cardId === id || drag?.cardId === id) continue;', 'if (drag?.cardId === id) continue;', 'projection arriving before acknowledgement keeps one pending card'],
  privacy: ['oldSelf !== nextSelf', 'false', 'changing to spectator cancels private pending mesh without waiting for an ACK'],
};
if (mutant) assert.ok(mutations[mutant], 'known bounded mutation');
let mutationApplied = false;
const runtime = process.env.CODEX_NODE_MODULES || 'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = await import(pathToFileURL(join(runtime, 'playwright/index.mjs')));
const { PNG } = (await import(pathToFileURL(join(runtime, 'pngjs/lib/png.js')))).default;
const entry = `import{mountTableStage}from ${JSON.stringify(resolve(import.meta.dirname, 'index.ts'))};
import{createGame,projectSeat,projectPublic,applyAction,card}from ${JSON.stringify(resolve(import.meta.dirname, '../rules/index.ts'))};
import{coinDenominations}from ${JSON.stringify(resolve(import.meta.dirname, 'layout.ts'))};
const canvas=document.querySelector('canvas'),quality=[];
let state=createGame({id:'webgl-stage',seed:7341,seats:[{id:'s1',name:'Aurelia'},{id:'s2',name:'Bram'},{id:'s3',name:'Cyra'},{id:'s4',name:'Dorian'}]});
let model={view:projectSeat(state,'s1'),language:'en',connected:true,legalDropZone:'ante'};let lossExtension;let surface=mountTableStage(canvas,{onQuality:q=>quality.push(q)});surface.update(model);
window.h={surface,quality,coinDenominations,get model(){return model},setModel(next){model=next;surface.update(model)},reset(){model={view:projectSeat(state,'s1'),language:'en',connected:true,animate:false};surface.update(model)},public(){model={...model,view:projectPublic(state),animate:false};surface.update(model)},
publicSameRevision(){const{selfSeatId,hand,committedAnte,actions,...view}=model.view;model={...model,view,animate:true};surface.update(model)},
visibility(value){if(value===null)delete document.hidden;else Object.defineProperty(document,'hidden',{get:()=>value,configurable:true});document.dispatchEvent(new Event('visibilitychange'))},
doAnte(){const before=projectSeat(state,'s1');let r=applyAction(state,{id:'ante-test',kind:'ante',revision:state.revision,seatId:'s1',cardId:before.hand[0].id});if(!r.ok)throw Error(r.error.code);state=r.state;model={...model,view:projectSeat(state,'s1'),animate:true};surface.update(model);return before.hand[0].id},
scene(){const view=structuredClone(projectSeat(state,'s1'));view.revision+=1;view.phase='play';view.ante=[];view.seats.forEach((s,i)=>{s.flight=[{cardId:['red-12','gold-13','blue-11','green-10'][i],card:card(['red-12','gold-13','blue-11','green-10'][i])}];s.committed=false});view.stakes=18;view.seats[0].gold-=10;view.deckCount-=2;view.hand=view.hand.filter(c=>!view.seats.some(s=>s.flight.some(f=>f.cardId===c.id)));view.discard=[card('white-1')];model={...model,view,animate:true};surface.update(model)},
remount(){surface.destroy();surface=mountTableStage(canvas,{onQuality:q=>quality.push(q)});this.surface=surface;surface.update(model)},
contextLoss(){lossExtension=canvas.getContext('webgl2').getExtension('WEBGL_lose_context');lossExtension.loseContext()},
contextRestore(){lossExtension.restoreContext()}};`;
await build({ input: 'stage-fixture', plugins: [{ name: 'stage-fixture', resolveId(id) { if (id === 'stage-fixture') return '\0stage-fixture.ts'; }, load(id) { if (id === '\0stage-fixture.ts') return entry; },
  transform(code,id) { if (!mutant || !id.replaceAll('\\','/').endsWith('/stage/index.ts')) return; code=code.replaceAll('\r\n','\n');const[from,to]=mutations[mutant];assert.equal(code.split(from).length-1,1,'mutation anchor applies exactly once');mutationApplied=true;return{code:code.replace(from,to)}; },
  buildEnd() { if(mutant) assert.ok(mutationApplied,'mutation must actually apply before execution'); }
}], output: { file: join(output, 'fixture.js'), format: 'esm' }, logLevel: 'silent' });
const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  if (request.url === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); response.end(readFileSync(join(output, 'fixture.js'))); }
  else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#181211}canvas{width:100%;height:100%;display:block}</style></head><body><canvas aria-label="Three Dragon Ante stage"></canvas><script type="module" src="/fixture.js"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const errors = [], checks = []; page.on('pageerror', error => errors.push(String(error)));
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const d = () => page.evaluate(() => h.surface.diagnostics());
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = () => page.waitForFunction(() => h.surface.diagnostics().animations === 0, undefined, { timeout: 10000 });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.h?.surface.diagnostics().frames > 0); await pause(100);
  let diag = await d(); check('actual WebGL renderer with thick mesh cards and lit table', diag.meshes > 50 && diag.drawCalls > 20 && await page.evaluate(() => h.quality[0].webgl));
  const image = PNG.sync.read(await page.screenshot({ path: join(output, 'hand-wide.png') }));
  check('vector card faces load without raster artwork requests', !requests.some(url => /\.(?:png|jpe?g|webp)(?:\?|$)|\/art\//i.test(url)));
  const palette = new Set(); for (let y = 100; y < image.height - 80; y += 8) for (let x = 80; x < image.width - 80; x += 8) { const offset = (y * image.width + x) * 4; palette.add([...image.data.subarray(offset, offset + 3)].map(c => Math.round(c / 16)).join(',')); }
  check('actual raster contains textured multicolor geometry, not an empty canvas', palette.size > 80);
  const initial = diag.frames; await pause(260); check('settled scene has no continuous render loop', (await d()).frames === initial);
  const initialFaces = await page.evaluate(() => ({ seen: h.surface.diagnostics().faceCardIds, own: h.model.view.hand.map(c => c.id) }));
  check('only private own hand has front textures on initial hidden table', initialFaces.seen.length === initialFaces.own.length && initialFaces.seen.every(id => initialFaces.own.includes(id)));
  const cardId = initialFaces.own[0]; let anchor = await page.evaluate(id => h.surface.getAnchor({ cardId: id }), cardId);
  check('own hand anchor is visible', anchor?.visible);
  const hit = await page.evaluate(p => h.surface.hitTest(p.x, p.y), anchor); check('actual Three raycaster selects own hand card', hit?.kind === 'hand' && hit.cardId === cardId);
  const zone = await page.evaluate(() => h.surface.getAnchor({ zone: 'ante', seatId: 's1' }));
  check('ante zone belongs to the self seat', (await page.evaluate(p => h.surface.hitTest(p.x, p.y), zone))?.seatId === 's1');
  await page.evaluate(({ cardId, anchor, zone }) => { h.surface.setDrag({ cardId, ...anchor }); h.surface.setDrag({ cardId, ...zone }); }, { cardId, anchor, zone }); await pause(60);
  await page.screenshot({ path: join(output, 'drag-curve.png') });
  const dragged = await page.evaluate(id => h.surface.getAnchor({ cardId: id }), cardId); check('drag changes actual card position and preserves card ID', Math.hypot(dragged.x - anchor.x, dragged.y - anchor.y) > 30);
  await page.evaluate(() => h.surface.releaseDrag({ pending: true, zone: 'ante' })); await pause(540);
  check('release waits for a real acknowledgement', (await d()).pendingCardId === cardId);
  const projectedCard = await page.evaluate(() => h.doAnte()); check('test uses the actual rules engine to commit the dragged ante', projectedCard === cardId);
  diag = await d(); check('projection arriving before acknowledgement keeps one pending card', diag.pendingCardId === cardId && diag.faceCardIds.filter(id => id === cardId).length === 1);
  await page.evaluate(() => h.surface.resolvePending(true)); await settle(); check('acknowledged ante becomes face down and clears pending', (await d()).pendingCardId === null && !(await d()).faceCardIds.includes(cardId));
  const handCard = await page.evaluate(() => h.model.view.hand[0].id);
  await page.evaluate(id => { const a = h.surface.getAnchor({ cardId: id }), z = h.surface.getAnchor({ zone: 'flight', seatId: 's1' }); h.surface.setDrag({ cardId: id, ...a }); h.surface.setDrag({ cardId: id, ...z }); h.surface.releaseDrag({ pending: true, zone: 'flight' }); }, handCard);
  await settle(); await page.evaluate(() => h.surface.resolvePending(false)); await settle();
  anchor = await page.evaluate(id => h.surface.getAnchor({ cardId: id }), handCard); check('rejected drop returns to authoritative hand location', (await page.evaluate(p => h.surface.hitTest(p.x, p.y), anchor))?.kind === 'hand');
  await page.evaluate(() => h.scene()); const flying = await d(); check('adjacent projection drives finite card and coin motions', flying.animations > 0); await pause(180); await page.screenshot({ path: join(output, 'flight-in-motion.png') });
  await settle(); await page.screenshot({ path: join(output, 'table-settled.png') }); diag = await d(); check('all flying cards and coin motions settle', diag.animations === 0); const settledFrames = diag.frames; await pause(250); check('projection animation stops rendering when complete', (await d()).frames === settledFrames);
  const gold = await page.evaluate(() => [0, 1, 30, 1000].map(value => ({ value, ...h.coinDenominations(value) }))); check('silver is exact visual change, not a new rules resource', gold.every(x => x.gold + x.silver / 10 === x.value));
  await page.evaluate(() => h.surface.gesture('s2', { gameId: h.model.view.id, revision: h.model.view.revision, count: h.model.view.seats[1].handCount, hover: 0, selected: [], sequence: 1 }));
  check('ordinal-only remote gesture lifts a hidden card', (await d()).animations > 0); await settle();
  const publicBefore = await page.evaluate(() => h.surface.diagnostics().faceCardIds.slice()); await page.evaluate(() => h.surface.gesture('s2', { gameId: 'stale', revision: h.model.view.revision, count: 6, hover: 0, selected: [], sequence: 2 }));
  check('stale gesture neither animates nor reveals a card identity', (await d()).animations === 0 && JSON.stringify((await d()).faceCardIds) === JSON.stringify(publicBefore));
  await page.evaluate(() => h.setModel({ ...h.model, reducedMotion: true, selectedCardIds: [h.model.view.hand[0].id] })); check('reduced motion snaps to selected pose without RAF animation', (await d()).animations === 0);
  await page.evaluate(() => { const view = structuredClone(h.model.view); view.revision += 12; h.setModel({ ...h.model, view, reducedMotion: false }); }); check('revision gap does not replay historical transitions', (await d()).animations === 0);
  await page.evaluate(() => h.surface.suspend()); const suspended = (await d()).frames;
  await page.evaluate(() => h.setModel({ ...h.model, language: 'zh' })); await pause(100); check('suspended scene does no GPU rendering on model update', (await d()).frames === suspended);
  await page.evaluate(() => h.surface.resume()); await pause(70); check('resume renders the latest projection', (await d()).frames > suspended);
  await page.evaluate(() => h.visibility(true)); const hiddenFrames = (await d()).frames;
  await page.evaluate(() => h.setModel({ ...h.model, language: 'en' })); await pause(80); check('document hidden signal prevents late updates from restarting rendering', (await d()).frames === hiddenFrames);
  await page.evaluate(() => h.visibility(null)); await pause(80); check('visibility restoration renders latest data', (await d()).frames > hiddenFrames);
  await page.setViewportSize({ width: 420, height: 820 }); await pause(120); await page.screenshot({ path: join(output, 'table-narrow.png') });
  check('responsive projection remains bounded at narrow size', await page.evaluate(() => h.surface.getAnchor({ zone: 'deck' }).visible));
  check('portrait hand remains in the usable foreground instead of shrinking onto the table', await page.evaluate(() => h.surface.getAnchor({ cardId: h.model.view.hand[0].id }).y > innerHeight * .7));
  await page.setViewportSize({ width: 1440, height: 960 }); await pause(100);
  const textureCount = (await d()).textures;
  await page.evaluate(() => { for (let i = 0; i < 30; i++) h.setModel({ ...h.model, language: i % 2 ? 'zh' : 'en', animate: false }); }); await pause(100);
  check('repeated localization disposes replaced card and label textures', (await d()).textures <= textureCount + 1);
  await page.evaluate(() => { const id=h.model.view.hand[0].id,a=h.surface.getAnchor({cardId:id});h.surface.setDrag({cardId:id,...a});h.surface.releaseDrag({pending:true,zone:'flight'});h.publicSameRevision(); }); await pause(80);
  check('changing to spectator cancels private pending mesh without waiting for an ACK', (await d()).pendingCardId === null && await page.evaluate(() => h.surface.diagnostics().faceCardIds.every(id=>h.model.view.seats.some(s=>s.flight.some(f=>f.cardId===id))||h.model.view.discard.some(c=>c.id===id)||h.model.view.ante.some(c=>c.id===id))));
  await page.evaluate(() => h.public()); await pause(100); check('spectator projection never retains private hand face textures', (await d()).faceCardIds.length === 0);
  await page.evaluate(() => h.contextLoss()); await pause(120); check('context loss suspends and reports unavailable', (await d()).suspended && await page.evaluate(() => h.quality.some(q => q.reason === 'context-lost')));
  await page.evaluate(() => h.contextRestore()); await pause(300); check('context restore redraws without replacing the canvas', !(await d()).suspended);
  await page.evaluate(() => h.surface.destroy()); diag = await d(); check('destroy releases every owned texture, mesh and animation', diag.destroyed && diag.textures === 0 && diag.meshes === 0 && diag.animations === 0);
  await pause(200); check('late callbacks cannot restart rendering after destroy', (await d()).frames === diag.frames);
  check('no browser application errors', errors.length === 0);
  const pins = sourcePins(); assert.deepEqual(pins, initialPins, 'source inputs stayed frozen during the browser run');
  if (mutant) throw Error(`Mutation ${mutant} survived all behavioral assertions`);
  writeFileSync(join(output, 'result.json'), JSON.stringify({ checks, count: checks.length, browser: browser.version(), renderer: 'Real Three.js WebGL via Chromium ANGLE SwiftShader; software GPU, not native Owlbear or hardware frame-time UAT. Document visibility change is an explicit synthetic lifecycle signal.', paletteSize: palette.size, errors, pins }, null, 2));
  console.log(JSON.stringify({ output, checks: checks.length, paletteSize: palette.size }));
} catch (error) { if (mutant && mutationApplied && error instanceof assert.AssertionError && error.message === mutations[mutant][2]) { writeFileSync(join(output,'mutation.json'),JSON.stringify({mutant,mutationApplied:true,killedBy:error.message,checksBeforeFailure:checks,errors},null,2));console.log(JSON.stringify({output,mutant,killedBy:error.message})); }
  else { writeFileSync(join(output, 'failure.json'), JSON.stringify({ checks, errors, error: String(error) }, null, 2)); console.error(output); throw error; } }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
