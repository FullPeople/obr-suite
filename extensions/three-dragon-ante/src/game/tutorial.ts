import { applyAction, card, checkInvariants, createGame, eligibleActions, projectSeat, SPECIAL_CARDS, STANDARD_CARDS } from './rules';
import type { GameAction, GameState } from './rules';
import { cardHint, cardName, rulePrompt } from './rules/prompts';
import { tableText, type TableLanguage } from './text';
import { mountTableUI } from './ui';
import type { TableView, ActionReceipt } from './protocol';
import { REVEAL_PRESENTATION_MS } from './stage/types';
import { POWER_PRESENTATION_MS, powerEvents } from './power-sequence';
import './tutorial.css';

type Words = readonly [string, string];
type Chapter = 'game' | 'basics' | 'legendary' | 'mortal';
export interface TutorialLesson { id: string; chapter: Chapter; title: Words; explanation: Words; firstCard?: string }
const w = (value: Words, lang: TableLanguage) => value[lang === 'zh' ? 0 : 1];
const seats = [{ id: 'you', name: 'You' }, { id: 'ember', name: 'Ember' }, { id: 'jade', name: 'Jade' }];
export const tutorialLessons: readonly TutorialLesson[] = [
  { id: 'game', chapter: 'game', title: ['从发牌打完一整局', 'A complete game, from the deal'], explanation: ['三人各有 30 金币和 6 张手牌。先暗置一张下注，最高的点数决定每人的付款；最高且不并列的玩家领出。通常出三轮牌，再结算轮局。有人在轮局结算后金币为零，整局才结束。你可以自由选择自己的牌。对手会自动行动。', 'Three players start with 30 gold and six cards each. Secretly ante one card: the highest strength sets everyone’s payment, and the highest untied player leads. A gambit normally lasts three rounds. The game ends when someone has no gold after a gambit is settled. Choose your own legal moves. Opponents act automatically.'] },
  { id: 'powers', chapter: 'basics', title: ['我的牌什么时候发动能力', 'When does my card use its power?'], firstCard: 'black-3', explanation: ['如果你是本轮第一个出牌的人，你这次出的牌会发动能力。否则，看右边玩家在本轮刚出的那张牌：你这张牌的点数比它低，或与它相同，你这张牌才会发动能力；比它高就不发动。比较的是这两张牌，牌阵总点数不参与。这里右边玩家出了 5 点白龙。你出 3 点黑龙，发动的是你这张黑龙的能力，从奖池拿金币；退回一步改出 13 点金龙，你这张金龙的抓牌能力就不会发动。', 'If you play first this round, the card you play uses its power. Otherwise, look at the card the player on your right just played this round. If your new card has a lower or equal strength, your card uses its power. If yours is stronger, it does not. Compare those two cards, without adding up either flight. Here, the player on your right played White 5. Play Black 3: your Black Dragon takes gold from the stakes. Undo and play Gold 13 instead: your Gold Dragon does not use its draw power.'] },
  { id: 'color', chapter: 'basics', title: ['同色牌阵', 'A color flight'], firstCard: 'white-6', explanation: ['已有 1、2 点白龙。出第三条白龙，先结算它的能力，再获得同色组合：每位对手支付中间点数，即 2 金币。同一颜色在本轮局只奖励一次。', 'White 1 and White 2 are already in your flight. Play a third White Dragon: resolve its power first, then collect the middle strength, 2 gold, from every opponent. Each color rewards only once per gambit.'] },
  { id: 'strength', chapter: 'basics', title: ['同点数牌阵', 'A strength flight'], firstCard: 'gold-6', explanation: ['已有两张 6 点牌。出 6 点金龙，先抓牌，再从奖池取 6 金币，并从明牌区选最多两张加入手牌；手牌上限仍为 10。若取空奖池，会立即结束轮局。', 'Two strength-6 cards are already in your flight. Play Gold 6: draw first, then take 6 from stakes and choose up to two ante cards for your hand, still respecting the ten-card limit. Emptying stakes ends the gambit immediately.'] },
  { id: 'ante-tie', chapter: 'basics', title: ['最高下注并列', 'Tied highest antes'], firstCard: 'red-10', explanation: ['按建议选择下注牌，依次是 10、10、9。所有人仍付 10 金币，但 9 点的玩家领出，因为两张 10 并列。下注牌在所有人提交前不会向其他座位公开。', 'The suggested antes are 10, 10, and 9. Everyone pays 10, but the player with 9 leads because the two 10s tie. Antes remain secret until everyone has committed.'] },
  { id: 'ante-all-tied', chapter: 'basics', title: ['所有下注都并列', 'Every ante tied'], firstCard: 'gold-6', explanation: ['三人各下注 6 点。没有不并列的牌：这些牌弃掉，每人抓一张，再次下注；此时不收本次下注款。', 'All three players ante strength 6. With no untied card, discard those antes, draw one card each, and ante again. No ante payment is collected yet.'] },
  { id: 'round-tie', chapter: 'basics', title: ['本轮领出权并列', 'A tied round lead'], firstCard: 'white-5', explanation: ['本轮最后出你的 5 点白龙，三张本轮牌均为 5 点。没有最高不并列牌时，下一轮保留原领出者。比较的是本轮出的单张牌，不是累计牌阵。', 'Finish the round with White 5; all three cards played this round then have strength 5. With no highest untied card, the previous leader keeps the lead. Compare this round’s cards, not total flights.'] },
  { id: 'gambit-tie', chapter: 'basics', title: ['三轮后牌阵并列', 'Tied flights after round three'], firstCard: 'white-3', explanation: ['出 3 点白龙后，三人的牌阵总点数都为 6。通常三轮的轮局继续到第四轮，直到产生胜者。奖池已空且仍并列时，暂停并请玩家裁定。', 'After White 3, all flights total 6. The normally three-round gambit continues into a fourth round until a winner emerges. If stakes are empty and the flights remain tied, pause and ask the players to decide.'] },
  { id: 'debt', chapter: 'basics', title: ['金币不足与偿债', 'Insufficient gold and debt'], firstCard: 'gold-13', explanation: ['你只有 1 金币。建议选择的下注牌会让每人支付 13，你支付现有的 1，并记录欠款 12；欠款不会凭空进入奖池。继续到轮局结算：先领奖，再用剩余金币偿债并放入偿债池，随后检查是否结束整局。', 'You have only 1 gold. The suggested ante costs 13: pay the available 1 and record a debt of 12. Unpaid debt does not create gold in stakes. Continue to settlement: award the pot, repay debt from remaining gold into the hole, then check whether the game ends.'] },
  { id: 'buy', chapter: 'basics', title: ['手牌不足时买牌', 'Buying when your hand is low'], firstCard: 'gold-2', explanation: ['你只有两张牌。先出金龙（它会抓牌，也可退一步改出白龙）；在一个回合开始时只剩一张或更少手牌，会翻出价格牌、付它的点数并补到四张。没有随时自愿买牌的按钮。', 'You have only two cards. Try Gold, which draws a card, or undo and play White instead. At the start of a turn with one or fewer cards, reveal a price card, pay its strength, and refill to four cards. There is no anytime voluntary-purchase button.'] },
  { id: 'empty', chapter: 'basics', title: ['奖池取空立即结算', 'Empty stakes end the gambit'], firstCard: 'black-3', explanation: ['奖池只剩 3。黑龙取走它们后立即结束轮局，尚未结算的能力、奖励或买牌都会停止；按当时牌阵决定胜者。无需继续凑满三轮。', 'Only 3 remain in stakes. Black Dragon takes them and immediately ends the gambit. Unfinished powers, bonuses, and purchases stop; the current flights determine the winner without waiting for three rounds.'] },
  ...SPECIAL_CARDS.map(value => ({ id: value.id, chapter: value.category as 'legendary' | 'mortal', title: [cardName(value.id, 'zh'), value.name] as Words, explanation: [cardHint(value.family, 'zh'), cardHint(value.family, 'en')] as Words, firstCard: value.id })),
];

