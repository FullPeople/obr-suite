import OBR, { Item } from "@owlbear-rodeo/sdk";
import { fireQuickRoll } from "../dice/tags";
import { getLocalLang, onLangChange } from "../../state";

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
const POPOVER_URL = "https://obr.dnd.center/suite/bestiary-group-saves.html";

const BESTIARY_SLUG_KEY = `${PLUGIN_ID}/slug`;
const BESTIARY_DATA_KEY = `${PLUGIN_ID}/monsters`;

// Broadcast channels (LOCAL only — single client lifecycle):
const BC_FIRE = "com.obr-suite/bestiary-group-save-fire";
const BC_STATE = "com.obr-suite/bestiary-group-save-state";

const POPOVER_WIDTH = 360;
const POPOVER_HEIGHT = 96;
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

async function broadcastState(): Promise<void> {
  try {
    await OBR.broadcast.sendMessage(
      BC_STATE,
      {
        count: lastSelection.length,
        names: lastSelection.map((m) => m.name),
        lang: getLocalLang(),
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
