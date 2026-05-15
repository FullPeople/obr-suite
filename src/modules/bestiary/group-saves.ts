import OBR, { Item } from "@owlbear-rodeo/sdk";
import { fireQuickRoll } from "../dice/tags";
import { broadcastDiceRoll, BROADCAST_DICE_ROLL, isGlobalDarkRollEnabled, type DiceRollPayload } from "../dice";
import { getLocalLang, onLangChange } from "../../state";
import { assetUrl } from "../../asset-base";
import { onViewportResize } from "../../utils/viewportAnchor";
import { patchBubbles, readBubbles } from "../../utils/statEdit";

// "Group save" popover — auto-shows when the GM box-selects 2+ tokens
// that ALL have bestiary monster data bound. Six ability buttons fire
// a collective save roll (1d20 + each token's own save bonus), all
// sharing one collectiveId so they show up as a single collective row
// in the dice history.
//
// Anchor: just below the initiative panel's collapsed position (top=45,
// height=40) → top=95, centered. Small enough that it doesn't fight
// with the initiative strip when both are visible.

const PLUGIN_ID = "com.bestiary";
const POPOVER_ID = "com.obr-suite/bestiary-group-saves";
const POPOVER_URL = assetUrl("bestiary-group-saves.html");

// Resolve modal — opened automatically after every group-save round
// finishes (all per-token rolls have arrived). Lets the DM enter a
// DC + HP value, then apply with the standard 5e save-half rule (fail
// = full damage, succeed = half floor). The modal is OBR.modal so
// click-away does NOT dismiss; only the explicit "好了" button closes
// it. 2026-05-11.
const RESOLVE_MODAL_ID = "com.obr-suite/bestiary-group-resolve";
const RESOLVE_URL = assetUrl("bestiary-group-resolve.html");
const BC_RESOLVE_STATE   = "com.obr-suite/bestiary-group-resolve-state";
const BC_RESOLVE_APPLY   = "com.obr-suite/bestiary-group-resolve-apply";
const BC_RESOLVE_DONE    = "com.obr-suite/bestiary-group-resolve-done";
const BC_RESOLVE_REQUEST = "com.obr-suite/bestiary-group-resolve-request";

const BESTIARY_SLUG_KEY = `${PLUGIN_ID}/slug`;
const BESTIARY_DATA_KEY = `${PLUGIN_ID}/monsters`;
// Initiative tracker writes its combat-state object to this scene
// metadata key. Shape: { preparing: bool, inCombat: bool, round: int }.
// We watch it so that during the "preparing combat" window the
// popover swaps from 6-ability save buttons to 3 initiative-roll
// variants (adv / normal / dis) — that's the GM's natural workflow
// (multi-select monsters → roll their initiative).
const COMBAT_STATE_KEY = "com.initiative-tracker/combat";
// Each initiative item carries a dexterity modifier here; bestiary
// spawn auto-populates it from the monster's DEX score so the
// initiative roll uses the right bonus.
const INITIATIVE_DEX_KEY = "com.initiative-tracker/dexMod";
// Initiative tracker stores per-token state (count, active, rolled)
// at this metadata key. Group-initiative writes the rolled d20
// (no modifier) into `count` once the dice modal hits its climax,
// so the initiative panel's column updates in sync with the
// animation — exact same protocol as useInitiative.rollInitiativeLocal.
const INITIATIVE_DATA_KEY = "com.initiative-tracker/data";
// The dice-effect page broadcasts this near the climax of every
// roll so any listener that knows the rollId can side-effect at
// the same instant the final number appears on canvas.
const BC_DICE_FADE_START = "com.obr-suite/dice-fade-start";

// Broadcast channels (LOCAL only — single client lifecycle):
const BC_FIRE = "com.obr-suite/bestiary-group-save-fire";
const BC_FIRE_INIT = "com.obr-suite/bestiary-group-init-fire";
// Group HP edit — page sends a {mode: "dmg"|"heal"|"set", value}
// payload; bg patches every selected token's bubbles HP. Hidden
// inside `initiative` (combat-prep) mode where the GM is rolling
// not editing, but visible whenever the popover is in `save` mode.
const BC_FIRE_HP = "com.obr-suite/bestiary-group-hp-fire";
const BC_STATE = "com.obr-suite/bestiary-group-save-state";

