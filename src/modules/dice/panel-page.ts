import OBR from "@owlbear-rodeo/sdk";
import { DiceType, DieResult, sidesOf } from "./types";
import { subscribeToSfx } from "./sfx-broadcast";

// Dice panel — three tabs (投掷 / 组合 / 历史). Loaded by OBR's action
// drawer / popover. Owns the expression UI + history view, broadcasts
// dice rolls via BROADCAST_DICE_ROLL for the visual half (effect-page).

const ALL_TYPES: DiceType[] = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

const BROADCAST_DICE_ROLL = "com.obr-suite/dice-roll";
const BC_DICE_FORCE_CLEAR = "com.obr-suite/dice-force-clear";
const BC_DICE_FADE_START = "com.obr-suite/dice-fade-start";
// Sent by the bottom-left history popover when a row is clicked. Tells
// the panel to switch to the History tab + select that player as the
// filter. Always sent LOCAL — only this client's panel reacts.
const BC_DICE_HISTORY_FILTER = "com.obr-suite/dice-history-filter";
const ANIM_FALLBACK_MS = 6000;

const LS_COMBOS  = "obr-suite/dice/combos";
const LS_HISTORY = "obr-suite/dice/history";
const LS_LAST_EXPR = "obr-suite/dice/last-expr";
const HISTORY_CAP = 80;

interface DiceRollPayload {
  itemId: string | null;
  dice: DieResult[];
  winnerIdx: number;
  modifier: number;
  label: string;
  total: number;
  rollerId: string;
  rollerName: string;
  rollerColor: string;
  rollId: string;
  ts: number;
  hidden?: boolean;
  // Layout/animation hints introduced by the new wrappers:
  // - rowStarts: explicit row boundaries for `repeat(N, ...)`. Row i
  //   spans [rowStarts[i], rowStarts[i+1]) (last row goes to end of
  //   dice[]). Each row computes its own total at the row's right
  //   edge instead of the global running total above.
  // - sameHighlight: if true, run a "duplicates pulse" animation
  //   between settle and rush — matched-value dice scale up and
  //   their numbers tint to the player color. Set by `same(...)`.
  rowStarts?: number[];
  sameHighlight?: boolean;
  // Multi-target rolls share a collectiveId so the history popover
  // groups them into one row and click-to-replay can find all
  // members of the group.
  collectiveId?: string;
}

interface SavedCombo {
  id: string;
  name: string;
  expr: string;
}

// --- State ---
let expression = "";
let labelText = "";
let combos: SavedCombo[] = loadCombos();
let history: DiceRollPayload[] = loadHistory();
let lastRolledExpression: string = loadLastExpr();
let activeTab: "roll" | "combos" | "history" = "roll";
let historyFilter = "";
let isAnimating = false;
let animationTimer: number | null = null;
// Roll IDs the panel itself spawned. Used to filter BC_DICE_FADE_START
// so initiative-rolled climaxes don't prematurely release the panel's
// lock (initiative + panel rolls can coexist on the same client).
const myActiveRollIds = new Set<string>();
// DM-only flag — gates visibility of the 暗骰 (dark roll) button.
let isDM = false;

// --- DOM refs ---
const diceRow      = document.getElementById("diceRow")      as HTMLDivElement;
const exprInput    = document.getElementById("exprInput")    as HTMLInputElement;
const labelInput   = document.getElementById("labelInput")   as HTMLInputElement;
const btnRoll      = document.getElementById("btnRoll")      as HTMLButtonElement;
const btnLastRoll  = document.getElementById("btnLastRoll")  as HTMLButtonElement;
const btnSave      = document.getElementById("btnSave")      as HTMLButtonElement;
const btnClear     = document.getElementById("btnClear")     as HTMLButtonElement;
const btnForceClr  = document.getElementById("btnForceClr")  as HTMLButtonElement;
const btnAdv       = document.getElementById("btnAdv")       as HTMLButtonElement;
const btnDis       = document.getElementById("btnDis")       as HTMLButtonElement;
const comboList    = document.getElementById("comboList")    as HTMLDivElement;
const historyList  = document.getElementById("historyList")  as HTMLDivElement;
const historySeg   = document.getElementById("historySeg")   as HTMLDivElement;
const btnClearHist = document.getElementById("btnClearHistory") as HTMLButtonElement;
const tabBtns      = document.querySelectorAll<HTMLButtonElement>(".tab");
const tabPanes     = document.querySelectorAll<HTMLDivElement>(".tabPane");

// --- localStorage helpers ---
function loadCombos(): SavedCombo[] {
  try {
    const v = localStorage.getItem(LS_COMBOS);
    if (!v) return [];
    const p = JSON.parse(v);
    if (Array.isArray(p)) return p;
  } catch {}
  return [];
}
function saveCombos() { try { localStorage.setItem(LS_COMBOS, JSON.stringify(combos)); } catch {} }
function loadHistory(): DiceRollPayload[] {
  try {
    const v = localStorage.getItem(LS_HISTORY);
    if (!v) return [];
    const p = JSON.parse(v);
    if (Array.isArray(p)) return p;
  } catch {}
  return [];
}
function saveHistory() { try { localStorage.setItem(LS_HISTORY, JSON.stringify(history)); } catch {} }
function loadLastExpr(): string {
  try { return localStorage.getItem(LS_LAST_EXPR) ?? ""; } catch { return ""; }
}
function saveLastExpr(v: string) { try { localStorage.setItem(LS_LAST_EXPR, v); } catch {} }

// --- Expression parser ---
//
// Supports a layered grammar:
//   PLAIN: "2d6 + 1d20 + 5" — sum of NdM terms + flat modifier
//   WRAPPERS: any of these can recursively wrap an inner expression
//     adv(<inner>[,N])   — roll <inner> N+1 times, keep the higher
//                          summed set; losing dice flagged `loser`.
//     dis(<inner>[,N])   — same but keep the lower set.
//     max(<inner>,X)     — clamp every die's value UP to at least X.
//                          Original value preserved as originalValue
//                          so the visual can show "3(1)".
//     min(<inner>,X)     — clamp every die's value DOWN to at most X.
//     reset(<inner>,X)   — force every die to value X.
//     same(<inner>)      — flag for "duplicate-value highlight" before
//                          the rush sequence. Doesn't change dice.
//     burst(<inner>)     — explosion: every kept die that rolls its
//                          maximum face triggers an extra roll of the
//                          same type, added to the dice list. Cap 5
//                          per starting die.
//     repeat(N,<inner>)  — runs the inner expression N times (each
//                          with its own dice rolls) and tells the
//                          visual to lay out one row per iteration
//                          with an independent per-row total.
//                          Special: repeat MUST be outermost.
//
// Wrappers are stored innermost-first so apply order is wrappers[0],
// wrappers[1], ... when rolling.
//
// Chinese full-width parens / commas are normalised to ASCII first.

interface ExprGroup { type: string; count: number }
interface PlainExpr { groups: ExprGroup[]; modifier: number }
type WrapperKind = "adv" | "dis" | "max" | "min" | "reset" | "same" | "burst" | "repeat";
interface Wrapper {
  kind: WrapperKind;
  // adv/dis: extra sets (N from "adv(...,N)"); default 1.
  // max/min/reset: the threshold/replacement value.
  // repeat: iteration count.
  // same/burst: undefined.
  param?: number;
}
// One independently-wrapped sub-expression. `adv(1d6)+adv(1d4)` parses
// to TWO segments — {plain:[d6], wrappers:[adv]} and {plain:[d4],
// wrappers:[adv]} — so each adv runs on its own dice instead of both
// d6 and d4 getting twin-rolled together.
interface ParsedSegment {
  plain: PlainExpr;
  wrappers: Wrapper[]; // innermost-first
}
interface ParsedExpr {
  segments: ParsedSegment[];
  // Flat dice + modifiers OUTSIDE every wrapper — e.g. the `+1d4` in
  // `adv(1d20)+1d4` lands here so it rolls ONCE and is added to the
  // adv-winner. Empty when the expression is fully wrapped.
  outerPlain: PlainExpr;
  // Backward-compat shims so existing code that reads `parsed.plain` /
  // `parsed.wrappers` keeps working: filled from the FIRST segment if
  // there's exactly one, else empty/empty. Refactor will eventually
  // drop these.
  plain: PlainExpr;
  wrappers: Wrapper[];
}

