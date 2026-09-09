// Real engine + real DOM, without the room controller, storage, or Owlbear SDK.
import assert from 'node:assert/strict';
import { build } from 'rolldown';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const base = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'tda-tutorial-'));
const entry = join(out, 'tutorial.mjs');
const styles = { name: 'no-css', resolveId(id) { if (id.endsWith('.css')) return '\0tutorial-style'; }, load(id) { if (id === '\0tutorial-style') return ''; }, transform(code,id){if(id.replaceAll('\\','/').endsWith('/tutorial.ts'))return code.replace('table.update(view);','globalThis.__tutorialViews?.push(structuredClone(view)); table.update(view);');} };
await build({ input: resolve(base, 'tutorial.ts'), plugins: [styles], output: { file: entry, format: 'esm' }, logLevel: 'silent' });
await build({ input: resolve(base, 'rules/index.ts'), output: { file: join(out, 'engine.mjs'), format: 'esm' }, logLevel: 'silent' });
await build({ input: resolve(base, 'stage/types.ts'), output: { file: join(out, 'timing.mjs'), format: 'esm' }, logLevel: 'silent' });
const t = await import(pathToFileURL(entry).href), engine = await import(pathToFileURL(join(out, 'engine.mjs')).href);
const { REVEAL_PRESENTATION_MS } = await import(pathToFileURL(join(out, 'timing.mjs')).href);
let checks = 0;
const check = (name, run) => { run(); checks++; console.log(`PASS ${name}`); };
function step(s, lesson) { const move = t.tutorialMove(s, lesson, `test:${s.revision}`); assert.ok(move, 'legal next action'); const r = engine.applyAction(s, move); assert.ok(r.ok, JSON.stringify(r)); return r.state; }
function health(s) {
  assert.deepEqual(engine.checkInvariants(s), []);
  const pending = s.pending && ['seer-keep', 'sorcerer'].includes(s.pending.task.kind) ? s.pending.task.ids ?? [] : [];
  const reserved = s.queue.filter(q => q.kind === 'sorcerer-ante').flatMap(q => q.ids ?? []);
  const all = [...s.deck, ...s.discard, ...s.ante, ...Object.values(s.committed), ...s.seats.flatMap(seat => [...seat.hand, ...seat.flight.map(f => f.cardId)]), ...pending, ...reserved];
  assert.equal(all.length, 80); assert.equal(new Set(all).size, 80);
  assert.equal(s.seats.reduce((n, seat) => n + seat.gold, s.stakes + s.hole), 90);
}
check('all exercises conserve 80 physical cards and 90 coins', () => { assert.equal(t.tutorialLessons.length, 41); for (const lesson of t.tutorialLessons) health(t.createTutorialGame(lesson.id)); });
check('complete deterministic game uses untouched createGame deal and reaches a real winner', () => {
  let s = t.createTutorialGame(); assert.deepEqual(s, engine.createGame({ id: s.id, seats: s.seats.map(({id,name})=>({id,name})), seed: 7341 }));
  let actions = 0; while (!['ended','adjudication'].includes(s.stage) && actions < 500) { s = step(s, 'game'); health(s); actions++; }
  assert.equal(s.stage, 'ended', `after ${actions} actions: ${s.issue}`); assert.ok(s.winners.length); console.log(`  full game: ${actions} actions, ${s.gambit} gambits`);
});
check('weak/equal comparison does not teach that stronger cards trigger', () => {
  const a=t.createTutorialGame('powers'); const weak=step(a,'powers'); assert.ok(weak.events.some(e=>e.code==='POWER_TRIGGERED'&&e.cardIds?.includes('black-3')));
  const strong=engine.applyAction(a,{id:'strong',revision:0,seatId:'you',kind:'play',cardId:'gold-13'}); assert.ok(strong.ok); assert.ok(!strong.state.events.some(e=>e.code==='POWER_TRIGGERED'));
});
check('color flight rewards each opponent only once after power', () => {
  let s=step(t.createTutorialGame('color'),'color'); assert.equal(s.pending.code,'WEAKEST_OPPONENT'); while(s.pending)s=step(s,'color'); const e=s.events; assert.equal(e.find(e=>e.code==='SPECIAL_FLIGHT').amount,2); assert.ok(e.findIndex(e=>e.code==='POWER_TRIGGERED')<e.findIndex(e=>e.code==='SPECIAL_FLIGHT')); assert.equal(s.seats[0].gold,26); assert.deepEqual(s.seats[0].rewards,['color:white']);
});
check('strength flight removes exactly two real ante cards after its choices',()=>{
  let s=step(t.createTutorialGame('strength'),'strength'); assert.equal(s.stakes,24); assert.equal(s.pending.code,'STRENGTH_FLIGHT_ANTE'); const before=s.ante.length;
  while(s.pending)s=step(s,'strength'); assert.equal(s.ante.length,before-2); health(s);
});
check('highest tied ante still sets price, lower untied player leads',()=>{let s=t.createTutorialGame('ante-tie');for(let i=0;i<3;i++)s=step(s,'ante-tie');assert.equal(s.leader,2);assert.equal(s.stakes,30);assert.ok(s.seats.every(v=>v.gold===20));});
check('all tied antes discard and redeal without charging',()=>{let s=t.createTutorialGame('ante-all-tied');for(let i=0;i<3;i++)s=step(s,'ante-all-tied');assert.equal(s.stage,'ante');assert.equal(s.stakes,0);assert.equal(s.discard.length,3);assert.ok(s.seats.every(v=>v.gold===30));});
check('tied round keeps leader; tied gambit really enters fourth round',()=>{let a=step(t.createTutorialGame('round-tie'),'round-tie');while(a.pending)a=step(a,'round-tie');assert.equal(a.round,2);assert.equal(a.leader,1);let b=step(t.createTutorialGame('gambit-tie'),'gambit-tie');while(b.pending)b=step(b,'gambit-tie');assert.equal(b.round,4);assert.equal(b.lastGambit,null);});
check('debt is not fictional pot money, actual settlement pays hole',()=>{let s=t.createTutorialGame('debt');for(let i=0;i<3;i++)s=step(s,'debt');assert.equal(s.seats[0].debt,12);assert.equal(s.stakes,27);assert.equal(s.seats[0].gold,0);let n=0;while(!s.lastGambit&&n++<80)s=step(s,'debt');assert.ok(s.lastGambit);assert.ok(s.seats.every(v=>v.debt===0));health(s);});
check('low hand triggers a real engine price draw, not a tutorial purchase shortcut',()=>{let s=t.createTutorialGame('buy');let n=0;while(!s.events.some(e=>e.code==='BUY_PRICE')&&n++<60)s=step(s,'buy');assert.ok(s.events.some(e=>e.code==='BUY_PRICE'));health(s);});
check('empty stakes interrupt and settle before a third round',()=>{const s=step(t.createTutorialGame('empty'),'empty');assert.equal(s.lastGambit.reason,'empty-stakes');assert.equal(s.lastGambit.number,1);assert.equal(s.gambit,2);health(s);});
for(const lesson of t.tutorialLessons.filter(v=>['legendary','mortal'].includes(v.chapter))) check(`special ${lesson.id}: actual power and choice chain`,()=>{
  let s=step(t.createTutorialGame(lesson.id),lesson.id);assert.ok(s.events.some(e=>e.code==='POWER_TRIGGERED'&&e.cardIds?.includes(lesson.id)),lesson.id);health(s);
  let n=0;while(s.pending&&n++<40){s=step(s,lesson.id);health(s);}assert.equal(s.pending,null);
  while(!s.lastGambit&&!['ended','adjudication'].includes(s.stage)&&n++<100){s=step(s,lesson.id);health(s);}
  assert.ok(s.lastGambit,`${lesson.id}: ${s.issue}`);
});
check('delayed powers have observable outcomes, including a Monarch win and extra Warlord round',()=>{
  const finished={};let warlordExtra=false;
  for(const id of ['gold-monarch','dracolich','dragonrider','druid','bronze-warlord','merchant-prince']){
    let s=t.createTutorialGame(id),n=0;while(!s.lastGambit&&n++<100){s=step(s,id);if(id==='bronze-warlord'&&s.round===4)warlordExtra=true;}assert.ok(s.lastGambit);finished[id]=s;
  }
  const monarch=finished['gold-monarch'];assert.deepEqual(monarch.lastGambit.winners,['you']);assert.equal(monarch.events.filter(e=>e.code==='PAID_PLAYER'&&e.seatId==='you'&&e.amount===3).length,2);
  assert.equal(finished.dracolich.lastGambit.strengths.you,18);assert.equal(finished.dragonrider.lastGambit.strengths.you,6);assert.deepEqual(finished.druid.lastGambit.winners,['you']);assert.equal(warlordExtra,true);
  const merchant=finished['merchant-prince'];assert.ok(merchant.events.some(e=>e.code==='BUY_PRICE'&&e.seatId==='ember'));assert.ok(merchant.events.some(e=>e.code==='PAID_PLAYER'&&e.seatId==='ember'&&e.targetSeatId==='you'));
});
check('Archmage exercise demonstrates a stronger non-leading card triggering',()=>{
  let s=t.createTutorialGame('archmage'),seen=false;
  for(let n=0;n<80&&!s.lastGambit;n++){
    const move=t.tutorialMove(s,'archmage',`mage:${n}`);assert.ok(move);const before=s;const r=engine.applyAction(s,move);assert.ok(r.ok);s=r.state;
    if(move.kind==='play'&&move.seatId==='you'&&before.turnIndex>0&&before.seats[0].archmage){
      const previous=before.roundCards[2];if(previous&&engine.card(move.cardId).strength>engine.card(previous).strength){assert.ok(s.events.slice(-20).some(e=>e.code==='POWER_TRIGGERED'&&e.cardIds?.includes(move.cardId)));seen=true;}
    }
  }assert.equal(seen,true);
});
check('explanation survives public event ring overflow',()=>{
  const before=t.createTutorialGame('color');before.events=Array.from({length:100},(_,i)=>({code:'PAID_STAKES',amount:i}));const move=t.tutorialMove(before,'color','ring');const r=engine.applyAction(before,move);assert.ok(r.ok);const lines=t.tutorialObservation(before,r.state,move,'en');assert.ok(lines.some(v=>v.includes('Power triggered')));assert.ok(!lines.some(v=>v.includes('does not trigger')));
});
check('private opponent ante recommendation and observation never name its secret card',()=>{
  let s=step(t.createTutorialGame('ante-tie'),'ante-tie');const move=t.tutorialMove(s,'ante-tie','hidden');assert.equal(move.seatId,'ember');const r=engine.applyAction(s,move);assert.ok(r.ok);const observation=t.tutorialObservation(s,r.state,move,'en').join('\n');assert.ok(!observation.includes('Green Dragon'));assert.equal(r.state.events.length,0);
});
check('explicit bot actor can ante before you without selecting your legal action',()=>{
  const s=t.createTutorialGame(),move=t.tutorialMove(s,'game','early-ember','ember');assert.equal(move.seatId,'ember');assert.equal(move.revision,0);
  const r=engine.applyAction(s,move);assert.ok(r.ok);assert.deepEqual(Object.keys(r.state.committed),['ember']);assert.equal(r.state.seats[0].hand.length,6);
  assert.equal(t.tutorialMove(r.state,'game','again','ember'),null);assert.equal(t.tutorialMove(s,'game','unknown','outsider'),null);health(r.state);
});
console.log(`${checks} engine/teaching checks passed. Browser checks starting.`);
// Keep evidence in a fresh temp directory; no dependency on an active room or saved state.
const { chromium } = await import(pathToFileURL('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true });
let browserChecks=0;
try {
  const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  // This suite exercises the DOM fallback and teaching engine. The separate
  // ui-stage-selftest covers actual WebGL, drag and ACK integration.
  await page.route('**/*',route=>route.request().url()==='http://localhost/'?route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}):route.abort());
  await page.goto('http://localhost/');
  await page.clock.install({time:new Date('2026-09-09T00:00:00Z')});await page.clock.pauseAt(new Date('2026-09-09T00:00:01Z'));
  await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'||type==='webgl2'?null:original.call(this,type,...args)}});
  await page.setContent(`<style>${readFileSync(join(base,'style.css'),'utf8')}\n${readFileSync(join(base,'tutorial.css'),'utf8')}\n${readFileSync(join(base,'stage-ui.css'),'utf8')}\n${readFileSync(join(base,'power-presentation.css'),'utf8')}${readFileSync(join(base,'card-images.css'),'utf8')}${readFileSync(join(base,'round-presentation.css'),'utf8')}</style><button id="real-table">Real table</button><div id="practice"></div>`);
  await page.addScriptTag({type:'module',content:readFileSync(entry,'utf8').replace(/export\s*\{[^}]*\};?\s*$/,'')+'\nwindow.mountTutorial=mountTutorial;'});
  await page.waitForFunction(()=>typeof window.mountTutorial==='function');
  await page.evaluate(()=>{document.querySelector('#real-table').focus();window.__tutorialViews=[];window.closedCount=0;window.handle=window.mountTutorial(document.querySelector('#practice'),'en',()=>window.closedCount++);});
  const revision=()=>page.locator('.tda-tutorial').getAttribute('data-revision');
  const latest=()=>page.evaluate(()=>window.__tutorialViews.at(-1));
  async function playOwn(id){const target=id?page.locator(`#hand button[data-card="${id}"]`):page.locator('#hand button[data-card]').first();await target.focus();await page.keyboard.press('Space');await page.keyboard.press('Enter');}
  let presentationDismissals=0;
  async function dismissPowers(){
    let count=0;
    while(await page.locator('.power-overlay').isVisible()){
      assert.ok(count++<64,'Each real click advances one finite queued power');
      const before=await revision();
      await page.locator('.power-overlay').click({position:{x:12,y:12}});
      assert.equal(await revision(),before,'Dismissing a presentation never submits a rule action');
      presentationDismissals++;
    }
    // Newly requested round/scoring banners finish before the next bot's
    // one-second thought. Advance actual scheduled milestones, not a guessed
    // blanket sleep that could accidentally execute a bot action as well.
    for(let i=0;await page.locator('.round-overlay').isVisible();i++){
      assert.ok(i<100,'finite round/score presentation');
      const delay=await page.locator('.round-overlay').evaluate(e=>Math.max(0,Number(e.dataset.nextAt)-performance.now()));
      await page.clock.runFor(Math.ceil(delay));
    }
  }
  await page.locator('.tutorial-chapter').selectOption('basics');await page.locator('.tutorial-lesson').selectOption('powers');
  await page.locator('#hand button[data-card="black-3"]').focus();await page.keyboard.press('Space');await page.keyboard.press('Enter');
  assert.match(await page.locator('.tutorial-result').innerText(),/Power triggered/);assert.equal(await page.locator('.tda-tutorial').getAttribute('data-revision'),'1');browserChecks++;
  await dismissPowers();await page.locator('.tutorial-undo').click();assert.equal(await page.locator('.tda-tutorial').getAttribute('data-revision'),'0');
  await page.locator('#hand button[data-card="gold-13"]').focus();await page.keyboard.press('Space');await page.keyboard.press('Enter');assert.match(await page.locator('.tutorial-result').innerText(),/does not trigger/);browserChecks++;
  const oldGame=await page.locator('.tda-tutorial').getAttribute('data-revision');await page.evaluate(()=>window.handle.setLanguage('zh'));assert.equal(await page.locator('.tda-tutorial').getAttribute('data-revision'),oldGame);assert.match(await page.locator('.tutorial-result').innerText(),/不发动能力/);browserChecks++;
  await page.locator('.tutorial-restart').click();await page.locator('#hand button[data-card="black-3"]').focus();await page.keyboard.press('Space');await page.evaluate(()=>window.handle.setLanguage('en'));assert.equal(await page.locator('.tda-tutorial').getAttribute('data-revision'),'0');await page.keyboard.press('Enter');assert.equal(await page.locator('.tda-tutorial').getAttribute('data-revision'),'1');browserChecks++;
  assert.equal(await page.locator('.tutorial-step').count(),0);await page.clock.runFor(30000);assert.equal(await revision(),'1','Reduced motion still waits for a real dismissal, however long the player reads');assert.equal(await page.locator('.power-overlay').isVisible(),true);await dismissPowers();await page.clock.runFor(999);assert.equal(await revision(),'1','Closing the explanation and finishing its banner starts a full one-second thought');await page.clock.runFor(1);assert.equal(await revision(),'2');browserChecks++;
  assert.equal(await page.locator('.tda-tutorial #tutorial:visible,.tda-tutorial #language:visible,.tda-tutorial #display-mode:visible,.tda-tutorial #close:visible').count(),0);browserChecks++;
  await dismissPowers();await page.screenshot({path:join(out,'tutorial-wide.png')});
  await page.locator('.tutorial-chapter').selectOption('game');
  assert.deepEqual((await latest()).game.waitingSeatIds,['you','ember','jade']);
  await page.clock.runFor(1999);assert.equal(await revision(),'0');await page.clock.runFor(1);assert.equal(await revision(),'1');
  assert.deepEqual((await latest()).game.waitingSeatIds,['you','jade']);assert.equal((await latest()).game.hand.length,6);
  await page.clock.runFor(3000);assert.equal(await revision(),'1','Jade waits for your ante, not just Ember');
  await playOwn();assert.equal(await revision(),'2');assert.deepEqual((await latest()).game.waitingSeatIds,['jade']);
  await page.clock.runFor(999);assert.equal(await revision(),'2');await page.clock.runFor(1);assert.equal(await revision(),'3');browserChecks++;
  await page.locator('.tutorial-restart').click();await page.clock.runFor(500);await playOwn();assert.equal(await revision(),'1');
  await page.clock.runFor(1499);assert.equal(await revision(),'1');await page.clock.runFor(1);assert.equal(await revision(),'2','Early player input never delays Ember beyond 2s');
  await page.clock.runFor(999);assert.equal(await revision(),'2');await page.clock.runFor(1);assert.equal(await revision(),'3');browserChecks++;
  // Timers use active visible time, with no catch-up burst while hidden/suspended.
  await page.locator('.tutorial-restart').click();await page.clock.runFor(700);await page.evaluate(()=>window.handle.suspend());await page.clock.runFor(5000);assert.equal(await revision(),'0');
  await page.evaluate(()=>window.handle.resume());await page.clock.runFor(1299);assert.equal(await revision(),'0');await page.clock.runFor(1);assert.equal(await revision(),'1');browserChecks++;
  await page.locator('.tutorial-restart').click();await page.clock.runFor(800);await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(4000);assert.equal(await revision(),'0');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(1199);assert.equal(await revision(),'0');await page.clock.runFor(1);assert.equal(await revision(),'1');browserChecks++;
  await page.locator('.tutorial-restart').click();await page.clock.runFor(1500);await page.locator('.tutorial-restart').click();await page.clock.runFor(1999);assert.equal(await revision(),'0','Old reset timer cannot enter the new game');await page.clock.runFor(1);assert.equal(await revision(),'1');
  await page.locator('.tutorial-undo').click();await page.clock.runFor(1999);assert.equal(await revision(),'0','Undo invalidates the old action and gets a fresh bot delay');await page.clock.runFor(1);assert.equal(await revision(),'1');browserChecks++;
  await page.locator('.tutorial-restart').click();
  const automatic={antes:0,plays:0,choices:0,humanChoices:0};let completeSteps=0;
  while((await latest()).game.phase!=='ended'&&completeSteps++<100){
    await dismissPowers();
    const v=await latest(),own=v.game.actions[0],beforeRevision=v.game.revision;
    if(own){
      if(own.kind==='choose'){
        await page.clock.runFor(1500);assert.equal(Number(await revision()),beforeRevision,'Bots never decide a user-owned choice');
        const available=own.choice.options.filter(o=>o.id!=='skip'),count=Math.max(own.choice.min,Math.min(1,own.choice.max));
        const options=available.length>=own.choice.min?available.slice(0,count):own.choice.options.slice(0,own.choice.min);
        for(const option of options)await page.locator(`#turn [data-option="${option.id}"]`).click();
        await page.locator('#confirm-action').click();automatic.humanChoices++;
      }else{
        const chosen=[...own.cardIds].sort((a,b)=>engine.card(b).strength-engine.card(a).strength||a.localeCompare(b))[0];await playOwn(chosen);
      }
    }else{
      const firstEmber=v.game.phase==='ante'&&v.game.gambit===1&&!v.game.seats.find(s=>s.id==='ember').committed;
      const delay=firstEmber?2000:1000;
      await page.clock.runFor(delay-1);assert.equal(Number(await revision()),beforeRevision,'One bot thinks for its full delay before acting');await page.clock.runFor(1);
      if(v.game.phase==='choice')automatic.choices++;else if(v.game.phase==='ante')automatic.antes++;else automatic.plays++;
    }
    assert.equal(Number(await revision()),beforeRevision+1,'Exactly one real rule action resolves per user submission or bot timer');
  }
  await dismissPowers();assert.equal((await latest()).game.phase,'ended');assert.ok(automatic.choices>=1&&automatic.humanChoices>=1);assert.equal(completeSteps,52);
  assert.match(await page.locator('.tutorial-suggestion').innerText(),/game is complete/);assert.equal(await page.locator('.tutorial-step').count(),0);browserChecks++;
  console.log('Automatic full-game browser trace: '+JSON.stringify({steps:completeSteps,...automatic}));
  // The engine and receipt advance immediately; only the next bot's thinking
  // begins after the stage's shared reveal interval. This is timing, not WebGL QA.
  await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('.tutorial-chapter').selectOption('basics');await page.locator('.tutorial-lesson').selectOption('ante-tie');await playOwn('red-10');await page.clock.runFor(2000);
  assert.equal(await revision(),'3');assert.equal((await latest()).game.phase,'play');assert.equal((await latest()).game.actions.length,0,'The real untied ante makes Jade lead');
  assert.equal((await latest()).actionReceipt.ok,true);assert.equal((await latest()).actionReceipt.revision,1,'Presentation never postpones the human action receipt');
  await page.clock.runFor(REVEAL_PRESENTATION_MS);assert.equal(await revision(),'3','Reveal and round banner finish before the next bot thinks');await dismissPowers();await page.clock.runFor(999);assert.equal(await revision(),'3');await page.clock.runFor(1);assert.equal(await revision(),'4');browserChecks++;
  await dismissPowers();await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.tutorial-restart').click();await playOwn('red-10');await page.clock.runFor(2000);assert.equal(await revision(),'3');await dismissPowers();
  await page.clock.runFor(999);assert.equal(await revision(),'3');await page.clock.runFor(1);assert.equal(await revision(),'4','Reduced motion skips only presentation, not the one-second thought');browserChecks++;
  await dismissPowers();await page.locator('.tutorial-lesson').selectOption('powers');
  await page.evaluate(()=>{window.__normalTimeout=window.setTimeout;window.__timerDelays=[];window.setTimeout=(fn,delay,...args)=>{window.__timerDelays.push(delay);return window.__normalTimeout(fn,delay,...args);};});
  await playOwn('black-3');await page.clock.runFor(60000);
  assert.equal(await revision(),'1','Reading the power has no automatic expiry');assert.equal(await page.locator('.power-overlay').isVisible(),true,'Real presentation CSS keeps the explanation visible');
  assert.equal(await page.evaluate(()=>window.__timerDelays.filter(delay=>delay===50).length),0,'Waiting for dismissal never starts 50ms busy polling');
  await page.evaluate(()=>window.setTimeout=window.__normalTimeout);
  await dismissPowers();await page.clock.runFor(999);assert.equal(await revision(),'1');await page.clock.runFor(1);assert.equal(await revision(),'2','Final dismissal starts exactly one fresh one-second bot thought');browserChecks++;
  await dismissPowers();await page.locator('.tutorial-restart').click();await playOwn('black-3');await page.evaluate(()=>window.handle.suspend());await page.clock.runFor(60000);assert.equal(await revision(),'1','Suspending a held explanation does not allow a bot action');await page.evaluate(()=>window.handle.resume());await page.clock.runFor(999);assert.equal(await revision(),'1');await page.clock.runFor(1);assert.equal(await revision(),'2','Resuming after a cleared explanation neither stalls nor catches up');browserChecks++;
  await dismissPowers();await page.locator('.tutorial-restart').click();await playOwn('black-3');assert.equal(await page.locator('.power-overlay').isVisible(),true);
  await page.locator('.tutorial-chapter').selectOption('game');assert.equal(await revision(),'0');assert.equal(await page.locator('.power-overlay').isVisible(),false,'Reset clears the old lesson presentation');await page.clock.runFor(1999);assert.equal(await revision(),'0','The old cue dismissal cannot shorten a new game’s opening two-second delay');await page.clock.runFor(1);assert.equal(await revision(),'1');browserChecks++;
  await page.setViewportSize({width:390,height:844});await page.locator('.tutorial-chapter').selectOption('mortal');await page.locator('.tutorial-lesson').selectOption('kobold');await playOwn('kobold');await dismissPowers();
  await page.locator('#confirm-action').scrollIntoViewIfNeeded();await page.locator('#confirm-action').click();assert.equal(await page.locator('.tda-tutorial').getAttribute('data-revision'),'2');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));browserChecks++;
  await page.screenshot({path:join(out,'tutorial-narrow.png')});
  await page.locator('.tutorial-lesson').selectOption('dragonrider');await page.locator('.tutorial-chapter').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'tutorial-narrow-guide.png')});
  await page.locator('.tutorial-close').click();assert.equal(await page.locator('.tda-tutorial').count(),0);assert.equal(await page.evaluate(()=>window.closedCount),1);assert.equal(await page.evaluate(()=>document.activeElement.id),'real-table');browserChecks++;
  await page.evaluate(()=>{window.handle.destroy();window.handle.setLanguage('en');});assert.equal(await page.locator('.tda-tutorial').count(),0);assert.equal(await page.evaluate(()=>window.closedCount),1);browserChecks++;
  await page.evaluate(()=>{window.handle=window.mountTutorial(document.querySelector('#practice'),'en',()=>window.closedCount++);});await page.locator('#hand .inspect-card').first().click();await page.keyboard.press('Escape');assert.equal(await page.locator('.tda-tutorial').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('.tda-tutorial').count(),0);assert.equal(await page.evaluate(()=>window.closedCount),2);browserChecks++;
  await page.evaluate(()=>{window.handle=window.mountTutorial(document.querySelector('#practice'),'en',()=>{});});await page.clock.runFor(1500);
  await page.evaluate(()=>window.handle.destroy());const closedViews=await page.evaluate(()=>window.__tutorialViews.length);await page.clock.runFor(5000);
  assert.equal(await page.evaluate(()=>window.__tutorialViews.length),closedViews,'Destroy cancels an actually scheduled opening opponent');assert.equal(await page.locator('.tda-tutorial').count(),0);browserChecks++;
  assert.deepEqual(errors,[]);browserChecks++;
  let mutations=0;
  // Compile/anchor failures are NOT kills. Only the named runtime assertion may fail.
  const mutants=[
    {name:'changed complete deal',anchor:"if (lessonId === 'game') return createGame({ id, seats, seed: 7341 });",replacement:"if (lessonId === 'game') return createGame({ id, seats, seed: 1 });",run(mod){const s=mod.createTutorialGame();assert.deepEqual(s,engine.createGame({id:s.id,seats:s.seats.map(({id,name})=>({id,name})),seed:7341}));}},
    {name:'event ring loses explanation',anchor:'const events = after.events.slice(retained);',replacement:'const events = after.events.slice(before.events.length);',run(mod){const s=mod.createTutorialGame('color');s.events=Array.from({length:100},(_,i)=>({code:'PAID_STAKES',amount:i}));const move=mod.tutorialMove(s,'color','mutant');const result=engine.applyAction(s,move);assert.ok(result.ok);assert.ok(mod.tutorialObservation(s,result.state,move,'en').some(v=>v.includes('Power triggered')));}},
    {name:'opponent ante leaked',anchor:"if (move.kind === 'ante') return move.seatId === 'you' ?",replacement:"if (move.kind === 'ante') return true ?",run(mod){const s=step(mod.createTutorialGame('ante-tie'),'ante-tie');const move=mod.tutorialMove(s,'ante-tie','mutant');const result=engine.applyAction(s,move);assert.ok(result.ok);assert.ok(!mod.tutorialObservation(s,result.state,move,'en').join('\n').includes('Green Dragon'));}},
    {name:'undo history missing',anchor:'history.push({ game, last });',replacement:'void ({ game, last });',async dom(){await playOwn();assert.equal(await page.locator('.tutorial-undo').isDisabled(),false);}},
    {name:'closed surface retained',anchor:'host.remove(); history.length = 0;',replacement:'void host; history.length = 0;',async dom(){await page.locator('.tutorial-close').click();assert.equal(await page.locator('.tda-tutorial').count(),0);}},
    {name:'Ember moves early',anchor:"key: 'opening:ember', seatId: 'ember', delay: 2000",replacement:"key: 'opening:ember', seatId: 'ember', delay: 1999",async dom(){await page.clock.runFor(1999);assert.equal(await revision(),'0','Ember must not act before 2000ms');}},
    {name:'Jade ignores your ante',anchor:"if (!Object.prototype.hasOwnProperty.call(game.committed, 'you')) return null;",replacement:'void 0;',async dom(){await page.clock.runFor(3000);assert.equal(await revision(),'1','Jade must wait for your ante');}},
    {name:'player resets Ember delay',anchor:"key: 'opening:ember', seatId: 'ember', delay: 2000",replacement:"key: `opening:ember:${game.revision}`, seatId: 'ember', delay: 2000",async dom(){await page.clock.runFor(500);await playOwn();await page.clock.runFor(1500);assert.equal(await revision(),'2','Your early action must not restart the Ember timer');}},
    {name:'bot skips post-presentation thought',anchor:'scheduleBot(1000);',replacement:'scheduleBot(0);',async dom(){await page.locator('.tutorial-chapter').selectOption('basics');await page.locator('.tutorial-lesson').selectOption('powers');await playOwn('black-3');await dismissPowers();await page.clock.runFor(999);assert.equal(await revision(),'1','A bot must wait a full second after all presentations');}},
  ];
  for(const [index,mutant] of mutants.entries()){
    let applied=0;const file=join(out,`mutant-${index}.mjs`);
    await build({input:resolve(base,'tutorial.ts'),plugins:[styles,{name:'unique-mutation',transform(code,id){if(id.replaceAll('\\','/').endsWith('/tutorial.ts')){code=code.replaceAll('\r\n','\n');assert.equal(code.split(mutant.anchor).length-1,1,mutant.name);applied++;return code.replace(mutant.anchor,mutant.replacement);}},buildEnd(){assert.equal(applied,1);}}],output:{file,format:'esm'},logLevel:'silent'});
    const mod=await import(pathToFileURL(file).href);
    if(mutant.dom){await page.evaluate(()=>document.querySelector('#practice').replaceChildren());await page.addScriptTag({type:'module',content:readFileSync(file,'utf8').replace(/export\s*\{[^}]*\};?\s*$/,'')+'\nwindow.mutantMount=mountTutorial;'});await page.evaluate(()=>{window.mutantHandle=window.mutantMount(document.querySelector('#practice'),'en',()=>{});});}
    let killed=false;try{if(mutant.run)mutant.run(mod);else await mutant.dom();}catch(error){if(error instanceof assert.AssertionError)killed=true;else throw new Error(`Unexpected mutant failure: ${mutant.name}`,{cause:error});}
    if(mutant.dom){await page.evaluate(()=>{window.mutantHandle.destroy();document.querySelector('#practice').replaceChildren();});await page.emulateMedia({reducedMotion:'reduce'});}
    assert.ok(killed,`survived: ${mutant.name}`);mutations++;console.log(`KILL ${mutant.name}`);
  }
  writeFileSync(join(out,'result.json'),JSON.stringify({engineChecks:checks,browserChecks,mutations,automaticFullGame:{steps:completeSteps,...automatic},revealPresentationMs:REVEAL_PRESENTATION_MS,presentationDismissals,powerDismissal:'A real pointer down/up click for every visible cue; no timer-driven expiry.',timing:'Actual Chrome DOM/engine and Playwright controlled browser clock. Scheduled bot actions are real; no manual opponent buttons. Visibility event is simulated; shared reveal interval checked with and without reduced motion, plus indefinite power reading, real dismissal, no busy polling and a fresh one-second bot delay; not a WebGL animation review. No native Owlbear/network.',evidence:out,nativeOwlbear:false},null,2));console.log(`${browserChecks} actual browser checks and ${mutations} runtime-assertion mutations passed. Evidence: ${out}`);
}finally{await browser.close();}