const POPOVER_WIDTH = 360;
// Save row (~52) + HP-edit row (~38) + head (~32) + paddings = ~140.
const POPOVER_HEIGHT = 140;
const TOP_OFFSET = 95;            // 45 (initiative TOP) + 40 (collapsed) + 10 gap
const MIN_SELECTED = 2;           // hide for solo selections — single-monster info popup already covers that

interface SelectedMonster {
  itemId: string;
  name: string;
  // Per-ability raw save bonus, already including proficiency where
  // the data lists `m.save.<ability>`. Falls back to (score-10)/2 floor
  // when no save proficiency is recorded.
  saves: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
}

let popoverOpen = false;
let unsubs: Array<() => void> = [];
let lastSelection: SelectedMonster[] = [];
let role: "GM" | "PLAYER" = "PLAYER";

const ABBR_FULL_ZH: Record<string, string> = {
  str: "力量", dex: "敏捷", con: "体质", int: "智力", wis: "感知", cha: "魅力",
};
const ABBR_FULL_EN: Record<string, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};

function abilityLabel(key: string, lang: "zh" | "en"): string {
  if (lang === "zh") return `${ABBR_FULL_ZH[key] ?? key}豁免`;
  return `${ABBR_FULL_EN[key] ?? key} Save`;
}

// Reading "+5" / "5" / number → integer bonus. Mirrors the logic in
// monster-info-page.ts so the value matches what the user would see
// rolling a save from the monster info popup.
function parseSaveBonus(raw: unknown, abilityScore: number): number {
  const fallback = Math.floor((abilityScore - 10) / 2);
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const m = /([+-]?\s*\d+)/.exec(raw);
    if (m) return parseInt(m[1].replace(/\s+/g, ""), 10);
  }
  return fallback;
}

function buildSelectedMonster(item: Item, monstersTable: Record<string, any>): SelectedMonster | null {
  const slug = item.metadata?.[BESTIARY_SLUG_KEY];
  if (typeof slug !== "string" || !slug) return null;
  const m = monstersTable[slug];
  if (!m) return null;
  const saves = m.save || {};
  const score = (k: string) => (typeof m[k] === "number" ? m[k] : 10);
  return {
    itemId: item.id,
    name: m.name ?? m.ENG_name ?? item.name ?? "?",
    saves: {
      str: parseSaveBonus(saves.str, score("str")),
      dex: parseSaveBonus(saves.dex, score("dex")),
      con: parseSaveBonus(saves.con, score("con")),
      int: parseSaveBonus(saves.int, score("int")),
      wis: parseSaveBonus(saves.wis, score("wis")),
      cha: parseSaveBonus(saves.cha, score("cha")),
    },
  };
}

async function resolveSelection(): Promise<SelectedMonster[]> {
  let selection: string[] = [];
  try {
    selection = (await OBR.player.getSelection()) ?? [];
  } catch {}
  if (selection.length < MIN_SELECTED) return [];
  let items: Item[] = [];
  let table: Record<string, any> = {};
  try {
    [items, table] = await Promise.all([
      OBR.scene.items.getItems(selection),
      (async () => {
        try {
          const meta = await OBR.scene.getMetadata();
          const t = meta[BESTIARY_DATA_KEY] as Record<string, any> | undefined;
          return t || {};
        } catch { return {}; }
      })(),
    ]);
  } catch {
    return [];
  }
  // ALL selected items must be bestiary-bound — partial selections (e.g.
  // mixed monsters + a player token) shouldn't trigger the popover.
  const out: SelectedMonster[] = [];
  for (const it of items) {
    const sm = buildSelectedMonster(it, table);
    if (!sm) return [];
    out.push(sm);
  }
  return out;
}

async function readCombatPreparing(): Promise<boolean> {
  try {
    const meta = await OBR.scene.getMetadata();
    const cs = meta[COMBAT_STATE_KEY] as { preparing?: boolean } | undefined;
    return !!cs?.preparing;
  } catch { return false; }
}

async function broadcastState(): Promise<void> {
  try {
    const preparing = await readCombatPreparing();
    await OBR.broadcast.sendMessage(
      BC_STATE,
      {
        count: lastSelection.length,
        names: lastSelection.map((m) => m.name),
        lang: getLocalLang(),
        // mode: "initiative" while combat is being prepared (the GM
        // is rolling for monsters about to enter the order); "save"
        // otherwise (group save against a spell DC etc.).
        mode: preparing ? "initiative" : "save",
      },
      { destination: "LOCAL" },
    );
  } catch {}
}

