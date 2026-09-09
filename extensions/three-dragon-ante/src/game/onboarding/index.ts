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
const pages: readonly { zone: OnboardingZone; eyebrow: Words; title: Words; body: Words; tip: Words; caption: Words }[] = [
  { zone: 'hand', eyebrow: ['一张桌，几位旅伴', 'A table. A few fellow travellers.'], title: ['把故事，放上牌桌。', 'Bring your story to the table.'],
    body: ['下方是你的手牌；其他玩家的牌背围坐在桌边。打出的牌在各自身前组成牌阵，中央放着奖池和公开牌。', 'Your hand rests below you; your opponents’ card backs sit around the table. Played cards form each player’s flight, with stakes and public cards in the centre.'],
    tip: ['2–6 人 · 加入一次，主持人开局。返回地图仍保留座位。', '2–6 players · Join once; the table creator starts. Returning to the map keeps your seat.'], caption: ['你的手牌，只对你展开。', 'Your hand opens only to you.'] },
  { zone: 'ownAnte', eyebrow: ['先暗置，再揭晓', 'A secret choice. A shared reveal.'], title: ['扣下一张，等大家就位。', 'Place one card face down.'],
    body: ['把一张手牌拖进自己身前的暗置槽，松手提交。所有人提交前，其他玩家只看得到牌背。提交成功后不能收回。', 'Drag a card into the face-down slot in front of you and release to commit. Everyone else sees only its back until all players have committed. An accepted card cannot be taken back.'],
    tip: ['全部揭示后，最高点数决定每人的付款；最高且不并列的牌决定领出。找不到不并列牌时，弃牌、各抓一张并重新暗置，这次不收款。', 'Once revealed, the highest strength sets everyone’s payment; the highest untied card leads. If no card is untied, discard the antes, draw one each and repeat, without paying this ante.'], caption: ['拖入发光区域 · 松手即提交', 'Drag into the lit slot · release to commit'] },
  { zone: 'ownFlight', eyebrow: ['拿起，拖出，落桌', 'Lift. Drag. Play.'], title: ['小一点，也能做大事。', 'A smaller card can do more.'],
    body: ['轮到你时，把手牌拖到自己的公开牌阵。通常，点数不大于右邻本轮出的牌才发动能力；本轮领出者会直接发动。', 'On your turn, drag a card into your face-up flight. Its power normally triggers when its strength is no greater than the card your right-hand neighbour played this round. The round’s leader triggers directly.'],
    tip: ['需要你决定时，合法的牌或目标才会亮起。特殊牌可能改变规则，按当下提示选择；未发动的牌仍然公开。', 'When a decision is yours, eligible cards or targets light up. Special cards may change the rules: follow the current choice. A card stays face up even if its power does not trigger.'], caption: ['点牌可查看 · 拖出才行动', 'Tap to inspect · drag to act'] },
  { zone: 'stakes', eyebrow: ['让牌桌替你数金币', 'Let the table count the gold.'], title: ['赢下一轮，再讲下一段。', 'Win a gambit. Tell the next chapter.'],
    body: ['金币会自动付款、转移和结算。通常打三轮后，总强度最高的牌阵赢得奖池；特殊牌可能改变胜负，某些平局或能力也会让轮局继续。奖池被取空会立即结算。', 'Gold is paid, transferred and settled automatically. Normally, after three rounds, the flight with the highest total strength wins the stakes. Special cards can change the winner; some ties or powers extend play. Emptying the stakes settles the gambit immediately.'],
    tip: ['先试一局本机练习：可以退回、重来，再进入真实牌桌。练习不会改变房间里的牌局。', 'Try a local practice game: undo, restart, then return to the real table. Practice never changes the room’s game.'], caption: ['奖池、金币、欠款 · 数字始终清楚', 'Stakes, gold and debt · every amount stays clear'] },
];

/** Pure UI: no SDK, storage, network, or rules actions. The caller owns first-run policy. */
export function mountOnboarding(parent: HTMLElement, options: OnboardingOptions): OnboardingHandle {
  let language = options.language, page = 0, destroyed = false, swipe: { id: number; x: number; y: number } | null = null;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const abort = new AbortController(), id = `tda-guide-${crypto.randomUUID()}`;
  const dialog = document.createElement('dialog'); dialog.className = 'tda-onboarding';
  dialog.setAttribute('aria-labelledby', `${id}-title`); dialog.setAttribute('aria-describedby', `${id}-body`);
  dialog.innerHTML = `<header class="tda-guide-header"><span class="tda-guide-brand"><span aria-hidden="true">◇</span> THREE-DRAGON ANTE</span><button class="tda-guide-close" type="button">×</button></header>
    <div class="tda-guide-body"><div class="tda-guide-visual"><div class="tda-guide-art"></div><p class="tda-guide-caption"></p></div>
    <section class="tda-guide-copy"><p class="tda-guide-eyebrow"></p><h1 id="${id}-title" tabindex="-1"></h1><p id="${id}-body" class="tda-guide-description"></p><p class="tda-guide-tip"></p><span class="tda-guide-table-anchor" hidden></span></section></div>
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
    find('.tda-guide-eyebrow').textContent = words(content.eyebrow); title.textContent = words(content.title);
    find('.tda-guide-description').textContent = words(content.body); find('.tda-guide-tip').textContent = words(content.tip); find('.tda-guide-caption').textContent = words(content.caption);
    find('.tda-guide-close').setAttribute('aria-label', words(['关闭介绍，返回牌桌', 'Close introduction and return to the table']));
    find('.tda-guide-skip').textContent = words(['直接入座', 'Take a seat']);
    find<HTMLButtonElement>('.tda-guide-back').textContent = words(['上一步', 'Back']); find<HTMLButtonElement>('.tda-guide-back').disabled = page === 0;
    find('.tda-guide-next').textContent = page === pages.length - 1 ? words(['跟着打一局', 'Try a practice game']) : words(['下一步', 'Next']);
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
