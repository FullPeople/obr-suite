import OBR from "@owlbear-rodeo/sdk";
import { DiceType, DIE_SIDES, DIE_SIZE_FACTOR, sidesOf } from "./types";
import * as sfx from "./sfx-broadcast";

// Dice-effect modal page. Multi-die + multi-type capable.
//
// URL params:
//   dtypes   - comma-separated die types: "d20,d20" or "d20,d6,d6,d6"
//   dvalues  - comma-separated face values, parallel to dtypes
//   winner   - index into dvalues of the kept die. -1 = no specific
//              winner (panel rolls just show the total). Only the
//              winner plays the zoom punch + crit/fail flash.
//   total    - sum of values + modifier (cached for total-display)
//   modifier - add/subtract bonus
//   label    - optional display label ("Sneak attack")
//   rollId   - unique id (matches modal id)
//   wx, wy   - world coords of the LANDING anchor
//   color    - rolling player's OBR-assigned color
//
// Each die gets its own random fly-in direction, rotation magnitude /
// direction, horizontal slot offset, and SIZE — d4 is smaller than d20
// is smaller than d100, so a row visually distinguishes types.

const params = new URLSearchParams(location.search);

// Channels — duplicated string consts (rather than imported from
// dice/index.ts) so this iframe stays a leaf module that doesn't pull
// the whole sibling background module into its bundle.
const BC_DICE_FORCE_CLEAR = "com.obr-suite/dice-force-clear";
const BC_DICE_CLEAR_ALL   = "com.obr-suite/dice-clear-all";
const BC_DICE_FADE_START  = "com.obr-suite/dice-fade-start";
// Sent when the fly-to-history animation reaches its fade-out point.
// The history popover defers committing each new entry until it
// receives this signal, so visually the entry "lands" in the popover
// at the same moment the dice arrive there.
const BC_DICE_HISTORY_REVEAL = "com.obr-suite/dice-history-reveal";

// Standard dice that have a dedicated PNG. Anything else (custom dN
// sides like d7 or d13) falls back to the d100 art.
const STANDARD_TYPES = new Set<string>(["d4", "d6", "d8", "d10", "d12", "d20", "d100"]);
function imgTypeFor(type: string): DiceType {
  return STANDARD_TYPES.has(type) ? (type as DiceType) : "d100";
}
// Use the shared sidesOf() helper from types.ts so behaviour matches
// the panel + the broadcast normaliser. Custom-side dice (d7, d600...)
// resolve to their actual face count instead of falling back to 20.
const sidesOfType = sidesOf;

// Type+value+loser-flag triples. Custom-side types (e.g. "d7") are kept
// as the raw string in `type` — `imgTypeFor()` maps to a real PNG,
// `sidesOfType()` resolves the side count for slot-machine cycling.
// `loser` flag is set for adv/dis losing-set dice; they render at 0.3
// alpha throughout and skip the rush sequence.
interface ParsedDie {
  type: string;
  value: number;
  loser: boolean;
  originalValue?: number;
  burstParent?: number;
}
function parseDice(): ParsedDie[] {
  const dtypes = (params.get("dtypes") ?? "").split(",").filter(Boolean);
  const dvalues = (params.get("dvalues") ?? params.get("rolls") ?? "")
    .split(",")
    .filter(Boolean);
  const dlosers = (params.get("dlosers") ?? "").split(",");
  // Parallel arrays — empty string means "no annotation" for that die.
  const doriginals = (params.get("doriginals") ?? "").split(",");
  const dparents = (params.get("dparents") ?? "").split(",");
  const out: ParsedDie[] = [];
  for (let i = 0; i < dvalues.length; i++) {
    const t = (dtypes[i] as string) ?? "d20";
    const sides = sidesOfType(t);
    const v = Math.max(1, Math.min(sides, parseInt(dvalues[i], 10) || 1));
    const loser = dlosers[i] === "1";
    const origRaw = doriginals[i] ?? "";
    const parentRaw = dparents[i] ?? "";
    const die: ParsedDie = { type: t, value: v, loser };
    if (origRaw !== "") {
      const o = parseInt(origRaw, 10);
      if (Number.isFinite(o)) die.originalValue = o;
    }
    if (parentRaw !== "") {
      const p = parseInt(parentRaw, 10);
      if (Number.isFinite(p)) die.burstParent = p;
    }
    out.push(die);
  }
  return out.length ? out : [{ type: "d20", value: 1, loser: false }];
}

const dice = parseDice();
const winnerIdx = (() => {
  const v = parseInt(params.get("winner") ?? "0", 10);
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(dice.length - 1, v));
})();
const rollId = params.get("rollId") ?? "";
const rollerIdParam = params.get("rollerId") ?? "";
const wx = parseFloat(params.get("wx") ?? "0");
const wy = parseFloat(params.get("wy") ?? "0");
const playerColor = params.get("color") || "#5dade2";
const isHidden = params.get("hidden") === "1";
const itemIdParam = params.get("itemId") ?? "";
const totalParam = params.get("total");
const total = totalParam !== null ? parseInt(totalParam, 10) : null;
const modifierParam = params.get("modifier");
const modifier = modifierParam !== null ? parseInt(modifierParam, 10) || 0 : 0;
const label = params.get("label") ?? "";
const MODAL_ID = `com.obr-suite/dice-effect-${rollId}`;
// Auto-dismiss: modal self-closes shortly after the climax. Set by
// initiative rolls so they don't linger after the result is shown.
const autoDismiss = params.get("autoDismiss") === "1";
// rowStarts: comma-separated start indices for repeat() row layout.
// Empty / single zero = no row layout (use the normal flow).
const rowStartsRaw = params.get("rowStarts") ?? "";
const rowStarts: number[] = rowStartsRaw
  ? rowStartsRaw.split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n))
  : [];
const sameHighlight = params.get("same") === "1";

const N_DICE = dice.length;
document.documentElement.style.setProperty("--player-color", playerColor);
// Conflict / contrast color — used by same-highlight so duplicates
// pop OFF the player-colored die background (same color on same color
// would just blend in). Shift hue 180°, force high saturation and a
// readable lightness regardless of the source.
function complementHex(hex: string): string {
  let h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return "#ffd166";
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0;
  const li = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = li > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  const newH = (hue + 180) % 360;
  // Clamp to bright + readable range so dark / pale player colors both
  // produce a vivid contrast tint.
  const newS = Math.max(0.7, sat);
  const newL = 0.62;
  // HSL → RGB
  const c = (1 - Math.abs(2 * newL - 1)) * newS;
  const x = c * (1 - Math.abs(((newH / 60) % 2) - 1));
  const mLight = newL - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (newH < 60) { r1 = c; g1 = x; }
  else if (newH < 120) { r1 = x; g1 = c; }
  else if (newH < 180) { g1 = c; b1 = x; }
  else if (newH < 240) { g1 = x; b1 = c; }
  else if (newH < 300) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  const toHex = (v: number) => {
    const n = Math.round((v + mLight) * 255);
    return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  };
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}
document.documentElement.style.setProperty("--player-conflict-color", complementHex(playerColor));
// BASE_SIZE is computed below — but we want the modifier number
// (.mod-num) to scale relative to it. Set on root so the calc()
// fallback in CSS resolves correctly.

// --- Per-die size: base (count-driven) × type factor (d4..d100). ---
const BASE_SIZE = N_DICE <= 1 ? 128 : Math.max(72, Math.round(128 * Math.pow(0.86, N_DICE - 1)));
document.documentElement.style.setProperty("--dice-size", `${BASE_SIZE}px`);
function dieSizeFor(type: string): number {
  const t = imgTypeFor(type);
  return Math.round(BASE_SIZE * DIE_SIZE_FACTOR[t]);
}
const dieSizes = dice.map((d) => dieSizeFor(d.type));

// repeat-mode flag: rowStarts has 2+ entries → each entry begins a
// separate row of dice (one row per repeat iteration). In that case
// the global rush sequence is replaced by per-row totals.
const useRepeatLayout = rowStarts.length >= 2;

// Slot for each die. Hard limit of 4 per row in default mode — anything
// beyond wraps. In repeat mode, rows are pre-determined by rowStarts
// so each row always shows exactly one repeat-iteration's dice.
const PER_ROW = 4;

// Track which dice are CURRENTLY in the layout (and therefore should
// have their slot computed). Burst children stay out of the layout
// until their parent's burst chain reveals them — at that point the
// existing dice slide aside and the new die takes its place. This
// avoids "spoiler" empty slots that telegraph an incoming burst.
//
//  - Non-repeat mode: visibleLinear is a flat list. layoutFor(...) below
//    auto-splits into rows of PER_ROW.
//  - Repeat mode: visibleByRow[r] is the live list of indices in row r;
//    each row's burst children appear within that row only.
const visibleLinear: number[] = [];
const visibleByRow: number[][] = [];
function initVisibleState(): void {
  if (useRepeatLayout) {
    for (let i = 0; i < rowStarts.length; i++) {
      const s = rowStarts[i];
      const e = i + 1 < rowStarts.length ? rowStarts[i + 1] : N_DICE;
      const row: number[] = [];
      for (let j = s; j < e; j++) {
        if (typeof dice[j].burstParent !== "number") row.push(j);
      }
      visibleByRow.push(row);
    }
  } else {
    for (let i = 0; i < N_DICE; i++) {
      if (typeof dice[i].burstParent !== "number") visibleLinear.push(i);
    }
  }
}