async function openPopover(): Promise<void> {
  if (popoverOpen) return;
  try {
    const vw = await OBR.viewport.getWidth();
    await OBR.popover.open({
      id: POPOVER_ID,
      url: POPOVER_URL,
      width: POPOVER_WIDTH,
      height: POPOVER_HEIGHT,
      anchorReference: "POSITION",
      anchorPosition: { left: Math.round(vw / 2), top: TOP_OFFSET },
      anchorOrigin: { horizontal: "CENTER", vertical: "TOP" },
      transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
      hidePaper: true,
      // Don't insert OBR's invisible click-catcher — the user is in
      // the middle of canvas work (selecting tokens), and the catcher
      // would steal pointer events.
      disableClickAway: true,
    });
    popoverOpen = true;
    // Send state once the popover has had a moment to mount its
    // listener. The page itself also requests state on load via
    // BC_STATE_REQUEST as a belt-and-suspenders fallback.
    setTimeout(() => { void broadcastState(); }, 80);
  } catch (e) {
    console.error("[obr-suite/group-saves] openPopover failed", e);
  }
}

async function closePopover(): Promise<void> {
  if (!popoverOpen) return;
  try { await OBR.popover.close(POPOVER_ID); } catch {}
  popoverOpen = false;
}

async function refresh(): Promise<void> {
  if (role !== "GM") return;
  const next = await resolveSelection();
  lastSelection = next;
  if (next.length >= MIN_SELECTED) {
    if (!popoverOpen) await openPopover();
    else void broadcastState();
  } else {
    if (popoverOpen) await closePopover();
  }
}

// Roll one or two d20s for a single initiative entry. Mirrors the
// localRoll() helper in useInitiative.ts — same shape so the count
// write at climax matches the panel's display.
function rollD20Local(variant: "adv" | "normal" | "dis"): {
  rolls: number[];
  winnerIdx: number;
  finalValue: number;
} {
  const r1 = Math.floor(Math.random() * 20) + 1;
  if (variant === "normal") return { rolls: [r1], winnerIdx: 0, finalValue: r1 };
  const r2 = Math.floor(Math.random() * 20) + 1;
  if (variant === "adv") {
    const winnerIdx = r1 >= r2 ? 0 : 1;
    return { rolls: [r1, r2], winnerIdx, finalValue: Math.max(r1, r2) };
  }
  const winnerIdx = r1 <= r2 ? 0 : 1;
  return { rolls: [r1, r2], winnerIdx, finalValue: Math.min(r1, r2) };
}

