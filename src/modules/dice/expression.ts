import {type DiceType,type DieResult,sidesOf} from "./types";
import {distributeFaces,faceBounds,randIntInclusive,type DieSpec} from "./fixed-roll";
export interface ExprGroup { type: string; count: number }
export interface PlainExpr { groups: ExprGroup[]; modifier: number }
export type WrapperKind = "adv" | "dis" | "max" | "min" | "reset" | "resetmin" | "resetmax" | "same" | "burst" | "repeat";
export interface Wrapper {
  kind: WrapperKind;
  // adv/dis: extra sets (N from "adv(...,N)"); default 1.
  // max/min/reset/resetmin/resetmax: the threshold/replacement value.
  //   reset(d, X)    — TRIGGERED reroll when value EQUALS X.
  //   resetmin(d, X) — TRIGGERED reroll when value <= X.
  //   resetmax(d, X) — TRIGGERED reroll when value >= X.
  // repeat: iteration count.
  // same/burst: undefined.
  param?: number;
}
// One independently-wrapped sub-expression. `adv(1d6)+adv(1d4)` parses
// to TWO segments — {plain:[d6], wrappers:[adv]} and {plain:[d4],
// wrappers:[adv]} — so each adv runs on its own dice instead of both
// d6 and d4 getting twin-rolled together.
export interface ParsedSegment {
  plain: PlainExpr;
  wrappers: Wrapper[]; // innermost-first
}
export interface ParsedExpr {
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

export function normalizeExpr(s: string): string {
  return s
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[，]/g, ",")
    .replace(/\s+/g, "");
}

