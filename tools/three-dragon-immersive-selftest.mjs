import { build } from 'rolldown';
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = mkdtempSync(join(tmpdir(), 'three-dragon-immersive-'));
const images = process.env.THREE_DRAGON_IMMERSIVE_SCREENSHOTS ?? join(tmpdir(), 'three-dragon-immersive-screens');
mkdirSync(images, { recursive: true }); let browser, assertions = 0;
const check = (ok, label) => { if (!ok) throw Error(`ASSERTION: ${label}`); assertions++; };
try {
  const file = join(out, 'ui.js'); await build({ input: resolve('tools/three-dragon-ui-selftest.entry.ts'), plugins:[{name:'immersive-mutation',resolveId(id){if(id.endsWith('.css'))return '\0test-css';},load(id){if(id==='\0test-css')return '';},transform(code,id){
    if(!process.env.THREE_DRAGON_IMMERSIVE_MUTANT||!id.replaceAll('\\','/').endsWith('/game/ui.ts'))return;
    const target={'expired-phase':['incoming.selectionKey!==selectionKey','false'],'private-preview':['else hidePreview();','else { /* mutation: keep private preview */ }']}[process.env.THREE_DRAGON_IMMERSIVE_MUTANT];
    if(!target||code.split(target[0]).length!==2)throw Error('Mutation target must occur exactly once');return code.replace(target[0],target[1]);
  }}], output: { file, format: 'iife' } });
  if(process.env.THREE_DRAGON_IMMERSIVE_MUTANT)console.log(`MUTATION_BUNDLED ${process.env.THREE_DRAGON_IMMERSIVE_MUTANT}`);
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  for (const [count, language, width, height] of [[2,'en',1440,900],[6,'zh',1440,900],[6,'en',390,780],[2,'zh',390,780]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 500 });
    await page.route('http://localhost/table-ui',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><main id="table-app"></main>'}));await page.goto('http://localhost/table-ui');
    await page.setContent('<main id="table-app"></main>'); for(const css of ['style.css','stage-ui.css'])await page.addStyleTag({ content: readFileSync(`extensions/three-dragon-ante/src/game/${css}`, 'utf8') }); await page.addScriptTag({ path: file });
    check(await page.locator('#table-app').getAttribute('data-renderer')==='dom',`${count}/${language}: actual WebGL-unavailable fallback is visible`);
    await page.evaluate(({ count, language }) => { window.visual = window.scenario(count); window.ui.language(language); }, { count, language });
    check(await page.locator('#players .seat').count() === count, `${count}/${language}: all public seats rendered`);
    check(await page.locator('.opponent-hand').count() === count - 1, `${count}/${language}: opponents show only backs and counts`);
    check(await page.evaluate(() => !window.otherVisualHand.some(id => document.querySelector(`[data-card="${id}"]`))), `${count}/${language}: opponents private cards absent from DOM`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#hand').getBoundingClientRect().bottom <= innerHeight), `${count}/${language}: own hand stays at viewport bottom without page overflow`);
    check(await page.locator('#players .flight .card').count() > 0 && await page.locator('#deck-pile').innerText().then(text => /\d/.test(text)), `${count}/${language}: public flights and deck count visible`);
    await page.locator('#hand .inspect-card').first().click();
    check(await page.locator('#card-preview').isVisible() && (await page.locator('.preview-hint').textContent()).length > 5, `${count}/${language}: explicit tap opens readable card ability`);
    check(await page.evaluate(() => window.commands.length) === 0, `${count}/${language}: inspect does not execute a game action`);
    await page.locator('#close-preview').click(); await page.mouse.move(2,2);
    await page.evaluate(()=>Promise.allSettled(document.getAnimations().map(a=>a.finished)));await page.screenshot({ path: join(images, `${count}-${language}-${width}.png`) });
    if (width >= 1000) {
      const reachableFlights=async(label)=>{for(const card of await page.locator('#players .flight .card').all()){await card.scrollIntoViewIfNeeded();check(await card.evaluate(card=>{const board=document.querySelector('#board-scroll').getBoundingClientRect(),rect=card.getBoundingClientRect();return rect.top>=board.top-1&&rect.bottom<=board.bottom+1&&rect.width>=60;}),label);}check(await page.locator('#close').isVisible()&&await page.locator('#hand').isVisible(),'scrolling fallback public cards retains hand and return-to-map access');};
      if(count===2)check(await page.evaluate(() => {const board=document.querySelector('#board-scroll').getBoundingClientRect();return [...document.querySelectorAll('#players .flight .card')].every(card=>{const rect=card.getBoundingClientRect();return rect.top>=board.top&&rect.bottom<=board.bottom&&rect.width>=60;});}), `${count}/${language}: desktop public flights are fully visible with readable card size`);
      else await reachableFlights(`${count}/${language}: each public flight remains fully reachable and readable in scrollable DOM fallback`);
      const card = page.locator('#hand .card').first(); await card.hover(); check(await page.locator('#card-preview').isVisible(), `${count}/${language}: mouse hover enlarges card information`);
      await page.mouse.move(0,0); await card.focus(); check(await page.locator('#card-preview').isVisible(), `${count}/${language}: keyboard focus previews card`);
      await page.keyboard.press('Escape'); check(await page.locator('#card-preview').isHidden(), `${count}/${language}: Escape dismisses preview`);
      if(count===6){await page.evaluate(()=>window.scenario(6,true));check(await page.evaluate(()=>window.current.game.actions[0]?.kind==='play'&&!document.querySelector('#confirm-action')&&!!document.querySelector('.seat.self [data-drop-zone=flight]')), 'six-player own turn uses current legal play and own drop area without obsolete confirm');await reachableFlights('six-player own turn keeps every public flight reachable above the fixed dock after scrolling');await page.evaluate(()=>Promise.allSettled(document.getAnimations().map(a=>a.finished)));await page.screenshot({path:join(images,'6-zh-own-turn-1440.png')});}
      if(count===2){
        await page.evaluate(()=>window.scenario(2,true));
        const points=await page.evaluate(()=>{const card=document.querySelector('#hand [data-card]'),r=card.getBoundingClientRect(),slot=document.querySelector('.seat.self [data-drop-zone=flight]').getBoundingClientRect();return{cardId:card.dataset.card,from:{x:r.left+15,y:r.top+40},to:{x:slot.left+slot.width/2,y:slot.top+slot.height/2},revision:window.current.game.revision};});
        await page.mouse.move(points.from.x,points.from.y);await page.mouse.down();await page.mouse.move(points.to.x,points.to.y,{steps:8});await page.mouse.up();
        check(await page.evaluate(p=>window.commands.filter(c=>c.type==='action').length===1&&window.commands.at(-1).action.kind==='play'&&window.commands.at(-1).action.cardId===p.cardId&&window.commands.at(-1).action.revision===p.revision,points),'actual DOM-fallback pointer drop submits one current legal play');
      }
    } else {
      await page.locator('#hand .card').first().tap(); check(await page.locator('#card-preview').isVisible(), `${count}/${language}: touch face tap previews without autoplay`);
      const before = await page.evaluate(() => window.commands.length); await page.locator('#close-preview').click(); check(await page.evaluate(() => window.commands.length) === before, `${count}/${language}: touch dismissal never confirms a card`);
      await page.locator('#hand .cards').evaluate(element => { element.scrollLeft = element.scrollWidth; });
      check(await page.locator('#hand .card').last().boundingBox().then(box => box.x + box.width <= width), `${count}/${language}: last hand card remains reachable horizontally`);
    }
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 800, height: 720 } });await page.route('http://localhost/table-ui',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><main id="table-app"></main>'}));await page.goto('http://localhost/table-ui'); await page.setContent('<main id="table-app"></main>'); for(const css of ['style.css','stage-ui.css'])await page.addStyleTag({ content: readFileSync(`extensions/three-dragon-ante/src/game/${css}`, 'utf8') }); await page.addScriptTag({ path: file });
  await page.evaluate(() => {window.draftView=window.choice('EXCHANGE_HAND_CARDS',0,2);window.set(window.draftView);}); await page.locator('#turn [data-option=c1]').click(); const chosen = await page.locator('#turn [aria-pressed=true]').getAttribute('data-option');
  await page.locator('#display-mode').click();
  check(await page.evaluate(() => window.commands.at(-1).type === 'display' && window.commands.at(-1).mode === 'compact' && !window.commands.at(-1).action), 'mode switch sends only a LOCAL UI draft, never a rules action');
  await page.evaluate(() => window.remount('compact',window.draftView,window.commands.at(-1).draft));
  check(await page.locator('#turn [aria-pressed=true]').getAttribute('data-option') === chosen, 'same table/game/legal phase restores unconfirmed selection');
  check(await page.evaluate(() => !window.commands.some(command => command.type === 'action')), 'restoring an unconfirmed selection never executes it');
  check((await page.locator('#display-mode').innerText()).includes('Expand'), 'compact view exposes return to full table');
  await page.evaluate(() => { const draft=window.ui.draft(),next=structuredClone(window.draftView);next.game.gambit++;window.remount('full',next,draft); });
  check(await page.locator('#turn [aria-pressed=true]').count() === 0, 'new gambit rejects old unconfirmed draft');
  await page.evaluate(() => { const next=structuredClone(window.draftView),draft=window.commands.at(-1).draft;draft.selected=['not-an-eligible-card'];window.remount('full',next,draft); });
  check(await page.locator('#turn [aria-pressed=true]').count() === 0, 'restored draft filters IDs against current legal options');
  await page.locator('#turn [data-option=c2]').click(); const latest = await page.locator('#turn [aria-pressed=true]').getAttribute('data-option');
  await page.evaluate(() => window.ui.restore(window.commands.at(-1).draft));
  check(await page.locator('#turn [aria-pressed=true]').getAttribute('data-option') === latest, 'late restore cannot overwrite a fresh user selection');
  if(await page.locator('#card-preview').isVisible()){if(await page.locator('#card-preview').getAttribute('data-pinned')==='true')await page.locator('#close-preview').click();else await page.keyboard.press('Escape');check(await page.locator('#card-preview').isHidden(),'choice preview dismisses through its current input mode');}
  await page.locator('#hand .inspect-card').first().click(); await page.evaluate(() => window.set({...window.base,isHost:false,selfPlayerId:'watcher',game:window.publicGame}));
  check(await page.locator('#card-preview').isHidden() && await page.locator('#hand').isHidden(), 'spectator transition clears private hand preview');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.evaluate(() => window.set(window.base)); await page.locator('#hand .card').first().hover();
  check(await page.locator('#hand .card').first().evaluate(card => getComputedStyle(card).transform === 'none'), 'reduced motion disables hover movement');
  console.log(`PASS ${assertions} actual DOM-fallback assertions (WebGL intentionally unavailable, no GPU coverage); screenshots: ${images}`);
} finally { await browser?.close(); rmSync(out, { recursive: true, force: true }); }