async function fireInitiative(
  variant: "adv" | "normal" | "dis",
): Promise<void> {
  if (lastSelection.length === 0) return;
  const lang = getLocalLang();
  const variantLabel = lang === "zh"
    ? (variant === "adv" ? "先攻 (优势)" : variant === "dis" ? "先攻 (劣势)" : "先攻")
    : (variant === "adv" ? "Initiative (Adv)" : variant === "dis" ? "Initiative (Dis)" : "Initiative");
  const collectiveId = `col-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  // Read each token's dex modifier from initiative-tracker metadata
  // (bestiary spawn populates this when a monster is added). Falls
  // back to 0 if the token isn't initiative-tracked yet — the dice
  // animation still plays so the GM gets a usable number.
  let items: Item[] = [];
  try { items = await OBR.scene.items.getItems(lastSelection.map((m) => m.itemId)); } catch {}
  const itemMap = new Map<string, Item>();
  for (const it of items) itemMap.set(it.id, it);

  let rollerId = "";
  let rollerName = "";
  try {
    [rollerId, rollerName] = await Promise.all([
      OBR.player.getId(),
      OBR.player.getName(),
    ]);
  } catch {}

  // Per-token: roll d20 locally, generate deterministic init- rollId,
  // subscribe to BC_DICE_FADE_START with that rollId, then broadcast
  // the dice. The fade-start listener writes the rolled value into the
  // initiative-tracker `count` metadata at the instant of the climax —
  // exact same protocol as useInitiative.rollInitiativeLocal so the
  // initiative panel's column lights up at the right moment. Without
  // this we were just throwing dice without ever updating count.
  for (const m of lastSelection) {
    const it = itemMap.get(m.itemId);
    if (!it) continue;
    const dexMod = (it.metadata?.[INITIATIVE_DEX_KEY] as number) ?? 0;
    const { rolls, winnerIdx, finalValue } = rollD20Local(variant);
    const rollId = `init-${m.itemId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    let writeDone = false;
    const writeFinalValue = () => {
      if (writeDone) return;
      writeDone = true;
      OBR.scene.items.updateItems([m.itemId], (drafts) => {
        for (const d of drafts) {
          const existing = d.metadata[INITIATIVE_DATA_KEY] as any;
          // Stored count is the RAW d20 (no modifier) — the panel
          // adds the dexMod at display time. Mirror that exactly so
          // the existing sort / display path works unchanged.
          d.metadata[INITIATIVE_DATA_KEY] = { ...(existing ?? { count: 0, active: false }), count: finalValue, rolled: true };
        }
      }).catch((e) => {
        console.error("[obr-suite/group-saves] init count write failed", e);
      });
    };
    const unsub = OBR.broadcast.onMessage(BC_DICE_FADE_START, (event) => {
      const data = event.data as { rollId?: string } | undefined;
      if (data?.rollId !== rollId) return;
      writeFinalValue();
      try { unsub(); } catch {}
    });
    // Safety net — if the climax broadcast never arrives (modal
    // crash / network), still write the value after a generous
    // timeout so the column doesn't stay stale forever.
    setTimeout(() => { writeFinalValue(); try { unsub(); } catch {} }, 6000);

    // 2026-05-09: invisible-flagged tokens roll dark (initiative
    // metadata flag set by the right-click "Mark Invisible" menu).
    // Read here per-token instead of upfront because each iteration
    // already has the item handy via `itemMap`.
    // 2026-05-14: also force dark when DM has 全局暗骰 toggle on. The
    // toggle covers attack checks, group saves, etc. — group initiative
    // is the same conceptual category.
    const initData = (it.metadata as any)?.[INITIATIVE_DATA_KEY];
    const isInvisible =
      !!(initData && typeof initData === "object" && initData.invisible);
    const hiddenRoll = isInvisible || isGlobalDarkRollEnabled();

    try {
      await broadcastDiceRoll({
        itemId: m.itemId,
        dice: rolls.map((v, i) => {
          const die: { type: "d20"; value: number; loser?: boolean } = {
            type: "d20",
            value: v,
          };
          if (rolls.length > 1 && i !== winnerIdx) die.loser = true;
          return die;
        }),
        winnerIdx,
        modifier: dexMod,
        label: variantLabel,
        rollerId,
        rollerName,
        rollId,
        autoDismiss: true,
        collectiveId,
        hidden: hiddenRoll,
      });
    } catch (e) {
      console.error("[obr-suite/group-saves] fireInitiative broadcast failed for", m.itemId, e);
    }
  }
}

// Group HP edit — page sends one of three modes ("dmg" | "heal" |
// "set") with a numeric value. We patch every selected token's
// bubbles HP metadata via the shared `patchBubbles` helper. Damage
// applies to TEMP HP first, then bleeds into HP; heal stops at maxHp;
// set forces an exact value clamped to [0, maxHp]. Each iteration
// reads the current HP fresh so the user can stack actions in
// sequence (−5, −5, +10) without race conditions.
// Single-token HP / Max HP / AC delta — extracted from fireGroupHp so
// the resolve modal's per-token half-on-success path can call it with
// a different `value` per token.
async function applyHpDeltaToToken(
  itemId: string,
  mode: "dmg" | "heal" | "set",
  value: number,
  field: "health" | "max health" | "armor class",
): Promise<void> {
  try {
    const cur = await readBubbles(itemId);
    const maxHp = typeof cur["max health"] === "number" ? (cur["max health"] as number) : null;
    const hp = typeof cur["health"] === "number" ? (cur["health"] as number) : (maxHp ?? 0);
    const temp = typeof cur["temporary health"] === "number" ? (cur["temporary health"] as number) : 0;
    if (field === "max health" || field === "armor class") {
      const current = typeof cur[field] === "number" ? (cur[field] as number) : (field === "max health" ? (maxHp ?? hp) : 0);
      const next = mode === "set" ? value : mode === "heal" ? current + value : current - value;
      await patchBubbles(itemId, { [field]: Math.max(field === "max health" ? 1 : 0, next) } as any);
      return;
    }
    let nextHp = hp;
    let nextTemp = temp;
    if (mode === "set") {
      nextHp = Math.max(0, value);
      if (maxHp != null) nextHp = Math.min(nextHp, maxHp);
    } else if (mode === "heal") {
      nextHp = hp + value;
      if (maxHp != null) nextHp = Math.min(nextHp, maxHp);
    } else {
      // dmg: bleed through temp HP first, then HP. Negative HP is
      // pinned to 0 (matches the suite's standard "downed = 0 hp"
      // convention; DMs that track negative HP can manually edit
      // the token afterwards).
      let dmg = value;
      if (temp > 0) {
        const absorb = Math.min(temp, dmg);
        nextTemp = temp - absorb;
        dmg -= absorb;
      }
      nextHp = Math.max(0, hp - dmg);
    }
    const patch: Record<string, number> = {};
    if (nextHp !== hp) patch["health"] = nextHp;
    if (nextTemp !== temp) patch["temporary health"] = nextTemp;
    if (Object.keys(patch).length > 0) {
      await patchBubbles(itemId, patch as any);
    }
  } catch (e) {
    console.error("[obr-suite/group-saves] applyHpDeltaToToken failed for", itemId, e);
  }
}