interface Position {
  hands?: string[][]; flights?: string[][]; ante?: string[]; gold?: number[]; stakes?: number;
  stage?: 'ante' | 'play'; round?: number; leader?: number; active?: number; turnIndex?: number; roundCards?: (string | null)[];
  exactHands?: boolean;
}
/** Authored midgame exercises are explicitly labelled. A full game uses createGame unchanged.
 * Fixtures partition a real 80-card deck and conserve all 90 starting gold. No fake engine events. */
function position(id: string, p: Position): GameState {
  const hands = (p.hands ?? [[], [], []]).map(a => [...a]);
  const flights = p.flights ?? [[], [], []], ante = p.ante ?? [];
  const used = [...hands.flat(), ...flights.flat(), ...ante];
  if (new Set(used).size !== used.length) throw Error('TUTORIAL_DUPLICATE_CARD');
  const specials = used.filter(value => card(value).category !== 'standard');
  for (const value of SPECIAL_CARDS) if (specials.length < 10 && !specials.includes(value.id)) specials.push(value.id);
  const state = createGame({ id, seats, specialIds: specials, seed: 7341 });
  const pool = [...STANDARD_CARDS.map(c => c.id), ...specials].filter(value => !used.includes(value));
  if (!p.exactHands) for (const hand of hands) while (hand.length < 4) hand.push(pool.shift()!);
  state.deck = pool; state.discard = []; state.ante = [...ante]; state.stage = p.stage ?? 'play';
  state.stakes = p.stakes ?? 30; state.round = p.round ?? 3; state.leader = p.leader ?? 0;
  state.active = p.active ?? state.leader; state.turnIndex = p.turnIndex ?? 0;
  state.roundCards = p.roundCards ?? [null, null, null];
  state.seats.forEach((seat, i) => { seat.hand = hands[i]; seat.flight = flights[i].map(cardId => ({ cardId })); seat.gold = p.gold?.[i] ?? 20; });
  if (state.seats.reduce((total, seat) => total + seat.gold, state.stakes) !== 90 || checkInvariants(state).length) throw Error('TUTORIAL_INVALID_POSITION');
  return state;
}

