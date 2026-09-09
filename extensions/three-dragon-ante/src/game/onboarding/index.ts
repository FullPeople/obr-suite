import { onboardingArt } from './art';
import './style.css';

export type OnboardingLanguage = 'zh' | 'en';
export type OnboardingZone = 'hand' | 'ownAnte' | 'ownFlight' | 'stakes';
export interface OnboardingOptions {
  language: OnboardingLanguage;
  onClose(): void;
  onPractice(): void;
  /** Optional underlying-table anchor. Offscreen or invalid anchors are ignored. */
  getAnchor?(zone: OnboardingZone): DOMRect | null;
}
export interface OnboardingHandle { setLanguage(language: OnboardingLanguage): void; destroy(): void }
type Words = readonly [string, string];
type GlossaryTerm = { term: Words; meaning: Words };
// Concise interface explanations of Legendary Edition pp. 6–11. No rules actions.
const pages: readonly { zone: OnboardingZone; eyebrow: Words; title: Words; body: Words; tip: Words; caption: Words; steps?: readonly Words[]; results?: readonly Words[]; glossary: readonly GlossaryTerm[] }[] = [
  { zone: 'hand', eyebrow: ['基本流程', 'Game flow'], title: ['三龙牌', 'Three-Dragon Ante'],
    body: ['和多名玩家一起打牌。支持 2–6 人；加入牌桌后，由创建者开始游戏。', 'Play cards with other players. A table has 2–6 players; its creator starts the game after everyone joins.'],
    steps: [['暗置放牌', 'Commit a face-down card'], ['同时翻出', 'Reveal all ante cards'], ['结算效果', 'Resolve payment and the leader'], ['轮流出牌', 'Take turns playing cards'], ['循环直到轮次结束', 'Continue until the round ends']],
    tip: ['每人每轮出一张牌；每轮局通常进行三轮，再结算奖池。手牌只对本人可见。', 'Each player plays one card per round. A gambit normally lasts three rounds, then the stakes are awarded. Only you can see your hand.'],
    caption: ['手牌在下方，公开牌在桌面上。', 'Your hand is below; public cards are on the table.'],
    glossary: [{ term: ['暗置', 'Face down'], meaning: ['牌面朝下，暂不公开。', 'Keep the card face hidden.'] }, { term: ['轮次', 'Round'], meaning: ['每位玩家各行动一次。', 'Each player takes one turn.'] }, { term: ['轮局', 'Gambit'], meaning: ['从暗置到奖池结算，通常三轮。', 'From ante to scoring; usually three rounds.'] }] },
  { zone: 'ownAnte', eyebrow: ['第一步：选择下注牌', 'Step 1: Commit an ante'], title: ['先暗置一张下注牌', 'Commit one card face down'],
    body: ['把一张手牌拖进自己身前的暗置区，松手提交。所有人提交后一起翻开；提交成功后不能收回，下注牌的能力不会因此发动。', 'Drag one hand card into your face-down slot and release. The cards are revealed when everyone has committed. An accepted ante cannot be withdrawn; its power does not trigger from being anted.'],
    results: [['每人付款 = 最高下注牌点数，包含并列最高。', 'Everyone pays the highest ante strength, including tied highest cards.'], ['领出者 = 点数最高且不并列的下注牌玩家。', 'The highest untied ante determines who leads.']],
    tip: ['例如 9、9、6：每人付 9 金币，出 6 的玩家领出。若每张牌都与其他牌并列，全部弃掉、每人抓一张并重新暗置，这次不付款。', 'Example: 9, 9, 6 means everyone pays 9 gold and the player who anted 6 leads. If every card is tied with another, discard all antes, draw one each and ante again without paying.'],
    caption: ['下注牌公开保留；被能力取走或轮局结束时移除。', 'Antes stay public until taken by an effect or the gambit ends.'],
    glossary: [{ term: ['下注牌', 'Ante card'], meaning: ['每轮局先暗置后翻开的牌。', 'The card committed before a gambit.'] }, { term: ['并列', 'Tied'], meaning: ['至少两张牌点数相同。', 'Two or more cards have equal strength.'] }, { term: ['领出', 'Leader'], meaning: ['本轮第一个出牌的玩家。', 'The player who acts first this round.'] }] },
  { zone: 'ownFlight', eyebrow: ['第二步：轮流出牌', 'Step 2: Take turns'], title: ['轮到你时出一张牌', 'Play one card on your turn'],
    body: ['把一张手牌拖到自己的牌阵，正面朝上加入已有的牌。领出的牌直接发动能力；其余玩家出的牌，通常在点数不大于右邻本轮所出牌时发动能力。', 'Drag one hand card to your flight, face up beside your earlier cards. The leader’s card triggers its power. Other cards normally trigger when their strength is no greater than the card played by the player on the right this round.'],
    tip: ['出现选择时，按提示选择牌或目标并确认。先结算能力，再结算同色或同点数组合奖励。未发动能力的牌也保持公开；不能随意跳过出牌或主动买牌。', 'When prompted, select the required cards or targets and confirm. Powers resolve before color or strength flight rewards. Cards remain face up even without triggering. You cannot pass or buy cards whenever you want.'],
    caption: ['点牌查看；拖到自己的牌阵才出牌。', 'Tap to inspect; drag to your flight to play.'],
    glossary: [{ term: ['牌阵', 'Flight'], meaning: ['你在本轮局已公开打出的牌。', 'The face-up cards you played this gambit.'] }, { term: ['触发', 'Trigger'], meaning: ['满足条件，执行卡牌能力。', 'Meet a condition and resolve the power.'] }, { term: ['右邻', 'Right-hand player'], meaning: ['按顺时针顺序，在你之前行动的玩家。', 'The player before you in clockwise order.'] }] },
  { zone: 'stakes', eyebrow: ['第三步：结算', 'Step 3: Score'], title: ['比较牌阵，结算金币', 'Score flights and award gold'],
    body: ['通常三轮后，总强度最高的牌阵赢得奖池；最高总强度并列则所有人再打一轮。特殊牌可能改变胜负或增加轮次。奖池被取空时，轮局立即结束并结算。', 'Normally, after three rounds, the strongest flight wins the stakes. If the highest totals are tied, everyone plays another round. Special cards can change scoring or add a round. Empty stakes end the gambit immediately.'],
    tip: ['先分配奖池，再将未付款补入偿债池。此时有人没有金币，整局结束：金币最多者获胜，并获得偿债池；并列胜者共享胜利。否则每人抓两张，开始下一轮局。', 'Award the stakes, then pay any unpaid amount into the hole. If anyone now has no gold, the game ends: the richest player wins and takes the hole; tied winners share victory. Otherwise, draw two cards each and start the next gambit.'],
    caption: ['金币自动结算。练习不会改动房间牌局。', 'Gold resolves automatically. Practice does not change the room game.'],
    glossary: [{ term: ['总强度', 'Total strength'], meaning: ['牌阵点数之和，计入特殊效果。', 'The flight’s strength after special effects.'] }, { term: ['奖池', 'Stakes'], meaning: ['本轮局供玩家争取的金币。', 'The gold contested in this gambit.'] }, { term: ['偿债池', 'Hole'], meaning: ['轮局末补付的金币，暂时移出游戏。', 'Unpaid gold settled after a gambit and set aside.'] }] },
];