async function fireGroupHp(
  mode: "dmg" | "heal" | "set",
  value: number,
  field: "health" | "max health" | "armor class" = "health",
): Promise<void> {
  if (lastSelection.length === 0) return;
  for (const m of lastSelection) {
    await applyHpDeltaToToken(m.itemId, mode, value, field);
  }
}

// === Group-save resolve flow =================================
//
// After every fireSave() emits its per-token rolls we register a
// pending entry keyed by collectiveId. A BROADCAST_DICE_ROLL listener
// (registered once in setupGroupSaves) collects each roll's `total`
// by itemId. When the count reaches the expected size we open the
// resolve modal and push the per-token results into it.
//
// Modal interaction (channels in the constants block above):
//   - BC_RESOLVE_STATE   bg → modal: { cid, ability, results }
//   - BC_RESOLVE_REQUEST modal → bg: { cid }   (re-push state)
//   - BC_RESOLVE_APPLY   modal → bg: { cid, mode, dc, value, field }
//   - BC_RESOLVE_DONE    modal → bg: { cid }   (close modal)
//
// The user can apply multiple times before clicking 好了 — each apply
// reads the CURRENT bubbles state (so chained −30 then +5 works) and
// applies relative to that. The save totals are LOCKED at fire time
// (subsequent applies don't re-roll), so the half-on-success math
// always uses the original results.
interface PendingResolve {
  cid: string;
  ability: keyof SelectedMonster["saves"];
  expected: number;
  results: Map<string, { name: string; total: number }>;
  selection: SelectedMonster[];
  // 2026-05-11 — track rollIds so we can wait for BC_DICE_FADE_START
  // (the climax broadcast at the END of each roll's animation, fired
  // from effect-page.ts signalUnlockReady). Earlier round opened the
  // modal as soon as BROADCAST_DICE_ROLL arrived, which is BEFORE the
  // animation runs; the user reported it felt premature.
  rollIds: Set<string>;
  rollIdsAnimDone: Set<string>;
  rollIdToItemId: Map<string, string>;
  timer: ReturnType<typeof setTimeout> | null;
  modalOpen: boolean;
}
const pendingResolves = new Map<string, PendingResolve>();

function buildResolveStatePayload(p: PendingResolve) {
  const out: Array<{ itemId: string; name: string; total: number }> = [];
  for (const m of p.selection) {
    const r = p.results.get(m.itemId);
    if (!r) continue;
    out.push({ itemId: m.itemId, name: r.name, total: r.total });
  }
  return { cid: p.cid, ability: p.ability, results: out };
}

async function broadcastResolveState(p: PendingResolve): Promise<void> {
  try {
    await OBR.broadcast.sendMessage(
      BC_RESOLVE_STATE,
      buildResolveStatePayload(p),
      { destination: "LOCAL" },
    );
  } catch {}
}

async function openResolveModal(p: PendingResolve): Promise<void> {
  if (p.modalOpen) {
    await broadcastResolveState(p);
    return;
  }
  p.modalOpen = true;
  try {
    await OBR.modal.open({
      id: RESOLVE_MODAL_ID,
      url: `${RESOLVE_URL}?cid=${encodeURIComponent(p.cid)}`,
      fullScreen: true,
      hideBackdrop: true,
      // Modals don't dismiss on click-away by default, but be explicit:
      // the "好了" button is the ONLY way out.
      hidePaper: true,
    });
  } catch (e) {
    console.error("[obr-suite/group-saves] open resolve modal failed", e);
    p.modalOpen = false;
    return;
  }
  // Push state after a short tick so the iframe has time to register
  // its BC_RESOLVE_STATE listener. The modal's own onReady also
  // requests a re-push (BC_RESOLVE_REQUEST), so this is just the
  // happy-path fast push.
  setTimeout(() => { void broadcastResolveState(p); }, 80);
}