const TERM_RE = /([+\-]?)(?:(\d*)d(\d+)|(\d+))/gi;

function normalizeExpr(s: string): string {
  return s
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[，]/g, ",")
    .replace(/\s+/g, "");
}

function parsePlain(s: string): PlainExpr {
  const groups: ExprGroup[] = [];
  let modifier = 0;
  if (!s) return { groups, modifier };
  for (const m of s.matchAll(TERM_RE)) {
    const sign = m[1] === "-" ? -1 : 1;
    if (m[3] !== undefined) {
      const count = (m[2] ? parseInt(m[2], 10) : 1) * sign;
      const sides = parseInt(m[3], 10);
      if (!sides || sides < 2 || sides > 1000) continue;
      const type = `d${sides}`;
      const ex = groups.find((g) => g.type === type);
      if (ex) ex.count += count;
      else groups.push({ type, count });
    } else if (m[4] !== undefined) {
      modifier += sign * parseInt(m[4], 10);
    }
  }
  return { groups: groups.filter((g) => g.count > 0), modifier };
}

// Split a string at the LAST top-level comma — so "1d20+5,2" splits
// at the comma before the 2 (the +5 is inside the inner expr part).
function topLevelLastComma(s: string): number {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth = Math.max(0, depth - 1);
    else if (s[i] === "," && depth === 0) last = i;
  }
  return last;
}

// Find the FIRST top-level comma — used by `repeat(N,...)` where the
// count comes before the inner expression.
function topLevelFirstComma(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth = Math.max(0, depth - 1);
    else if (s[i] === "," && depth === 0) return i;
  }
  return -1;
}

// Split `s` into top-level additive terms, preserving each term's sign.
// E.g. `adv(1d6)+adv(1d4)-2` → [{sign:+1, body:"adv(1d6)"},
// {sign:+1, body:"adv(1d4)"}, {sign:-1, body:"2"}]. Wrapper-internal
// `+` / `-` (inside parens) are ignored — depth-aware.
function splitTopLevel(s: string): Array<{ sign: 1 | -1; body: string }> {
  const out: Array<{ sign: 1 | -1; body: string }> = [];
  if (!s) return out;
  let depth = 0;
  let start = 0;
  let sign: 1 | -1 = 1;
  // A leading sign on the whole string ("-1d4") sets the first term's sign.
  if (s[0] === "+" || s[0] === "-") {
    sign = s[0] === "-" ? -1 : 1;
    start = 1;
  }
  for (let i = start; i <= s.length; i++) {
    const c = i < s.length ? s[i] : "";
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (i === s.length || c === "+" || c === "-")) {
      const body = s.slice(start, i).trim();
      if (body) out.push({ sign, body });
      sign = c === "-" ? -1 : 1;
      start = i + 1;
    }
  }
  return out;
}

// Try to read a wrapper call at the START of `s` (i.e. `s` is exactly
// `FUNC(...)` with maybe an outer modifier appended). Returns the
// wrapper, its inner string, and whatever trailed after the closing
// paren. Returns null if `s` doesn't start with a wrapper call OR the
// parens are unbalanced.
function readWrapperHead(s: string): {
  wrapper: Wrapper;
  inner: string;
  tail: string;
} | null {
  const m = /^(adv|dis|max|min|reset|same|burst|repeat)\(/i.exec(s);
  if (!m) return null;
  const fnName = m[1].toLowerCase() as WrapperKind;
  const innerStart = m[0].length;
  let depth = 1;
  let innerEnd = -1;
  for (let i = innerStart; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) { innerEnd = i; break; }
    }
  }
  if (innerEnd < 0) return null;
  const innerRaw = s.slice(innerStart, innerEnd);
  const tail = s.slice(innerEnd + 1);
  let wrapper: Wrapper;
  let inner = innerRaw;
  if (fnName === "adv" || fnName === "dis") {
    let extraSets = 1;
    const lastComma = topLevelLastComma(innerRaw);
    if (lastComma >= 0) {
      const t = innerRaw.slice(lastComma + 1);
      if (/^\d+$/.test(t)) {
        const n = parseInt(t, 10);
        if (n > 0) {
          inner = innerRaw.slice(0, lastComma);
          extraSets = n;
        }
      }
    }
    wrapper = { kind: fnName, param: extraSets };
  } else if (fnName === "max" || fnName === "min" || fnName === "reset") {
    const lastComma = topLevelLastComma(innerRaw);
    if (lastComma < 0) return null;
    const t = innerRaw.slice(lastComma + 1);
    if (!/^-?\d+$/.test(t)) return null;
    wrapper = { kind: fnName, param: parseInt(t, 10) };
    inner = innerRaw.slice(0, lastComma);
  } else if (fnName === "repeat") {
    const firstComma = topLevelFirstComma(innerRaw);
    if (firstComma <= 0) return null;
    const head = innerRaw.slice(0, firstComma);
    if (!/^\d+$/.test(head)) return null;
    const n = Math.max(1, Math.min(20, parseInt(head, 10) || 1));
    wrapper = { kind: "repeat", param: n };
    inner = innerRaw.slice(firstComma + 1);
  } else {
    wrapper = { kind: fnName }; // same / burst
  }
  return { wrapper, inner, tail };
}

// Apply `sign` to a PlainExpr — flips dice counts and modifier sign.
// Used when a wrapped term has a leading minus, like `-adv(1d4)`.
function negatePlain(p: PlainExpr): PlainExpr {
  return {
    groups: p.groups.map((g) => ({ type: g.type, count: g.count })).filter((g) => {
      g.count = -g.count;
      return g.count !== 0;
    }),
    modifier: -p.modifier,
  };
}

// Merge `src` PlainExpr into `dst` (in place). Same-type dice sum.
function mergePlain(dst: PlainExpr, src: PlainExpr): void {
  for (const g of src.groups) {
    const ex = dst.groups.find((x) => x.type === g.type);
    if (ex) ex.count += g.count;
    else dst.groups.push({ type: g.type, count: g.count });
  }
  dst.modifier += src.modifier;
  dst.groups = dst.groups.filter((g) => g.count !== 0);
}