// Insert die i (a burst child) into the visible structure right after
// its burst parent so it lands adjacent in the layout. Called from
// revealBurstChild before the slot recompute.
function insertIntoVisible(i: number): void {
  const parent = dice[i].burstParent!;
  if (useRepeatLayout) {
    for (const row of visibleByRow) {
      const pIdx = row.indexOf(parent);
      if (pIdx >= 0) {
        row.splice(pIdx + 1, 0, i);
        return;
      }
    }
  } else {
    const pIdx = visibleLinear.indexOf(parent);
    if (pIdx >= 0) visibleLinear.splice(pIdx + 1, 0, i);
    else visibleLinear.push(i);
  }
}

// All currently-visible indices in display order — used by the slide
// animation to know whose left/top to update.
function allVisibleIndices(): number[] {
  if (useRepeatLayout) return visibleByRow.flat();
  return [...visibleLinear];
}

initVisibleState();

// `slots[i]` may be left undefined for not-yet-visible burst children.
// The frame loop and per-die element creation must guard against this.
const slots: Array<{ ox: number; oy: number; size: number } | undefined> = new Array(N_DICE);

// Recompute slots[] for every CURRENTLY visible die based on the live
// visibleLinear / visibleByRow lists. Burst children that haven't been
// revealed yet are skipped — their slots[i] stays undefined.
function recomputeLayout(): void {
  const gap = Math.round(BASE_SIZE * 0.16);
  const rowH = BASE_SIZE + gap;

  if (useRepeatLayout) {
    const rowCount = visibleByRow.length;
    for (let r = 0; r < rowCount; r++) {
      const row = visibleByRow[r];
      let rowW = 0;
      for (const idx of row) rowW += dieSizes[idx];
      rowW += gap * Math.max(0, row.length - 1);
      let cursor = -rowW / 2;
      const rowOy = (r - (rowCount - 1) / 2) * rowH;
      for (const idx of row) {
        const s = dieSizes[idx];
        slots[idx] = { ox: cursor + s / 2, oy: rowOy, size: s };
        cursor += s + gap;
      }
    }
    return;
  }

  // Non-repeat: split visibleLinear into rows of PER_ROW.
  const N_VIS = visibleLinear.length;
  const rowCount = Math.max(1, Math.ceil(N_VIS / PER_ROW));
  for (let r = 0; r < rowCount; r++) {
    const startInList = r * PER_ROW;
    const endInList = Math.min(startInList + PER_ROW, N_VIS);
    const rowDice = endInList - startInList;
    let rowW = 0;
    for (let li = startInList; li < endInList; li++) rowW += dieSizes[visibleLinear[li]];
    rowW += gap * Math.max(0, rowDice - 1);
    let cursor = -rowW / 2;
    const rowOy = (r - (rowCount - 1) / 2) * rowH;
    for (let li = startInList; li < endInList; li++) {
      const idx = visibleLinear[li];
      const s = dieSizes[idx];
      slots[idx] = { ox: cursor + s / 2, oy: rowOy, size: s };
      cursor += s + gap;
    }
  }
}

// rowSpans is still used by repeat-mode helpers (per-row totals etc.)
// so keep it as the original split. `visibleByRow` mirrors it for the
// dynamic layout state.
function computeRowSpans(): Array<[number, number]> {
  if (useRepeatLayout) {
    const rows: Array<[number, number]> = [];
    for (let i = 0; i < rowStarts.length; i++) {
      const s = rowStarts[i];
      const e = i + 1 < rowStarts.length ? rowStarts[i + 1] : N_DICE;
      if (e > s) rows.push([s, e]);
    }
    return rows;
  }
  const rows: Array<[number, number]> = [];
  for (let i = 0; i < N_DICE; i += PER_ROW) {
    rows.push([i, Math.min(i + PER_ROW, N_DICE)]);
  }
  return rows;
}
const rowSpans = computeRowSpans();

// Run initial layout (visible dice only).
recomputeLayout();

// --- Timings ---
//
//   0       FLIGHT          +HOLD1      +PUNCH       +HOLD2      +EXIT
//   |--bouncing-|---rest---|--zoom in/out--|--rest--|--fade out--|
//
// The dice settles at FLIGHT_MS (slot snaps to value, NO zoom yet),
// holds for HOLD1 so the user can read the result calmly, then plays
// the dramatic zoom punch (winner only — both dice & number), holds
// briefly, then fades out. Non-winners just snap their values and
// stay quietly until the shared exit fade.
const FLIGHT_MS = 1200;
const HOLD_BEFORE_PUNCH_MS = 500;
const PUNCH_MS = 360;
const HOLD_AFTER_PUNCH_MS = 220;
const EXIT_MS = 320;
const SLOT_INTERVAL_MS = 55;
// Beat between phases of the effect pipeline. Same length as the
// adv/dis simple-punch hold so every special animation feels like it
// kicks in "after the dice fully land", not the moment values appear.
const POST_LAND_HOLD_MS = 500;
// Hold after the same-tint pulse so the player sees the highlight
// settle before the rush starts.
const SAME_HOLD_MS = 500;
// Beats inside a burst chain — between the parent's pop and the
// child's fly-in, and between a child landing and the next pop.
const BURST_BEAT_MS = 280;
// Total ≈ 2600ms. Helpful named milestones used by setTimeouts below.
const SETTLE_AT_MS = FLIGHT_MS;
const PUNCH_AT_MS = FLIGHT_MS + HOLD_BEFORE_PUNCH_MS;
const EXIT_AT_MS = PUNCH_AT_MS + PUNCH_MS + HOLD_AFTER_PUNCH_MS;

// --- Multi-arc bounce parameters ---
const N_ARCS = 4;
const r = 0.55;
const t0 = (FLIGHT_MS * (1 - r)) / (1 - Math.pow(r, N_ARCS));
const arcDurations: number[] = [];
const arcEndTimes: number[] = [];
{
  let cum = 0;
  for (let i = 0; i < N_ARCS; i++) {
    const d = t0 * Math.pow(r, i);
    arcDurations.push(d);
    cum += d;
    arcEndTimes.push(cum);
  }
}
const H0 = 240; // first arc peak height (px)
const arcHeights: number[] = [];
for (let i = 0; i < N_ARCS; i++) {
  arcHeights.push(H0 * Math.pow(r, 2 * i));
}
const ROT_BASE = 720;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface DieAnim {
  // Per-die fly-in start offset (from this die's slot)
  sx: number;
  sy: number;
  // Cumulative rotation at end of each arc (sums to -initial so final = 0)
  arcRotEnds: number[];
  initialRotation: number;
  // Per-arc impact points along the baseline (start → slot)
  impactPoints: Array<{ x: number; y: number }>;
}

function makeDieAnim(): DieAnim {
  const angle = Math.random() * 2 * Math.PI;
  // Modal is fullscreen so we can fly in from genuine off-viewport
  // distance — no need to constrain to a popover bounding box.
  const vmax = Math.max(window.innerWidth, window.innerHeight, 1024);
  const distance = vmax * 0.6 + Math.random() * 100;
  const sx = Math.cos(angle) * distance;
  const sy = Math.sin(angle) * distance;

  const rotDir = Math.random() < 0.5 ? -1 : 1;
  const arcRotations: number[] = [];
  for (let i = 0; i < N_ARCS; i++) {
    arcRotations.push(rotDir * ROT_BASE * Math.pow(r, i));
  }
  const arcRotEnds: number[] = [];
  let cumR = 0;
  for (let i = 0; i < N_ARCS; i++) {
    cumR += arcRotations[i];
    arcRotEnds.push(cumR);
  }
  const initialRotation = -arcRotEnds[N_ARCS - 1];

  const impactPoints: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < N_ARCS; i++) {
    const tFrac = arcEndTimes[i] / FLIGHT_MS;
    impactPoints.push({
      x: sx * (1 - tFrac),
      y: sy * (1 - tFrac),
    });
  }

  return { sx, sy, arcRotEnds, initialRotation, impactPoints };
}

const dieAnims: DieAnim[] = Array.from({ length: N_DICE }, () => makeDieAnim());

// --- DOM ---
const diceWrap = document.getElementById("diceWrap") as HTMLDivElement;
const flash = document.getElementById("flash") as HTMLDivElement;