/** Pure UI: no SDK, storage, network, or rules actions. The caller owns first-run policy. */
export function mountOnboarding(parent: HTMLElement, options: OnboardingOptions): OnboardingHandle {
  let language = options.language, page = 0, destroyed = false, swipe: { id: number; x: number; y: number } | null = null;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const abort = new AbortController(), id = `tda-guide-${crypto.randomUUID()}`;
  const dialog = document.createElement('dialog'); dialog.className = 'tda-onboarding';
  dialog.setAttribute('aria-labelledby', `${id}-title`); dialog.setAttribute('aria-describedby', `${id}-body`);
  dialog.innerHTML = `<header class="tda-guide-header"><span class="tda-guide-brand"><span aria-hidden="true">◇</span><span class="tda-guide-name"></span></span><aside class="tda-guide-glossary"><h2></h2><dl></dl></aside><button class="tda-guide-close" type="button">×</button></header>
    <div class="tda-guide-body"><div class="tda-guide-visual"><div class="tda-guide-art"></div><p class="tda-guide-caption"></p></div>
    <section class="tda-guide-copy"><p class="tda-guide-eyebrow"></p><h1 id="${id}-title" tabindex="-1"></h1><p id="${id}-body" class="tda-guide-description"></p><ol class="tda-guide-flow"></ol><div class="tda-guide-results"></div><p class="tda-guide-tip"></p><span class="tda-guide-table-anchor" hidden></span></section></div>
    <footer class="tda-guide-footer"><div class="tda-guide-progress" role="group"></div><p class="tda-guide-step" aria-live="polite"></p><div class="tda-guide-actions"><button class="tda-guide-skip" type="button"></button><button class="tda-guide-back" type="button"></button><button class="tda-guide-next" type="button"></button></div></footer>`;
  const find = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const words = (value: Words) => value[language === 'zh' ? 0 : 1];
  const title = find<HTMLHeadingElement>('h1'), art = find('.tda-guide-art'), progress = find('.tda-guide-progress');
  const dots = pages.map((_, index) => { const button = document.createElement('button'); button.type = 'button'; button.dataset.step = String(index); button.append(document.createElement('span')); progress.append(button); return button; });
  const listen = (target: EventTarget, type: string, listener: EventListener) => target.addEventListener(type, listener, { signal: abort.signal });
  function updateAnchor() {
    if (destroyed) return;
    const marker = find('.tda-guide-table-anchor'); marker.hidden = true;
    let rect: DOMRect | null = null;
    try { rect = options.getAnchor?.(pages[page].zone) ?? null; } catch { return; }
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return;
    // A dialog may hide its underlying table. Provide location text, never a false arrow through the modal.
    const zones: Record<OnboardingZone, Words> = { hand: ['你的手牌', 'Your hand'], ownAnte: ['身前暗置槽', 'Your face-down slot'], ownFlight: ['你的公开牌阵', 'Your face-up flight'], stakes: ['中央奖池', 'The central stakes'] };
    marker.hidden = false; marker.textContent = words(['牌桌区域 · ', 'On the table · ']) + words(zones[pages[page].zone]);
  }
  function render(changeArt = false) {
    if (destroyed) return;
    const content = pages[page]; dialog.lang = language === 'zh' ? 'zh-CN' : 'en'; dialog.dataset.step = String(page);
    if (changeArt) art.innerHTML = onboardingArt(page, `${id}-${page}`);
    find('.tda-guide-name').textContent = words(['三龙牌', 'Three-Dragon Ante']);
    find('.tda-guide-glossary h2').textContent = words(['本页术语', 'Terms on this page']);
    const glossary = find('dl'); glossary.replaceChildren();
    for (const value of content.glossary) { const term = document.createElement('dt'), meaning = document.createElement('dd'); term.textContent = words(value.term); meaning.textContent = words(value.meaning); glossary.append(term, meaning); }
    const flow = find('.tda-guide-flow'); flow.replaceChildren(); flow.hidden = !content.steps;
    for (const value of content.steps ?? []) { const step = document.createElement('li'); step.textContent = words(value); flow.append(step); }
    const results = find('.tda-guide-results'); results.replaceChildren(); results.hidden = !content.results;
    for (const value of content.results ?? []) { const result = document.createElement('p'); result.textContent = words(value); results.append(result); }
    find('.tda-guide-eyebrow').textContent = words(content.eyebrow); title.textContent = words(content.title);
    find('.tda-guide-description').textContent = words(content.body); find('.tda-guide-tip').textContent = words(content.tip); find('.tda-guide-caption').textContent = words(content.caption);
    find('.tda-guide-close').setAttribute('aria-label', words(['关闭介绍，返回牌桌', 'Close introduction and return to the table']));
    find('.tda-guide-skip').textContent = words(['直接入座', 'Take a seat']);
    find<HTMLButtonElement>('.tda-guide-back').textContent = words(['上一步', 'Back']); find<HTMLButtonElement>('.tda-guide-back').disabled = page === 0;
    find('.tda-guide-next').textContent = page === pages.length - 1 ? words(['开始练习', 'Start practice']) : words(['下一步', 'Next']);
    progress.setAttribute('aria-label', words(['介绍进度', 'Introduction progress']));
    find('.tda-guide-step').textContent = language === 'zh' ? `${page + 1} / ${pages.length} · ${words(content.eyebrow)}` : `${page + 1} of ${pages.length} · ${words(content.eyebrow)}`;
    dots.forEach((dot, index) => { dot.setAttribute('aria-label', words([`第 ${index + 1} 页：${pages[index].title[0]}`, `Page ${index + 1}: ${pages[index].title[1]}`])); if (index === page) dot.setAttribute('aria-current', 'step'); else dot.removeAttribute('aria-current'); });
    updateAnchor();
  }
  function go(next: number) { if (destroyed || next < 0 || next >= pages.length || next === page) return; page = next; swipe = null; render(true); find('.tda-guide-body').scrollTop = 0; }
  function destroy() {
    if (destroyed) return; destroyed = true; swipe = null; abort.abort(); resize.disconnect();
    if (dialog.open) dialog.close(); dialog.remove();
    if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
  }
  function finish(practice = false) { if (destroyed) return; destroy(); if (practice) options.onPractice(); else options.onClose(); }
  listen(find('.tda-guide-close'), 'click', () => finish()); listen(find('.tda-guide-skip'), 'click', () => finish());
  listen(find('.tda-guide-back'), 'click', () => go(page - 1));
  listen(find('.tda-guide-next'), 'click', () => { if (page === pages.length - 1) finish(true); else go(page + 1); });
  dots.forEach((dot, index) => listen(dot, 'click', () => go(index)));
  listen(dialog, 'cancel', event => { event.preventDefault(); finish(); });
  listen(dialog, 'keydown', event => {
    const key = event as KeyboardEvent;
    if (key.key === 'Tab' && !key.altKey && !key.ctrlKey && !key.metaKey) {
      const available = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(button => button.getClientRects().length > 0);
      const current = available.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0 || !key.shiftKey && current === available.length - 1 || key.shiftKey && current === 0) {
        key.preventDefault(); available[key.shiftKey ? available.length - 1 : 0]?.focus();
      }
      return;
    }
    if (key.altKey || key.ctrlKey || key.metaKey || key.shiftKey) return;
    if (key.key === 'ArrowRight') { key.preventDefault(); go(page + 1); }
    if (key.key === 'ArrowLeft') { key.preventDefault(); go(page - 1); }
  });
  listen(art, 'pointerdown', event => { const e = event as PointerEvent; if (!e.isPrimary) { swipe = null; return; } if (e.pointerType === 'touch') swipe = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
  listen(art, 'pointerup', event => { const e = event as PointerEvent, start = swipe; swipe = null; if (!start || start.id !== e.pointerId) return; const dx = e.clientX - start.x, dy = e.clientY - start.y; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) go(page + (dx < 0 ? 1 : -1)); });
  for (const event of ['pointercancel', 'lostpointercapture', 'pointerleave']) listen(art, event, () => { swipe = null; });
  listen(window, 'blur', () => { swipe = null; }); listen(window, 'resize', updateAnchor);
  listen(window, 'pagehide', destroy);
  const resize = new ResizeObserver(updateAnchor); resize.observe(parent);
  try { parent.append(dialog); render(true); dialog.showModal(); title.focus({ preventScroll: true }); }
  catch (error) { destroy(); throw error; }
  return { setLanguage(next) { if (!destroyed && (next === 'zh' || next === 'en')) { language = next; render(); } }, destroy };
}