// LEGACY peelOne — replaced by `readWrapperHead` + `parseExprInner`.
// Kept temporarily so I don't break unrelated callers in this commit;
// nothing reaches it at runtime.
function peelOne(s: string, outerOut?: PlainExpr): { wrapper: Wrapper; combined: string } | null {
  // Find the first wrapper-call signature anywhere in the string.
  const fnRe = /(adv|dis|max|min|reset|same|burst|repeat)\(/i;
  const m = s.match(fnRe);
  if (!m || m.index === undefined) return null;
  const fnName = m[1].toLowerCase() as WrapperKind;
  const fnStart = m.index;
  const innerStart = fnStart + m[0].length;

  // Walk to the matching close paren (depth-aware so nested wrappers
  // don't trip us up).
  let depth = 1;
  let innerEnd = -1;
  for (let i = innerStart; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) { innerEnd = i; break; }
    }
  }
  if (innerEnd < 0) return null;

  const prefix = s.slice(0, fnStart);
  const innerRaw = s.slice(innerStart, innerEnd);
  const suffix = s.slice(innerEnd + 1);

  let wrapper: Wrapper;
  let inner = innerRaw;

  if (fnName === "adv" || fnName === "dis") {
    let extraSets = 1;
    const lastComma = topLevelLastComma(innerRaw);
    if (lastComma >= 0) {
      const tail = innerRaw.slice(lastComma + 1);
      if (/^\d+$/.test(tail)) {
        const n = parseInt(tail, 10);
        if (Number.isFinite(n) && n > 0) {
          inner = innerRaw.slice(0, lastComma);
          extraSets = n;
        }
      }
    }
    wrapper = { kind: fnName, param: extraSets };
  } else if (fnName === "max" || fnName === "min" || fnName === "reset") {
    const lastComma = topLevelLastComma(innerRaw);
    if (lastComma < 0) return null;
    const tail = innerRaw.slice(lastComma + 1);
    if (!/^-?\d+$/.test(tail)) return null;
    const value = parseInt(tail, 10);
    if (!Number.isFinite(value)) return null;
    wrapper = { kind: fnName, param: value };
    inner = innerRaw.slice(0, lastComma);
  } else if (fnName === "repeat") {
    const firstComma = topLevelFirstComma(innerRaw);
    if (firstComma <= 0) return null;
    const head = innerRaw.slice(0, firstComma);
    if (!/^\d+$/.test(head)) return null;
    const n = Math.max(1, Math.min(20, parseInt(head, 10) || 1));
    wrapper = { kind: "repeat", param: n };
    inner = innerRaw.slice(firstComma + 1);
  } else {
    // same / burst — no params
    wrapper = { kind: fnName };
  }

  // For adv/dis: extract dice from prefix/suffix into outerOut so they
  // get rolled ONCE outside the advantage. Flat modifiers stay in the
  // combined string (commutative with adv comparison). If prefix/suffix
  // contain another wrapper call we leave them alone — the next peel
  // iteration handles them; until then we don't risk corrupting nested
  // wrapper syntax by stripping their internal dice.
  if ((wrapper.kind === "adv" || wrapper.kind === "dis") && outerOut) {
    const wrapperRe = /(adv|dis|max|min|reset|same|burst|repeat)\(/i;
    const prefixHasWrapper = wrapperRe.test(prefix);
    const suffixHasWrapper = wrapperRe.test(suffix);
    let prefixOut = prefix;
    let suffixOut = suffix;
    const absorbInto = (frag: string): string => {
      const p = parsePlain(frag);
      for (const g of p.groups) {
        const ex = outerOut.groups.find((x) => x.type === g.type);
        if (ex) ex.count += g.count;
        else outerOut.groups.push({ ...g });
      }
      // Drop the dice; reduce to a flat-modifier string so peel can
      // continue working on the wrapper chain.
      if (p.modifier > 0) return `+${p.modifier}`;
      if (p.modifier < 0) return `${p.modifier}`;
      return "";
    };
    if (!prefixHasWrapper) prefixOut = absorbInto(prefix);
    if (!suffixHasWrapper) suffixOut = absorbInto(suffix);
    const needsSep = prefixOut && !/[+\-]$/.test(prefixOut) && inner && !/^[+\-]/.test(inner);
    const combined = prefixOut + (needsSep ? "+" : "") + inner + suffixOut;
    return { wrapper, combined };
  }

  // Combine prefix + inner + suffix as the NEW expression to keep
  // peeling. Prefix should already end with an operator (or be empty).
  // Suffix should already start with an operator. If a sign-less prefix
  // is followed by a sign-less inner, separate them with "+" so the
  // plain parser doesn't run them together.
  const needsSepBefore = prefix && !/[+\-]$/.test(prefix) && inner && !/^[+\-]/.test(inner);
  const combined = prefix + (needsSepBefore ? "+" : "") + inner + suffix;
  return { wrapper, combined };
}

// Top-down recursive parser. Splits at top-level `+` / `-`, and for
// each term either:
//   - reads a wrapper call FUNC(...) → recursively parses the inner,
//     pushes this wrapper onto every inner segment's chain, and lifts
//     any inner outer-plain into a NEW segment with this wrapper.
//   - parses as a flat plain term → folded into outerPlain.
//
// Result: `segments[]` are independent wrapped dice chains, plus a
// flat `outerPlain` for un-wrapped terms. Each segment rolls its dice
// ONCE through its own wrapper chain, so `adv(1d6)+adv(1d4)` correctly
// performs two independent advantage rolls.
function parseExpr(raw: string): ParsedExpr {
  const s = normalizeExpr(raw);
  return finalizeParse(parseExprInner(s));
}

function parseExprInner(s: string): {
  segments: ParsedSegment[];
  outerPlain: PlainExpr;
} {
  const segments: ParsedSegment[] = [];
  const outerPlain: PlainExpr = { groups: [], modifier: 0 };
  if (!s) return { segments, outerPlain };

  for (const term of splitTopLevel(s)) {
    const head = readWrapperHead(term.body);
    if (head) {
      // Wrapped term. Recursively parse the inner, then push THIS
      // wrapper onto every inner segment AND lift the inner outer-plain
      // into its own segment under this wrapper.
      const innerParsed = parseExprInner(head.inner);
      // Inner outer-plain → fresh segment with [this wrapper] applied.
      const innerOuter = innerParsed.outerPlain;
      if (innerOuter.groups.length || innerOuter.modifier !== 0) {
        const seg: ParsedSegment = {
          plain: term.sign === -1 ? negatePlain(innerOuter) : innerOuter,
          wrappers: [head.wrapper],
        };
        segments.push(seg);
      }
      // Each existing inner segment: push this wrapper at the END
      // (outer-of-inner = applied later by rollExpr).
      for (const innerSeg of innerParsed.segments) {
        const seg: ParsedSegment = {
          plain: term.sign === -1 ? negatePlain(innerSeg.plain) : innerSeg.plain,
          wrappers: [...innerSeg.wrappers, head.wrapper],
        };
        segments.push(seg);
      }
      // Trailing modifier after the wrapper, e.g. `adv(1d20)+5` has
      // tail "+5" — fold into outerPlain.
      if (head.tail) {
        const tailParsed = parsePlain(head.tail);
        if (term.sign === -1) {
          // Sign on the wrapped term ALSO flips its tail.
          tailParsed.modifier = -tailParsed.modifier;
          for (const g of tailParsed.groups) g.count = -g.count;
        }
        mergePlain(outerPlain, tailParsed);
      }
    } else {
      // Flat plain term (NdM or number). Apply sign and fold into
      // outerPlain.
      const signed = term.sign === -1 ? `-${term.body}` : term.body;
      const plain = parsePlain(signed);
      mergePlain(outerPlain, plain);
    }
  }

  return { segments, outerPlain };
}

// Strip empty-zero entries + populate the backward-compat shims.
function finalizeParse(p: {
  segments: ParsedSegment[];
  outerPlain: PlainExpr;
}): ParsedExpr {
  // Drop segments whose plain has no dice and no modifier — happens
  // when an empty wrapper inner gets pushed.
  const segments = p.segments.filter(
    (seg) => seg.plain.groups.length > 0 || seg.plain.modifier !== 0,
  );
  const outerPlain = p.outerPlain;
  // Backward-compat shim: legacy callers read `parsed.plain` and
  // `parsed.wrappers`. If there's exactly ONE segment, surface it; if
  // there's none, surface outerPlain so simple `1d20+5`-style
  // expressions still look "wrapper-less" to old code paths.
  let plain: PlainExpr;
  let wrappers: Wrapper[];
  if (segments.length === 1) {
    plain = segments[0].plain;
    wrappers = segments[0].wrappers;
  } else if (segments.length === 0) {
    plain = outerPlain;
    wrappers = [];
  } else {
    plain = { groups: [], modifier: 0 };
    wrappers = [];
  }
  return { segments, outerPlain, plain, wrappers };
}

function rollDieType(type: string): number {
  return Math.floor(Math.random() * sidesOf(type)) + 1;
}

function rollPlainSet(plain: PlainExpr): DieResult[] {
  const dice: DieResult[] = [];
  for (const g of plain.groups) {
    for (let i = 0; i < g.count; i++) {
      dice.push({ type: g.type as DiceType, value: rollDieType(g.type) });
    }
  }
  return dice;
}

function formatPlain(p: PlainExpr): string {
  const parts = p.groups.map((g) => `${g.count}${g.type}`);
  let s = parts.join(" + ");
  if (p.modifier > 0) s += `${s ? " + " : ""}${p.modifier}`;
  else if (p.modifier < 0) s += `${s ? " " : ""}${p.modifier}`;
  return s || "—";
}

function formatSegment(seg: ParsedSegment): string {
  let body = formatPlain(seg.plain);
  for (const w of seg.wrappers) {
    switch (w.kind) {
      case "adv":
      case "dis":
        body = w.param && w.param > 1
          ? `${w.kind}(${body},${w.param})`
          : `${w.kind}(${body})`;
        break;
      case "max":
      case "min":
      case "reset":
        body = `${w.kind}(${body},${w.param ?? 0})`;
        break;
      case "same":
      case "burst":
        body = `${w.kind}(${body})`;
        break;
      case "repeat":
        body = `repeat(${w.param ?? 1},${body})`;
        break;
    }
  }
  return body;
}

