import OBR, { Item } from "@owlbear-rodeo/sdk";
import { fireQuickRoll } from "../dice/tags";
import { broadcastDiceRoll } from "../dice";
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
async function fireGroupHp(
  mode: "dmg" | "heal" | "set",
  value: number,
): Promise<void> {
  if (lastSelection.length === 0) return;
  for (const m of lastSelection) {
    try {
      const cur = await readBubbles(m.itemId);
      const maxHp = typeof cur["max health"] === "number" ? (cur["max health"] as number) : null;
      const hp = typeof cur["health"] === "number" ? (cur["health"] as number) : (maxHp ?? 0);
      const temp = typeof cur["temporary health"] === "number" ? (cur["temporary health"] as number) : 0;
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
        await patchBubbles(m.itemId, patch as any);
      }
    } catch (e) {
      console.error("[obr-suite/group-saves] fireGroupHp failed for", m.itemId, e);
    }
  }
}

async function fireSave(
  ability: keyof SelectedMonster["saves"],
  opts: { hidden?: boolean; advMode?: "adv" | "dis" } = {},
): Promise<void> {
  if (lastSelection.length === 0) return;
  const lang = getLocalLang();
  const lbl = abilityLabel(ability, lang);
  const collectiveId = `col-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // Per-token roll. Each one carries its own save bonus so the dice
  // animation + history reflect each monster's individual outcome.
  // collectiveId groups them in the history popover as one collective.
  // hidden / advMode propagate to fireQuickRoll → handleQuickRoll →
  // broadcastDiceRoll, so the dark-roll + adv/dis branches all work
  // identically to a single quick-roll.
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
    OBR.scene.onMetadataChange(async () => {
      // Monster data table writes (e.g. fresh bind) — re-resolve so a
      // newly-populated row enables the popover instantly.
      try { await refresh(); } catch {}
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_FIRE, async (event) => {
      const data = event.data as
        | { ability?: string; hidden?: boolean; advMode?: "adv" | "dis" }
        | undefined;
      const a = data?.ability;
      if (a === "str" || a === "dex" || a === "con" || a === "int" || a === "wis" || a === "cha") {
        await fireSave(a, { hidden: data?.hidden, advMode: data?.advMode });
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
      const data = event.data as { mode?: string; value?: number } | undefined;
      const m = data?.mode;
      const v = typeof data?.value === "number" ? data.value : NaN;
      if (!Number.isFinite(v)) return;
      if (m === "dmg" || m === "heal" || m === "set") {
        await fireGroupHp(m, Math.max(0, Math.min(9999, Math.round(v))));
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
  lastSelection = [];
}