export function createTutorialGame(lessonId = 'game', instance = 'local'): GameState {
  if (!tutorialLessons.some(lesson => lesson.id === lessonId)) throw Error('UNKNOWN_TUTORIAL');
  const id = `tutorial:${lessonId}:${instance}`;
  if (lessonId === 'game') return createGame({ id, seats, seed: 7341 });
  const flights = [['gold-2', 'black-2'], ['red-12', 'silver-12'], ['green-10', 'brass-9']];
  const ante = ['blue-4', 'copper-5', 'bronze-8'];
  if (lessonId === 'powers') return position(id, { hands: [['black-3', 'gold-13'], [], []], flights: [['white-1'], ['red-3'], ['gold-2', 'white-5']], round: 2, leader: 2, active: 0, turnIndex: 1, roundCards: [null, null, 'white-5'] });
  if (lessonId === 'color') return position(id, { hands: [['white-6'], [], []], flights: [['white-1', 'white-2'], flights[1], flights[2]], ante });
  if (lessonId === 'strength') return position(id, { hands: [['gold-6'], [], []], flights: [['white-6', 'black-6'], flights[1], flights[2]], ante });
  if (lessonId === 'ante-tie' || lessonId === 'ante-all-tied' || lessonId === 'debt') {
    const selected = lessonId === 'ante-tie' ? ['red-10', 'green-10', 'gold-9'] : lessonId === 'debt' ? ['gold-13', 'red-12', 'silver-12'] : ['gold-6', 'black-6', 'white-6'];
    return position(id, { stage: 'ante', round: 0, hands: selected.map(value => [value]), stakes: 0, gold: lessonId === 'debt' ? [1, 44, 45] : [30, 30, 30] });
  }
  if (lessonId === 'round-tie') return position(id, { hands: [['white-5'], [], []], flights: [[], ['black-5'], ['red-5']], round: 1, leader: 1, active: 0, turnIndex: 2, roundCards: [null, 'black-5', 'red-5'] });
  if (lessonId === 'gambit-tie') {
    const s = position(id, { hands: [['white-3'], [], []], flights: [['white-1', 'white-2'], ['black-1', 'black-2', 'black-3'], ['brass-1', 'brass-2', 'brass-3']], leader: 1, active: 0, turnIndex: 2, roundCards: [null, 'black-3', 'brass-3'] });
    s.seats[1].rewards = ['color:black']; s.seats[2].rewards = ['color:brass']; return s;
  }
  if (lessonId === 'buy') return position(id, { hands: [['gold-2', 'white-8'], ['red-12', 'blue-11', 'green-10', 'silver-12'], ['brass-9', 'bronze-11', 'copper-10', 'gold-13']], exactHands: true, round: 1 });
  if (lessonId === 'empty') return position(id, { hands: [['black-3'], [], []], flights: [['gold-13', 'silver-12'], ['red-2'], ['green-1']], round: 2, stakes: 3, gold: [29, 29, 29] });
  const hands = [[lessonId, 'white-8', 'gold-11', 'red-10'], ['blue-11', 'silver-10'], ['bronze-11', 'copper-10']];
  if (lessonId === 'illusionist') flights[1] = ['red-12', 'thief'];
  if (lessonId === 'wyrmpriest' || lessonId === 'tiamat') flights[0] = ['white-1', 'white-2'];
  if (lessonId === 'bahamut') flights[0] = ['gold-2', 'brass-1'];
  if (lessonId === 'archmage') return position(id, { hands: [['archmage', 'gold-11', 'white-8', 'red-10'], ['red-12', 'blue-11', 'silver-10', 'copper-8'], ['gold-13', 'green-10', 'brass-9', 'bronze-7']], round: 1, ante });
  if (lessonId === 'gold-monarch') { flights[0] = ['gold-13', 'silver-12']; flights[1] = ['red-12', 'silver-6']; }
  const s = position(id, { hands, flights, ante });
  // A later opponent's forced purchase demonstrates the Merchant's beneficiary.
  if (lessonId === 'merchant-prince') { s.deck.push(...s.seats[1].hand.slice(1)); s.seats[1].hand = s.seats[1].hand.slice(0, 1); }
  return s;
}