// Stitch all segments + outerPlain into a readable string. Order:
// segments first (preserving the order they appeared in the input)
// then any outer plain. Each piece is joined with ` + ` / ` - ` based
// on the leading sign of its formatted body.
function formatExpr(p: ParsedExpr): string {
  const pieces: string[] = [];
  for (const seg of p.segments) {
    const s = formatSegment(seg);
    if (s && s !== "—") pieces.push(s);
  }
  const outer = p.outerPlain ? formatPlain(p.outerPlain) : "";
  if (outer && outer !== "—") pieces.push(outer);
  if (pieces.length === 0) return "—";
  // Join with ` + ` — formatPlain already inserts leading "-" for
  // negative modifiers, so we just splice with " + " and the user sees
  // "adv(1d20) + -1" → not pretty. Fix by detecting leading "-".
  let out = pieces[0];
  for (let i = 1; i < pieces.length; i++) {
    const next = pieces[i];
    if (next.startsWith("-")) out += ` ${next}`;
    else out += ` + ${next}`;
  }
  return out;
}

// Apply max/min/reset to a single die value. Stamps originalValue if
// the value actually changed so the visual can render "new(orig)".
//
// Semantics:
//   max(d, X)    — value bumped UP to at least X (floor)
//   min(d, X)    — value capped DOWN to at most X (ceiling)
//   reset(d, X)  — TRIGGERED reroll: if rolled value EQUALS X, reroll
//                  the die ONCE (using its real side count) and use
//                  the reroll. Original X is preserved as originalValue
//                  so the visual can show "newRoll(X)". Hits no other
//                  values.
function applyValueClamp(d: DieResult, kind: "max" | "min" | "reset", X: number): DieResult {
  if (d.loser) return d;     // discarded set is preserved as-rolled
  if (kind === "reset") {
    if (d.value !== X) return d;        // didn't hit the trigger
    const sides = sidesOf(d.type);
    const newVal = Math.floor(Math.random() * sides) + 1;
    if (newVal === d.value) return d;   // reroll happened to land on same — no visual delta
    return { ...d, originalValue: d.originalValue ?? d.value, value: newVal };
  }
  let nv = d.value;
  if (kind === "max") nv = Math.max(d.value, X);
  else if (kind === "min") nv = Math.min(d.value, X);
  if (nv === d.value) return d;
  return { ...d, originalValue: d.originalValue ?? d.value, value: nv };
}