const diceEls: HTMLDivElement[] = [];
const numEls: HTMLSpanElement[] = [];
// Sibling element shown when a die has originalValue (max/min/reset
// replacement). Same index as diceEls — null entries for dice whose
// value wasn't changed.
const numOrigEls: Array<HTMLSpanElement | null> = [];
// Per-die maximum-opacity ceiling.
//   - Hidden roll (DM dark roll): every die rides at 0.5 to visually
//     denote "this is hidden from players".
//   - Otherwise: full 1.0.
// Loser-set dice (adv/dis) start at the ceiling too; they only fade
// down to 0.3 AFTER the winner punch / final scale completes — see
// `loserFadeFactor()` in the frame loop. (User asked for losers to
// stay full-alpha through the bounce + landing, then fade.)
const HIDDEN_TINT = 0.5;
const ALPHA_CEILING = isHidden ? HIDDEN_TINT : 1;
const LOSER_REST_ALPHA = 0.3;
const LOSER_FADE_MS = 380;
const baseAlpha = dice.map(() => ALPHA_CEILING);
// `revealed[i]` flips false → true the moment a burst child becomes
// visible (its parent's burst animation called revealBurstChild). Dice
// that aren't burst children start true. The frame loop checks this
// during bounce + rest so burst children stay invisible until the
// chain animation explicitly reveals them — without this they bounced
// in alongside originals, then vanished at settle, then reappeared at
// burst time (jarring flicker).
const revealed: boolean[] = dice.map((d) => typeof d.burstParent !== "number");
for (let i = 0; i < N_DICE; i++) {
  const el = document.createElement("div");
  el.className = "dice";
  if (dice[i].loser) el.classList.add("loser");
  el.dataset.type = dice[i].type;
  const size = dieSizes[i];
  // Per-die size override — d4 visibly smaller than d20, d100 a bit
  // bigger. Set both via the CSS variable (font-size of inner number
  // tracks it) and explicit width/height.
  el.style.setProperty("--dice-size", `${size}px`);
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  // Position the die's natural slot via left/top (relative to wrap which
  // is anchored at the token's top-center). Burst children don't have
  // a slot yet (they're not in the layout until their parent triggers
  // them) — initially position them at the wrap origin behind opacity:0
  // so they don't render anywhere visible.
  const initSlot = slots[i];
  if (initSlot) {
    el.style.left = `${initSlot.ox - size / 2}px`;
    el.style.top = `${initSlot.oy - size / 2}px`;
  } else {
    el.style.left = `${-size / 2}px`;
    el.style.top = `${-size / 2}px`;
  }

  // Each die uses its TYPE's PNG as the alpha mask. Custom-side dice
  // (d7, d13, etc.) fall back to d100 art via imgTypeFor(). Build via
  // createElement (NOT innerHTML with `style="..."`) — embedding url("...")
  // inside a double-quoted HTML attribute terminates the attribute
  // prematurely and the mask never applies.
  const url = `/suite/${imgTypeFor(dice[i].type)}.png`;
  const artBase = document.createElement("div");
  artBase.className = "art-base";
  artBase.style.setProperty("-webkit-mask", `url("${url}") center/contain no-repeat`);
  artBase.style.setProperty("mask", `url("${url}") center/contain no-repeat`);

  const artFg = document.createElement("div");
  artFg.className = "art-fg";
  artFg.style.background = `url("${url}") center/contain no-repeat`;

  const num = document.createElement("span");
  num.className = "num";
  num.textContent = "?";

  el.appendChild(artBase);
  el.appendChild(artFg);
  el.appendChild(num);

  // Original-value annotation — shown only if the die was modified by
  // max/min/reset. Empty otherwise so we don't paint a "(N)" tag for
  // every die. Revealed at settle (when the slot lands).
  let origEl: HTMLSpanElement | null = null;
  if (typeof dice[i].originalValue === "number") {
    origEl = document.createElement("span");
    origEl.className = "num-orig";
    origEl.textContent = `(${dice[i].originalValue})`;
    el.appendChild(origEl);
  }
  numOrigEls.push(origEl);

  diceWrap.appendChild(el);
  diceEls.push(el);
  numEls.push(num);
}

// --- Branch decision ---
//
// Simple-punch case  (single die OR adv/dis with no modifier): just
// the existing winner-zoom flow, no upper total counter.
//
// Rush case (any other situation — multi-die or has modifier): each
// die's number rushes up to a running-total counter above the row,
// label + modifier fade in below, modifier rushes last, final pop,
// fade.
const useSimplePunch = (N_DICE === 1 || winnerIdx >= 0) && modifier === 0;

// Running total counter (rush case only) — sits above the dice row.
let totalEl: HTMLDivElement | null = null;
let totalNumEl: HTMLSpanElement | null = null;
// Modifier + label box (rush case only) — sits below the dice row,
// fades in 0.2s after settle.
let modBoxEl: HTMLDivElement | null = null;
let modNumEl: HTMLSpanElement | null = null;

// Running total — only meaningful in the rush flow. Built only there.
// Skipped in repeat mode (per-row totals replace it).
if (!useSimplePunch && !useRepeatLayout) {
  totalEl = document.createElement("div");
  totalEl.className = "running-total";
  totalEl.style.left = "0";
  totalEl.style.top = `${-BASE_SIZE / 2 - 64}px`;
  totalNumEl = document.createElement("span");
  totalNumEl.className = "rt-num";
  totalNumEl.textContent = "0";
  totalEl.appendChild(totalNumEl);
  diceWrap.appendChild(totalEl);
}