/** Only legal actions supplied by the actual engine. Bots never inspect another seat's hand. */
export function tutorialMove(state: GameState, lessonId: string, actionId: string, actorSeatId?: string): GameAction | null {
  const actor = actorSeatId === undefined ? state.seats.find(seat => eligibleActions(state, seat.id).length) : state.seats.find(seat => seat.id === actorSeatId);
  if (!actor) return null;
  const own = projectSeat(state, actor.id), action = own.actions[0];
  if (!action) return null;
  const base = { id: actionId, revision: state.revision, seatId: actor.id };
  if (action.kind === 'choose') {
    const options = action.choice.options.filter(option => option.id !== 'skip');
    const selected = options.slice(0, Math.max(action.choice.min, Math.min(1, action.choice.max))).map(option => option.id);
    return { ...base, kind: 'choose', choiceId: action.choice.id, optionIds: selected.length >= action.choice.min ? selected : action.choice.options.slice(0, action.choice.min).map(option => option.id) };
  }
  let chosen: string | undefined;
  if (state.gambit === 1 && state.stage === 'ante' && ['ante-tie', 'ante-all-tied', 'debt'].includes(lessonId) && !state.events.some(e => e.code === 'ANTE_ALL_TIED')) chosen = own.hand[0]?.id;
  if (state.revision === 0 && actor.id === 'you') chosen = tutorialLessons.find(lesson => lesson.id === lessonId)?.firstCard;
  chosen ??= [...action.cardIds].sort((a, b) => card(b).strength - card(a).strength || a.localeCompare(b))[0];
  return { ...base, kind: action.kind, cardId: action.cardIds.includes(chosen!) ? chosen : action.cardIds[0] };
}