// Recursively roll one instance of (plain + the given wrapper chain).
// Wrappers are innermost-first, applied in order. adv/dis are special:
// they recurse to roll the INNER chain multiple times, then pick a
// winning set and mark losers.
function rollExpr(plain: PlainExpr, wrappers: Wrapper[]): { dice: DieResult[]; winnerIdx: number } {
  if (wrappers.length === 0) {
    return { dice: rollPlainSet(plain), winnerIdx: -1 };
  }
  const outer = wrappers[wrappers.length - 1];
  const inner = wrappers.slice(0, -1);

  // adv / dis — expand: roll the inner chain N+1 times, pick winner.
  if (outer.kind === "adv" || outer.kind === "dis") {
    const setsCount = (outer.param ?? 1) + 1;
    const sets: { dice: DieResult[]; sum: number }[] = [];
    for (let i = 0; i < setsCount; i++) {
      const r = rollExpr(plain, inner);
      sets.push({ dice: r.dice, sum: r.dice.reduce((a, d) => a + d.value, 0) });
    }
    let winSetIdx = 0;
    for (let i = 1; i < sets.length; i++) {
      if (outer.kind === "adv" && sets[i].sum > sets[winSetIdx].sum) winSetIdx = i;
      else if (outer.kind === "dis" && sets[i].sum < sets[winSetIdx].sum) winSetIdx = i;
    }
    const dice: DieResult[] = [];
    for (let i = 0; i < sets.length; i++) {
      const isLoser = i !== winSetIdx;
      for (const d of sets[i].dice) dice.push(isLoser ? { ...d, loser: true } : d);
    }
    let winnerIdx = -1;
    if (sets[winSetIdx].dice.length === 1) {
      let idx = 0;
      for (let i = 0; i < winSetIdx; i++) idx += sets[i].dice.length;
      winnerIdx = idx;
    }
    return { dice, winnerIdx };
  }

  // Non-expanding wrappers: recurse first, then transform.
  const innerResult = rollExpr(plain, inner);
  let dice = innerResult.dice;
  let winnerIdx = innerResult.winnerIdx;

  if (outer.kind === "max" || outer.kind === "min" || outer.kind === "reset") {
    const X = outer.param ?? 1;
    dice = dice.map((d) => applyValueClamp(d, outer.kind as "max" | "min" | "reset", X));
  } else if (outer.kind === "burst") {
    const out: DieResult[] = [];
    for (const d of dice) {
      const parentIdxInOut = out.length;
      out.push(d);
      if (d.loser) continue;
      const sides = sidesOf(d.type);
      let lastValue = d.value;
      let lastIdxInOut = parentIdxInOut;
      let chain = 0;
      while (lastValue === sides && chain < 5) {
        // Record the index of the die that triggered THIS new one so
        // the visual can play parent → child fly-in animations along
        // the chain. burstParent indexes into the OUTPUT array so it
        // remains valid through subsequent wrapper insertions.
        const next: DieResult = {
          type: d.type,
          value: rollDieType(d.type),
          burstParent: lastIdxInOut,
        };
        out.push(next);
        lastIdxInOut = out.length - 1;
        lastValue = next.value;
        chain++;
      }
    }
    dice = out;
    // Burst inserts dice between original ones — winnerIdx invalidated.
    winnerIdx = -1;
  }
  // "same" is a visual-only flag, no value transform.

  return { dice, winnerIdx };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// --- Owner-aware target-token resolution ---
//
// Per user spec: focus the dice on a token if there's exactly one
// reasonable candidate. Priority:
//   1. Currently selected (if exactly one selected)
//   2. Visible character-layer item owned (createdUserId matches) by
//      the current player — but ONLY if there's exactly one such item.
async function findFocusTokenId(): Promise<string | null> {
  try {
    const sel = await OBR.player.getSelection();
    if (sel && sel.length === 1) return sel[0];
  } catch {}
  try {
    const myId = await OBR.player.getId();
    const items = await OBR.scene.items.getItems(
      (it: any) =>
        it.type === "IMAGE" &&
        (it.layer === "CHARACTER" || it.layer === "MOUNT") &&
        it.visible &&
        it.createdUserId === myId
    );
    if (items.length === 1) return items[0].id;
  } catch {}
  return null;
}

// --- Lock state ---

function setLocked(locked: boolean) {
  isAnimating = locked;
  btnForceClr.classList.toggle("on", locked);
}
// Shake any button red and (optionally) replace its label with a brief
// failure reason. The original label is restored after the animation
// so the button is reusable. Used by both the panel's main 投掷 button
// and per-card combo 投掷 buttons.
const SHAKE_MS = 700;
function shakeButtonWithReason(btn: HTMLButtonElement, reason?: string): void {
  btn.classList.remove("shake-red");
  void btn.offsetWidth;
  btn.classList.add("shake-red");
  if (reason) {
    if (btn.dataset.origLabel === undefined) {
      btn.dataset.origLabel = btn.textContent ?? "";
    }
    btn.textContent = reason;
  }
  setTimeout(() => {
    btn.classList.remove("shake-red");
    if (btn.dataset.origLabel !== undefined) {
      btn.textContent = btn.dataset.origLabel;
      delete btn.dataset.origLabel;
    }
  }, SHAKE_MS);
}
// Backwards-compat shorthand for the main panel button.
function flashRollButtonRed(reason?: string) {
  shakeButtonWithReason(btnRoll, reason);
}
function forceClear() {
  if (animationTimer !== null) {
    clearTimeout(animationTimer);
    animationTimer = null;
  }
  setLocked(false);
  OBR.broadcast.sendMessage(BC_DICE_FORCE_CLEAR, {}, { destination: "LOCAL" }).catch(() => {});
  OBR.broadcast.sendMessage(BC_DICE_FORCE_CLEAR, {}, { destination: "REMOTE" }).catch(() => {});
}

// --- Dice button click adjusts expression (left=+1, right=-1) ---

function adjustExprForType(type: DiceType, delta: number) {
  const parsed = parseExpr(expression);
  // Add to outerPlain — outside any wrapper. Each click of a die
  // button always lands as a free-standing additive term so the user
  // can stack `adv(1d20) + 1d6` by clicking adv then d6 etc. For
  // simple `1d20+5` (no wrapper) outerPlain IS where the dice live, so
  // this also matches the old behavior. Decrement only fires when
  // there's an existing entry to subtract from — matches the legacy
  // "right-click on a die button removes one" UX.
  const dst = parsed.outerPlain;
  const ex = dst.groups.find((g) => g.type === type);
  if (ex) {
    ex.count += delta;
    if (ex.count <= 0) dst.groups = dst.groups.filter((g) => g !== ex);
  } else if (delta > 0) {
    dst.groups.push({ type, count: delta });
  }
  setExpression(formatExpr(parsed));
}

// Bump the flat numeric modifier in the expression by `delta`. The
// modifier always lives on the INNER plain (under any adv/dis/max/...
// wrapper) — that's where peelOne already absorbs flat-number suffixes
// like the +5 in `adv(1d20)+5`, and it formats cleanly back into the
// inner. Empty expression starts at 0.
function adjustExprModifier(delta: number) {
  const parsed = parseExpr(expression);
  // Add to outerPlain — that's the unambiguous "outside any wrapper"
  // bucket. For a plain `1d20+5` (no wrapper, single segment) this
  // adjusts the segment's own modifier via the backward-compat shim;
  // for multi-segment / wrapped expressions the modifier shows up as
  // a trailing `+ N` after the wrapped parts, which is the right
  // behavior (it doesn't get advantage-doubled).
  if (parsed.segments.length === 0) {
    parsed.outerPlain.modifier += delta;
  } else {
    parsed.outerPlain.modifier += delta;
  }
  setExpression(formatExpr(parsed));
}

// Total modifier across all segments + outer. Used for empty-checks
// and for the single-number `modifier` field in the broadcast payload.
function totalModifier(p: ParsedExpr): number {
  let m = p.outerPlain.modifier;
  for (const seg of p.segments) m += seg.plain.modifier;
  return m;
}

function exprIsEmpty(p: ParsedExpr): boolean {
  if (p.outerPlain.groups.length || p.outerPlain.modifier !== 0) return false;
  for (const seg of p.segments) {
    if (seg.plain.groups.length || seg.plain.modifier !== 0) return false;
  }
  return true;
}

function setExpression(v: string) {
  expression = v === "—" ? "" : v;
  exprInput.value = expression;
  refreshBadges();
}

function refreshBadges() {
  const parsed = parseExpr(expression);
  const counts: Record<string, number> = {};
  for (const g of parsed.plain.groups) counts[g.type] = (counts[g.type] ?? 0) + g.count;
  for (const g of parsed.outerPlain.groups) counts[g.type] = (counts[g.type] ?? 0) + g.count;
  diceRow.querySelectorAll<HTMLElement>(".dice-btn[data-type]").forEach((b) => {
    const t = b.dataset.type!;
    const c = counts[t] ?? 0;
    b.dataset.count = String(c);
    const badge = b.querySelector<HTMLSpanElement>(".badge");
    if (badge) badge.textContent = String(c);
  });
}

// --- Combos / History rendering ---

function renderCombos() {
  if (!combos.length) {
    comboList.innerHTML = `<div class="empty-state">还没有保存的组合<br>在「投掷」标签里组好骰子后点「保存组合」</div>`;
    return;
  }
  // DM-only 暗骰 button — same gating as the main panel's dark-roll.
  const darkBtn = isDM
    ? `<button class="btn dark-roll combo-dark" data-act="roll-dark" type="button">暗骰</button>`
    : "";
  comboList.innerHTML = combos.map((c) => {
    const formula = formatExpr(parseExpr(c.expr));
    return `
      <div class="combo-card" data-id="${c.id}">
        <div class="combo-name">${escapeHtml(c.name)}</div>
        <div class="combo-formula">${escapeHtml(formula)}</div>
        <div class="combo-actions">
          <button class="btn primary" data-act="roll" type="button">投掷</button>
          ${darkBtn}
          <button class="btn" data-act="load" type="button">编辑</button>
          <button class="btn danger" data-act="del" type="button">删除</button>
        </div>
      </div>
    `;
  }).join("");
  comboList.querySelectorAll<HTMLButtonElement>(".combo-actions button").forEach((b) => {
    b.addEventListener("click", () => {
      const card = b.closest(".combo-card") as HTMLElement;
      const id = card.dataset.id!;
      const c = combos.find((x) => x.id === id);
      if (!c) return;
      const act = b.dataset.act;
      if (act === "roll") {
        rollFromCombo(c.expr, c.name, false, b);
      } else if (act === "roll-dark") {
        rollFromCombo(c.expr, c.name, true, b);
      } else if (act === "load") {
        setExpression(c.expr);
        labelText = c.name;
        labelInput.value = labelText;
        switchTab("roll");
      } else if (act === "del") {
        combos = combos.filter((x) => x.id !== id);
        saveCombos();
        renderCombos();
      }
    });
  });
}

function renderHistorySeg() {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const h of history) {
    if (!seen.has(h.rollerName)) {
      seen.add(h.rollerName);
      names.push(h.rollerName);
    }
  }
  const buttons: string[] = [
    `<button class="seg-btn ${historyFilter === "" ? "on" : ""}" data-p="" type="button">全部</button>`,
  ];
  for (const n of names) {
    const isOn = historyFilter === n;
    buttons.push(
      `<button class="seg-btn ${isOn ? "on" : ""}" data-p="${escapeHtml(n)}" type="button">${escapeHtml(n)}</button>`
    );
  }
  historySeg.innerHTML = buttons.join("");
  historySeg.querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      historyFilter = b.dataset.p ?? "";
      renderHistorySeg();
      renderHistoryList();
    });
  });
}

function renderHistoryList() {
  const filtered = historyFilter
    ? history.filter((h) => h.rollerName === historyFilter)
    : history;
  if (!filtered.length) {
    historyList.innerHTML = `<div class="empty-state">还没有掷骰记录</div>`;
    return;
  }
  historyList.innerHTML = filtered.map((h) => {
    const ago = formatAgo(Date.now() - h.ts);
    // For history, ignore loser dice in the formula recap — they're a
    // visual-only annotation of adv/dis.
    const kept = h.dice.filter((d) => !d.loser);
    const grouped: Record<string, number> = {};
    for (const d of kept) grouped[d.type] = (grouped[d.type] ?? 0) + 1;
    const parts = Object.entries(grouped).map(([t, n]) => `${n}${t}`);
    let formula = parts.join(" + ");
    if (h.modifier) formula += `${formula ? (h.modifier > 0 ? " + " : " ") : ""}${h.modifier}`;
    const dieChips = h.dice.map((d) => {
      const sides = sidesOf(d.type);
      const cls =
        d.value === sides ? "high" :
        d.value === 1     ? "low"  : "";
      const loserCls = d.loser ? " loser" : "";
      return `<span class="history-die ${cls}${loserCls}">${d.value}</span>`;
    }).join("");
    const labelStr = h.label ? ` · ${escapeHtml(h.label)}` : "";
    const isCrit = kept.some((d) => d.type === "d20" && d.value === 20);
    const isFail = kept.some((d) => d.type === "d20" && d.value === 1);
    const cardCls = isCrit ? "crit" : isFail ? "fail" : "";
    return `
      <div class="history-item ${cardCls}">
        <div class="history-head">
          <span class="history-player" style="color:${h.rollerColor}">${escapeHtml(h.rollerName)}${labelStr}</span>
          <span>${ago}</span>
        </div>
        <div class="history-formula">${escapeHtml(formula || "—")}</div>
        <div class="history-rolls">
          ${dieChips}
          ${h.modifier ? `<span style="color:#8a8e9c">${h.modifier > 0 ? "+" : ""}${h.modifier}</span>` : ""}
          <span class="history-total">${h.total}</span>
        </div>
      </div>
    `;
  }).join("");
}