// Mod box appears whenever there's a modifier OR a label. In repeat
// mode the modifier is already baked into each per-row total, so we
// SKIP showing the modifier number there (would be confusing) and
// only render the label if one was supplied.
const showModNumber = modifier !== 0 && !useRepeatLayout;
if (showModNumber || label) {
  modBoxEl = document.createElement("div");
  modBoxEl.className = "mod-box";
  modBoxEl.style.left = "0";
  // Vertical anchor — below the LAST row of dice. In repeat mode use
  // the actual row count from rowSpans; otherwise fall back to the 4-
  // per-row default.
  const rowCount = useRepeatLayout ? rowSpans.length : Math.ceil(N_DICE / 4);
  const rowH = BASE_SIZE + Math.round(BASE_SIZE * 0.16);
  const lastRowOy = (rowCount - 1 - (rowCount - 1) / 2) * rowH;
  modBoxEl.style.top = `${lastRowOy + BASE_SIZE / 2 + 28}px`;
  if (showModNumber) {
    modNumEl = document.createElement("span");
    modNumEl.className = "mod-num";
    modNumEl.textContent = modifier > 0 ? `+${modifier}` : `${modifier}`;
    modBoxEl.appendChild(modNumEl);
  }
  if (label) {
    const lab = document.createElement("span");
    lab.className = "mod-label";
    lab.textContent = label;
    modBoxEl.appendChild(lab);
  }
  diceWrap.appendChild(modBoxEl);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// --- Animation helpers ---
function findArc(elapsedMs: number): { idx: number; localT: number } {
  for (let i = 0; i < N_ARCS; i++) {
    if (elapsedMs < arcEndTimes[i]) {
      const start = i === 0 ? 0 : arcEndTimes[i - 1];
      return { idx: i, localT: (elapsedMs - start) / arcDurations[i] };
    }
  }
  return { idx: N_ARCS - 1, localT: 1 };
}

function getPos(elapsedMs: number, anim: DieAnim): { x: number; y: number } {
  if (elapsedMs >= FLIGHT_MS) return { x: 0, y: 0 };
  const { idx, localT } = findArc(elapsedMs);
  const startPt = idx === 0 ? { x: anim.sx, y: anim.sy } : anim.impactPoints[idx - 1];
  const endPt = anim.impactPoints[idx];
  const x = startPt.x + (endPt.x - startPt.x) * localT;
  const y = startPt.y + (endPt.y - startPt.y) * localT;
  const arc = -arcHeights[idx] * 4 * localT * (1 - localT);
  return { x, y: y + arc };
}

function getScaleXY(elapsedMs: number): { sx: number; sy: number } {
  const t01 = Math.min(elapsedMs / FLIGHT_MS, 1);
  const overall = 0.6 + 0.4 * easeOutCubic(t01);
  if (elapsedMs >= FLIGHT_MS) return { sx: overall, sy: overall };
  const { localT } = findArc(elapsedMs);
  const SQUASH = 0.18;
  const STRETCH = 0.08;
  let cartoonY = 1;
  if (localT < 0.13) {
    cartoonY = 1 - SQUASH + SQUASH * (localT / 0.13);
  } else if (localT > 0.87) {
    cartoonY = 1 - SQUASH * ((localT - 0.87) / 0.13);
  } else {
    const t = (localT - 0.13) / 0.74;
    cartoonY = 1 + STRETCH * Math.sin(t * Math.PI);
  }
  const cartoonX = 1 + (1 - cartoonY) * 0.4;
  return { sx: overall * cartoonX, sy: overall * cartoonY };
}

function getRotation(elapsedMs: number, anim: DieAnim): number {
  if (elapsedMs >= FLIGHT_MS) return 0;
  const { idx, localT } = findArc(elapsedMs);
  const startRot = anim.initialRotation + (idx === 0 ? 0 : anim.arcRotEnds[idx - 1]);
  const endRot = anim.initialRotation + anim.arcRotEnds[idx];
  return startRot + (endRot - startRot) * localT;
}

function getAlpha(elapsedMs: number): number {
  const t01 = Math.min(elapsedMs / FLIGHT_MS, 1);
  if (t01 < 0.3) return (t01 / 0.3) * 0.7;
  return 0.7 + ((t01 - 0.3) / 0.7) * 0.3;
}

// --- Viewport tracking ---
let trackingActive = true;
let updateInFlight = false;
// Slot index the flash should anchor to. Defaults to winnerIdx; the
// punch-time setTimeout may override this for panel rolls that crit
// on a non-winner d20.
let flashSlot = winnerIdx;
async function readPosOnce(): Promise<void> {
  if (updateInFlight) return;
  updateInFlight = true;
  try {
    let worldX = wx;
    let worldY = wy;
    // Re-resolve the token's CURRENT world position EVERY frame so the
    // dice stay glued to the token — including DURING the bounce flight
    // (per spec: dynamic follow, not snap-after-stop). The token-top
    // resolution itself is cheap; getItems is throttled by
    // updateInFlight so we won't pile up calls.
    if (itemIdParam) {
      try {
        const items = await OBR.scene.items.getItems([itemIdParam]);
        if (items.length) {
          const item = items[0] as any;
          let halfHeight = 75;
          try {
            const sceneDpi = await OBR.scene.grid.getDpi();
            const img = item.image;
            const itemGridDpi = item.grid?.dpi;
            const scaleY = item.scale?.y ?? 1;
            if (img?.height && itemGridDpi && sceneDpi) {
              halfHeight = (img.height / itemGridDpi) * sceneDpi * scaleY / 2;
            } else if (sceneDpi) {
              halfHeight = sceneDpi / 2;
            }
          } catch {}
          worldX = item.position.x;
          worldY = item.position.y - halfHeight;
        }
      } catch {}
    }
    const [vp, scale] = await Promise.all([
      OBR.viewport.getPosition(),
      OBR.viewport.getScale(),
    ]);
    lastVpScale = scale;
    const sxScreen = worldX * scale + vp.x;
    const syScreen = worldY * scale + vp.y;
    document.documentElement.style.setProperty("--tx", `${sxScreen}px`);
    document.documentElement.style.setProperty("--ty", `${syScreen}px`);
    document.documentElement.style.setProperty("--vp-scale", String(scale));
    const winSlot = flashSlot >= 0 && slots[flashSlot] ? slots[flashSlot] : { ox: 0, oy: 0, size: BASE_SIZE };
    document.documentElement.style.setProperty("--flash-x", `${sxScreen + winSlot.ox * scale}px`);
    document.documentElement.style.setProperty("--flash-y", `${syScreen + winSlot.oy * scale}px`);
  } catch {}
  updateInFlight = false;
}

// Loser fade — applied AFTER restStart only. Per req 3, losers stay
// at full opacity throughout bounce + landing + winner punch, and
// only THEN fade down to 0.3.
function loserFadeFactor(i: number, now: number): number {
  if (!dice[i].loser) return 1;
  if (restStart === null) return 1;
  const t = Math.min((now - restStart) / LOSER_FADE_MS, 1);
  return 1 - (1 - LOSER_REST_ALPHA) * easeOutCubic(t);
}

// Enter the resting state — starts the loser fade. Modal stays open
// indefinitely until BC_DICE_CLEAR_ALL closes it. Unlock is broadcast
// separately at the punch / final-scale moment via signalUnlockReady().
function enterRest(): void {
  if (restStart !== null) return;
  restStart = performance.now();
}

// --- Main animation driver ---
let animStart: number | null = null;
let exitStart: number | null = null;
// Set the moment the dice reach their resting state (after PUNCH for
// simple path, after final-pop for rush path). From that point on:
//   - Loser dice fade 1 → 0.3 over LOSER_FADE_MS
//   - Frame loop is in REST mode (viewport tracking + viewport scale
//     applied to wrap, no per-die transform writes)
//   - Modal stays open until BC_DICE_CLEAR_ALL fires
let restStart: number | null = null;
// Last-known viewport scale; written to --vp-scale and applied to
// dice-wrap inline transform so dice grow/shrink with the camera in
// real time.
let lastVpScale = 1;
// Whether the wrap should scale with the viewport. For normal token
// rolls this is true → dice stay proportional to the token. For dark
// rolls with no selected token, this is false → dice render at fixed
// pixel size regardless of camera zoom (per spec: "缩放摄像头也保持
// 正常" = camera zoom doesn't shrink the dice display).
const wrapTracksViewport: boolean = !!itemIdParam;

// Trigger the exit fade-out — modal will fade dice + total + mod box,
// then close itself. Idempotent (no-op if already exiting). The panel's
// roll-lock is released SEPARATELY by signalUnlockReady() at the
// punch / final-scale moment, not by beginExit.
function beginExit(): void {
  if (exitStart !== null) return;
  exitStart = performance.now();
}

// JS-driven punch curve for the WINNER die: scale 1 → 1.18 → 1 across
// PUNCH_MS, peak at ~45%. Returns the scalar to multiply onto the rest
// state's scale(1,1).
function getPunchScale(elapsedSincePunchMs: number): number {
  const t = elapsedSincePunchMs / PUNCH_MS;
  if (t <= 0) return 1;
  if (t >= 1) return 1;
  const peak = 0.45;
  if (t < peak) return 1 + 0.18 * easeOutCubic(t / peak);
  return 1.18 - 0.18 * easeOutCubic((t - peak) / (1 - peak));
}

function frame(now: number): void {
  if (animStart === null) animStart = now;
  readPosOnce();
  const elapsed = now - animStart;

  // Effective punch target — the index that should zoom in the simple
  // path. For initiative rolls we use winnerIdx; for single-die panel
  // rolls (winnerIdx = -1) we punch the only die (index 0).
  const punchIdx = winnerIdx >= 0 ? winnerIdx : 0;

  // Apply viewport zoom to the wrap CONTINUOUSLY (per spec: dice size
  // tracks the camera in real time so it stays proportional to the
  // token throughout — bounce, rush, and rest. The previous behaviour
  // animated dice in pixel space and then snapped to viewport scale at
  // rest, producing a visible size-jump at the end.) For tokenless dark
  // rolls we lock at scale=1 — there's no token to follow, so the dice
  // hold their pixel size and never react to camera zoom.
  const wrapScale = wrapTracksViewport ? lastVpScale : 1;
  diceWrap.style.transform = `scale(${wrapScale})`;
  diceWrap.style.transformOrigin = "0 0";

  for (let i = 0; i < N_DICE; i++) {
    const el = diceEls[i];
    const anim = dieAnims[i];

    // Burst children stay completely invisible until their chain reveals
    // them (handled by animateBurstChain). Force opacity=0 here so the
    // bounce phase doesn't paint them on the canvas. Skip transform
    // writes too — when revealed later the WAA animation drives them.
    if (!revealed[i] && exitStart === null) {
      el.style.opacity = "0";
      el.style.transform = "translate(0,0) rotate(0deg) scale(0.5)";
      continue;
    }

    if (exitStart !== null) {
      // ── EXIT ── single fade-up + grow-out, ending in modal.close
      const eMs = now - exitStart;
      const t01 = Math.min(eMs / EXIT_MS, 1);
      const eased = easeOutCubic(t01);
      el.style.transform =
        `translate(0px, ${-15 * eased}px) rotate(0deg) scale(${1 + 0.18 * eased}, ${1 + 0.18 * eased})`;
      el.style.opacity = String(baseAlpha[i] * loserFadeFactor(i, now) * (1 - eased));
      // Also fade the rush-case overlays on the LAST die's iteration so
      // they all dissolve in lockstep with the dice.
      if (i === N_DICE - 1) {
        const op = String(1 - eased);
        if (totalEl) totalEl.style.opacity = op;
        if (modBoxEl) modBoxEl.style.opacity = op;
        if (t01 >= 1) {
          trackingActive = false;
          OBR.modal.close(MODAL_ID).catch(() => {});
          return;
        }
      }
      continue;
    }

    if (elapsed < FLIGHT_MS) {
      // ── BOUNCING ── parabolic flight + spin + cartoon squash
      const pos = getPos(elapsed, anim);
      const sc = getScaleXY(elapsed);
      const rot = getRotation(elapsed, anim);
      const a = getAlpha(elapsed);
      el.style.transform =
        `translate(${pos.x}px, ${pos.y}px) rotate(${rot}deg) scale(${sc.sx}, ${sc.sy})`;
      // Losers stay full-opacity through the bounce; only after rest
      // starts do they fade. So baseAlpha (bare ceiling, no loser cut)
      // multiplied by the bounce alpha curve.
      el.style.opacity = String(baseAlpha[i] * a);
    } else if (rushPhaseActive) {
      // Rush sequence is driving dice transforms via WAA — DON'T
      // overwrite from here. Just keep viewport tracking alive.
    } else if (useSimplePunch && elapsed >= PUNCH_AT_MS && elapsed < PUNCH_AT_MS + PUNCH_MS && i === punchIdx) {
      // ── SIMPLE PUNCH (winner / single die) ──
      const s = getPunchScale(elapsed - PUNCH_AT_MS);
      el.style.transform = `translate(0px, 0px) rotate(0deg) scale(${s}, ${s})`;
      el.style.opacity = String(baseAlpha[i] * loserFadeFactor(i, now));
    } else {
      // ── REST (settled hold before/after punch, or non-winner) ──
      el.style.transform = "translate(0px, 0px) rotate(0deg) scale(1, 1)";
      el.style.opacity = String(baseAlpha[i] * loserFadeFactor(i, now));
    }
  }

  if (trackingActive) requestAnimationFrame(frame);
}

OBR.onReady(async () => {
  // Each die plays its own tumble sample, staggered by ~60ms so a pile
  // of dice sounds like a cascading roll rather than a single pop. With
  // dice.mp3 ≈ 0.5-1s long, all instances overlap into the FLIGHT_MS
  // bounce window. sfxParabola() also broadcasts so any iframe with a
  // warm AudioContext picks it up — see sfx-broadcast.ts.
  for (let i = 0; i < N_DICE; i++) {
    setTimeout(() => sfx.sfxParabola(), i * 60);
  }

  await readPosOnce();

  // Each die has its own slot-machine ticker. Cycling them simultaneously
  // (vs. staggered) keeps the total visual noise readable.
  // Each die cycles through its OWN range during the slot — d4 flashes
  // 1..4, d100 flashes 1..100, d20 flashes 1..20, etc. Numbers are blurry
  // anyway during the roll, but keeping them in-range avoids the brief
  // snap of a wrong-domain number when the slot stops.
  for (let i = 0; i < N_DICE; i++) {
    numEls[i].classList.add("rolling");
    const sides = sidesOfType(dice[i].type);
    numEls[i].textContent = String(Math.floor(Math.random() * sides) + 1);
  }
  const slotTimer = setInterval(() => {
    for (let i = 0; i < N_DICE; i++) {
      const sides = sidesOfType(dice[i].type);
      numEls[i].textContent = String(Math.floor(Math.random() * sides) + 1);
    }
  }, SLOT_INTERVAL_MS);

  // ── At settle: stop the slot. For each die:
  //   - max/min/reset (originalValue set): show ORIGINAL value first.
  //     The transform phase will spin the die and reveal the new value.
  //   - burst child (burstParent set): hide it; the burst chain phase
  //     reveals it with a fly-in.
  //   - everyone else: snap to final value as before.
  // Same-tint is deferred to AFTER all transforms / burst reveals so
  // the duplicate detection can use the truly-final visible values.
  requestAnimationFrame(frame);
  setTimeout(async () => {
    clearInterval(slotTimer);
    for (let i = 0; i < N_DICE; i++) {
      numEls[i].classList.remove("rolling");
      const isBurstChild = typeof dice[i].burstParent === "number";
      const hasTransform = typeof dice[i].originalValue === "number";
      if (isBurstChild) {
        // Hide until the burst chain animation reveals it. Keep the
        // collapsed transform too so the future WAA reveal can animate
        // FROM "off-screen above" cleanly without reading whatever the
        // bounce loop last wrote.
        diceEls[i].style.opacity = "0";
        diceEls[i].style.transform = "translate(0,0) rotate(0deg) scale(0.5)";
        numEls[i].textContent = "?";
      } else {
        // Snap the die's transform to the rest pose so any subsequent
        // WAA (transform phase / burst pop / rush punch) animates from
        // a clean (1,1) baseline — without this the WAA could read a
        // mid-bounce squash/translate as its starting point.
        diceEls[i].style.transform = "translate(0,0) rotate(0deg) scale(1,1)";
        diceEls[i].style.opacity = String(baseAlpha[i]);
        if (hasTransform) {
          // Show the rolled value first; transform phase animates to
          // the post-rule value.
          numEls[i].textContent = String(dice[i].originalValue);
        } else {
          numEls[i].textContent = String(dice[i].value);
          // Tint immediately if this die rolled its max face — only
          // safe for non-transform dice here since a transform die's
          // displayed value isn't yet final.
          applyMaxTintIfMax(i);
        }
        numEls[i].classList.add("snap");
      }
    }
    if (modBoxEl) modBoxEl.classList.add("on");
    // Lock the frame loop OUT of writing per-die transforms BEFORE the
    // next rAF fires. Without this lock, a frame() call during the rAF
    // wait could overwrite our just-written scale(1,1) with a stale
    // bounce-cartoon-squash value if frame()'s `animStart` was set
    // late (rAF jitter on a busy tab) and the bounce window extends
    // past SETTLE_AT_MS in the frame loop's clock — which is what
    // caused dice to occasionally render squashed at the start of
    // the effect pipeline.
    rushPhaseActive = true;
    // Wait one frame so the inline rest-pose writes are committed to
    // the compositor before any phase WAA starts.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    // ─── Effect pipeline ───
    // Order: settle-hold → max/min/reset → burst chains → same tint
    // → rush / simple-punch / per-row-rush.
    //
    // Each phase begins with a brief hold (POST_LAND_HOLD_MS) so the
    // dice "rest" visibly after landing before the next animation kicks
    // in — same beat as the existing adv/dis simple-punch hold. The
    // hold is skipped if the previous phase didn't run (no transforms,
    // no burst chains, etc.) so plain rolls don't get an extra delay.
    try {
      let needHold = true;  // first phase always preceded by a hold

      // Phase A: max/min/reset transforms — parallel.
      const transformIndices: number[] = [];
      for (let i = 0; i < N_DICE; i++) {
        if (dice[i].loser) continue;
        if (typeof dice[i].originalValue === "number") transformIndices.push(i);
      }
      if (transformIndices.length) {
        if (needHold) await delay(POST_LAND_HOLD_MS);
        await Promise.all(transformIndices.map((i) => animateValueTransform(i)));
        needHold = true;
      }

      // Phase B: burst chains — parallel chains, sequential within.
      const chains = collectBurstChains();
      if (chains.length) {
        if (needHold) await delay(POST_LAND_HOLD_MS);
        await Promise.all(chains.map((c) => animateBurstChain(c)));
        needHold = true;
      }

      // Phase C: same-highlight tint — uses the now-final values.
      if (sameHighlight) {
        if (needHold) await delay(POST_LAND_HOLD_MS);
        applySameTint();
        // Let the pulse breathe before the rush kicks in.
        await delay(SAME_HOLD_MS);
        needHold = false;  // same already paid its own hold
      }

      // Phase C.5: adv/dis loser fade — runs BEFORE the rush so the
      // discarded set visibly recedes before the kept dice fly into
      // the running total. (Was firing AFTER the rush at restStart,
      // which made the losers look like they briefly joined the rush
      // before fading. The user pointed this out as wrong.)
      const losers: number[] = [];
      for (let i = 0; i < N_DICE; i++) if (dice[i].loser) losers.push(i);
      if (losers.length) {
        if (needHold) await delay(POST_LAND_HOLD_MS);
        await fadeLosersOut(losers);
        needHold = false;
      }

      // Phase D: climax animation.
      if (needHold) await delay(POST_LAND_HOLD_MS);
      if (useRepeatLayout) {
        await runRepeatRowRushes();
      } else if (useSimplePunch) {
        await runSimplePunch();
      } else {
        await runRushSequence();
      }

      // ─── Phase E: fly to the bottom-left history popover ───
      // After the climax, hold so the player can read the result, then
      // do a "reverse charge" anticipation pull-back, then fly the
      // entire dice composition (wrap + dice + total + mod-box +
      // row totals) toward the bottom-left history box. Modal closes
      // itself when the fly completes. This replaces the old
      // "stay until cleared" model entirely.
      await delay(POST_LAND_HOLD_MS);
      await flyToHistory();
    } catch (e) {
      console.error("[obr-suite/dice] effect pipeline failed", e);
    } finally {
      rushPhaseActive = false;
      trackingActive = false;
      try { await OBR.modal.close(MODAL_ID); } catch {}
    }
  }, SETTLE_AT_MS);

  // Force-clear: panel sends BC_DICE_FORCE_CLEAR if a stuck modal needs
  // to be aborted. Close ourselves immediately.
  OBR.broadcast.onMessage(BC_DICE_FORCE_CLEAR, () => {
    trackingActive = false;
    OBR.modal.close(MODAL_ID).catch(() => {});
  });
});

// ─────────────── Rush sequence (rush case only) ───────────────

const RUSH_HOLD_MS = 250;
const RUSH_MOD_FADE_MS = 200;
const RUSH_PER_DIE_MS = 260;
const RUSH_ACCEL = 0.86;
const RUSH_ANTICIPATE_MS = 100;
const RUSH_GAP_MS = 60;
const RUSH_FINAL_POP_MS = 420;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let rushPhaseActive = false;

async function rushFly(
  sourceEl: HTMLElement,
  value: number,
  anticipateMs: number,
  rushMs: number
): Promise<void> {
  if (!totalNumEl) return;
  const sR = sourceEl.getBoundingClientRect();
  const tR = totalNumEl.getBoundingClientRect();
  const sx = sR.left + sR.width / 2;
  const sy = sR.top + sR.height / 2;
  const tx = tR.left + tR.width / 2;
  const ty = tR.top + tR.height / 2;
  const dx = tx - sx;
  const dy = ty - sy;

  // Leave a 30%-opacity GHOST in the source's position so the user
  // visually sees "this number was here, and is now flying up". The
  // ghost shares the source's parent so it inherits the dice's exit
  // fade automatically.
  const ghost = sourceEl.cloneNode(true) as HTMLElement;
  ghost.classList.add("num-ghost");
  ghost.style.opacity = "0.3";
  ghost.style.pointerEvents = "none";
  sourceEl.parentElement?.insertBefore(ghost, sourceEl);

  // Flying clone, fixed-positioned at the source's screen pos.
  const fly = document.createElement("span");
  fly.className = "num-fly";
  fly.style.left = `${sx}px`;
  fly.style.top = `${sy}px`;
  fly.textContent = String(value);
  document.body.appendChild(fly);
  // Hide the original numEl — the ghost remains visible at 0.3 alpha.
  sourceEl.style.opacity = "0";

  // Anticipation — slight backwards motion + scale up (slingshot pull).
  await fly.animate(
    [
      { transform: "translate(-50%, -50%) scale(1)" },
      {
        transform: `translate(calc(-50% - ${dx * 0.12}px), calc(-50% - ${dy * 0.12}px)) scale(1.18)`,
      },
    ],
    { duration: anticipateMs, easing: "ease-in", fill: "forwards" }
  ).finished;

  // Rush — accelerate into the total counter.
  await fly.animate(
    [
      {
        transform: `translate(calc(-50% - ${dx * 0.12}px), calc(-50% - ${dy * 0.12}px)) scale(1.18)`,
      },
      {
        transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.45)`,
      },
    ],
    { duration: rushMs, easing: "cubic-bezier(0.55, 0, 0.5, 1)", fill: "forwards" }
  ).finished;

  fly.remove();
}

async function diePunchOnceWAA(idx: number, ms: number): Promise<void> {
  // Web Animations API punch — overrides the inline rest transform
  // for the duration. rushPhaseActive is true so the rAF frame loop
  // won't fight us.
  await diceEls[idx].animate(
    [
      { transform: "translate(0px, 0px) rotate(0deg) scale(1, 1)" },
      { transform: "translate(0px, 0px) rotate(0deg) scale(1.18, 1.18)", offset: 0.45 },
      { transform: "translate(0px, 0px) rotate(0deg) scale(1, 1)" },
    ],
    { duration: ms, easing: "ease-out", fill: "none" }
  ).finished;
}

function shakeRunningTotal(): void {
  if (!totalEl) return;
  totalEl.classList.remove("shake");
  void totalEl.offsetWidth; // restart animation
  totalEl.classList.add("shake");
}

async function runRushSequence(): Promise<void> {
  // Settle / rest-pose write + rushPhaseActive flip are already
  // handled by the pipeline. Skip the redundant initial hold + mod-
  // box fade — the pipeline-level POST_LAND_HOLD covers the wait,
  // and modBoxEl was faded in at SETTLE.
  if (!totalEl || !totalNumEl) {
    beginExit();
    return;
  }
  totalEl.classList.add("on");
  totalNumEl.textContent = "0";

  let runningTotal = 0;
  let dieMs = RUSH_PER_DIE_MS;

  // 4. Each WINNER die's number rushes to total, sequentially,
  // accelerating. Losers (adv/dis losing set) sit at 30% alpha and are
  // skipped — they don't punch, don't fly, don't add to the total.
  for (let i = 0; i < N_DICE; i++) {
    if (dice[i].loser) continue;
    diePunchOnceWAA(i, Math.round(dieMs * 1.1)).catch(() => {});
    sfx.sfxNumFly();
    await rushFly(numEls[i], dice[i].value, RUSH_ANTICIPATE_MS, dieMs);
    sfx.sfxNumLand();
    runningTotal += dice[i].value;
    totalNumEl.textContent = String(runningTotal);
    shakeRunningTotal();
    // Crit/fail tint on this die if it was a d20 nat-20 / nat-1.
    if (dice[i].type === "d20" && dice[i].value === 20) diceEls[i].classList.add("crit");
    else if (dice[i].type === "d20" && dice[i].value === 1) diceEls[i].classList.add("fail");
    dieMs = Math.max(150, dieMs * RUSH_ACCEL);
    await delay(RUSH_GAP_MS);
  }

  // 5. Modifier rushes (if non-zero).
  if (modNumEl && modifier !== 0) {
    sfx.sfxNumFly();
    await rushFly(modNumEl, modifier, RUSH_ANTICIPATE_MS, dieMs);
    sfx.sfxNumLand();
    runningTotal += modifier;
    totalNumEl.textContent = String(runningTotal);
    shakeRunningTotal();
    await delay(RUSH_GAP_MS);
  }

  // 6. Crit/fail flash on the running total if the FINAL TOTAL was
  // headline-worthy. Loser dice (adv/dis losing set) don't count —
  // a fail on the discarded set isn't actually relevant.
  const critIdx = dice.findIndex((d) => !d.loser && d.type === "d20" && d.value === 20);
  const failIdx = dice.findIndex((d) => !d.loser && d.type === "d20" && d.value === 1);
  if (critIdx >= 0) {
    flashSlot = critIdx;
    flash.classList.add("crit", "fire");
    sfx.sfxFlashCrit();
  } else if (failIdx >= 0) {
    flashSlot = failIdx;
    flash.classList.add("fail", "fire");
    sfx.sfxFlashFail();
  }

  // 7. Final scale-pop on the running total. The roll-permission
  // unlock fires HERE — at the moment the final pop animation kicks
  // in, not after the dissolve.
  totalEl.classList.add("final");
  sfx.sfxScalePunch();
  signalUnlockReady();
  await delay(RUSH_FINAL_POP_MS);

  // 8. Settle into REST — dice stay on canvas (anchored to token,
  // scaled with viewport zoom) until BC_DICE_CLEAR_ALL fires. Losers
  // fade to 0.3 over LOSER_FADE_MS from this moment.
  rushPhaseActive = false;
  enterRest();
}

// Apply the contrast/conflict-color tint to dice whose displayed value
// equals their type's max face. Reuses the same `same-tint` class as
// the duplicate-value highlight so both treatments share the same
// visual language. Idempotent — calling twice has no effect.
function applyMaxTintIfMax(i: number): void {
  if (dice[i].loser) return;
  const sides = sidesOfType(dice[i].type);
  if (dice[i].value === sides) {
    numEls[i].classList.add("same-tint");
  }
}

// ─────────────── max/min/reset transform animation ───────────────
//
// One die at a time spins 360° while its displayed value scale-pops
// from the original to the post-rule value. Halfway through the spin
// the number text swaps. All transforms run in parallel (same class)
// — the caller does Promise.all over the affected indices.
const TRANSFORM_MS = 700;
async function animateValueTransform(i: number): Promise<void> {
  const el = diceEls[i];
  const numEl = numEls[i];
  sfx.sfxSpin();
  // Run a 720° rotation with a slight scale bump in the middle so the
  // die feels like it's "tumbling" to its new face.
  const spin = el.animate([
    { transform: "translate(0,0) rotate(0deg) scale(1)" },
    { transform: "translate(0,0) rotate(360deg) scale(1.15)", offset: 0.5 },
    { transform: "translate(0,0) rotate(720deg) scale(1)" },
  ], { duration: TRANSFORM_MS, easing: "ease-out", fill: "none" });
  // Halfway through the spin, swap the number to the post-rule value
  // and scale-pop it. Reveal the (orig) tag too.
  const halfway = setTimeout(() => {
    numEl.classList.remove("snap", "transform-pop");
    void numEl.offsetWidth; // restart animation
    numEl.textContent = String(dice[i].value);
    numEl.classList.add("snap", "transform-pop");
    if (numOrigEls[i]) numOrigEls[i]!.classList.add("on");
  }, Math.round(TRANSFORM_MS * 0.45));
  try {
    await spin.finished;
  } finally {
    clearTimeout(halfway);
    // WAA without fill:forwards reverts the element to its inline
    // style on completion. Write the rest pose explicitly so the next
    // phase / frame loop sees the correct baseline.
    el.style.transform = "translate(0,0) rotate(0deg) scale(1,1)";
    // Final value is now displayed — apply the contrast tint if this
    // die ended up showing its max face.
    applyMaxTintIfMax(i);
  }
}

// ─────────────── burst chain animation ───────────────
//
// Group burst dice into chains (parent → child → grandchild …). For
// each chain: pop the parent, then fly in the child with a mini slot
// machine; if the child also hit its max it gets popped too and the
// next child flies in. Chains animate in parallel.

interface BurstChain { indices: number[] }

function collectBurstChains(): BurstChain[] {
  const childOf = new Map<number, number>();
  for (let i = 0; i < N_DICE; i++) {
    if (typeof dice[i].burstParent === "number") {
      childOf.set(dice[i].burstParent!, i);
    }
  }
  const chains: BurstChain[] = [];
  for (let i = 0; i < N_DICE; i++) {
    if (typeof dice[i].burstParent === "number") continue;
    if (!childOf.has(i)) continue;
    const indices = [i];
    let cur = i;
    while (childOf.has(cur)) {
      const next = childOf.get(cur)!;
      indices.push(next);
      cur = next;
    }
    chains.push({ indices });
  }
  return chains;
}

async function popDie(i: number, ms: number): Promise<void> {
  await diceEls[i].animate([
    { transform: "translate(0,0) rotate(0deg) scale(1)" },
    { transform: "translate(0,0) rotate(0deg) scale(1.32)", offset: 0.4 },
    { transform: "translate(0,0) rotate(0deg) scale(1)" },
  ], { duration: ms, easing: "ease-out" }).finished;
  diceEls[i].style.transform = "translate(0,0) rotate(0deg) scale(1,1)";
}

const BURST_REVEAL_MS = 460;
const SLIDE_MS = 320;

// Slide an already-positioned visible die from its current left/top
// to a new slot. Used when a burst child enters the layout — every
// existing die that needs to make room gets slid in parallel.
//
// IMPORTANT for parallel chains: when two reveals fire at the same time
// each call captures the slot value at call-time. The WAA itself uses
// composite=replace so the visual rendering correctly tracks the LATEST
// slide. But on completion, we MUST read slots[i] LIVE (not the
// captured target) so the final inline write reflects the final layout
// regardless of which slide's `finally` runs last.
async function slideDieToSlot(i: number, target: { ox: number; oy: number; size: number }): Promise<void> {
  const newLeft = `${target.ox - target.size / 2}px`;
  const newTop = `${target.oy - target.size / 2}px`;
  const oldLeft = diceEls[i].style.left;
  const oldTop = diceEls[i].style.top;
  if (oldLeft === newLeft && oldTop === newTop) return;
  const a = diceEls[i].animate(
    [
      { left: oldLeft, top: oldTop },
      { left: newLeft, top: newTop },
    ],
    { duration: SLIDE_MS, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
  );
  try {
    await a.finished;
  } finally {
    a.cancel();
    // Live read: another concurrent reveal may have re-laid-out while
    // this slide was running — write the LATEST slot, not the stale
    // target captured when this call started.
    const live = slots[i];
    if (live) {
      diceEls[i].style.left = `${live.ox - live.size / 2}px`;
      diceEls[i].style.top = `${live.oy - live.size / 2}px`;
    } else {
      diceEls[i].style.left = newLeft;
      diceEls[i].style.top = newTop;
    }
  }
}

async function revealBurstChild(i: number): Promise<void> {
  const sides = sidesOfType(dice[i].type);
  sfx.sfxBurst();

  // 1. Insert this child into the live visibility list (right after
  //    its parent) and recompute every visible die's slot. This is
  //    what gives the chain-reveal its surprise — until the parent
  //    pops, no slot is reserved for the new die so the player
  //    can't read "more dice are coming" from the layout.
  insertIntoVisible(i);
  recomputeLayout();

  // 2. Slide existing visible dice to their new positions in parallel
  //    so the row makes room for the incoming die. The new die is
  //    excluded — it isn't on-screen yet.
  const visibleNow = allVisibleIndices();
  await Promise.all(
    visibleNow
      .filter((idx) => idx !== i && slots[idx])
      .map((idx) => slideDieToSlot(idx, slots[idx]!)),
  );

  // 3. Pre-place the new die at its computed slot so the reveal WAA's
  //    relative translate(...) lands at the correct grid cell.
  const sl = slots[i]!;
  diceEls[i].style.left = `${sl.ox - dieSizes[i] / 2}px`;
  diceEls[i].style.top = `${sl.oy - dieSizes[i] / 2}px`;

  // 4. Flip the revealed flag so the frame loop stops forcing
  //    opacity=0 on this die.
  revealed[i] = true;
  numEls[i].classList.add("rolling");
  // Mini slot during the fly-in so the new die looks like it's actively
  // rolling. Stops at the final value when the fly-in lands.
  const slotTimer = setInterval(() => {
    numEls[i].textContent = String(Math.floor(Math.random() * sides) + 1);
  }, 50);
  // Fly in from a small offset above with a quick spin so the addition
  // reads as "a new die just dropped into the chain". `fill:forwards`
  // pins the end keyframe so the die holds at scale(1) opacity 1 once
  // the animation completes — without this, WAA would revert to the
  // inline scale(0.5) opacity 0 we wrote at settle (= invisible /
  // tiny die after the reveal, the bug that made bursts look like
  // they didn't fire on small dice setups like 6d6).
  const a = diceEls[i].animate([
    { transform: "translate(0, -120px) rotate(-540deg) scale(0.4)", opacity: 0 },
    { transform: "translate(0, 8px) rotate(-30deg) scale(1.18)", opacity: 1, offset: 0.7 },
    { transform: "translate(0, 0) rotate(0deg) scale(1)", opacity: 1 },
  ], { duration: BURST_REVEAL_MS, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "forwards" });
  try {
    await a.finished;
  } finally {
    clearInterval(slotTimer);
    numEls[i].classList.remove("rolling");
    numEls[i].textContent = String(dice[i].value);
    numEls[i].classList.add("snap");
    // Clear the WAA effect AND commit the rest pose to inline so the
    // next phase (and the eventual rest-mode frame loop) starts from a
    // clean baseline. cancel() is needed because fill:forwards keeps
    // the WAA composited until something replaces it.
    a.cancel();
    diceEls[i].style.transform = "translate(0,0) rotate(0deg) scale(1,1)";
    diceEls[i].style.opacity = String(baseAlpha[i]);
    // Tint the freshly-revealed die if it rolled max — that's also
    // the visual indicator that it's about to trigger another burst.
    applyMaxTintIfMax(i);
  }
}

async function animateBurstChain(chain: BurstChain): Promise<void> {
  const ix = chain.indices;
  // 1. Pop the parent that triggered the chain.
  await popDie(ix[0], 360);
  for (let k = 1; k < ix.length; k++) {
    // 2. Brief beat after the pop so the user sees "parent triggered,
    // a new die is on the way" rather than parent+child overlapping.
    await delay(BURST_BEAT_MS);
    // 3. Toss the new burst child in with a mini slot machine.
    await revealBurstChild(ix[k]);
    // 4. After the new die fully lands, hold so the value reads
    // before either the next pop or the chain ending.
    await delay(POST_LAND_HOLD_MS);
    // 5. If this child is also a parent (rolled max), pop it before
    // looping back for the next reveal.
    if (k < ix.length - 1) {
      await popDie(ix[k], 280);
    }
  }
}

// ─────────────── adv/dis loser fade ───────────────
//
// Animate every loser die's opacity from full ALPHA_CEILING down to
// LOSER_REST_ALPHA in parallel. Runs BEFORE the rush sequence so the
// discarded set visibly recedes first; the rush then only animates
// the kept dice. baseAlpha[i] is reduced so the post-fade frame loop
// keeps them at the dim alpha (the loserFadeFactor() can return 1.
// since fading is finished by then).
const LOSER_FADE_OUT_MS = 360;
async function fadeLosersOut(indices: number[]): Promise<void> {
  await Promise.all(indices.map((i) => {
    const startAlpha = parseFloat(diceEls[i].style.opacity || "1") || 1;
    const a = diceEls[i].animate(
      [
        { opacity: startAlpha },
        { opacity: LOSER_REST_ALPHA },
      ],
      { duration: LOSER_FADE_OUT_MS, easing: "ease-out", fill: "forwards" },
    );
    return a.finished.finally(() => {
      diceEls[i].style.opacity = String(LOSER_REST_ALPHA);
      a.cancel();
      // Lower this die's baseAlpha so any subsequent renders stay
      // dim. loserFadeFactor()'s contribution becomes redundant.
      baseAlpha[i] = LOSER_REST_ALPHA;
    });
  }));
}

// ─────────────── same-tint reveal ───────────────
function applySameTint(): void {
  // Heuristic: only chime if there's actually a duplicate group. The
  // chime fires once for the whole batch (not per die) so it doesn't
  // sound like a typewriter when many dice match.
  const valSeen = new Set<number>();
  let hasDup = false;
  for (let i = 0; i < N_DICE; i++) {
    if (dice[i].loser) continue;
    if (valSeen.has(dice[i].value)) { hasDup = true; break; }
    valSeen.add(dice[i].value);
  }
  if (hasDup) sfx.sfxSame();
  return _applySameTintImpl();
}
function _applySameTintImpl(): void {
  const valueGroups = new Map<number, number[]>();
  for (let i = 0; i < N_DICE; i++) {
    if (dice[i].loser) continue;
    if (diceEls[i].style.opacity === "0") continue;  // hidden burst child
    const arr = valueGroups.get(dice[i].value) ?? [];
    arr.push(i);
    valueGroups.set(dice[i].value, arr);
  }
  for (const indices of valueGroups.values()) {
    if (indices.length < 2) continue;
    for (const idx of indices) {
      diceEls[idx].classList.add("same-pulse");
      numEls[idx].classList.add("same-tint");
      setTimeout(() => diceEls[idx].classList.remove("same-pulse"), 750);
    }
  }
}

// ─────────────── Simple punch (single die / adv-dis no-modifier) ───────────────
async function runSimplePunch(): Promise<void> {
  // Hold is provided by the pipeline-level POST_LAND_HOLD before this
  // phase; no extra wait here.
  const i = winnerIdx >= 0 ? winnerIdx : 0;
  sfx.sfxScalePunch();
  numEls[i].classList.remove("snap");
  numEls[i].classList.add("land");
  // Drive the dice element scale via WAA to match the .num punch.
  const punch = diceEls[i].animate([
    { transform: "translate(0,0) rotate(0deg) scale(1)" },
    { transform: "translate(0,0) rotate(0deg) scale(1.18)", offset: 0.45 },
    { transform: "translate(0,0) rotate(0deg) scale(1)" },
  ], { duration: PUNCH_MS, easing: "ease-out" });
  if (dice[i].type === "d20" && dice[i].value === 20) {
    diceEls[i].classList.add("crit");
    flash.classList.add("crit", "fire");
    sfx.sfxFlashCrit();
  } else if (dice[i].type === "d20" && dice[i].value === 1) {
    diceEls[i].classList.add("fail");
    flash.classList.add("fail", "fire");
    sfx.sfxFlashFail();
  }
  signalUnlockReady();
  await punch.finished;
}

// ─────────────── Repeat: per-row mini rushes ───────────────
//
// One row total per repeat-iteration, sitting at the right edge of
// the row. Each row's dice rush into its own running total in parallel
// across rows (same effect class). Within a row, dice rush sequentially
// so the running total visibly grows. Modifier (if any) is added at
// the end as part of the initial row-total seed = modifier, so each
// row's first rendered total is its modifier and dice contribute.

async function runRepeatRowRushes(): Promise<void> {
  const gap = Math.round(BASE_SIZE * 0.16);
  const rowH = BASE_SIZE + gap;
  const rowCount = rowSpans.length;
  // Build per-row total elements positioned at the right edge of each
  // row. They start at the modifier value (so dice rush ADD to it)
  // and reach the row's full total when all dice have flown in.
  interface RowAnim {
    totalEl: HTMLDivElement;
    totalNum: HTMLSpanElement;
    indices: number[];   // non-loser dice in order
    runningSum: number;  // starts at modifier
    finalTotal: number;
  }
  const rowAnims: RowAnim[] = [];
  for (let r = 0; r < rowCount; r++) {
    const [startIdx, endIdx] = rowSpans[r];
    if (endIdx <= startIdx) continue;
    const indices: number[] = [];
    let final = 0;
    for (let i = startIdx; i < endIdx; i++) {
      if (dice[i].loser) continue;
      indices.push(i);
      final += dice[i].value;
    }
    final += modifier;
    // Anchor the row total at the rightmost VISIBLE die in this row
    // (visibleByRow tracks the live layout, including any bursts that
    // expanded the row). Falling back to the row span end when no
    // visibleByRow tracking exists (non-repeat path can't reach here).
    const liveRow = visibleByRow[r] ?? [];
    const lastIdx = liveRow.length ? liveRow[liveRow.length - 1] : endIdx - 1;
    const lastSlot = slots[lastIdx] ?? { ox: 0, oy: 0, size: BASE_SIZE };
    const rightX = lastSlot.ox + lastSlot.size / 2 + Math.round(BASE_SIZE * 0.36);
    const rowOy = (r - (rowCount - 1) / 2) * rowH;

    const totalEl = document.createElement("div");
    totalEl.className = "row-total";
    totalEl.style.left = `${rightX}px`;
    totalEl.style.top = `${rowOy}px`;
    totalEl.style.transform = "translate(0, -50%) scale(0.85)";
    const totalNum = document.createElement("span");
    totalNum.className = "rt-num";
    totalNum.textContent = String(modifier);
    totalEl.appendChild(totalNum);
    diceWrap.appendChild(totalEl);
    // Reveal the running total instantly with a small fade.
    requestAnimationFrame(() => totalEl.classList.add("on"));
    rowAnims.push({ totalEl, totalNum, indices, runningSum: modifier, finalTotal: final });
  }

  // Run all rows' rushes IN PARALLEL.
  await Promise.all(rowAnims.map((row) => runOneRowRush(row)));
  // Final pop on every row to mark climax.
  for (const row of rowAnims) {
    row.totalEl.classList.remove("on");
    void row.totalEl.offsetWidth;
    row.totalEl.classList.add("on", "pop");
  }
  signalUnlockReady();
  await delay(420);
}

async function runOneRowRush(row: {
  totalEl: HTMLDivElement;
  totalNum: HTMLSpanElement;
  indices: number[];
  runningSum: number;
  finalTotal: number;
}): Promise<void> {
  let dieMs = RUSH_PER_DIE_MS;
  for (const i of row.indices) {
    diePunchOnceWAA(i, Math.round(dieMs * 1.1)).catch(() => {});
    await rushFlyToTarget(numEls[i], row.totalNum, dice[i].value, RUSH_ANTICIPATE_MS, dieMs);
    row.runningSum += dice[i].value;
    row.totalNum.textContent = String(row.runningSum);
    shakeRowTotal(row.totalEl);
    if (dice[i].type === "d20" && dice[i].value === 20) diceEls[i].classList.add("crit");
    else if (dice[i].type === "d20" && dice[i].value === 1) diceEls[i].classList.add("fail");
    dieMs = Math.max(150, dieMs * RUSH_ACCEL);
    await delay(RUSH_GAP_MS);
  }
}

// Generic rush-fly variant: flies a numeric clone of `sourceEl` to
// the bounding box of `targetEl`. Used by the per-row rush; the global
// rush still uses rushFly which targets totalNumEl directly.
async function rushFlyToTarget(
  sourceEl: HTMLElement,
  targetEl: HTMLElement,
  value: number,
  anticipateMs: number,
  rushMs: number,
): Promise<void> {
  const sR = sourceEl.getBoundingClientRect();
  const tR = targetEl.getBoundingClientRect();
  const sx = sR.left + sR.width / 2;
  const sy = sR.top + sR.height / 2;
  const tx = tR.left + tR.width / 2;
  const ty = tR.top + tR.height / 2;
  const dx = tx - sx;
  const dy = ty - sy;

  const ghost = sourceEl.cloneNode(true) as HTMLElement;
  ghost.classList.add("num-ghost");
  ghost.style.opacity = "0.3";
  ghost.style.pointerEvents = "none";
  sourceEl.parentElement?.insertBefore(ghost, sourceEl);

  const fly = document.createElement("span");
  fly.className = "num-fly";
  fly.style.left = `${sx}px`;
  fly.style.top = `${sy}px`;
  fly.textContent = String(value);
  document.body.appendChild(fly);
  sourceEl.style.opacity = "0";

  await fly.animate(
    [
      { transform: "translate(-50%, -50%) scale(1)" },
      { transform: `translate(calc(-50% - ${dx * 0.12}px), calc(-50% - ${dy * 0.12}px)) scale(1.18)` },
    ],
    { duration: anticipateMs, easing: "ease-in", fill: "forwards" },
  ).finished;

  await fly.animate(
    [
      { transform: `translate(calc(-50% - ${dx * 0.12}px), calc(-50% - ${dy * 0.12}px)) scale(1.18)` },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.45)` },
    ],
    { duration: rushMs, easing: "cubic-bezier(0.55, 0, 0.5, 1)", fill: "forwards" },
  ).finished;

  fly.remove();
}