export function parsePlain(s: string): PlainExpr {
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
  // Drop zero-count groups but PRESERVE negative-count ones — they
  // represent subtraction dice (e.g. `1d20-1d6` keeps `{type:"d6",
  // count:-1}` so rollPlainSet can roll it and stamp `subtract:true`
  // on each die. Removed-from-total dice are still rolled + animated
  // for the visual.
  return { groups: groups.filter((g) => g.count !== 0), modifier };
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
  const m = /^(adv|dis|max|min|resetmin|resetmax|reset|same|burst|repeat)\(/i.exec(s);
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
  } else if (
    fnName === "max" || fnName === "min" ||
    fnName === "reset" || fnName === "resetmin" || fnName === "resetmax"
  ) {
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
  const fnRe = /(adv|dis|max|min|resetmin|resetmax|reset|same|burst|repeat)\(/i;
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
  } else if (
    fnName === "max" || fnName === "min" ||
    fnName === "reset" || fnName === "resetmin" || fnName === "resetmax"
  ) {
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
    const wrapperRe = /(adv|dis|max|min|resetmin|resetmax|reset|same|burst|repeat)\(/i;
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
export function parseExpr(raw: string): ParsedExpr {
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
export function finalizeParse(p: {
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

export function rollPlainSet(plain: PlainExpr): DieResult[] {
  const dice: DieResult[] = [];
  for (const g of plain.groups) {
    // Negative-count groups represent SUBTRACTION dice (1d20-1d6 →
    // group {d6, count:-1}). Roll the same number of physical dice
    // but mark each as `subtract:true` so totals subtract the value
    // and the visual renders them at lower opacity.
    const isSubtract = g.count < 0;
    const n = Math.abs(g.count);
    for (let i = 0; i < n; i++) {
      const die: DieResult = { type: g.type as DiceType, value: rollDieType(g.type) };
      if (isSubtract) die.subtract = true;
      dice.push(die);
    }
  }
  return dice;
}

export function formatPlain(p: PlainExpr): string {
  // 2026-05-10: stitch with separate `+`/`-` separators so negative
  // counts render as `... - 1d4` instead of `... + -1d4`. First term
  // keeps its native sign (`-1d4` if it leads, `1d20` otherwise).
  let s = "";
  p.groups.forEach((g, i) => {
    if (i === 0) {
      s = `${g.count}${g.type}`;
    } else if (g.count < 0) {
      s += ` - ${Math.abs(g.count)}${g.type}`;
    } else {
      s += ` + ${g.count}${g.type}`;
    }
  });
  if (p.modifier > 0) s += `${s ? " + " : ""}${p.modifier}`;
  else if (p.modifier < 0) s += `${s ? " " : ""}${p.modifier}`;
  return s || "—";
}

export function formatSegment(seg: ParsedSegment): string {
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
      case "resetmin":
      case "resetmax":
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
export function formatExpr(p: ParsedExpr): string {
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

// Apply max/min/reset/resetmin/resetmax to a single die value. Stamps
// originalValue if the value actually changed so the visual can
// render "new(orig)".
//
// Semantics:
//   max(d, X)       — value bumped UP to at least X (floor)
//   min(d, X)       — value capped DOWN to at most X (ceiling)
//   reset(d, X)     — TRIGGERED reroll: if rolled value EQUALS X,
//                      reroll once and use the reroll.
//   resetmin(d, X)  — TRIGGERED reroll: if rolled value <= X,
//                      reroll once and use the reroll.
//   resetmax(d, X)  — TRIGGERED reroll: if rolled value >= X,
//                      reroll once and use the reroll.
function applyValueClamp(
  d: DieResult,
  kind: "max" | "min" | "reset" | "resetmin" | "resetmax",
  X: number,
): DieResult {
  if (d.loser) return d;     // discarded set is preserved as-rolled
  if (kind === "reset" || kind === "resetmin" || kind === "resetmax") {
    const triggers =
      kind === "reset" ? d.value === X :
      kind === "resetmin" ? d.value <= X :
      d.value >= X;
    if (!triggers) return d;
    const sides = sidesOf(d.type);
    const newVal = Math.floor(Math.random() * sides) + 1;
    if (newVal === d.value) return d;
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
export function rollExpr(plain: PlainExpr, wrappers: Wrapper[]): { dice: DieResult[]; winnerIdx: number } {
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

  if (
    outer.kind === "max" || outer.kind === "min" ||
    outer.kind === "reset" || outer.kind === "resetmin" || outer.kind === "resetmax"
  ) {
    const X = outer.param ?? 1;
    dice = dice.map((d) =>
      applyValueClamp(d, outer.kind as "max" | "min" | "reset" | "resetmin" | "resetmax", X),
    );
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


export function totalModifier(p: ParsedExpr): number {
  let m = p.outerPlain.modifier;
  for (const seg of p.segments) m += seg.plain.modifier;
  return m;
}

export function exprIsEmpty(p: ParsedExpr): boolean {
  if (p.outerPlain.groups.length || p.outerPlain.modifier !== 0) return false;
  for (const seg of p.segments) {
    if (seg.plain.groups.length || seg.plain.modifier !== 0) return false;
  }
  return true;
}


export interface BuiltRoll {
  dice: DieResult[];
  winnerIdx: number;
  rowStarts?: number[];  // repeat: row[i] spans [rowStarts[i], rowStarts[i+1] || dice.length)
  sameHighlight?: boolean;
}
export function buildOneRollDice(parsed: ParsedExpr): BuiltRoll {
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

// ---- §9 (2026-08-21): DM fixed-result building (panel grammar) -----
//
// Produces REAL die faces whose kept sum + modifier equals the target.
// Supported: plain sums (subtraction dice included), max/min clamps,
// reset/resetmin/resetmax (a triggered reroll can land on any face, so
// every final face is reachable), same (visual-only), repeat (grand
// total = faces + modifier × rows), and ONE outermost adv/dis per
// segment — losing sets get real faces constrained to the losing side
// of rollExpr's raw-sum comparison, so replaying the comparison yields
// the same winner. Refused: burst (faces are structurally coupled to
// spawned child dice) and nested / non-outermost adv-dis. A refusal
// falls back to a true random roll with a WARNING; the fix stays armed.

type FixedBuild =
  | { ok: BuiltRoll }
  | { err: "unsupported" }
  | { err: "bounds"; min: number; max: number };

// Final-face range of one die after its value-wrapper chain, applied
// in rollExpr order (array order = innermost first). Returns null for
// unsupported wrappers or clamp params outside the die's face range
// (e.g. max(1d6,10) — the broadcast layer would re-clamp such faces
// and break consistency, so we refuse instead).
function clampRangeForWrappers(
  sides: number,
  wrappers: Wrapper[],
): { lo: number; hi: number } | null {
  let lo = 1;
  let hi = sides;
  for (const w of wrappers) {
    switch (w.kind) {
      case "max": {
        const X = w.param ?? 1;
        if (X < 1 || X > sides) return null;
        lo = Math.max(lo, X);
        hi = Math.max(hi, X);
        break;
      }
      case "min": {
        const X = w.param ?? 1;
        if (X < 1 || X > sides) return null;
        lo = Math.min(lo, X);
        hi = Math.min(hi, X);
        break;
      }
      case "reset":
      case "resetmin":
      case "resetmax":
        lo = 1;
        hi = sides;
        break;
      case "same":
        break;
      default:
        return null;
    }
  }
  return { lo, hi };
}

export function buildFixedRollDice(parsed: ParsedExpr, target: number): FixedBuild {
  if (!Number.isInteger(target)) return { err: "unsupported" };
  const sameHighlight = parsed.segments.some((s) =>
    s.wrappers.some((w) => w.kind === "same"),
  );

  // Kept dice accumulate here in creation order; faces are assigned in
  // one distributeFaces pass, then loser sets are generated against
  // the now-known kept sums.
  const keptSpecs: DieSpec[] = [];
  const keptDice: DieResult[] = [];

  const addPlainKept = (
    plain: PlainExpr,
    valueWrappers: Wrapper[],
    into: DieResult[],
  ): boolean => {
    for (const g of plain.groups) {
      const sides = sidesOf(g.type);
      const range = clampRangeForWrappers(sides, valueWrappers);
      if (!range) return false;
      const subtract = g.count < 0;
      const n = Math.abs(g.count);
      for (let i = 0; i < n; i++) {
        const d: DieResult = { type: g.type as DiceType, value: 0 };
        if (subtract) d.subtract = true;
        keptSpecs.push({ sides, lo: range.lo, hi: range.hi, subtract });
        keptDice.push(d);
        into.push(d);
      }
    }
    return true;
  };

  const repeatSegIdx = parsed.segments.findIndex((s) =>
    s.wrappers.some((w) => w.kind === "repeat"),
  );
  const outerHasDice = parsed.outerPlain.groups.some((g) => g.count !== 0);

  // --- repeat path (mirrors buildOneRollDice's支持范围) ---
  if (repeatSegIdx >= 0) {
    if (parsed.segments.length !== 1 || outerHasDice) return { err: "unsupported" };
    const seg = parsed.segments[0];
    const inner = seg.wrappers.filter((w) => w.kind !== "same" && w.kind !== "repeat");
    if (inner.some((w) => w.kind === "adv" || w.kind === "dis" || w.kind === "burst")) {
      return { err: "unsupported" };
    }
    const repeatW = seg.wrappers.find((w) => w.kind === "repeat")!;
    const N = Math.max(1, repeatW.param ?? 1);
    const all: DieResult[] = [];
    const rowStarts: number[] = [];
    for (let i = 0; i < N; i++) {
      rowStarts.push(all.length);
      if (!addPlainKept(seg.plain, inner, all)) return { err: "unsupported" };
    }
    if (!keptDice.length) return { err: "unsupported" };
    const mod = totalModifier(parsed) * N;
    const faces = distributeFaces(keptSpecs, target - mod);
    if (!faces) {
      const { low, high } = faceBounds(keptSpecs);
      return { err: "bounds", min: low + mod, max: high + mod };
    }
    faces.forEach((f, i) => { keptDice[i].value = f; });
    return { ok: { dice: all, winnerIdx: -1, rowStarts, sameHighlight } };
  }

  // --- segments + outer plain ---
  interface SegPlan {
    keptSet: DieResult[];
    keptStart: number;
    kind: "adv" | "dis" | null;
    loserSets: Array<{ dice: DieResult[]; specs: DieSpec[] }>;
  }
  const plans: SegPlan[] = [];
  for (const seg of parsed.segments) {
    const wr = seg.wrappers.filter((w) => w.kind !== "same" && w.kind !== "repeat");
    if (wr.some((w) => w.kind === "burst")) return { err: "unsupported" };
    const advPositions: number[] = [];
    wr.forEach((w, i) => {
      if (w.kind === "adv" || w.kind === "dis") advPositions.push(i);
    });
    if (advPositions.length > 1) return { err: "unsupported" };
    if (advPositions.length === 1 && advPositions[0] !== wr.length - 1) {
      return { err: "unsupported" };
    }

    if (advPositions.length === 0) {
      const keptSet: DieResult[] = [];
      const keptStart = keptDice.length;
      if (!addPlainKept(seg.plain, wr, keptSet)) return { err: "unsupported" };
      plans.push({ keptSet, keptStart, kind: null, loserSets: [] });
      continue;
    }

    const advW = wr[wr.length - 1];
    const inner = wr.slice(0, -1);
    const keptSet: DieResult[] = [];
    const keptStart = keptDice.length;
    if (!addPlainKept(seg.plain, inner, keptSet)) return { err: "unsupported" };
    const loserSets: Array<{ dice: DieResult[]; specs: DieSpec[] }> = [];
    const extraSets = Math.max(1, advW.param ?? 1);
    for (let s = 0; s < extraSets; s++) {
      // Loser faces are RAW: rollExpr compares sets by raw value sum
      // (subtract flags don't negate there) and applyValueClamp skips
      // loser-marked dice, so their reachable range is [1, sides].
      const dice: DieResult[] = [];
      const specs: DieSpec[] = [];
      for (const g of seg.plain.groups) {
        const sides = sidesOf(g.type);
        const subtract = g.count < 0;
        const n = Math.abs(g.count);
        for (let i = 0; i < n; i++) {
          const d: DieResult = { type: g.type as DiceType, value: 0, loser: true };
          if (subtract) d.subtract = true;
          dice.push(d);
          specs.push({ sides, lo: 1, hi: sides });
        }
      }
      loserSets.push({ dice, specs });
    }
    plans.push({ keptSet, keptStart, kind: advW.kind as "adv" | "dis", loserSets });
  }

  const outerChunk: DieResult[] = [];
  if (!addPlainKept(parsed.outerPlain, [], outerChunk)) return { err: "unsupported" };
  if (!keptDice.length) return { err: "unsupported" };

  // Assign every kept face in one pass.
  const mod = totalModifier(parsed);
  const faces = distributeFaces(keptSpecs, target - mod);
  if (!faces) {
    const { low, high } = faceBounds(keptSpecs);
    return { err: "bounds", min: low + mod, max: high + mod };
  }
  faces.forEach((f, i) => { keptDice[i].value = f; });

  // Generate loser sets + assemble chunks. The kept set lands at a
  // random position among its sets; sets BEFORE it must be STRICTLY
  // worse (rollExpr's scan keeps the first max/min, so an earlier tie
  // would steal the win), sets after it may tie.
  const allDice: DieResult[] = [];
  let winnerIdx = -1;
  for (const plan of plans) {
    if (!plan.kind) {
      for (const d of plan.keptSet) allDice.push(d);
      continue;
    }
    const keptRaw = plan.keptSet.reduce((a, d) => a + d.value, 0);
    const setsCount = plan.loserSets.length + 1;
    let pos = Math.floor(Math.random() * setsCount);
    // Strict feasibility for sets placed before the kept one.
    const rawLo = plan.loserSets[0]?.specs.reduce((a, s) => a + s.lo, 0) ?? 0;
    const rawHi = plan.loserSets[0]?.specs.reduce((a, s) => a + s.hi, 0) ?? 0;
    if (plan.kind === "adv" && keptRaw - 1 < rawLo) pos = 0;
    if (plan.kind === "dis" && keptRaw + 1 > rawHi) pos = 0;

    const segStartInAll = allDice.length;
    let keptStartInAll = -1;
    let loserPtr = 0;
    for (let s = 0; s < setsCount; s++) {
      if (s === pos) {
        keptStartInAll = allDice.length;
        for (const d of plan.keptSet) allDice.push(d);
        continue;
      }
      const ls = plan.loserSets[loserPtr++];
      const strict = s < pos;
      let lo = rawLo;
      let hi = rawHi;
      if (plan.kind === "adv") hi = Math.min(hi, keptRaw - (strict ? 1 : 0));
      else lo = Math.max(lo, keptRaw + (strict ? 1 : 0));
      if (hi < lo) return { err: "unsupported" };
      const sum = randIntInclusive(lo, hi);
      const lfaces = distributeFaces(ls.specs, sum);
      if (!lfaces) return { err: "unsupported" };
      lfaces.forEach((f, i) => { ls.dice[i].value = f; });
      for (const d of ls.dice) allDice.push(d);
    }
    // rollExpr reports winnerIdx only for single-die winning sets, and
    // buildOneRollDice surfaces it only for a lone segment without
    // outer dice — mirror both conditions.
    if (
      plan.keptSet.length === 1 &&
      parsed.segments.length === 1 &&
      outerChunk.length === 0 &&
      segStartInAll === 0
    ) {
      winnerIdx = keptStartInAll;
    }
  }
  for (const d of outerChunk) allDice.push(d);
  return { ok: { dice: allDice, winnerIdx, sameHighlight } };
}