function formatAgo(ms: number): string {
  if (ms < 5_000) return "刚刚";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s 前`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}min 前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h 前`;
  return `${Math.floor(ms / 86_400_000)}d 前`;
}

// --- Tab switching ---

function switchTab(t: typeof activeTab) {
  activeTab = t;
  tabBtns.forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  tabPanes.forEach((p) => p.classList.toggle("on", p.dataset.tab === t));
  if (t === "history") {
    renderHistorySeg();
    renderHistoryList();
  }
  if (t === "combos") renderCombos();
}

// --- Roll dispatch ---
//
// The "clear" concept was removed — every roll now self-dismisses
// (effect modal flies the dice down to the bottom-left history popover
// and closes). The buttons stay as plain "投掷" / "暗骰" forever.

// Owned + visible selected tokens — these are the legitimate targets
// for a normal roll. GM can roll for any selected token; players can
// only roll for tokens they own (createdUserId match).
//
// Fallback for players: if NO selection (or selection has nothing the
// player owns) AND the player owns exactly one visible character
// token, auto-target that single token. Removes the "click your own
// token first" friction in the common case where a player only has
// one PC.
async function getOwnedSelectedTokenIds(): Promise<string[]> {
  try {
    const sel = await OBR.player.getSelection();
    const myId = await OBR.player.getId();
    if (sel && sel.length) {
      const items = await OBR.scene.items.getItems(sel);
      const filtered = items
        .filter((it: any) => it.visible && (isDM || it.createdUserId === myId))
        .map((it: any) => it.id);
      if (filtered.length) return filtered;
    }
    // Player auto-target fallback. GM doesn't get this — they can
    // own many tokens and shouldn't accidentally roll on a random
    // one without selecting it.
    if (!isDM) {
      const items = await OBR.scene.items.getItems(
        (it: any) =>
          it.type === "IMAGE" &&
          (it.layer === "CHARACTER" || it.layer === "MOUNT") &&
          it.visible &&
          it.createdUserId === myId,
      );
      if (items.length === 1) return [items[0].id];
    }
  } catch {}
  return [];
}

// Camera focus before a roll fires. Single target: keep the user's
// current zoom (they may have framed the scene already), just pan so
// the token is centered. Multi target: fit a bounding box covering
// every target so the player sees all dice columns at once.
//
// Per spec: do NOT use animateTo with scale=1 (was the old behaviour
// in showDiceEffect — too aggressive, snapped from a wide overview to
// 100% on every single-target roll). And do NOT focus per-broadcast
// (was per-token, caused chaotic camera-thrash for multi-rolls).
async function focusCameraOnTokens(tokenIds: string[]): Promise<void> {
  if (!tokenIds.length) return;
  try {
    const items = await OBR.scene.items.getItems(tokenIds);
    if (!items.length) return;
    if (items.length === 1) {
      const [vw, vh, currentScale] = await Promise.all([
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
        OBR.viewport.getScale(),
      ]);
      const p = items[0].position;
      OBR.viewport.animateTo({
        position: { x: -p.x * currentScale + vw / 2, y: -p.y * currentScale + vh / 2 },
        scale: currentScale,
      }).catch(() => {});
      return;
    }
    // Multi-target — bounding box across every token position. Padding
    // (in world units) keeps tokens away from the screen edge so the
    // dice that anchor on each token's TOP have room to fly in.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      const p = (it as any).position;
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) return;
    let dpi = 150;
    try { dpi = await OBR.scene.grid.getDpi(); } catch {}
    const padX = dpi * 1.5;
    const padY = dpi * 2;   // extra vertical so dice above heads stay visible
    const min = { x: minX - padX, y: minY - padY };
    const max = { x: maxX + padX, y: maxY + padY };
    const w = max.x - min.x;
    const h = max.y - min.y;
    OBR.viewport.animateToBounds({
      min,
      max,
      width: w,
      height: h,
      center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 },
    }).catch(() => {});
  } catch {}
}


async function emitOneRoll(opts: {
  dice: DieResult[];
  winnerIdx: number;
  modifier: number;
  label: string;
  itemId: string | null;
  hidden: boolean;
  rowStarts?: number[];
  sameHighlight?: boolean;
  collectiveId?: string;
}): Promise<void> {
  if (!opts.dice.length) return;
  // Total: sum of all NON-loser dice. For repeat-mode the panel total
  // is the grand sum; the visual computes per-row totals from rowStarts
  // independently. modifier is added once per row visually but only
  // once to the grand total here (history-friendly aggregate).
  const kept = opts.dice.filter((d) => !d.loser);
  const baseTotal = kept.reduce((a, d) => a + d.value, 0);
  const total = opts.rowStarts && opts.rowStarts.length > 0
    ? baseTotal + opts.modifier * opts.rowStarts.length
    : baseTotal + opts.modifier;

  let rollerId = "";
  let rollerName = "投骰人";
  let rollerColor = "#5dade2";
  try {
    [rollerId, rollerName, rollerColor] = await Promise.all([
      OBR.player.getId(),
      OBR.player.getName(),
      OBR.player.getColor(),
    ]);
  } catch {}

  const rollId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  myActiveRollIds.add(rollId);
  const payload: DiceRollPayload = {
    itemId: opts.itemId,
    dice: opts.dice,
    winnerIdx: opts.winnerIdx,
    modifier: opts.modifier,
    label: opts.label,
    total,
    rollerId,
    rollerName,
    rollerColor,
    rollId,
    ts: Date.now(),
    hidden: opts.hidden,
    ...(opts.rowStarts ? { rowStarts: opts.rowStarts } : {}),
    ...(opts.sameHighlight ? { sameHighlight: true } : {}),
    ...(opts.collectiveId ? { collectiveId: opts.collectiveId } : {}),
  };

  try {
    if (opts.hidden) {
      // Dark roll: LOCAL only — players never receive it; only the
      // sender's own client renders the (translucent) modal.
      await OBR.broadcast.sendMessage(BROADCAST_DICE_ROLL, payload, { destination: "LOCAL" });
    } else {
      await Promise.all([
        OBR.broadcast.sendMessage(BROADCAST_DICE_ROLL, payload, { destination: "LOCAL" }),
        OBR.broadcast.sendMessage(BROADCAST_DICE_ROLL, payload, { destination: "REMOTE" }),
      ]);
    }
  } catch (e) {
    console.error("[obr-suite/dice-panel] broadcast failed", e);
  }
}

// Compute the dice array (with adv/dis loser annotations + value
// transforms + burst expansion) for a single "instance" of a roll.
// Multi-token rolls call this once per token so each token gets its
// own independent dice values.
//
// `repeat` is handled specially here: it produces N independent inner
// rolls and reports row boundaries so the visual can lay them out one
// row per iteration with per-row totals.
// `same` is a visual-only flag — propagated via sameHighlight, doesn't
// alter the rolled values.
interface BuiltRoll {
  dice: DieResult[];
  winnerIdx: number;
  rowStarts?: number[];  // repeat: row[i] spans [rowStarts[i], rowStarts[i+1] || dice.length)
  sameHighlight?: boolean;
}
function buildOneRollDice(parsed: ParsedExpr): BuiltRoll {
  // `same` highlight + `repeat` row layout are recognized at the
  // segment level. We support repeat ONLY when it's the outermost
  // wrapper of a segment that also covers all dice (i.e., a single
  // segment with empty outerPlain). Mixing repeat with siblings is
  // explicitly out of scope.
  const sameHighlight = parsed.segments.some((s) =>
    s.wrappers.some((w) => w.kind === "same"),
  );

  const repeatSegIdx = parsed.segments.findIndex((s) =>
    s.wrappers.some((w) => w.kind === "repeat"),
  );
  const outerDice = rollPlainSet(parsed.outerPlain);

  if (repeatSegIdx >= 0 && parsed.segments.length === 1 && outerDice.length === 0) {
    const seg = parsed.segments[0];
    const repeatW = seg.wrappers.find((w) => w.kind === "repeat")!;
    const inner = seg.wrappers.filter((w) => w.kind !== "same" && w.kind !== "repeat");
    const N = Math.max(1, repeatW.param ?? 1);
    const allDice: DieResult[] = [];
    const rowStarts: number[] = [];
    for (let i = 0; i < N; i++) {
      rowStarts.push(allDice.length);
      const r = rollExpr(seg.plain, inner);
      for (const d of r.dice) allDice.push(d);
    }
    return { dice: allDice, winnerIdx: -1, rowStarts, sameHighlight };
  }

  // Roll each segment INDEPENDENTLY through its own wrapper chain, then
  // stitch dice arrays together. Each segment has its own winnerIdx
  // (only meaningful for single-die segments under adv/dis), but the
  // top-level winnerIdx is meaningful only when there's exactly one
  // segment with one kept die.
  const allDice: DieResult[] = [];
  let winnerIdx = -1;
  for (const seg of parsed.segments) {
    const inner = seg.wrappers.filter((w) => w.kind !== "same" && w.kind !== "repeat");
    const r = rollExpr(seg.plain, inner);
    if (parsed.segments.length === 1 && outerDice.length === 0) {
      winnerIdx = r.winnerIdx;
    }
    for (const d of r.dice) allDice.push(d);
  }
  for (const d of outerDice) allDice.push(d);
  return { dice: allDice, winnerIdx, sameHighlight };
}

