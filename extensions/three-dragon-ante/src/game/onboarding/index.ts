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
export const pages: readonly { zone: OnboardingZone; eyebrow: Words; title: Words; body: Words; tip: Words; caption: Words; steps?: readonly Words[]; results?: readonly Words[]; glossary: readonly GlossaryTerm[] }[] = [
 {zone:'ownFlight',eyebrow:['游戏流程','Game flow'],title:['三龙牌怎么玩','How to play Three-Dragon Ante'],
 body:['游戏由多个**轮局**组成。每轮局通常打 **3 轮**，每轮每人出一张牌。**某轮局结算后，有玩家的金币归零，整局就结束；此时金币最多的玩家获胜。**','Play a series of **gambits**, normally **3 rounds** each. Each player plays one card per round. **After a gambit is settled, if anyone has no gold, the game ends. The richest player wins.**'],
 steps:[
 ['**暗置前注牌。** 每人从手牌里选一张，放到自己的暗置区。全部放好后，同时翻开。','**Commit an ante.** Each player puts one hand card face down in their own ante area. Reveal them together.'],
 ['**付前注、确定领出者。** 每人支付最高前注点数那么多金币。忽略点数并列的牌，剩下点数最高者先出；前注牌不触发能力。','**Pay the ante and choose a leader.** Everyone pays the highest ante strength in gold. Ignore tied strengths: the highest remaining card leads. Ante powers do not trigger.'],
 ['**顺时针轮流出牌。** 从领出者开始，每人将一张手牌放到自己的牌阵，处理该牌触发的能力。','**Play clockwise.** Starting with the leader, each player plays one hand card into their flight and resolves any triggered power.'],
 ['**确定下一轮领出者。** 每人出过一张后，只比较这一轮出的牌，忽略点数并列的牌；剩下最高者领出下一轮。如果全都并列，原领出者继续。','**Choose the next leader.** Compare only cards played this round. Ignore tied strengths; the highest remaining card leads. If every card is tied, the same leader continues.'],
 ['**通常打满 3 轮后结算。** 先处理特殊牌阵奖励，再相加整个牌阵的点数；符合获胜条件且总点数最大者获得公共下注区的钱币。最高总点数并列，就所有人加打一轮再比较。','**Normally settle after 3 rounds.** Resolve special-flight rewards, then add the whole flight. The eligible highest total wins the stakes. Tied winning totals mean another round for everyone.'],
 ['**检查整局是否结束。** 发完奖池、补付欠款后，若有人没有金币，金币最多者获胜并分得偿债池；否则每人抽 2 张牌（上限 10 张），保留手牌，开始新轮局。','**Check for game end.** Award stakes and settle debts. If anyone has no gold, the richest wins and receives the hole. Otherwise everyone draws 2 cards (up to 10), keeps their hand, and starts another gambit.']
 ],tip:['**例外：** 公共下注区被能力取空时，轮局立即结算，不等第三轮。德鲁伊可改为最低总点数获胜；青铜大督军可要求加轮；龙神条件可限制获胜。整局金币最多者并列时共同获胜。','**Exceptions:** Empty stakes end a gambit immediately. Druid can make the lowest total win; Bronze Warlord can add a round; dragon gods can prevent a flight from winning. Tied richest players share the game victory.'],
 caption:['一轮：每人出一张牌。轮局：通常包含三轮。','Round: one card each. Gambit: normally three rounds.'],
 glossary:[{term:['领出','Lead'],meaning:['一轮中第一个出牌。','Play first in a round.']},{term:['轮局 / 斗牌','Gambit'],meaning:['从暗置前注牌到分配公共下注区钱币的一段游戏。','From committing antes to awarding the stakes.']},{term:['并列','Tie'],meaning:['多个玩家的点数相同；领出比较忽略所有重复点数。','Equal strengths; leader comparisons ignore all repeated strengths.']}]},
 {zone:'ownAnte',eyebrow:['核心规则','Core rules'],title:['手牌、前注与能力','Hands, antes and powers'],
 body:['**默认起始手牌为 6 张，手牌上限始终是 10 张。** 创建者可以在开局前调整初始金币和起始手牌；未调整时，每人金币为玩家人数 × 10。','**Start with 6 cards by default; the hand limit is always 10.** The creator can adjust starting gold and initial cards. Default gold per player is the number of players × 10.'],
 results:[
 ['**手牌不足时必须买牌。** 自己回合开始只剩 1 张牌，或所有已触发能力处理完后没有手牌时，必须买牌。翻开牌库顶的一张牌作为定价牌并弃掉，支付其点数的金币到公共下注区，再从牌堆补至 **4 张手牌**。不能随时主动买牌；商人王等能力可免除买牌费用。','**Buying is compulsory when needed.** Buy at the start of your turn with only 1 card, or after triggered powers finish if your hand is empty. Reveal and discard the top card as the price, pay its strength to the stakes, then draw up to **4 hand cards**. You cannot buy whenever you want. Merchant Prince can waive the price.'],
 ['**暗置前注牌：决定付多少金币、谁先出牌。** 每轮局只在开始时暗置一次，不是每一轮都暗置。每人支付的金币等于所有前注牌的 **最高点数（即使并列也按这个数付款）**。决定谁先出则忽略并列，选剩下最高者。例如 8、8、5：每人付 8，出 5 的人先出。若所有前注点数都有并列，全部弃掉、重新暗置，这次不付款。','**Antes set the payment and first leader.** Ante once per gambit, not every round. Everyone pays the **highest printed ante strength, even if tied**. For the leader, ignore ties and choose the highest remaining card. With 8, 8, 5: pay 8 each, and the 5 leads. If every ante is tied, discard all and ante again without payment.'],
 ['**公共下注区：本轮局的奖池。** 前注、买牌费用和部分能力付款放在这里。通常轮局结束时，牌阵总点数最高者拿走全部；若卡片改变胜负或分配条件，以卡片为准。钱不够时先付现有金币并记下差额，轮局末从所得金币补付到偿债池。','**Stakes: this gambit’s prize pool.** Antes, buying fees and some powers add gold here. Normally the highest flight total wins it all; follow cards that change winning or payout conditions. Pay what you can and record any shortfall, then settle it into the hole at the gambit end.'],
 ['**卡片能力：打出时判断，不是看整个牌阵。** 除非卡片另有说明，自己这轮打出的牌 **小于或等于上家这轮打出的牌**，能力才触发。你是这一轮第一个出牌的人时，能力正常触发。上家是 **逆时针相邻玩家**；已弃掉的牌不参与比较。龙神的常驻限制不需要触发。','**Powers: check when the card is played, not against the whole flight.** Unless a card says otherwise, its strength must be **less than or equal to the previous player’s card this round**. The first card of a round triggers normally. The previous player is your **counterclockwise neighbor**; discarded cards do not count. Dragon god restrictions are always active.']
 ],tip:['前注牌不会加入自己的牌阵。牌阵里的牌留到轮局结算；剩余手牌保留到下个轮局。场上公开牌都可以悬浮放大查看。','Ante cards do not enter your flight. Flight cards stay until the gambit is settled; remaining hand cards carry into the next gambit. Hover over any public card to enlarge it.'],
 caption:['暗置区放前注牌；牌阵放轮到你时打出的牌。','The ante area holds your ante. The flight holds cards played on your turns.'],
 glossary:[{term:['牌阵','Flight'],meaning:['本轮局中自己打出的公开牌，不含前注牌。','Your face-up played cards this gambit, excluding antes.']},{term:['前注','Ante'],meaning:['轮局开始时暗置的牌及据此支付的钱币。','The committed opening card and resulting payment.']},{term:['偿债池','Hole'],meaning:['轮局末补付欠款的独立钱币池，整局胜者获得。','A separate pool for repaid shortfalls, awarded to the game winner.']}]}
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
  // Only the authored **bold** markers are interpreted; names never enter HTML.
  function rich(target:HTMLElement,text:string){target.replaceChildren();text.split(/(\*\*.*?\*\*)/g).forEach(part=>{if(part.startsWith('**')&&part.endsWith('**')){const strong=document.createElement('strong');strong.textContent=part.slice(2,-2);target.append(strong);}else target.append(document.createTextNode(part));});}
  function render(changeArt = false) {
    if (destroyed) return;
    const content = pages[page]; dialog.lang = language === 'zh' ? 'zh-CN' : 'en'; dialog.dataset.step = String(page);
    if (changeArt) art.innerHTML = onboardingArt(page, `${id}-${page}`);
    find('.tda-guide-name').textContent = words(['三龙牌', 'Three-Dragon Ante']);
    find('.tda-guide-glossary h2').textContent = words(['本页术语', 'Terms on this page']);
    const glossary = find('dl'); glossary.replaceChildren();
    for (const value of content.glossary) { const term = document.createElement('dt'), meaning = document.createElement('dd'); term.textContent = words(value.term); meaning.textContent = words(value.meaning); glossary.append(term, meaning); }
    const flow = find('.tda-guide-flow'); flow.replaceChildren(); flow.hidden = !content.steps;
    for (const value of content.steps ?? []) { const step = document.createElement('li'); rich(step,words(value)); flow.append(step); }
    const results = find('.tda-guide-results'); results.replaceChildren(); results.hidden = !content.results;
    for (const value of content.results ?? []) { const result = document.createElement('p'); rich(result,words(value)); results.append(result); }
    find('.tda-guide-eyebrow').textContent = words(content.eyebrow); title.textContent = words(content.title);
    rich(find('.tda-guide-description'),words(content.body)); rich(find('.tda-guide-tip'),words(content.tip)); find('.tda-guide-caption').textContent = words(content.caption);
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