function seatName(id: string, lang: TableLanguage) { return id === 'you' ? w(['你', 'You'], lang) : id === 'ember' ? w(['余烬', 'Ember'], lang) : w(['翡翠', 'Jade'], lang); }
function describeMove(state: GameState, move: GameAction, lang: TableLanguage): string {
  const actor = seatName(move.seatId, lang);
  if (move.kind === 'ante') return move.seatId === 'you' ? `${actor} · ${w(['暗置', 'Ante'], lang)} ${cardName(move.cardId!, lang)} · ${card(move.cardId!).strength}` : `${actor} · ${w(['秘密选择下注牌', 'Commit a secret ante'], lang)}`;
  if (move.kind === 'play') return `${actor} · ${w(['出牌', 'Play'], lang)} ${cardName(move.cardId!, lang)} · ${card(move.cardId!).strength}`;
  if (move.seatId !== 'you') return `${actor} · ${w(['完成选择', 'Resolve a choice'], lang)}${state.pending ? ` · ${rulePrompt(state.pending.code, lang)}` : ''}`;
  const options = state.pending?.options.filter(option => move.optionIds?.includes(option.id)) ?? [];
  return `${actor} · ${state.pending ? rulePrompt(state.pending.code, lang) : ''}: ${options.map(option => option.cardId ? cardName(option.cardId, lang) : option.seatId ? seatName(option.seatId, lang) : rulePrompt(option.code!, lang)).join(', ') || w(['不选择（可选能力）', 'Choose none (optional power)'], lang)}`;
}

/** Explanations use actual before/after states, including interrupts and delayed effects. */
export function tutorialObservation(before: GameState, after: GameState, move: GameAction, lang: TableLanguage): string[] {
  const lines = [describeMove(before, move, lang)];
  // The engine keeps only its last 100 public events. Find the retained overlap,
  // rather than losing every explanation once that ring reaches its limit.
  let retained = Math.min(before.events.length, after.events.length);
  while (retained && JSON.stringify(before.events.slice(-retained)) !== JSON.stringify(after.events.slice(0, retained))) retained--;
  const events = after.events.slice(retained);
  for (const value of events) {
    if (value.code === 'CARD_PLAYED') continue;
    lines.push([value.seatId ? seatName(value.seatId, lang) : '', tableText(value.code, lang), value.amount === undefined ? '' : String(value.amount), value.targetSeatId ? `→ ${seatName(value.targetSeatId, lang)}` : '', ...(value.cardIds ?? []).map(id => `${cardName(id, lang)} (${card(id).strength})`)].filter(Boolean).join(' · '));
  }
  if (move.kind === 'play' && !events.some(e => e.code === 'POWER_TRIGGERED' && e.cardIds?.includes(move.cardId!))) lines.push(w([
    `${seatName(move.seatId, lang)}这次出的「${cardName(move.cardId!, lang)}」点数更高。这次不是本轮第一个出牌，也没有大法师效果，所以这张牌不发动能力。`,
    `${seatName(move.seatId, lang)} played ${cardName(move.cardId!, lang)}, which is stronger than the card on the right. This is not the first play of the round, and no Archmage effect applies, so this card does not trigger its power.`,
  ], lang));
  before.seats.forEach((seat, i) => { const next = after.seats[i]; const changes: string[] = [];
    for (const [code, old, value] of [['gold', seat.gold, next.gold], ['debt', seat.debt, next.debt], ['handCount', seat.hand.length, next.hand.length]] as const) if (old !== value) changes.push(`${tableText(code, lang)} ${old} → ${value}`);
    if (changes.length) lines.push(`${seatName(seat.id, lang)}: ${changes.join(' · ')}`);
  });
  for (const [label, old, value] of [['stakes', before.stakes, after.stakes], ['hole', before.hole, after.hole]] as const) if (old !== value) lines.push(`${tableText(label, lang)}: ${old} → ${value}`);
  if (after.lastGambit && after.lastGambit.number !== before.lastGambit?.number) lines.push(`${tableText('lastGambit', lang)}: ${after.lastGambit.winners.map(id => seatName(id, lang)).join(', ')}. ${Object.entries(after.lastGambit.strengths).map(([id, value]) => `${seatName(id, lang)} ${value}`).join(' · ')}`);
  if (before.round !== after.round && after.round > 0) lines.push(`${tableText('round', lang)} ${after.round} · ${tableText('leader', lang)}: ${seatName(after.seats[after.leader].id, lang)}`);
  if (after.stage === 'adjudication') lines.push(rulePrompt(after.issue!, lang));
  if (after.stage === 'ended') lines.push(`${tableText('ended', lang)} · ${tableText('winners', lang)}: ${after.winners.map(id => seatName(id, lang)).join(', ')}`);
  return lines;
}