async function performRoll(opts: { hidden: boolean }): Promise<void> {
  // The button to shake — for the main panel that's btnRoll, for the
  // dark-roll variant it's btnDarkRoll (visible only to DM).
  const btnSelf = opts.hidden
    ? (document.getElementById("btnDarkRoll") as HTMLButtonElement | null) ?? btnRoll
    : btnRoll;

  if (isAnimating) {
    shakeButtonWithReason(btnSelf, "动画进行中…");
    return;
  }
  const expr = expression;
  const label = labelText.trim();
  const parsed = parseExpr(expr);
  if (exprIsEmpty(parsed)) {
    shakeButtonWithReason(btnSelf, expr.trim() ? "表达式无法解析" : "请先输入表达式");
    return;
  }

  // Resolve target tokens.
  //   - Normal roll: REQUIRES at least one owned-and-visible selected
  //     token. Empty selection → shake and bail.
  //   - Dark roll: tokens are optional — DM can dark-roll without any
  //     selection (anchored at viewport center for them only).
  let targetTokens = await getOwnedSelectedTokenIds();
  if (!opts.hidden && targetTokens.length === 0) {
    shakeButtonWithReason(btnSelf, "请先选中角色");
    return;
  }
  if (opts.hidden && targetTokens.length === 0) {
    targetTokens = [""]; // empty itemId → effect-page anchors at viewport center
  }

  // Save expression for "上一次" BEFORE clearing the input.
  lastRolledExpression = expr;
  saveLastExpr(expr);
  btnLastRoll.disabled = false;

  // Camera focus BEFORE broadcasting. Filter out the empty-string
  // entry that signals dark-roll-with-no-selection (those have no
  // token to focus on). Only the roller's own client moves.
  const focusIds = targetTokens.filter((id) => id);
  if (focusIds.length) focusCameraOnTokens(focusIds);

  // One broadcast per target token. Each gets its own roll values
  // (independent dice) — important so each token's dice are
  // unique to it, not shared. All emitted broadcasts share a single
  // collectiveId so history can group them as one entry and the
  // click-to-replay overlay can find every member of the group.
  const collectiveId = `col-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  let sent = 0;
  for (const tokenId of targetTokens) {
    const built = buildOneRollDice(parsed);
    if (!built.dice.length) continue;
    await emitOneRoll({
      dice: built.dice,
      winnerIdx: built.winnerIdx,
      modifier: totalModifier(parsed),
      label,
      itemId: tokenId || null,
      hidden: opts.hidden,
      rowStarts: built.rowStarts,
      sameHighlight: built.sameHighlight,
      collectiveId,
    });
    sent++;
  }

  if (sent > 0) {
    setLocked(true);
    if (animationTimer !== null) clearTimeout(animationTimer);
    animationTimer = window.setTimeout(() => {
      setLocked(false);
      animationTimer = null;
    }, ANIM_FALLBACK_MS);
  }

  // Clear the expression + label so the next roll starts fresh
  // (per spec). The "上一次" button gets the saved expr back if needed.
  setExpression("");
  labelText = "";
  labelInput.value = "";
}

// Combos tab roll. Same flow as performRoll — the panel just builds
// dice + broadcasts. The button passed in receives the failure shake
// so feedback stays attached to the actual click target.
async function rollFromCombo(expr: string, label: string, hidden: boolean = false, sourceBtn?: HTMLButtonElement): Promise<void> {
  const btnSelf = sourceBtn ?? btnRoll;
  if (isAnimating) {
    shakeButtonWithReason(btnSelf, "动画进行中…");
    return;
  }
  const parsed = parseExpr(expr);
  if (exprIsEmpty(parsed)) {
    shakeButtonWithReason(btnSelf, "表达式无法解析");
    return;
  }

  let targetTokens = await getOwnedSelectedTokenIds();
  if (!hidden && targetTokens.length === 0) {
    shakeButtonWithReason(btnSelf, "请先选中角色");
    return;
  }
  // Dark roll: tokens optional — DM can dark-roll a combo with no
  // selection (anchored at viewport center on their client only).
  if (hidden && targetTokens.length === 0) {
    targetTokens = [""];
  }

  lastRolledExpression = expr;
  saveLastExpr(expr);
  btnLastRoll.disabled = false;

  // Camera focus BEFORE broadcasting (skip when there's no real token
  // for dark-roll-with-no-selection).
  const focusIds = targetTokens.filter((id) => id);
  if (focusIds.length) focusCameraOnTokens(focusIds);

  const collectiveId = `col-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  let sent = 0;
  for (const tokenId of targetTokens) {
    const built = buildOneRollDice(parsed);
    if (!built.dice.length) continue;
    await emitOneRoll({
      dice: built.dice,
      winnerIdx: built.winnerIdx,
      modifier: totalModifier(parsed),
      label,
      itemId: tokenId || null,
      hidden,
      rowStarts: built.rowStarts,
      sameHighlight: built.sameHighlight,
      collectiveId,
    });
    sent++;
  }

  if (sent > 0) {
    setLocked(true);
    if (animationTimer !== null) clearTimeout(animationTimer);
    animationTimer = window.setTimeout(() => {
      setLocked(false);
      animationTimer = null;
    }, ANIM_FALLBACK_MS);
  }
}

function saveCurrentCombo() {
  const parsed = parseExpr(expression);
  if (exprIsEmpty(parsed)) return;
  const promptName = labelText.trim() || formatExpr(parsed);
  const name = window.prompt("组合名称：", promptName);
  if (!name) return;
  const combo: SavedCombo = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: name.trim().slice(0, 40),
    expr: expression,
  };
  combos.unshift(combo);
  saveCombos();
  switchTab("combos");
}

function clearAll() {
  setExpression("");
  labelText = "";
  labelInput.value = "";
}

// --- Wire events ---

// Dice buttons on the row (excluding the d20-box's children which are
// also .dice-btn but already rendered in HTML).
diceRow.querySelectorAll<HTMLButtonElement>(".dice-btn[data-type]").forEach((b) => {
  const type = b.dataset.type as DiceType;
  b.addEventListener("click", () => adjustExprForType(type, +1));
  b.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    adjustExprForType(type, -1);
  });
});

