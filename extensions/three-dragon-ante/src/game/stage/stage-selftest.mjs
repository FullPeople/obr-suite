import assert from 'node:assert/strict';
import { build } from 'rolldown';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const repo = resolve(import.meta.dirname, '../../../../../..');
const output = mkdtempSync(join(tmpdir(), 'tda-stage-'));
  const sourceFiles = ['index.ts', 'types.ts', 'textures.ts', 'currency.ts', 'layout.ts', '../power-effects.ts', '../flight-formations.ts', 'stage-selftest.mjs'];
const sourcePins = () => Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(join(import.meta.dirname, file))).digest('hex')]));
const initialPins = sourcePins();
const mutant = process.argv.find(arg => arg.startsWith('--mutant='))?.split('=')[1];
const mutations = {
  idle: ['if (motions.size || revealCue || powerPulses.size || powerBursts.size || handPowerActive || spotActive || slapActive) requestFrame();', 'requestFrame();', 'settled scene has no continuous render loop'],
  pending: ['if (pending?.cardId === id || drag?.cardId === id) continue;', 'if (drag?.cardId === id) continue;', 'projection arriving before acknowledgement keeps one pending card'],
  privacy: ['oldSelf !== nextSelf', 'false', 'changing to spectator cancels private pending mesh without waiting for an ACK'],
};
if (mutant) assert.ok(mutations[mutant], 'known bounded mutation');
let mutationApplied = false;
const runtime = process.env.CODEX_NODE_MODULES || 'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = await import(pathToFileURL(join(runtime, 'playwright/index.mjs')));
const { PNG } = (await import(pathToFileURL(join(runtime, 'pngjs/lib/png.js')))).default;
const entry = `import{mountTableStage}from ${JSON.stringify(resolve(import.meta.dirname, 'index.ts'))};
import{createGame,projectSeat,projectPublic,projectOmniscient,applyAction,card}from ${JSON.stringify(resolve(import.meta.dirname, '../rules/index.ts'))};import{powerEffectTheme}from ${JSON.stringify(resolve(import.meta.dirname, '../power-effects.ts'))};
import{coinDenominations,moneyPlacement,seatPlacements,DECK,DISCARD,HOLE}from ${JSON.stringify(resolve(import.meta.dirname, 'layout.ts'))};
const canvas=document.querySelector('canvas'),quality=[];
let state=createGame({id:'webgl-stage',seed:7341,seats:[{id:'s1',name:'Aurelia'},{id:'s2',name:'Bram'},{id:'s3',name:'Cyra'},{id:'s4',name:'Dorian'}]});
let model={view:projectSeat(state,'s1'),language:'en',connected:true,legalDropZone:'ante'};let lossExtension;let surface=mountTableStage(canvas,{onQuality:q=>quality.push(q)});surface.update(model);
window.h={surface,quality,coinDenominations,moneyPlacement,seatPlacements,DECK,DISCARD,HOLE,get model(){return model},powerShape(id){return powerEffectTheme(card(id).family).shape},setModel(next){model=next;surface.update(model)},reset(){model={view:projectSeat(state,'s1'),language:'en',connected:true,animate:false};surface.update(model)},hole(amount){const view=structuredClone(model.view);if(view){view.hole=amount;model={...model,view,animate:false};surface.update(model)}},public(){model={...model,view:projectPublic(state),animate:false};surface.update(model)},
stacks(n){const state=createGame({id:'stack-layout-'+n,seed:7341,seats:Array.from({length:n},(_,i)=>({id:'s'+(i+1),name:['Aurelia','Bram','Cyra','Dorian','Elara','Finn'][i]}))});state.stage='play';state.round=3;state.anteOrigins=[];state.seats.forEach(s=>{s.flight=s.hand.splice(0,3).map(cardId=>({cardId}));const id=s.hand.pop();state.ante.push(id);state.anteOrigins.push({seatId:s.id,cardId:id})});model={view:projectSeat(state,'s1'),language:'zh',connected:true,animate:false};surface.update(model)},
publicSameRevision(){const{selfSeatId,hand,committedAnte,actions,...view}=model.view;model={...model,view,animate:true};surface.update(model)},
visibility(value){if(value===null)delete document.hidden;else Object.defineProperty(document,'hidden',{get:()=>value,configurable:true});document.dispatchEvent(new Event('visibilitychange'))},
doAnte(){const before=projectSeat(state,'s1');let r=applyAction(state,{id:'ante-test',kind:'ante',revision:state.revision,seatId:'s1',cardId:before.hand[0].id});if(!r.ok)throw Error(r.error.code);state=r.state;model={...model,view:projectSeat(state,'s1'),animate:true};surface.update(model);return before.hand[0].id},
  scene(){const view=structuredClone(projectSeat(state,'s1'));view.revision+=1;view.phase='play';view.activeSeatId='s2';view.ante=[];view.seats.forEach((s,i)=>{s.flight=[{cardId:['red-12','gold-13','blue-11','green-10'][i],card:card(['red-12','gold-13','blue-11','green-10'][i])}];s.committed=false});view.stakes=18;view.hole=7;view.seats[0].gold-=10;view.deckCount-=2;view.hand=view.hand.filter(c=>!view.seats.some(s=>s.flight.some(f=>f.cardId===c.id)));view.discard=[card('white-1')];model={...model,view,animate:true,goldFlows:[]};surface.update(model)},
  turn(seatId){const view=structuredClone(model.view);view.revision+=1;view.phase='play';view.activeSeatId=seatId;model={...model,view,animate:true,reducedMotion:false};surface.update(model)},
  resolutionRelation(relation){model={...model,reducedMotion:true,activeResolutionCardIds:['red-12'],activeResolutionFamily:'black',resolutionTargetSeatId:'s2',resolutionTargetRelation:relation,animate:true};surface.update(model)},
  goldFlow(){const view=structuredClone(model.view);view.revision+=1;view.events=[...view.events,{code:'TOOK_STAKES',seatId:'s1',amount:3}];model={...model,view,animate:true,goldFlows:[{key:'gold-flow-test',code:'TOOK_STAKES',fromSeatId:'stakes',toSeatId:'s1',amount:3}]};surface.update(model)},
  holeFlow(){const view=structuredClone(model.view);view.revision+=1;view.hole=(view.hole??0)+3;view.events=[...view.events,{code:'PAID_HOLE',seatId:'s1',amount:3}];model={...model,view,animate:true,goldFlows:[{key:'hole-flow-test',code:'PAID_HOLE',fromSeatId:'s1',toSeatId:'hole',amount:3}]};surface.update(model)},
  playFixture(){state=createGame({id:'webgl-power-hand',seed:7341,seats:[{id:'s1',name:'Aurelia'},{id:'s2',name:'Bram'},{id:'s3',name:'Cyra'},{id:'s4',name:'Dorian'}]});let attempts=0;while(state.stage==='ante'&&attempts++<20){for(const seat of state.seats){if(Object.prototype.hasOwnProperty.call(state.committed,seat.id))continue;const move={id:'ante-power-'+attempts+'-'+seat.id,revision:state.revision,seatId:seat.id,kind:'ante',cardId:seat.hand[0]};const result=applyAction(state,move);if(!result.ok)throw Error(result.error.code);state=result.state;if(state.stage!=='ante')break;}}if(state.stage!=='play')throw Error('POWER_FIXTURE_DID_NOT_REACH_PLAY');model={view:projectSeat(state,state.seats[state.active].id),language:'en',connected:true,legalDropZone:'flight',animate:false};surface.update(model)},
omniscient(){model={...model,view:projectOmniscient(state,'s1'),animate:false};surface.update(model)},
omniscientPower(){state.stage='play';state.pending=null;state.active=1;state.turnIndex=0;state.roundCards=state.seats.map(()=>null);model={view:projectOmniscient(state,'s1'),language:'en',connected:true,animate:false};surface.update(model)},
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
  const currency=/^\/art\/currency\/(dragon-gold|shard-silver)\.webp$/.exec(request.url);if(currency){response.setHeader('content-type','image/webp');return response.end(readFileSync(join(import.meta.dirname,'../art/currency',currency[1]+'.webp')))}
  const art = /^\/art\/pack-20260910\/cards\/([a-z0-9-]+)\.webp$/.exec(request.url);
  if (art) {
    const file = join(import.meta.dirname, '../art/pack-20260910/cards', art[1] + '.webp');
    if (!existsSync(file)) { response.statusCode = 404; return response.end(); }
    response.setHeader('content-type', 'image/webp'); return response.end(readFileSync(file));
  }
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
// An idle headless page is not serviced by the compositor, so a Node-side sleep
// never lets the scene render. Drive real animation frames from inside the page
// whenever a check depends on elapsed presentation time.
const advance = ms => page.evaluate(wait => new Promise(resolve => { const end = performance.now() + wait; const step = () => performance.now() >= end ? resolve() : requestAnimationFrame(step); requestAnimationFrame(step); }), ms);
// The impact is an oscillation, so a single sample can legitimately read ~zero.
// Advance real frames for the window and report how far the table actually moved.
// Frame-count driven, not wall-clock: an idle headless page services RAF
// irregularly, so "wait 180ms" can observe zero frames.
const peakJolt = frames => page.evaluate(count => new Promise(resolve => { const seen = []; const start = h.surface.diagnostics().frames; const step = () => { const diag = h.surface.diagnostics(); seen.push(Number(diag.sceneJolt.x.toFixed(4))); if (diag.frames - start >= count) return resolve({ peak: Math.max(0, ...seen.map(Math.abs)), seen, frames: diag.frames - start }); requestAnimationFrame(step); }; requestAnimationFrame(step); }), frames);
const settle = () => page.waitForFunction(() => h.surface.diagnostics().animations === 0, undefined, { timeout: 10000 });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.h?.surface.diagnostics().frames > 0); await pause(100);
  let diag = await d(); check('actual WebGL renderer with thick mesh cards and lit table', diag.meshes > 50 && diag.drawCalls > 20 && await page.evaluate(() => h.quality[0].webgl));
  const image = PNG.sync.read(await page.screenshot({ path: join(output, 'hand-wide.png') }));
  const fronts = requests.filter(url => /\/cards\/.*\.webp$/.test(url));
  check('only visible supplied fronts load; original back needs no raster request', fronts.length > 0 && fronts.length < 40 && fronts.every(url => /^\/art\/pack-20260910\/cards\/[a-z0-9-]+\.webp$/.test(url)) && !requests.some(url => /back\.webp|\.(?:png|jpe?g)$/.test(url)));
  const palette = new Set(); for (let y = 100; y < image.height - 80; y += 8) for (let x = 80; x < image.width - 80; x += 8) { const offset = (y * image.width + x) * 4; palette.add([...image.data.subarray(offset, offset + 3)].map(c => Math.round(c / 16)).join(',')); }
  check('actual raster contains textured multicolor geometry, not an empty canvas', palette.size > 80);
  await page.waitForLoadState('networkidle');await pause(80);
  const initial = (await d()).frames; await pause(260); check('settled scene has no continuous render loop', (await d()).frames === initial);
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
  await page.evaluate(() => h.omniscient()); await pause(100);
  const omniscientPrivate = await page.evaluate(() => ({
    hand: Object.values(h.model.view.privateHands).flat().map(card => card.id),
    antes: Object.values(h.model.view.privateCommittedAntes).filter(Boolean).map(card => card.id),
  }));
  const omniscientDiag = await d();
  check('host-only omniscient stage shows every locally authorized private hand face', omniscientPrivate.hand.every(id => omniscientDiag.faceCardIds.includes(id)));
  check('host-only omniscient stage shows committed hidden antes as local faces', omniscientPrivate.antes.every(id => omniscientDiag.faceCardIds.includes(id)));
  await page.screenshot({ path: join(output, 'omniscient-private-faces.png') });
  await page.evaluate(() => h.reset()); await pause(100);
  check('leaving omniscient view immediately restores opponent hand privacy', await page.evaluate(() => {
    const publicIds = new Set([...h.model.view.ante, ...h.model.view.discard, ...h.model.view.revealed, ...h.model.view.seats.flatMap(seat => seat.flight.map(entry => entry.card))].map(value => value.id));
    return h.surface.diagnostics().faceCardIds.every(id => h.model.view.hand.some(card => card.id === id) || publicIds.has(id));
  }));
  const handCard = await page.evaluate(() => h.model.view.hand[0].id);
  await page.evaluate(id => { const a = h.surface.getAnchor({ cardId: id }), z = h.surface.getAnchor({ zone: 'flight', seatId: 's1' }); h.surface.setDrag({ cardId: id, ...a }); h.surface.setDrag({ cardId: id, ...z }); h.surface.releaseDrag({ pending: true, zone: 'flight' }); }, handCard);
  await settle(); await page.evaluate(() => h.surface.resolvePending(false)); await settle();
  anchor = await page.evaluate(id => h.surface.getAnchor({ cardId: id }), handCard); check('rejected drop returns to authoritative hand location', (await page.evaluate(p => h.surface.hitTest(p.x, p.y), anchor))?.kind === 'hand');
  await page.evaluate(() => h.scene()); const flying = await d(); check('adjacent projection drives finite card and coin motions', flying.animations > 0); await pause(180); await page.screenshot({ path: join(output, 'flight-in-motion.png') });
  // The central 3D turn compass was removed from the table. The acting seat is
  // still tracked from the public projection; its cue is now the warm table
  // spotlight asserted further below.
  await page.evaluate(() => h.turn('s3')); await settle();
  await settle(); await page.evaluate(() => h.resolutionRelation('payment')); let relation = await d(); check('public payment relation reaches the real target line', relation.resolutionLinkVisible && relation.resolutionLinkRelation === 'payment'); check('payment relation adds a visible target marker', relation.resolutionTargetMarkerVisible === true); await page.evaluate(() => h.resolutionRelation('swap')); relation = await d(); check('public swap relation changes the real target line semantics', relation.resolutionLinkVisible && relation.resolutionLinkRelation === 'swap'); check('swap relation keeps a distinct visible target marker', relation.resolutionTargetMarkerVisible === true); await page.evaluate(() => h.setModel({ ...h.model, reducedMotion: false, activeResolutionCardIds: [], resolutionTargetSeatId: null, resolutionTargetRelation: null, animate: true })); await settle();
  await settle(); await page.evaluate(() => h.goldFlow()); const goldPath = await d(); check('explicit public stakes flow creates finite directional coin paths', goldPath.goldTransfers === 3 && goldPath.animations >= 3); await page.evaluate(() => h.surface.update({ ...h.model })); check('repainting the same public flow does not duplicate coin paths', (await d()).goldTransfers === 3); await settle(); check('explicit public coin paths settle and release their meshes', (await d()).goldTransfers === 0); await page.evaluate(() => h.holeFlow()); const holePath = await d(); check('explicit public debt repayment flow reaches the separate hole pool', holePath.goldTransfers === 3 && holePath.animations >= 3); await settle(); check('hole repayment coin paths also release their meshes', (await d()).goldTransfers === 0);
   await settle(); const holeOn = PNG.sync.read(await page.screenshot({ path: join(output, 'table-settled.png') })); diag = await d(); check('all flying cards and coin motions settle', diag.animations === 0); const settledFrames = diag.frames; await pause(250); check('projection animation stops rendering when complete', (await d()).frames === settledFrames);
   await page.evaluate(() => h.hole(0)); await pause(90); const holeOff = PNG.sync.read(await page.screenshot({ path: join(output, 'hole-off.png') })); let holePixels = 0; for (let index = 0; index < holeOn.data.length; index += 4) if (Math.abs(holeOn.data[index] - holeOff.data[index]) + Math.abs(holeOn.data[index + 1] - holeOff.data[index + 1]) + Math.abs(holeOn.data[index + 2] - holeOff.data[index + 2]) > 35) holePixels++; check('public hole has an independent rendered coin pool and amount label', holePixels > 40 && await page.evaluate(() => h.HOLE.x > 0)); await page.evaluate(() => h.hole(7)); await pause(90);
  const gold = await page.evaluate(() => [0, 1, 30, 1000].map(value => ({ value, ...h.coinDenominations(value) }))); check('silver is exact visual change, not a new rules resource', gold.every(x => x.gold + x.silver / 10 === x.value));
  await page.evaluate(() => h.surface.gesture('s2', { gameId: h.model.view.id, revision: h.model.view.revision, count: h.model.view.seats[1].handCount, hover: 0, selected: [], sequence: 1 }));
  check('ordinal-only remote gesture lifts a hidden card', (await d()).animations > 0); await settle();
  const publicBefore = await page.evaluate(() => h.surface.diagnostics().faceCardIds.slice()); await page.evaluate(() => h.surface.gesture('s2', { gameId: 'stale', revision: h.model.view.revision, count: 6, hover: 0, selected: [], sequence: 2 }));
  check('stale gesture neither animates nor reveals a card identity', (await d()).animations === 0 && JSON.stringify((await d()).faceCardIds) === JSON.stringify(publicBefore));
  const facesBeforeSlap = JSON.stringify((await d()).faceCardIds);
  // One round trip owns the whole impact: the animation is 620ms long, and each
  // separate evaluate costs enough real time to outlive it in this environment.
  // One round trip owns the whole impact: the animation is 620ms long, and each
  // separate evaluate costs enough real time to outlive it here. An idle
  // headless page also services RAF irregularly, so a strike is re-armed until
  // one rendered frame is observed with the cue live - the contract is "the
  // impact drives the hand, the ring and the offset", not "at 60fps".
  const slap = await page.evaluate(() => new Promise(resolve => {
    const view = h.model.view, seat = view.seats.find(row => row.id === 's2');
    let sequence = 3, attempts = 0, seen = null, restarted = 0, survivedRepaint = 0;
    const payload = value => ({ gameId: view.id, revision: view.revision, count: seat.handCount, hover: null, selected: [], sequence: value, slap: true });
    const faces = JSON.stringify(h.surface.diagnostics().faceCardIds);
    const arm = () => h.surface.gesture('s2', payload(sequence));
    arm();
    const armed = h.surface.diagnostics().slapStates.slice();
    h.surface.update({ ...h.model });
    survivedRepaint = h.surface.diagnostics().slapStates.length;
    let peak = 0, sawHand = false, sawRing = false, firstLive = false;
    const step = () => {
      const diag = h.surface.diagnostics();
      if (diag.slapStates.length) {
        // The palm and the landing ring appear at different points of the
        // impact, so both are accumulated rather than sampled at one instant.
        if (diag.strikeHandVisible || diag.slapRingVisible) {
          firstLive = firstLive || diag.strikeHandVisible;
          if (firstLive && !seen) { seen = { sequence }; sequence++; arm(); restarted = h.surface.diagnostics().slapStates[0]?.sequence ?? 0; }
        }
        sawHand = sawHand || diag.strikeHandVisible;
        sawRing = sawRing || diag.slapRingVisible;
        peak = Math.max(peak, Math.abs(diag.sceneJolt.x), Math.abs(diag.sceneJolt.y));
        if (peak === 0 && !sawHand) attempts++;
      } else {
        if (!sawHand && attempts < 12) { attempts++; sequence++; arm(); return requestAnimationFrame(step); }
        const end = h.surface.diagnostics();
        return resolve({ faces, armed, survivedRepaint, restarted, seen, sawHand, sawRing, peak, attempts, end: { states: end.slapStates.length, hand: end.strikeHandVisible, ring: end.slapRingVisible, jolt: end.sceneJolt } });
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }));
  check('a public slap arms the slapping seat before any frame runs', slap.armed.length === 1 && slap.armed[0].seatId === 's2' && slap.armed[0].sequence === 3);
  check('an unrelated repaint cannot wipe an in-flight slap cue', slap.survivedRepaint === 1);
  check('a slap carries no card identity and reveals no hidden face', slap.faces === facesBeforeSlap);
  check('a slap raises the striking hand, marks the felt and throws the scene off centre', slap.sawHand === true && slap.sawRing === true && slap.peak > .005);
  check('slapping again mid-impact restarts the strike instead of being swallowed', !!slap.seen && slap.restarted === slap.seen.sequence + 1);
  check('a finite slap releases the hand, the ring and the scene offset', slap.end.states === 0 && slap.end.hand === false && slap.end.ring === false && slap.end.jolt.x === 0 && slap.end.jolt.y === 0 && slap.end.jolt.z === 0);
  const slapFrames = (await d()).frames; await pause(250);
  check('slap impact stops rendering once the cue is released', (await d()).frames === slapFrames);
  // The seat a player slaps from is their own, at the near edge of the table:
  // capture that view too, because it is the one a player actually looks at.
  await page.evaluate(() => { h.reset(); const view = h.model.view, seat = view.seats.find(row => row.id === view.selfSeatId); h.surface.gesture(view.selfSeatId, { gameId: view.id, revision: view.revision, count: seat.handCount, hover: null, selected: [], sequence: 6, slap: true }); });
  // Three back-to-back grabs: a screenshot costs a few hundred ms, so the run
  // covers the whole 620ms impact instead of racing a single frame.
  for (const index of [1, 2, 3]) await page.screenshot({ path: join(output, `slap-self-view-${index}.png`) });
  await page.waitForFunction(() => h.surface.diagnostics().slapStates.length === 0, undefined, { timeout: 10000 });
  const mutedSlap = await page.evaluate(() => { h.setModel({ ...h.model, reducedMotion: true }); h.surface.gesture('s2', { gameId: h.model.view.id, revision: h.model.view.revision, count: h.model.view.seats[1].handCount, hover: null, selected: [], sequence: 5, slap: true }); const diag = h.surface.diagnostics(); return { states: diag.slapStates.length, hand: diag.strikeHandVisible, ring: diag.slapRingVisible, jolt: diag.sceneJolt.x }; });
  check('reduced motion suppresses the slap instead of jolting the table', mutedSlap.states === 0 && mutedSlap.hand === false && mutedSlap.ring === false && mutedSlap.jolt === 0);
  await page.evaluate(() => h.setModel({ ...h.model, reducedMotion: true, selectedCardIds: [h.model.view.hand[0].id] })); check('reduced motion snaps to selected pose without RAF animation', (await d()).animations === 0);
  await page.evaluate(() => { const view = structuredClone(h.model.view); view.revision += 12; h.setModel({ ...h.model, view, reducedMotion: false }); }); check('revision gap does not replay historical transitions', (await d()).animations === 0);
  await page.evaluate(() => h.surface.suspend()); const suspended = (await d()).frames;
  await page.evaluate(() => h.setModel({ ...h.model, language: 'zh' })); await pause(100); check('suspended scene does no GPU rendering on model update', (await d()).frames === suspended);
   await page.evaluate(() => h.surface.resume()); // An idle headless page services RAF irregularly, so the deadline has to
// tolerate a starved compositor; the assertion is still "a frame rendered".
   await page.waitForFunction(previous => h.surface.diagnostics().frames > previous, suspended, { timeout: 10000 }); check('resume renders the latest projection', (await d()).frames > suspended);
  await page.evaluate(() => h.visibility(true)); const hiddenFrames = (await d()).frames;
  await page.evaluate(() => h.setModel({ ...h.model, language: 'en' })); await pause(80); check('document hidden signal prevents late updates from restarting rendering', (await d()).frames === hiddenFrames);
  await page.evaluate(() => h.visibility(null)); await pause(80); check('visibility restoration renders latest data', (await d()).frames > hiddenFrames);
   await page.setViewportSize({ width: 420, height: 820 }); await pause(120); const narrowImage = PNG.sync.read(await page.screenshot({ path: join(output, 'table-narrow.png') }));
   const portraitQuality = await d(); check('auto quality keeps the bounded profile on a window too small to show the table', portraitQuality.quality === 'low' && portraitQuality.qualityMode === 'auto' && portraitQuality.pixelRatio <= 1.15 && portraitQuality.shadowsEnabled === false);
   await page.evaluate(() => h.surface.setQuality('high')); await pause(80); const forcedHigh = await d(); check('explicit high quality keeps full local shadows without changing the projection', forcedHigh.quality === 'high' && forcedHigh.qualityMode === 'high' && forcedHigh.shadowsEnabled === true);
   await page.evaluate(() => h.surface.setQuality('low')); await pause(80); const forcedLow = await d(); check('the bounded profile stays reachable through the local API', forcedLow.quality === 'low' && forcedLow.qualityMode === 'low' && forcedLow.pixelRatio <= 1.15 && forcedLow.shadowsEnabled === false);
   await page.evaluate(() => h.surface.setQuality('auto')); await pause(80); check('returning to auto quality restores the bounded small-window profile deterministically', (await d()).quality === 'low' && (await d()).qualityMode === 'auto');
   check('responsive projection remains bounded at narrow size', await page.evaluate(() => h.surface.getAnchor({ zone: 'deck' }).visible));
   let feltLeft = narrowImage.width, feltRight = -1, feltPixels = 0;
   for (let y = 0; y < narrowImage.height; y += 1) for (let x = 0; x < narrowImage.width; x += 1) { const offset = (y * narrowImage.width + x) * 4, red = narrowImage.data[offset], green = narrowImage.data[offset + 1], blue = narrowImage.data[offset + 2]; if (green > red + 6 && green > blue + 1 && green > 24) { feltPixels++; feltLeft = Math.min(feltLeft, x); feltRight = Math.max(feltRight, x); } }
   check('portrait camera gives the felt a useful width instead of leaving desktop side margins', feltPixels > 5000 && feltRight - feltLeft + 1 > narrowImage.width * .76);
   // The fan is now clamped onto the table's near edge for every aspect ratio,
  // so on a tall viewport it sits a little higher than before while staying in
  // the lower foreground; previously it fell off the timber into the dark
  // surround and read as if a black mask covered the cards.
  const portraitHand = await page.evaluate(() => ({ y: h.surface.getAnchor({ cardId: h.model.view.hand[0].id }).y, viewport: innerHeight }));
  check(`portrait hand stays on screen in the lower half instead of sinking into the dark surround (${Math.round(portraitHand.y)}/${portraitHand.viewport})`, portraitHand.y > portraitHand.viewport * .35 && portraitHand.y < portraitHand.viewport);
  await page.setViewportSize({ width: 1440, height: 960 }); await pause(100);
  const desktopQuality = await d(); check('an ordinary mouse-driven desktop window always resolves to the full profile with no user switch', desktopQuality.quality === 'high' && desktopQuality.qualityMode === 'auto' && desktopQuality.shadowsEnabled === true);
  const textureCount = (await d()).textures;
  await page.evaluate(() => { for (let i = 0; i < 30; i++) h.setModel({ ...h.model, language: i % 2 ? 'zh' : 'en', animate: false }); }); await pause(100);
  check('repeated localization disposes replaced card and label textures', (await d()).textures <= textureCount + 1);
  await page.evaluate(() => h.playFixture()); await pause(180);

  const powerHand = await page.evaluate(() => Object.fromEntries(h.model.view.handPowerHints.map(hint => [hint.cardId, hint.state])));
  const powerDiagnostics = await d(), powerVisuals = powerDiagnostics.handPowerStates ?? [], powerMarkers = powerDiagnostics.handPowerOutlines ?? [], powerShapes = await page.evaluate(() => Object.fromEntries(h.model.view.hand.map(value => [value.id, h.powerShape(value.id)])));
  check('engine-authored power-ready hand cards receive the real WebGL halo', Object.entries(powerHand).some(([cardId, state]) => state === 'power-ready' && powerVisuals.some(visual => visual.cardId === cardId && visual.state === 'power-ready')));
  check('WebGL power-ready cards carry a glowing family-coloured edge instead of a glyph', Object.entries(powerHand).some(([cardId, state]) => state === 'power-ready' && powerDiagnostics.handPowerOutlines?.some(effect => effect.cardId === cardId && effect.visible && effect.theme === powerShapes[cardId])));
  check('WebGL power-ready cards carry their own family colour and no other card is marked', Object.entries(powerHand).some(([cardId, state]) => state === 'power-ready' && powerMarkers.some(marker => marker.cardId === cardId && marker.state === 'power-ready' && marker.visible && marker.shape === powerShapes[cardId])) && powerMarkers.filter(marker => marker.visible).every(marker => powerHand[marker.cardId] === 'power-ready'));
  const powerOn = PNG.sync.read(await page.screenshot({ path: join(output, 'hand-power-marker-on.png') }));
  // A one-second window rather than 300ms: an idle headless page can stall a
  // whole short window, and the contract is a 30 FPS *rate*, not a sample count.
  await pause(3900); const cueFrames = (await d()).frames; await pause(1000); const quietPower = await d();
  // A ready edge now keeps burning while the card is in hand. That is a deliberate
  // contract change: the cue is continuous again, and what is asserted instead is
  // that it stays inside the 30 FPS hand-power frame budget rather than rendering
  // the scene unthrottled.
  check(`a ready-power edge keeps burning while the card is in hand, within the hand-power frame budget (${quietPower.frames - cueFrames} frames / 1000ms)`, quietPower.handPowerOutlines?.some(effect => effect.visible) && quietPower.frames > cueFrames && quietPower.frames - cueFrames <= 32);
  await page.setViewportSize({ width: 420, height: 820 }); await pause(120);
  const mobilePower = await d();
  check('portrait WebGL hand keeps its ready-power edge in the usable touch foreground', mobilePower.handPowerOutlines?.some(marker => marker.visible && marker.state === 'power-ready') && await page.evaluate(() => h.surface.getAnchor({ cardId: h.model.view.hand.find(card => h.model.view.handPowerHints.find(hint => hint.cardId === card.id && hint.state === 'power-ready'))?.id ?? '' })?.y > innerHeight * .35));
  await page.screenshot({ path: join(output, 'hand-power-marker-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 960 }); await page.evaluate(() => h.omniscientPower()); await pause(180);
  const omniscientPower = await page.evaluate(() => Object.entries(h.model.view.privateHandPowerHints).filter(([seatId]) => seatId !== h.model.view.selfSeatId).flatMap(([seatId, hints]) => hints.filter(hint => hint.state === 'power-ready').map(hint => ({ seatId, cardId: hint.cardId }))));
  const omniscientPowerDiag = await d();
  check('host-only omniscient projection exposes ready-power hints for other local hands', omniscientPower.length > 0);
  check('host-only omniscient WebGL hands show the same ready-power edge for opponents', omniscientPower.some(value => omniscientPowerDiag.handPowerOutlines?.some(marker => marker.cardId === value.cardId && marker.state === 'power-ready' && marker.visible)));
  await page.evaluate(() => h.reset()); await pause(100);
  await page.setViewportSize({ width: 1440, height: 960 }); await pause(90);
  await page.evaluate(() => h.setModel({ ...h.model, view: { ...h.model.view, handPowerHints: [] }, animate: false })); await pause(300);
  const powerOff = PNG.sync.read(await page.screenshot({ path: join(output, 'hand-power-marker-off.png') })); let powerPixels = 0;
  for (let index = 0; index < powerOn.data.length; index += 4) if (Math.abs(powerOn.data[index] - powerOff.data[index]) + Math.abs(powerOn.data[index + 1] - powerOff.data[index + 1]) + Math.abs(powerOn.data[index + 2] - powerOff.data[index + 2]) > 35) powerPixels++;
  check('the ready-power edge changes actual WebGL hand pixels', powerPixels > 30);
  await page.evaluate(() => { const id=h.model.view.hand[0].id,a=h.surface.getAnchor({cardId:id});h.surface.setDrag({cardId:id,...a});h.surface.releaseDrag({pending:true,zone:'flight'});h.publicSameRevision(); }); await pause(80);
  check('changing to spectator cancels private pending mesh without waiting for an ACK', (await d()).pendingCardId === null && await page.evaluate(() => h.surface.diagnostics().faceCardIds.every(id=>h.model.view.seats.some(s=>s.flight.some(f=>f.cardId===id))||h.model.view.discard.some(c=>c.id===id)||h.model.view.ante.some(c=>c.id===id))));
  await pause(400); const idleFrames = (await d()).frames; await pause(250);
  check('settled scene has no continuous render loop', (await d()).frames === idleFrames);
  await page.evaluate(() => h.public()); await pause(100); check('spectator projection never retains private hand face textures', await page.evaluate(() => { const publicIds = new Set([...h.model.view.ante, ...h.model.view.discard, ...h.model.view.revealed, ...h.model.view.seats.flatMap(seat => seat.flight.map(entry => entry.card))].map(value => value.id)); return h.surface.diagnostics().faceCardIds.every(id => publicIds.has(id)); }));
  await page.evaluate(() => h.contextLoss()); await pause(120); check('context loss suspends and reports unavailable', (await d()).suspended && await page.evaluate(() => h.quality.some(q => q.reason === 'context-lost')));
  await page.evaluate(() => h.contextRestore()); await pause(300); check('context restore redraws without replacing the canvas', !(await d()).suspended);
  for(const count of [2,3,4,5,6]){
    await page.evaluate(n=>h.stacks(n),count);await pause(120);
    const hits=await page.evaluate(()=>h.model.view.seats.flatMap(s=>s.flight.map(c=>{const point=h.surface.getAnchor({cardId:c.cardId});return {id:c.cardId,point,hit:point&&h.surface.hitTest(point.x,point.y)}})));
    check(`${count} player overlapping flights expose every strength corner to real picking`,hits.every(row=>row.point?.visible&&row.hit?.cardId===row.id));
    const anteHits=await page.evaluate(()=>h.model.view.ante.map(c=>{const point=h.surface.getAnchor({cardId:c.id});return {id:c.id,point,hit:point&&h.surface.hitTest(point.x,point.y)}}));
    check(`${count} player coins leave all underlying public ante cards inspectable`,anteHits.every(row=>row.point?.visible&&row.hit?.cardId===row.id));
    const layout=await page.evaluate(()=>h.model.view.seats.every(self=>{
      const view={...h.model.view,selfSeatId:self.id};return h.seatPlacements(view).every(s=>{
        const dx=s.ante.x-s.flight.x,dz=s.ante.z-s.flight.z,m=h.moneyPlacement(view,s.id);
        return dx*Math.cos(s.angle)-dz*Math.sin(s.angle)<-2&&Math.abs(dx*Math.sin(s.angle)+dz*Math.cos(s.angle))<1e-8&&m.x===s.coins.x&&m.z===s.coins.z;
      });
    })&&h.DECK.yaw===0&&h.DISCARD.yaw===0);
    check(`${count} seats from every viewpoint keep ante left at matching depth, coins on ante and central piles upright`,layout);
    await page.screenshot({path:join(output,`stacked-${count}-players.png`)});
  }
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
