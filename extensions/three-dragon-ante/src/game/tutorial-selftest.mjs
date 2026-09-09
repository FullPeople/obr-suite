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
const styles = { name: 'no-css', resolveId(id) { if (id.endsWith('.css')) return '\0tutorial-style'; }, load(id) { if (id === '\0tutorial-style') return ''; } };
await build({ input: resolve(base, 'tutorial.ts'), plugins: [styles], output: { file: entry, format: 'esm' }, logLevel: 'silent' });
await build({ input: resolve(base, 'rules/index.ts'), output: { file: join(out, 'engine.mjs'), format: 'esm' }, logLevel: 'silent' });
const t = await import(pathToFileURL(entry).href), engine = await import(pathToFileURL(join(out, 'engine.mjs')).href);
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
console.log(`${checks} engine/teaching checks passed. Browser checks starting.`);
// Keep evidence in a fresh temp directory; no dependency on an active room or saved state.
const { chromium } = await import(pathToFileURL('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true });
let browserChecks=0;
try {
  const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',route=>route.abort());
  await page.setContent(`<style>${readFileSync(join(base,'style.css'),'utf8')}\n${readFileSync(join(base,'tutorial.css'),'utf8')}</style><button id="real-table">Real table</button><div id="practice"></div>`);
  await page.addScriptTag({type:'module',content:readFileSync(entry,'utf8').replace(/export\s*\{[^}]*\};?\s*$/,'')+'\nwindow.mountTutorial=mountTutorial;'});
  await page.waitForFunction(()=>typeof window.mountTutorial==='function');
  await page.evaluate(()=>{document.querySelector('#real-table').focus();window.closedCount=0;window.handle=window.mountTutorial(document.querySelector('#practice'),'en',()=>window.closedCount++);});
  await page.locator('.tutorial-chapter').selectOption('basics');await page.locator('.tutorial-lesson').selectOption('powers');
  await page.locator('#hand button[data-card="black-3"]').click();await page.locator('#confirm-action').click();
  assert.match(await page.locator('.tutorial-result').innerText(),/Power triggered/);assert.equal(await page.locator('.tda-tutorial').getAttribute('data-revision'),'1');browserChecks++;
  await page.locator('.tutorial-undo').click();assert.equal(await page.locator('.tda-tutorial').getAttribute('data-revision'),'0');
  await page.locator('#hand button[data-card="gold-13"]').click();await page.locator('#confirm-action').click();assert.match(await page.locator('.tutorial-result').innerText(),/does not trigger/);browserChecks++;
  const oldGame=await page.locator('.tda-tutorial').getAttribute('data-revision');await page.evaluate(()=>window.handle.setLanguage('zh'));assert.equal(await page.locator('.tda-tutorial').getAttribute('data-revision'),oldGame);assert.match(await page.locator('.tutorial-result').innerText(),/不发动能力/);browserChecks++;
  await page.locator('.tutorial-restart').click();await page.locator('#hand button[data-card="black-3"]').click();await page.evaluate(()=>window.handle.setLanguage('en'));assert.equal(await page.locator('#hand button[data-card="black-3"]').getAttribute('aria-pressed'),'true');browserChecks++;
  await page.locator('.tutorial-step').click();const revision=await page.locator('.tda-tutorial').getAttribute('data-revision');await page.waitForTimeout(600);assert.equal(await page.locator('.tda-tutorial').getAttribute('data-revision'),revision);browserChecks++;
  assert.equal(await page.locator('.tda-tutorial #tutorial:visible,.tda-tutorial #language:visible,.tda-tutorial #display-mode:visible,.tda-tutorial #close:visible').count(),0);browserChecks++;
  await page.screenshot({path:join(out,'tutorial-wide.png')});
  await page.locator('.tutorial-chapter').selectOption('game');for(let i=0;i<35;i++)await page.locator('.tutorial-step').click();assert.match(await page.locator('.tutorial-suggestion').innerText(),/game is complete/);assert.equal(await page.locator('.tutorial-step').isDisabled(),true);browserChecks++;
  await page.setViewportSize({width:390,height:844});await page.locator('.tutorial-chapter').selectOption('mortal');await page.locator('.tutorial-lesson').selectOption('kobold');await page.locator('.tutorial-step').click();
  await page.locator('#confirm-action').scrollIntoViewIfNeeded();await page.locator('#confirm-action').click();assert.equal(await page.locator('.tda-tutorial').getAttribute('data-revision'),'2');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));browserChecks++;
  await page.screenshot({path:join(out,'tutorial-narrow.png')});
  await page.locator('.tutorial-lesson').selectOption('dragonrider');await page.locator('.tutorial-chapter').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'tutorial-narrow-guide.png')});
  await page.locator('.tutorial-close').click();assert.equal(await page.locator('.tda-tutorial').count(),0);assert.equal(await page.evaluate(()=>window.closedCount),1);assert.equal(await page.evaluate(()=>document.activeElement.id),'real-table');browserChecks++;
  await page.evaluate(()=>{window.handle.destroy();window.handle.setLanguage('en');});assert.equal(await page.locator('.tda-tutorial').count(),0);assert.equal(await page.evaluate(()=>window.closedCount),1);browserChecks++;
  await page.evaluate(()=>{window.handle=window.mountTutorial(document.querySelector('#practice'),'en',()=>window.closedCount++);});await page.locator('#hand .inspect-card').first().click();await page.keyboard.press('Escape');assert.equal(await page.locator('.tda-tutorial').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('.tda-tutorial').count(),0);assert.equal(await page.evaluate(()=>window.closedCount),2);browserChecks++;
  assert.deepEqual(errors,[]);browserChecks++;
  let mutations=0;
  // Compile/anchor failures are NOT kills. Only the named runtime assertion may fail.
  const mutants=[
    {name:'changed complete deal',anchor:"if (lessonId === 'game') return createGame({ id, seats, seed: 7341 });",replacement:"if (lessonId === 'game') return createGame({ id, seats, seed: 1 });",run(mod){const s=mod.createTutorialGame();assert.deepEqual(s,engine.createGame({id:s.id,seats:s.seats.map(({id,name})=>({id,name})),seed:7341}));}},
    {name:'event ring loses explanation',anchor:'const events = after.events.slice(retained);',replacement:'const events = after.events.slice(before.events.length);',run(mod){const s=mod.createTutorialGame('color');s.events=Array.from({length:100},(_,i)=>({code:'PAID_STAKES',amount:i}));const move=mod.tutorialMove(s,'color','mutant');const result=engine.applyAction(s,move);assert.ok(result.ok);assert.ok(mod.tutorialObservation(s,result.state,move,'en').some(v=>v.includes('Power triggered')));}},
    {name:'opponent ante leaked',anchor:"if (move.kind === 'ante') return move.seatId === 'you' ?",replacement:"if (move.kind === 'ante') return true ?",run(mod){const s=step(mod.createTutorialGame('ante-tie'),'ante-tie');const move=mod.tutorialMove(s,'ante-tie','mutant');const result=engine.applyAction(s,move);assert.ok(result.ok);assert.ok(!mod.tutorialObservation(s,result.state,move,'en').join('\n').includes('Green Dragon'));}},
    {name:'undo history missing',anchor:'history.push({ game, last });',replacement:'void ({ game, last });',async dom(){await page.locator('.tutorial-step').click();assert.equal(await page.locator('.tutorial-undo').isDisabled(),false);}},
    {name:'closed surface retained',anchor:'host.remove(); history.length = 0;',replacement:'void host; history.length = 0;',async dom(){await page.locator('.tutorial-close').click();assert.equal(await page.locator('.tda-tutorial').count(),0);}},
  ];
  for(const [index,mutant] of mutants.entries()){
    let applied=0;const file=join(out,`mutant-${index}.mjs`);
    await build({input:resolve(base,'tutorial.ts'),plugins:[styles,{name:'unique-mutation',transform(code,id){if(id.replaceAll('\\','/').endsWith('/tutorial.ts')){code=code.replaceAll('\r\n','\n');assert.equal(code.split(mutant.anchor).length-1,1,mutant.name);applied++;return code.replace(mutant.anchor,mutant.replacement);}},buildEnd(){assert.equal(applied,1);}}],output:{file,format:'esm'},logLevel:'silent'});
    const mod=await import(pathToFileURL(file).href);
    if(mutant.dom){await page.evaluate(()=>document.querySelector('#practice').replaceChildren());await page.addScriptTag({type:'module',content:readFileSync(file,'utf8').replace(/export\s*\{[^}]*\};?\s*$/,'')+'\nwindow.mutantMount=mountTutorial;'});await page.evaluate(()=>{window.mutantHandle=window.mutantMount(document.querySelector('#practice'),'en',()=>{});});}
    let killed=false;try{if(mutant.run)mutant.run(mod);else await mutant.dom();}catch(error){if(error instanceof assert.AssertionError)killed=true;else throw new Error(`Unexpected mutant failure: ${mutant.name}`,{cause:error});}
    if(mutant.dom)await page.evaluate(()=>{window.mutantHandle.destroy();document.querySelector('#practice').replaceChildren();});
    assert.ok(killed,`survived: ${mutant.name}`);mutations++;console.log(`KILL ${mutant.name}`);
  }
  writeFileSync(join(out,'result.json'),JSON.stringify({engineChecks:checks,browserChecks,mutations,evidence:out,nativeOwlbear:false},null,2));console.log(`${browserChecks} actual browser checks and ${mutations} runtime-assertion mutations passed. Evidence: ${out}`);
}finally{await browser.close();}
