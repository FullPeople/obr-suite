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
// Plain-language explanations of Legendary Edition pp. 6–11. No rules actions.
const pages: readonly { zone: OnboardingZone; eyebrow: Words; title: Words; body: Words; tip: Words; caption: Words; steps?: readonly Words[]; results?: readonly Words[]; glossary: readonly GlossaryTerm[] }[] = [
  { zone: 'hand', eyebrow: ['基本流程', 'Game flow'], title: ['三龙牌', 'Three-Dragon Ante'],
    body: ['和多名玩家一起打牌。支持 2–6 人；加入牌桌后，由创建者开始游戏。', 'Play cards with other players. A table has 2–6 players; its creator starts the game after everyone joins.'],
    steps: [['暗置放牌', 'Commit a face-down card'], ['同时翻出', 'Reveal all ante cards'], ['结算效果', 'Resolve payment and the leader'], ['轮流出牌', 'Take turns playing cards'], ['循环直到轮次结束', 'Continue until the round ends']],
    tip: ['开局时，每人从牌堆里获得 6 张手牌，金币数等于玩家人数乘以 10。之后每人每轮出一张牌；每轮局通常进行三轮，再分配中央奖池里的金币。手牌只对本人可见。', 'At the start, each player receives 6 cards from the deck and gold equal to the number of players multiplied by 10. Each player then plays one card per round. A gambit normally lasts three rounds before the central stakes are awarded. Only you can see your hand.'],
    caption: ['手牌在下方，公开牌在桌面上。', 'Your hand is below; public cards are on the table.'],
    glossary: [{ term: ['暗置', 'Face down'], meaning: ['牌面朝下，暂不公开。', 'Keep the card face hidden.'] }, { term: ['轮次', 'Round'], meaning: ['每位玩家各行动一次。', 'Each player takes one turn.'] }, { term: ['轮局', 'Gambit'], meaning: ['从暗置到奖池结算，通常三轮。', 'From ante to scoring; usually three rounds.'] }] },
  { zone: 'ownAnte', eyebrow: ['第一步：选择下注牌', 'Step 1: Commit an ante'], title: ['先暗置一张下注牌', 'Commit one card face down'],
    body: ['把一张手牌拖进自己身前的暗置区，松手提交。所有人提交后一起翻开；提交成功后不能收回，下注牌的能力不会因此发动。', 'Drag one hand card into your face-down slot and release. The cards are revealed when everyone has committed. An accepted ante cannot be withdrawn; its power does not trigger from being anted.'],
    results: [['每人付款 = 最高下注牌点数，包含并列最高。', 'Everyone pays the highest ante strength, including tied highest cards.'], ['领出者 = 点数最高且不并列的下注牌玩家。', 'The highest untied ante determines who leads.']],
    tip: ['例如下注牌是 9、9、6：每人向中央奖池付 9 金币，下注牌为 6 的玩家先出牌。若每张下注牌都与其他牌并列，把这些下注牌全部放入弃牌堆，每人从牌堆里抽 1 张牌加入手牌，再重新选下注牌；这次不付款。手牌已满 10 张时不抽牌。', 'Example: ante cards of 9, 9, 6 mean everyone pays 9 gold to the central stakes and the player who anted 6 plays first. If every ante ties with another, discard all those ante cards. Each player draws 1 card from the deck into their hand, then chooses a new ante; no gold is paid for this tied attempt. A player holding 10 cards does not draw.'],
    caption: ['下注牌公开保留；被能力取走或轮局结束时移除。', 'Antes stay public until taken by an effect or the gambit ends.'],
    glossary: [{ term: ['下注牌', 'Ante card'], meaning: ['每轮局先暗置后翻开的牌。', 'The card committed before a gambit.'] }, { term: ['并列', 'Tied'], meaning: ['至少两张牌点数相同。', 'Two or more cards have equal strength.'] }, { term: ['领出', 'Leader'], meaning: ['本轮第一个出牌的玩家。', 'The player who acts first this round.'] }] },
  { zone: 'ownFlight', eyebrow: ['第二步：轮流出牌', 'Step 2: Take turns'], title: ['轮到你时出一张牌', 'Play one card on your turn'],
    body: ['从领出玩家开始，按顺时针轮流出牌。轮到你时，把一张手牌拖到自己的牌阵，正面朝上放下。如果你是本轮第一个出牌的人，你刚出的这张牌就发动自己的能力。否则，比较你刚出的牌和逆时针相邻玩家本轮出的那张牌：你的点数相同或更低，就发动你这张牌的能力；点数更高则通常不发动。比较的是这两张牌，不是双方整副牌阵；不会因此再次发动对方的牌。', 'Starting with the leader, take turns clockwise. On your turn, drag one hand card to your flight and place it face up. If you play first this round, your new card triggers its own power. Otherwise, compare your new card with the card your counterclockwise neighbor played this round. Equal or lower strength triggers your card; higher strength normally does not. Compare those two cards, not your whole flights. This does not trigger your opponent’s card again.'],
    results: [['例如逆时针相邻玩家本轮出 7 点：你出 5 点或 7 点，就发动你刚出的牌的能力。', 'If your counterclockwise neighbor played strength 7 this round, your strength 5 or 7 card triggers its own power.'], ['同样面对 7 点，你出 9 点时通常不发动能力，但这张牌仍留在你的牌阵中计分。', 'Against that same strength 7, your strength 9 card normally does not trigger, but it still stays in your flight and counts toward your total.']],
    tip: ['特殊牌可以改变上述触发条件，以牌的完整说明为准。出现选择时，由提示中指定的玩家选好牌或目标并确认，不一定是刚出牌的人。先结算能力，再结算同色或同点数组合奖励。你不能随意跳过出牌，也不能想买牌就买牌：自己回合开始时仅剩 1 张手牌，或能力结算完后没有手牌，才会自动按规则付款并从牌堆补至 4 张手牌。', 'Special cards can change these trigger conditions; read their full descriptions. If a choice appears, the player named in the prompt chooses cards or targets and confirms; that is not always the player who just played. Resolve powers before color or strength flight rewards. You cannot pass or buy cards whenever you want. A purchase is required when you start your turn with only 1 hand card, or have no hand cards after powers finish: the game charges the required price and draws from the deck until you hold 4 cards.'],
    caption: ['点牌查看；拖到自己的牌阵才出牌。', 'Tap to inspect; drag to your flight to play.'],
    glossary: [{ term: ['牌阵', 'Flight'], meaning: ['你在本轮局已公开打出的牌。', 'The face-up cards you played this gambit.'] }, { term: ['触发', 'Trigger'], meaning: ['满足条件，让这张牌发动自己的能力。', 'Meet the condition for this card to use its own power.'] }, { term: ['逆时针相邻玩家', 'Counterclockwise neighbor'], meaning: ['从你的座位沿逆时针找到的第一名玩家；也就是顺时针出牌时的上一位。', 'The first player counterclockwise from your seat; this is the previous player in clockwise turn order.'] }] },
  { zone: 'stakes', eyebrow: ['第三步：结算', 'Step 3: Score'], title: ['比较牌阵，结算金币', 'Score flights and award gold'],
    body: ['通常三轮后，总强度最高的牌阵赢得奖池；最高总强度并列则所有人再打一轮。特殊牌可能改变胜负或增加轮次。奖池被取空时，轮局立即结束并结算。', 'Normally, after three rounds, the strongest flight wins the stakes. If the highest totals are tied, everyone plays another round. Special cards can change scoring or add a round. Empty stakes end the gambit immediately.'],
    tip: ['金币不足时先付你现有的金币，缺额记下。轮局结束后先分配奖池，再把之前没能付出的金额补入偿债池，不是补给原收款人。此时有人没有金币，整局结束：金币最多者获胜，并获得偿债池；并列胜者共享胜利。否则，从本轮局胜者开始按顺时针，每人从牌堆里抽 2 张牌加入手牌，满 10 张就停止，然后开始下一轮局。原有手牌保留，公开牌阵和下注牌全部弃掉。', 'If you cannot afford a payment, pay the gold you have and record the shortfall. After awarding this gambit’s stakes, pay any shortfall into the hole, not to the original recipient. If anyone now has no gold, the game ends: the richest player wins and receives the hole; tied winners share victory. Otherwise, starting with this gambit’s winner and proceeding clockwise, each player draws 2 cards from the deck into their hand, stopping at 10. Begin the next gambit with your hand retained; discard all public flight and ante cards.'],
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