// Adv / Dis: WRAP every dice term currently in the expression with
// adv(...) / dis(...). Empty input → defaults to adv(1d20) / dis(1d20).
// Wrapping is per-segment so `1d20+1d6` becomes `adv(1d20)+adv(1d6)`,
// each die getting its own independent advantage. Already-wrapped
// segments get their adv/dis kind toggled (adv→dis, dis→adv) instead
// of double-wrapping. Other wrappers (max/min/reset/same/burst) are
// preserved underneath the new adv/dis.
function applyAdvWrap(kind: "adv" | "dis") {
  const parsed = parseExpr(expression);
  if (exprIsEmpty(parsed)) {
    setExpression(`${kind}(1d20)`);
    return;
  }
  const next: ParsedSegment[] = [];
  // Each existing segment: replace any outermost adv/dis with the new
  // kind (or push a fresh one if none).
  for (const seg of parsed.segments) {
    const ws = [...seg.wrappers];
    const advIdx = ws.length - 1 - [...ws].reverse().findIndex(
      (w) => w.kind === "adv" || w.kind === "dis",
    );
    if (advIdx >= 0 && advIdx < ws.length) {
      ws[advIdx] = { kind, param: ws[advIdx].param ?? 1 };
    } else {
      ws.push({ kind, param: 1 });
    }
    next.push({ plain: seg.plain, wrappers: ws });
  }
  // outerPlain dice → wrap as a NEW segment under the chosen kind.
  // outerPlain modifier stays outside (modifiers don't get advantage).
  const outerHasDice = parsed.outerPlain.groups.length > 0;
  let newOuter: PlainExpr = { groups: [], modifier: parsed.outerPlain.modifier };
  if (outerHasDice) {
    next.push({
      plain: { groups: parsed.outerPlain.groups, modifier: 0 },
      wrappers: [{ kind, param: 1 }],
    });
  }
  setExpression(
    formatExpr(finalizeParse({ segments: next, outerPlain: newOuter })),
  );
}

btnAdv.addEventListener("click", () => applyAdvWrap("adv"));
btnDis.addEventListener("click", () => applyAdvWrap("dis"));

// ± buttons next to the expression input. Bumps the flat modifier
// by 1 so the user can dial in attack/save/skill bonuses without
// retyping the whole expression.
document.getElementById("btnModInc")?.addEventListener("click", () => {
  adjustExprModifier(+1);
  exprInput.focus();
});
document.getElementById("btnModDec")?.addEventListener("click", () => {
  adjustExprModifier(-1);
  exprInput.focus();
});

exprInput.addEventListener("input", () => {
  expression = exprInput.value;
  refreshBadges();
});

// Enter to roll (no Shift required — single-line input).
// Auto-close `(` with `)` and place the caret between them so the
// player can keep typing the inner expression. Half-width and full-
// width parens are both handled.
exprInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    performRoll({ hidden: false });
    return;
  }
  if (e.key === "(" || e.key === "（") {
    e.preventDefault();
    const start = exprInput.selectionStart ?? exprInput.value.length;
    const end = exprInput.selectionEnd ?? start;
    const v = exprInput.value;
    const insertOpen = e.key === "（" ? "(" : "(";
    exprInput.value = v.slice(0, start) + insertOpen + ")" + v.slice(end);
    const caret = start + 1;
    exprInput.setSelectionRange(caret, caret);
    expression = exprInput.value;
    refreshBadges();
    return;
  }
  if (e.key === ")" || e.key === "）") {
    // If the next char is already ")", just step over it (don't double-
    // insert) — feels natural after auto-close.
    const start = exprInput.selectionStart ?? 0;
    const end = exprInput.selectionEnd ?? start;
    if (start === end && exprInput.value[start] === ")") {
      e.preventDefault();
      exprInput.setSelectionRange(start + 1, start + 1);
    }
  }
});
labelInput.addEventListener("input", () => {
  labelText = labelInput.value;
});

// Roll button.
btnRoll.addEventListener("click", () => {
  performRoll({ hidden: false });
});

// Dark-roll button (DM-only — visibility wired up in OBR.onReady).
const btnDarkRoll = document.getElementById("btnDarkRoll") as HTMLButtonElement | null;
btnDarkRoll?.addEventListener("click", () => {
  performRoll({ hidden: true });
});

// 上一次: refill expression with the last successfully-rolled expr.
// Does NOT auto-roll — user must click 投掷.
btnLastRoll.addEventListener("click", () => {
  if (!lastRolledExpression) return;
  setExpression(lastRolledExpression);
});
btnLastRoll.disabled = !lastRolledExpression;

btnSave.addEventListener("click", () => saveCurrentCombo());
btnClear.addEventListener("click", () => clearAll());
btnForceClr.addEventListener("click", () => forceClear());

// Quick-fill example buttons under the rules-hint. Each carries
// `data-expr` with a ready-made expression — clicking drops it into
// the input so players can try things without memorising syntax.
document.querySelectorAll<HTMLButtonElement>("#examplesRow .example-btn").forEach((b) => {
  b.addEventListener("click", () => {
    const expr = b.dataset.expr ?? "";
    if (!expr) return;
    setExpression(expr);
    exprInput.focus();
  });
});

btnClearHist.addEventListener("click", () => {
  if (!confirm("清空所有掷骰历史？")) return;
  history = [];
  saveHistory();
  renderHistorySeg();
  renderHistoryList();
});

tabBtns.forEach((b) => {
  b.addEventListener("click", () => switchTab(b.dataset.tab as typeof activeTab));
});

// --- Live history + lock-release subscriptions ---

OBR.onReady(async () => {
  // The dice panel is the iframe the user clicks "投掷" in — its
  // AudioContext warms up immediately and is the most reliable path
  // for SFX broadcast playback.
  subscribeToSfx();

  // Resolve role + show / hide the 暗骰 (dark roll) button. Only DMs
  // see it. (OBR.player.onChange would also re-resolve if the role
  // ever flipped at runtime, but in practice it doesn't.)
  try {
    const role = await OBR.player.getRole();
    isDM = role === "GM";
  } catch {}
  const btnDark = document.getElementById("btnDarkRoll") as HTMLButtonElement | null;
  if (btnDark) btnDark.style.display = isDM ? "" : "none";
  // Re-render combos so the per-card 暗骰 button shows up for DM
  // (initial paint ran before isDM was resolved).
  renderCombos();

  OBR.broadcast.onMessage(BROADCAST_DICE_ROLL, (event) => {
    const data = event.data as DiceRollPayload | undefined;
    if (!data || !Array.isArray(data.dice) || !data.rollId) return;
    // History also records hidden dark rolls (only the DM client
    // receives those, so only the DM sees them in history — players
    // see normal rolls only).
    history.unshift(data);
    if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
    saveHistory();
    if (activeTab === "history") {
      renderHistorySeg();
      renderHistoryList();
    }
  });

  // Right-click "添加到骰盘" — pre-fill the expression input. We don't
  // auto-roll; the user reviews and clicks 投掷.
  OBR.broadcast.onMessage("com.obr-suite/dice-panel-fill", (event) => {
    const data = event.data as { expression?: string } | undefined;
    if (!data || typeof data.expression !== "string") return;
    setExpression(data.expression);
    switchTab("roll");
    setTimeout(() => exprInput.focus(), 50);
    // Consume the localStorage fallback if the live broadcast got
    // there first — keeps re-opens of the panel from re-applying it.
    try { localStorage.removeItem("obr-suite/dice-pending-prefill"); } catch {}
  });

  OBR.broadcast.onMessage(BC_DICE_FADE_START, (event) => {
    const data = event.data as { rollId?: string } | undefined;
    // Only react to climaxes of rolls the PANEL itself spawned. Other
    // sources (initiative, future modules) carry their own rollIds and
    // shouldn't prematurely release the panel's lock.
    if (!data?.rollId || !myActiveRollIds.has(data.rollId)) return;
    myActiveRollIds.delete(data.rollId);
    if (animationTimer !== null) {
      clearTimeout(animationTimer);
      animationTimer = null;
    }
    setLocked(false);
  });

  // Listen for the bottom-left history popover's row-click events.
  // The popover sends { playerName } — we switch to History tab and
  // pre-select that player as the segmented filter.
  OBR.broadcast.onMessage(BC_DICE_HISTORY_FILTER, (event) => {
    const data = event.data as { playerName?: string } | undefined;
    if (!data || typeof data.playerName !== "string") return;
    historyFilter = data.playerName;
    switchTab("history");
  });
});

// --- Initial paint ---

renderCombos();
renderHistorySeg();
renderHistoryList();
refreshBadges();

// Pick up a pending prefill written by the bg module just before
// `OBR.action.open()`. Covers the cold-start case where the broadcast
// from "添加到骰盘" raced ahead of this iframe's listener registration.
try {
  const pending = localStorage.getItem("obr-suite/dice-pending-prefill");
  if (pending) {
    setExpression(pending);
    switchTab("roll");
    localStorage.removeItem("obr-suite/dice-pending-prefill");
    setTimeout(() => exprInput.focus(), 50);
  }
} catch {}

setInterval(() => {
  if (activeTab === "history") renderHistoryList();
}, 30_000);