function shakeRowTotal(totalEl: HTMLElement): void {
  totalEl.classList.remove("shake");
  void totalEl.offsetWidth;
  totalEl.classList.add("shake");
}

// signalUnlockReady() — broadcasts BC_DICE_FADE_START WITHOUT touching
// exitStart. Used to release the panel's roll lock at the climax of
// the animation (final scale / punch start), so the next roll is
// permitted while the previous still completes its dissolve. The
// actual exit/cleanup happens later in beginExit().
//
// The broadcast carries rollId so listeners that care about a SPECIFIC
// roll's climax (e.g. the initiative module writing the count value
// at the exact moment of the final pop) can match against it.
//
// If autoDismiss is set in the URL params (initiative rolls), schedule
// a self-close shortly after the climax so the dice fade out without
// waiting for a user-driven Clear.
function signalUnlockReady(): void {
  const payload = { rollId };
  OBR.broadcast.sendMessage(BC_DICE_FADE_START, payload, { destination: "LOCAL" }).catch(() => {});
  OBR.broadcast.sendMessage(BC_DICE_FADE_START, payload, { destination: "REMOTE" }).catch(() => {});
}

// ─────────────── Fly-to-history finale ───────────────
//
// At the end of the effect pipeline every roll funnels through here
// (replacing the old rest-mode + manual-clear model). Two beats:
//
//   1. Reverse charge (180ms): the whole composition scales up
//      slightly + lifts away from the token, like a slingshot pulling
//      back. Anticipation read.
//   2. Fly (560ms): translate to the bottom-left history popover
//      area + scale way down + fade out. Eased ease-in so the dice
//      accelerate as they approach the history box.
//
// After the fly the caller closes the modal. The history popover
// (separate iframe) updates itself from the same broadcast that
// triggered this modal — so the visual handoff is "dice dive into
// the corner just as that corner's row updates".