async function closeResolveModal(cid: string): Promise<void> {
  const p = pendingResolves.get(cid);
  if (!p) return;
  if (p.timer) clearTimeout(p.timer);
  pendingResolves.delete(cid);
  if (p.modalOpen) {
    try { await OBR.modal.close(RESOLVE_MODAL_ID); } catch {}
  }
}

function startResolveBatch(cid: string, ability: keyof SelectedMonster["saves"]): void {
  // Snapshot the selection at fire time — `lastSelection` mutates as
  // OBR.player selection changes, but a save batch should resolve
  // against whoever rolled. Same for the per-token name (the canvas
  // name might be edited mid-roll otherwise).
  const selection: SelectedMonster[] = lastSelection.map((m) => ({ ...m, saves: { ...m.saves } }));
  if (selection.length === 0) return;
  // Safety timer — extended to 12 s so the slowest dice animation
  // (rush mode + many tokens, ≈8 s end-to-end) still has slack.
  // If somehow a fade-start never arrives we still open the modal
  // with whatever totals we collected.
  const timer = setTimeout(() => {
    const p = pendingResolves.get(cid);
    if (!p) return;
    if (p.modalOpen) return;
    void openResolveModal(p);
  }, 12000);
  pendingResolves.set(cid, {
    cid,
    ability,
    expected: selection.length,
    results: new Map(),
    selection,
    rollIds: new Set(),
    rollIdsAnimDone: new Set(),
    rollIdToItemId: new Map(),
    timer,
    modalOpen: false,
  });
}

// Step 1 of the gating flow: capture per-token TOTAL from
// BROADCAST_DICE_ROLL. This fires BEFORE the dice animation runs,
// so we just store the result; the modal won't open until the
// matching fade-start arrives.
function recordResolveResult(payload: DiceRollPayload): void {
  const cid = payload.collectiveId;
  if (!cid) return;
  const p = pendingResolves.get(cid);
  if (!p) return;
  const itemId = payload.itemId;
  if (!itemId) return;
  if (p.results.has(itemId)) return; // dedupe LOCAL+REMOTE copies
  // Resolve display name from the snapshot so renames mid-roll don't
  // confuse the modal.
  const seen = p.selection.find((m) => m.itemId === itemId);
  if (!seen) return; // payload's itemId isn't in our batch
  p.results.set(itemId, { name: seen.name, total: payload.total });
  // Track rollId so we can match its later BC_DICE_FADE_START.
  if (payload.rollId) {
    p.rollIds.add(payload.rollId);
    p.rollIdToItemId.set(payload.rollId, itemId);
  }
  // NOTE: we no longer open the modal here — that's deferred until
  // the matching fade-start broadcasts arrive in
  // recordResolveAnimDone() below.
}

// Step 2 of the gating flow: BC_DICE_FADE_START fires from
// effect-page.ts at the climax of each roll's animation (the final
// scale/punch). Once we've seen one for every rollId in this batch,
// the modal opens. This is what the user asked for ("真的监听到骰
// 子动画结束的那一刻").
function recordResolveAnimDone(rollId: string): void {
  if (!rollId) return;
  // O(n) scan of pending batches looking for this rollId. Typically
  // there's at most one batch in-flight, so this is fine.
  for (const p of pendingResolves.values()) {
    if (!p.rollIds.has(rollId)) continue;
    if (p.rollIdsAnimDone.has(rollId)) return; // dedupe LOCAL+REMOTE
    p.rollIdsAnimDone.add(rollId);
    if (
      p.rollIdsAnimDone.size >= p.expected &&
      p.results.size >= p.expected
    ) {
      if (p.timer) { clearTimeout(p.timer); p.timer = null; }
      void openResolveModal(p);
    }
    return;
  }
}