export interface TutorialHandle { setLanguage(lang: TableLanguage): void; suspend(): void; resume(): void; destroy(): void }
/** Isolated teaching table with paced local opponents. No SDK, storage, controller or room messages. */
export function mountTutorial(parent: HTMLElement, initialLanguage: TableLanguage, onClose: () => void): TutorialHandle {
  let lang = initialLanguage, lessonId = 'game', generation = 0, serial = 0, destroyed = false;
  let suspended = false, pageActive = true, botTimer: ReturnType<typeof setTimeout> | undefined;
  let scheduled: { key: string; seatId: string; remaining: number; due: number; generation: number; gameId: string } | null = null;
  type Trace = { before: GameState; after: GameState; move: GameAction };
  let game = createTutorialGame(), last: Trace | null = null, receipt: ActionReceipt | undefined;
  const history: { game: GameState; last: Trace | null }[] = [];
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const oldTitle = document.title, oldLang = document.documentElement.lang;
  const host = document.createElement('section'); host.className = 'tda-tutorial'; host.setAttribute('role', 'region');
  host.innerHTML = `<header class="tutorial-header"><h1 class="tutorial-title"></h1><button type="button" class="tutorial-close"></button></header><div class="tutorial-workspace"><aside class="tutorial-guide"><div class="tutorial-picker"><label><span class="tutorial-chapter-label"></span><select class="tutorial-chapter"></select></label><label><span class="tutorial-lesson-label"></span><select class="tutorial-lesson"></select></label></div><p class="tutorial-scope"></p><details class="tutorial-instructions" open><summary></summary><p></p></details><div class="tutorial-next"><p class="tutorial-suggestion"></p></div><div class="tutorial-tools"><button type="button" class="tutorial-undo"></button><button type="button" class="tutorial-restart"></button></div><section class="tutorial-result" aria-live="polite"><h2></h2><ol></ol></section></aside><div class="tutorial-table"></div></div>`;
  parent.append(host);
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const chapter = get<HTMLSelectElement>('.tutorial-chapter'), select = get<HTMLSelectElement>('.tutorial-lesson');
  const abort = new AbortController();
  const listen = (element: EventTarget, event: string, fn: EventListener) => element.addEventListener(event, fn, { signal: abort.signal });
  const table = mountTableUI(get('.tutorial-table'), { language: lang, id: () => `lesson:${generation}:${++serial}`, send(command) {
    if (destroyed) return;
    if (command.type === 'action') take(command.action, true);
    // The embedded table's room/window controls are hidden. Never forward commands.
    else render();
  } });
  const names: Record<Chapter, Words> = { game: ['完整练习局', 'Complete game'], basics: ['基础规则', 'Core rules'], legendary: ['传奇龙', 'Legendary dragons'], mortal: ['凡人', 'Mortals'] };
  function cancelBot() { if (botTimer !== undefined) clearTimeout(botTimer); botTimer = undefined; scheduled = null; }
  function paused() { return destroyed || suspended || !pageActive || document.hidden; }
  function pauseBot() { if (botTimer !== undefined && scheduled) scheduled.remaining = Math.max(0, scheduled.due - performance.now()); if (botTimer !== undefined) clearTimeout(botTimer); botTimer = undefined; }
  function botPlan(): { key: string; seatId: string; delay: number } | null {
    if (['ended', 'adjudication'].includes(game.stage)) return null;
    const opening = lessonId === 'game' && game.gambit === 1 && game.stage === 'ante' && !game.events.some(event => event.code === 'ANTE_ALL_TIED');
    if (opening) {
      if (!Object.prototype.hasOwnProperty.call(game.committed, 'ember')) return { key: 'opening:ember', seatId: 'ember', delay: 2000 };
      if (!Object.prototype.hasOwnProperty.call(game.committed, 'you')) return null;
      if (!Object.prototype.hasOwnProperty.call(game.committed, 'jade')) return { key: 'opening:jade', seatId: 'jade', delay: 1000 };
      return null;
    }
    const actor = game.seats.find(seat => seat.id !== 'you' && projectSeat(game, seat.id).actions.length);
    // Authority already advanced. Only pace the next opponent after this reveal.
    const revealDelay = last?.move.kind === 'ante' && last.before.stage === 'ante' && last.after.stage === 'play' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? REVEAL_PRESENTATION_MS : 0;
    const powerDelay = last ? powerEvents(projectSeat(last.before, 'you'), projectSeat(last.after, 'you')).length * POWER_PRESENTATION_MS : 0;
    return actor ? { key: `${game.revision}:${actor.id}`, seatId: actor.id, delay: 1000 + revealDelay + powerDelay } : null;
  }
  function scheduleBot() {
    const plan = botPlan(), key = plan && `${generation}:${game.id}:${plan.key}`;
    if (!plan) { cancelBot(); return; }
    if (scheduled?.key !== key) { cancelBot(); scheduled = { key: key!, seatId: plan.seatId, remaining: plan.delay, due: 0, generation, gameId: game.id }; }
    if (paused() || botTimer !== undefined) return;
    const current = scheduled!; current.due = performance.now() + current.remaining;
    botTimer = setTimeout(() => {
      if (scheduled !== current || current.generation !== generation || current.gameId !== game.id || destroyed) return;
      botTimer = undefined;
      if (paused()) { current.remaining = 0; return; }
      // A delayed presentation callback may outlive its nominal duration.
      // Recheck only while it is busy; the same scoped timer is cancelled on hide/reset.
      if (table.presentationBusy()) { current.remaining = 50; scheduleBot(); return; }
      scheduled = null;
      const move = tutorialMove(game, lessonId, `lesson:${generation}:${++serial}`, current.seatId);
      if (move) take(move, false); else scheduleBot();
    }, current.remaining);
  }
  function syncVisibility() { if (paused()) { pauseBot(); table.suspend(); } else { table.resume(); scheduleBot(); } }
  function reset(id: string) { cancelBot(); generation++; lessonId = id; game = createTutorialGame(id, String(generation)); last = null; receipt = undefined; history.length = 0; render(); }
  function take(move: GameAction, human: boolean) {
    if (paused() || human && move.seatId !== 'you' || !human && move.seatId === 'you') return;
    const result = applyAction(game, move);
    // A tutorial receipt comes from this actual engine result, never from a timer.
    if (human) receipt = { actionId: move.id, tableId: game.id, gameId: game.id, revision: result.ok ? result.state.revision : move.revision, ok: result.ok, ...(!result.ok ? { code: result.error.code, retryable: false } : {}) };
    if (!result.ok || result.duplicate) { render(); return; }
    history.push({ game, last }); if (history.length > 256) history.shift();
    const before = game; game = result.state; last = { before, after: game, move }; render();
  }
  function render() {
    if (destroyed) return;
    const lesson = tutorialLessons.find(value => value.id === lessonId)!;
    host.setAttribute('aria-label', w(['三龙牌练习', 'Three-Dragon Ante practice'], lang));
    get('.tutorial-title').textContent = w(['跟着打一局', 'Learn by playing'], lang);
    get('.tutorial-close').textContent = w(['返回牌桌', 'Back to the table'], lang);
    get('.tutorial-chapter-label').textContent = w(['章节', 'Chapter'], lang); get('.tutorial-lesson-label').textContent = w(['练习', 'Exercise'], lang);
    chapter.replaceChildren(...Object.entries(names).map(([key, value]) => new Option(w(value, lang), key))); chapter.value = lesson.chapter;
    select.replaceChildren(...tutorialLessons.filter(value => value.chapter === lesson.chapter).map(value => new Option(w(value.title, lang), value.id))); select.value = lessonId;
    get('.tutorial-scope').textContent = lessonId === 'game' ? w(['仅本机 · 固定发牌 · 可自由出牌，不影响真实牌桌。', 'Local only · Fixed deal · Play freely without changing the real table.'], lang) : w(['仅本机 · 预设中盘练习，可退回并尝试其他打法。', 'Local only · An authored midgame position. Undo to try a different move.'], lang);
    get('.tutorial-instructions summary').textContent = w(lesson.title, lang);
    get('.tutorial-instructions p').textContent = w(lesson.explanation, lang) + (['legendary', 'mortal'].includes(lesson.chapter) ? w([' 你是本轮领出者，先出这张牌观察能力；持续效果请继续打到轮局结算。随时点卡牌上的 i 查看提示。', ' You lead this round: play this card to see its power. Continue to settlement to observe delayed effects. Tap i on any card to inspect its hint.'], lang) : '');
    const next = tutorialMove(game, lessonId, `lesson:${generation}:${serial + 1}`, 'you');
    get('.tutorial-suggestion').textContent = next ? `${w(['你可以这样做', 'You can try this'], lang)}: ${describeMove(game, next, lang)}` : game.stage === 'ended' ? w(['整局已完成。可退一步复盘，或换一个专项练习。', 'The game is complete. Undo to review, or choose another exercise.'], lang) : game.stage === 'adjudication' ? rulePrompt(game.issue ?? 'ADJUDICATION_REQUIRED', lang) : w(['对手正在思考，会自己完成操作。轮到你时，选择自己的牌或能力。', 'Your opponents are thinking and will act on their own. Choose your own card or power when it is your turn.'], lang);
    const undo = get<HTMLButtonElement>('.tutorial-undo'); undo.disabled = !history.length; undo.textContent = w(['退回一步', 'Undo one move'], lang);
    get('.tutorial-restart').textContent = w(['重新练习', 'Restart exercise'], lang);
    get('.tutorial-result h2').textContent = w(['刚才发生了什么', 'What just happened'], lang);
    const lines = last ? tutorialObservation(last.before, last.after, last.move, lang) : [w(['拖一张手牌到自己的区域；也可用方向键选牌、空格拿起、Enter 放下。点牌可查看能力。对手会自动行动，你自己的决定由你来做。', 'Drag a card into your own slot, or use arrows to choose, Space to lift and Enter to drop. Tap a card to inspect its power. Opponents act automatically; your decisions stay yours.'], lang)];
    get('.tutorial-result ol').replaceChildren(...lines.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    const projected = projectSeat(game, 'you'); projected.seats.forEach(seat => { seat.name = seat.id === 'you' ? w(['练习者', 'Learner'], lang) : seatName(seat.id, lang); });
    const view: TableView = { actionReceiptVersion: 1, table: { version: 1, id: game.id, hostPlayerId: 'local', hostConnectionId: 'tutorial', hostName: 'Tutorial', stage: game.stage === 'ended' ? 'ended' : 'playing', seats: seats.map(seat => ({ playerId: seat.id, seatId: seat.id, name: seatName(seat.id, lang) })), revision: game.revision }, selfPlayerId: 'you', isHost: false, connected: true, pending: false, game: projected, ...(receipt?.gameId === game.id ? { actionReceipt: receipt } : {}) };
    table.update(view); host.dataset.lesson = lessonId; host.dataset.revision = String(game.revision); scheduleBot();
  }
  function destroy() { if (destroyed) return; destroyed = true; cancelBot(); generation++; abort.abort(); table.destroy(); host.remove(); history.length = 0; last = null; document.title = oldTitle; document.documentElement.lang = oldLang; if (previousFocus?.isConnected) previousFocus.focus(); }
  listen(get('.tutorial-close'), 'click', () => { destroy(); onClose(); });
  listen(chapter, 'change', () => reset(tutorialLessons.find(value => value.chapter === chapter.value)!.id));
  listen(select, 'change', () => reset(select.value));
  listen(get('.tutorial-undo'), 'click', () => { const previous = history.pop(); if (previous) { cancelBot(); generation++; game = previous.game; last = previous.last; receipt = undefined; render(); } });
  listen(get('.tutorial-restart'), 'click', () => reset(lessonId));
  listen(host, 'keydown', event => { const key = event as KeyboardEvent; if (key.key === 'Escape' && !key.defaultPrevented) { key.preventDefault(); destroy(); onClose(); } });
  listen(document, 'visibilitychange', syncVisibility);
  listen(window, 'pagehide', () => { pageActive = false; syncVisibility(); });
  listen(window, 'pageshow', () => { pageActive = true; syncVisibility(); });
  render(); get('.tutorial-close').focus();
  return { setLanguage(value) { if (!destroyed && value !== lang) { lang = value; table.language(value); render(); } }, suspend() { suspended = true; syncVisibility(); }, resume() { suspended = false; syncVisibility(); }, destroy };
}