const ANTICIPATE_MS = 180;
const FLY_MS = 560;
const FLY_END_SCALE = 0.16;

// History popover position constants — must stay in sync with
// HISTORY_LEFT_OFFSET / HISTORY_BOTTOM_OFFSET / HISTORY_W in index.ts.
const HISTORY_LEFT = 16;
const HISTORY_BOTTOM = 70;
const HISTORY_W_ = 320;
const HISTORY_H_ = 280;

function flyTargetScreen(): { x: number; y: number } {
  // Aim near the TOP of the popover so dice land where new rows insert.
  const x = HISTORY_LEFT + HISTORY_W_ / 2;
  const y = window.innerHeight - HISTORY_BOTTOM - HISTORY_H_ + 30;
  return { x, y };
}

async function flyToHistory(): Promise<void> {
  // Suspend viewport tracking — we no longer want the wrap glued to
  // the token while it flies away.
  trackingActive = false;

  // Read the wrap's current screen position from the CSS vars our
  // frame loop has been writing. These are screen pixels.
  const tx = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--tx") || "0",
  );
  const ty = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--ty") || "0",
  );
  const target = flyTargetScreen();
  const dx = target.x - tx;
  const dy = target.y - ty;

  // The wrap currently has `transform: scale(vpScale)` (or scale(1)
  // for tokenless dark rolls). Animate from there → anticipate
  // (slightly bigger) → fly (translate + tiny scale + fade).
  const startScale = wrapTracksViewport ? lastVpScale : 1;
  const anticipate = diceWrap.animate(
    [
      {
        transform: `translate(0px, 0px) scale(${startScale})`,
        opacity: 1,
      },
      {
        transform: `translate(0px, ${-Math.max(20, startScale * 18)}px) scale(${startScale * 1.12})`,
        opacity: 1,
      },
    ],
    { duration: ANTICIPATE_MS, easing: "ease-out", fill: "forwards" },
  );
  await anticipate.finished;

  const fly = diceWrap.animate(
    [
      {
        transform: `translate(0px, ${-Math.max(20, startScale * 18)}px) scale(${startScale * 1.12})`,
        opacity: 1,
      },
      {
        transform: `translate(${dx * 0.55}px, ${dy * 0.35}px) scale(${startScale * 0.7})`,
        opacity: 0.9,
        offset: 0.5,
      },
      {
        transform: `translate(${dx}px, ${dy}px) scale(${FLY_END_SCALE})`,
        opacity: 0,
      },
    ],
    { duration: FLY_MS, easing: "cubic-bezier(0.5, 0.0, 0.85, 0.7)", fill: "forwards" },
  );
  // Roughly when the fly is fading out (~85% through), tell the
  // history popover to commit this entry. The popover deferred
  // adding it on receipt so the visual handoff is "dice arrive at
  // the corner just as the new history row pops in".
  setTimeout(() => {
    const payload = { rollId };
    OBR.broadcast.sendMessage(BC_DICE_HISTORY_REVEAL, payload, { destination: "LOCAL" }).catch(() => {});
    OBR.broadcast.sendMessage(BC_DICE_HISTORY_REVEAL, payload, { destination: "REMOTE" }).catch(() => {});
  }, Math.round(FLY_MS * 0.85));
  await fly.finished;
}