async function applyResolveBatch(
  cid: string,
  mode: "dmg" | "heal" | "set",
  dc: number | null,
  value: number,
  field: "health" | "max health" | "armor class",
): Promise<void> {
  const p = pendingResolves.get(cid);
  if (!p) return;
  for (const m of p.selection) {
    const r = p.results.get(m.itemId);
    // Tokens whose roll never came back are skipped (they get nothing
    // applied; the DM can edit them manually after dismissing).
    if (!r) continue;
    let toApply = value;
    if (mode === "dmg" && dc != null && Number.isFinite(dc)) {
      // 5e standard save-half: succeed (>= DC) → half floor, fail → full.
      toApply = r.total >= dc ? Math.floor(value / 2) : value;
    }
    // For heal / set the DC isn't meaningful (no "half-heal-on-fail"
    // standard rule); apply uniformly. For dmg with no DC entered,
    // we shouldn't be here (modal blocks that path), but fall back
    // to full damage to avoid silent misapplies.
    if (toApply === 0 && mode !== "set") continue;
    await applyHpDeltaToToken(m.itemId, mode, toApply, field);
  }
  // Re-broadcast state so the modal can refresh per-token tints if it
  // was holding any cached "applied" state. (Currently it doesn't,
  // but cheap to send and future-proof.)
  await broadcastResolveState(p);
}

async function fireSave(
  ability: keyof SelectedMonster["saves"],
  opts: { hidden?: boolean; advMode?: "adv" | "dis"; critMode?: boolean } = {},
): Promise<void> {
  if (lastSelection.length === 0) return;
  const lang = getLocalLang();
  const lbl = abilityLabel(ability, lang);
  const collectiveId = `col-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // 2026-05-11 — register a pending-resolve batch BEFORE we fire the
  // rolls so the BROADCAST_DICE_ROLL listener (registered in
  // setupGroupSaves) starts capturing totals as soon as the first
  // roll lands. The modal opens once `expected` results have arrived.
  // Hidden saves (e.g. invisible monster) intentionally skip the
  // modal — the DM is rolling those privately and there's nothing
  // to bulk-apply group-wise; they'll edit HP manually.
  if (!opts.hidden) {
    startResolveBatch(collectiveId, ability);
  }
  // Per-token roll. Each one carries its own save bonus so the dice
  // animation + history reflect each monster's individual outcome.
  // collectiveId groups them in the history popover as one collective.
  // hidden / advMode / critMode propagate to fireQuickRoll →
  // handleQuickRoll → broadcastDiceRoll.
  for (const m of lastSelection) {
    const bn = m.saves[ability];
    const expr = `1d20${bn >= 0 ? `+${bn}` : `${bn}`}`;
    try {
      await fireQuickRoll({
        expression: expr,
        label: lbl,
        itemId: m.itemId,
        focus: false,        // group-camera handled by the dice panel's focusCameraOnTokens
        hidden: !!opts.hidden,
        collectiveId,
        ...(opts.advMode ? { advMode: opts.advMode } : {}),
        ...(opts.critMode ? { critMode: true } : {}),
      });
    } catch (e) {
      console.error("[obr-suite/group-saves] fireSave failed for", m.itemId, e);
    }
  }
}

export async function setupGroupSaves(): Promise<void> {
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}
  if (role !== "GM") return;

  // Re-anchor the centered popover on browser resize. Same id + url
  // → OBR updates position in place.
  unsubs.push(
    onViewportResize(async () => {
      if (!popoverOpen) return;
      popoverOpen = false;
      await openPopover();
    }),
  );

  unsubs.push(
    OBR.player.onChange(async () => {
      try { await refresh(); } catch {}
    }),
  );
  unsubs.push(
    OBR.scene.items.onChange(async () => {
      // A token's metadata might have changed (bind/unbind), or the
      // selection might still be the same itemIds but the underlying
      // items got updated. Cheap to re-resolve.
      try { await refresh(); } catch {}
    }),
  );
  unsubs.push(
    OBR.scene.onMetadataChange(async (meta) => {
      if (!(BESTIARY_DATA_KEY in meta)) return;
      // Monster data table writes (e.g. fresh bind) — re-resolve so a
      // newly-populated row enables the popover instantly.
      try { await refresh(); } catch {}
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_FIRE, async (event) => {
      const data = event.data as
        | {
            ability?: string;
            hidden?: boolean;
            advMode?: "adv" | "dis";
            critMode?: boolean;
          }
        | undefined;
      const a = data?.ability;
      if (a === "str" || a === "dex" || a === "con" || a === "int" || a === "wis" || a === "cha") {
        await fireSave(a, {
          hidden: data?.hidden,
          advMode: data?.advMode,
          critMode: data?.critMode,
        });
      }
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_FIRE_INIT, async (event) => {
      const data = event.data as { variant?: string } | undefined;
      const v = data?.variant;
      if (v === "adv" || v === "normal" || v === "dis") {
        await fireInitiative(v);
      }
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_FIRE_HP, async (event) => {
      const data = event.data as { mode?: string; value?: number; field?: string } | undefined;
      const m = data?.mode;
      const v = typeof data?.value === "number" ? data.value : NaN;
      const f = data?.field === "max health" || data?.field === "armor class" ? data.field : "health";
      if (!Number.isFinite(v)) return;
      if (m === "dmg" || m === "heal" || m === "set") {
        await fireGroupHp(m, Math.max(0, Math.min(9999, Math.round(v))), f);
      }
    }),
  );
  // Page can request state right after mount in case our automatic
  // post-open broadcast missed the listener registration race.
  unsubs.push(
    OBR.broadcast.onMessage("com.obr-suite/bestiary-group-save-state-request", async () => {
      await broadcastState();
    }),
  );

  // 2026-05-11 — group-save resolve flow listeners.
  //
  // (1a) Capture per-token roll totals + rollIds from BROADCAST_DICE_ROLL.
  //      This fires BEFORE the animation. We just stash the result;
  //      the modal stays closed until the matching fade-start fires.
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_DICE_ROLL, (event) => {
      const data = event.data as DiceRollPayload | undefined;
      if (!data || !data.collectiveId) return;
      recordResolveResult(data);
    }),
  );

  // (1b) BC_DICE_FADE_START fires from effect-page.ts at each roll's
  //      climax (the final scale/punch animation step). When all
  //      rolls in a pending batch have animated out, THAT'S when we
  //      open the modal. Earlier rounds opened on (1a) which felt
  //      premature ("弹窗速度有点慢，并没有真的监听到骰子动画结束的
  //      那一刻") because the dice were still tumbling on screen.
  unsubs.push(
    OBR.broadcast.onMessage("com.obr-suite/dice-fade-start", (event) => {
      const data = event.data as { rollId?: string } | undefined;
      const rollId = data?.rollId;
      if (typeof rollId === "string" && rollId) {
        recordResolveAnimDone(rollId);
      }
    }),
  );

  // (2) Modal asks for state on cold-mount race.
  unsubs.push(
    OBR.broadcast.onMessage(BC_RESOLVE_REQUEST, async (event) => {
      const data = event.data as { cid?: string } | undefined;
      const cid = data?.cid;
      if (!cid) return;
      const p = pendingResolves.get(cid);
      if (!p) return;
      await broadcastResolveState(p);
    }),
  );

  // (3) Modal applies an HP change with the save-half rule.
  unsubs.push(
    OBR.broadcast.onMessage(BC_RESOLVE_APPLY, async (event) => {
      const data = event.data as
        | { cid?: string; mode?: string; dc?: number | null; value?: number; field?: string }
        | undefined;
      const cid = data?.cid;
      const mode = data?.mode;
      const value = typeof data?.value === "number" ? data.value : NaN;
      const field = data?.field === "max health" || data?.field === "armor class"
        ? data.field
        : "health";
      if (!cid) return;
      if (!Number.isFinite(value)) return;
      if (mode !== "dmg" && mode !== "heal" && mode !== "set") return;
      const dc = typeof data?.dc === "number" && Number.isFinite(data.dc) ? data.dc : null;
      await applyResolveBatch(cid, mode, dc, Math.max(0, Math.min(9999, Math.round(value))), field);
    }),
  );

  // (4) Modal dismissed via "好了".
  unsubs.push(
    OBR.broadcast.onMessage(BC_RESOLVE_DONE, async (event) => {
      const data = event.data as { cid?: string } | undefined;
      const cid = data?.cid;
      if (!cid) return;
      await closeResolveModal(cid);
    }),
  );
  // Re-broadcast state when the user flips suite language so the
  // popover labels refresh.
  unsubs.push(
    onLangChange(() => { void broadcastState(); }),
  );

  // Initial resolve (handles the case where a multi-selection already
  // exists when the suite finishes loading).
  await refresh();
}

export async function teardownGroupSaves(): Promise<void> {
  for (const u of unsubs.splice(0)) u();
  await closePopover();
  // Close any open resolve modal (and clear timers) so a scene
  // teardown doesn't leak a half-open dialog.
  for (const cid of [...pendingResolves.keys()]) {
    await closeResolveModal(cid);
  }
  lastSelection = [];
}
