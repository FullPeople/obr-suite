// 5etools-style inline tag → clickable rollable HTML.
//
// 5etools' Chinese mirror (5e.kiwee.top) embeds dice rolls inside text
// using the original 5etools shape: {@tag arg1|arg2|...}. We render
// the display portion with a clickable span that fires a quick roll
// when clicked, and strip cosmetic tags that aren't dice.
//
// Supported roll-producing tags:
//   {@dice 1d6+5}                     → roll 1d6+5
//   {@dice 1d6+5|+5 to hit}           → display "+5 to hit", roll 1d6+5
//   {@damage 2d6+3}                   → roll 2d6+3, label "伤害"
//   {@damage 2d6+3|fire}              → display "2d6+3 fire", label "fire"
//   {@hit 5}                          → roll 1d20+5, label "命中"
//   {@d20 5}                          → roll 1d20+5
//   {@chance 50}                      → roll 1d100, label "几率(50%)"
//   {@scaledice 1d8|3-9|1d8}          → just shows 1d8 — first arg is the rollable
//
// Tags WITHOUT roll semantics get their display portion rendered
// inline (current 5etools convention is "first | piece is display").

import OBR from "@owlbear-rodeo/sdk";
import { getLocalLang } from "../../state";

const BC_QUICK_ROLL = "com.obr-suite/dice-quick-roll";

// 2026-05-10: tag-handler outputs (e.g. {@h}, {@atk}, {@actSave}) are
// language-aware. Foreign players using the kiwee Chinese mirror were
// seeing labels like "近战攻击" / "命中：" / "体" hardcoded in the
// stat block; the actual entry prose is still data-source-driven (so
// it stays Chinese on kiwee), but at least the FRAMING is now in the
// player's language. Read at parse time so a mid-session lang flip
// reflects on the next render. Returned values are unicode-safe.
type Lang = "zh" | "en";
function curLang(): Lang {
  try {
    const v = getLocalLang();
    return v === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

const ATK_LABELS_ZH: Record<string, string> = {
  mw: "近战武器攻击",
  rw: "远程武器攻击",
  ms: "近战法术攻击",
  rs: "远程法术攻击",
  m: "近战攻击",
  r: "远程攻击",
};
const ATK_LABELS_EN: Record<string, string> = {
  mw: "Melee Weapon Attack",
  rw: "Ranged Weapon Attack",
  ms: "Melee Spell Attack",
  rs: "Ranged Spell Attack",
  m: "Melee Attack",
  r: "Ranged Attack",
};
const ABILITY_FULL_ZH: Record<string, string> = {
  str: "力量", dex: "敏捷", con: "体质", int: "智力", wis: "感知", cha: "魅力",
};
const ABILITY_FULL_EN: Record<string, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};
const ABILITY_ABBR_EN: Record<string, string> = {
  str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha",
};

export interface QuickRollRequest {
  expression: string;
  label?: string;
  itemId?: string | null;
  hidden?: boolean;
  focus?: boolean;
  collectiveId?: string;
  // Right-click "优势 / 劣势" — every d20 in the parsed expression
  // rolls twice; loser is flagged. Other dice unaffected.
  advMode?: "adv" | "dis";
  // Right-click "重击" — double every dice term's count.
  critMode?: boolean;
}

export function fireQuickRoll(req: QuickRollRequest): void {
  // LOCAL ONLY — only the clicker's own background module rolls.
  // It then calls broadcastDiceRoll which fans out the actual dice
  // values + visual to every client (LOCAL + REMOTE). Sending
  // BC_QUICK_ROLL to remote would cause every receiving client to
  // ALSO roll independently → N parallel rolls + N history entries
  // (the bug the user hit).
  OBR.broadcast.sendMessage(BC_QUICK_ROLL, req, { destination: "LOCAL" }).catch(() => {});
}

// Resolve the token to anchor a quick-roll on. Tries:
//   1. Selected token (if exactly one is selected)
//   2. Player auto-fallback: only-owned visible character token
//   3. null (no anchor → effect modal centers on viewport)
// Used by search / bestiary / cc-info click handlers so they all
// share the same "what token does this roll belong to" logic.
export async function resolveClickRollTarget(): Promise<string | null> {
  try {
    const sel = await OBR.player.getSelection();
    if (sel && sel.length === 1) return sel[0];
  } catch {}
  try {
    const role = await OBR.player.getRole();
    if (role !== "GM") {
      const myId = await OBR.player.getId();
      const owned = await OBR.scene.items.getItems(
        (it: any) =>
          it.type === "IMAGE" &&
          (it.layer === "CHARACTER" || it.layer === "MOUNT") &&
          it.visible &&
          it.createdUserId === myId,
      );
      if (owned.length === 1) return owned[0].id;
    }
  } catch {}
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

interface RollSpec {
  expression: string;
  label?: string;
  display: string;
}

// Parse the inside of a {@tag ...} payload. Returns either:
//   - { kind: "roll", ... } if the tag produces a dice roll
//   - { kind: "text", display } if it's a cosmetic tag (just text)
//
// Default cosmetic display follows the 5etools `name|source|display`
// convention: parts[0] is the canonical display, parts[2] is an
// explicit override when present. parts[1] is the SOURCE code (XPHB,
// MM, etc.) and must never leak into the visible text — that was the
// "陷入XPHB状态" / "随意XPHB、XPHB" bug.
function parseTagPayload(tag: string, payload: string):
  | { kind: "roll"; spec: RollSpec }
  | { kind: "text"; display: string } {
  const parts = payload.split("|");
  const arg = parts[0] ?? "";
  const cosmeticDisplay = (parts[2] && parts[2].trim()) || parts[0] || "";

  switch (tag) {
    case "dice":
    case "damage": {
      // arg is the dice expression. display = arg unless overridden.
      return {
        kind: "roll",
        spec: {
          expression: arg.trim(),
          label: tag === "damage" ? "伤害" : "",
          display: parts[1] ?? arg,
        },
      };
    }
    case "hit": {
      // arg is a signed bonus (e.g. "5", "+5", "-2"). Roll d20+bonus.
      const n = parseInt(arg, 10);
      const bonus = Number.isFinite(n) ? n : 0;
      const expr = `1d20${bonus >= 0 ? `+${bonus}` : `${bonus}`}`;
      return {
        kind: "roll",
        spec: {
          expression: expr,
          label: "命中",
          display: bonus >= 0 ? `+${bonus}` : `${bonus}`,
        },
      };
    }
    case "d20": {
      const n = parseInt(arg, 10);
      const bonus = Number.isFinite(n) ? n : 0;
      const expr = `1d20${bonus >= 0 ? `+${bonus}` : `${bonus}`}`;
      return {
        kind: "roll",
        spec: {
          expression: expr,
          label: "",
          display: parts[1] ?? (bonus >= 0 ? `+${bonus}` : `${bonus}`),
        },
      };
    }
    case "chance": {
      const pct = parseInt(arg, 10);
      return {
        kind: "roll",
        spec: {
          expression: "1d100",
          label: `几率 ${Number.isFinite(pct) ? pct : "?"}%`,
          display: parts[1] ?? `${arg}%`,
        },
      };
    }
    case "scaledice":
    case "scaledamage": {
      // {@scaledice base|levels|scale[|displayName]}  e.g.
      //   {@scaledamage 8d6|3-9|1d6}  → fireball: per-level +1d6
      //   {@scaledice 1d8|1-9|1d8}    → cure wounds: per-level +1d8
      // The visible text in 5etools is the SCALE (parts[2]) — that's
      // the "per level" increment, NOT the base. Clicking rolls the
      // scale formula (one level's worth of extra dice).
      const scale = (parts[2] ?? "").trim();
      const expr = scale || (parts[0] ?? "").trim();
      return {
        kind: "roll",
        spec: {
          expression: expr,
          label: tag === "scaledamage" ? "升阶伤害" : "升阶",
          display: parts[3] ?? expr,
        },
      };
    }

    // Cosmetic-tag renderers — 5etools data sprinkles these in attack /
    // trait prose. Render to a sensible Chinese inline phrase so the
    // result reads naturally without a full 5etools renderer.
    case "atk": {
      const codes = arg.split(",").map((s) => s.trim().toLowerCase());
      const labels = curLang() === "en" ? ATK_LABELS_EN : ATK_LABELS_ZH;
      const phrase = codes.map((c) => labels[c] ?? c).join("/");
      const sep = curLang() === "en" ? ": " : "：";
      return { kind: "text", display: `*${phrase}${sep}*` };
    }
    case "atkr": {
      // 2024 attack-roll variant. arg is "m"/"r"/"mw"/"rw" etc.
      const codes = arg.split(",").map((s) => s.trim().toLowerCase());
      const labels = curLang() === "en" ? ATK_LABELS_EN : ATK_LABELS_ZH;
      const sep = curLang() === "en" ? ": " : "：";
      return {
        kind: "text",
        display: `*${codes.map((c) => labels[c] ?? c).join("/")}${sep}*`,
      };
    }
    case "h":
      return { kind: "text", display: curLang() === "en" ? "Hit: " : "命中：" };
    case "hom":
      return { kind: "text", display: curLang() === "en" ? "Or Hit: " : "或命中：" };
    case "m":
      return { kind: "text", display: curLang() === "en" ? "Miss: " : "落空：" };
    // Cosmetic tags — fall through to a SHARED return at the end of
    // this group that emits the cosmetic display. Was previously
    // grouped with `actSave` (which I broke 2026-05-10 by giving
    // actSave its own block; everything in this list fell through
    // into that block and rendered as "*<name>豁免：*"). The fix
    // separates them.
    case "creature":
    case "status":
    case "spell":
    case "condition":
    case "skill":
    case "sense":
    case "item":
    case "feat":
    case "race":
    case "class":
    case "background":
    case "deity":
    case "psionic":
    case "object":
    case "trap":
    case "hazard":
    case "boon":
    case "cult":
    case "language":
    case "table":
    case "variantrule":
    case "vehicle":
    case "vehupgrade":
    case "filter":
    case "i":
    case "b":
    case "u":
    case "s":
    case "note":
    case "color":
    case "highlight":
    case "book":
    case "adventure":
    case "homebrew":
    case "5etools":
    case "5etoolsimg":
    case "code":
    case "style":
    case "comic":
    case "comich1":
    case "comich2":
    case "comich3":
    case "comich4":
    case "comicnote":
    case "deck":
    case "card":
    case "loader":
    case "footnote":
    case "link":
      return { kind: "text", display: cosmeticDisplay };
    // NOTE: case labels are matched against `tag.toLowerCase()` (see
    // formatTagsClickable: `m[1].toLowerCase()`), so ALL labels here
    // MUST be lowercase. The original 5etools tags use camelCase
    // (`actSave`, `actTrigger`, etc.) — bug 2026-05-10 was that those
    // labels stayed camelCase and silently fell through to the
    // `default` cosmetic-display branch, so `{@actSave con}` rendered
    // as bare "con" instead of "*体质豁免：*".
    case "actsave": {
      // 2024 attack-save variant. arg is the ability code (con/dex/wis/...).
      // Rendered as bold "Con Save:" / "体质豁免：" so foreign players
      // don't see a bare "con" in the middle of prose.
      const code = arg.trim().toLowerCase();
      if (curLang() === "en") {
        const label = ABILITY_ABBR_EN[code] ?? code.toUpperCase();
        return { kind: "text", display: `*${label} Save: *` };
      }
      const label = ABILITY_FULL_ZH[code] ?? code;
      return { kind: "text", display: `*${label}豁免：*` };
    }
    case "actsavesuccess":
      return {
        kind: "text",
        display: curLang() === "en" ? "*Save Success: *" : "*豁免成功：*",
      };
    case "actsavefail":
      return {
        kind: "text",
        display: curLang() === "en" ? "*Save Fail: *" : "*豁免失败：*",
      };
    case "actsavefailby":
      return {
        kind: "text",
        display: curLang() === "en" ? "*Save Fail By: *" : "*豁免差距：*",
      };
    case "acttrigger":
      return {
        kind: "text",
        display: curLang() === "en" ? "*Trigger: *" : "*触发：*",
      };
    case "actresponse":
      return {
        kind: "text",
        display: curLang() === "en" ? "*Response: *" : "*响应：*",
      };
    case "dc":
      // Difficulty class — render as "DC N" so the number doesn't
      // float bare in prose (was a UX gap for both Chinese and
      // English readers — "{@actSave con} {@dc 19}" used to show as
      // "con 19" / "Con Save: 19" rather than "Con Save (DC 19):").
      return {
        kind: "text",
        display: `DC ${arg.trim()}`,
      };
    case "recharge": {
      // Recharge ability: at the start of each turn, roll 1d6. If the
      // roll is ≥ N, the ability recharges. Make it a clickable d6 so
      // the DM can roll it inline from the stat block.
      const n = parseInt(arg, 10);
      const threshold = Number.isFinite(n) ? Math.max(2, Math.min(6, n)) : 6;
      const en = curLang() === "en";
      return {
        kind: "roll",
        spec: {
          expression: "1d6",
          label: en ? `Recharge ${threshold}+` : `充能 ${threshold}+`,
          display: en ? `(Recharge ${threshold}-6)` : `（充能 ${threshold}-6）`,
        },
      };
    }

    default:
      // Unknown tag — fall back to the cosmetic display rule
      // (parts[2] override, else parts[0] name).
      return { kind: "text", display: cosmeticDisplay };
  }
}

// Escape a string for safe placement in an HTML data-* attribute.
function escapeAttr(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

// Render `s` to HTML, replacing 5etools inline tags. Roll-producing
// tags become `<span class="rollable" data-expr="..." data-label="..."
// title="...">...</span>` clickable spans. The caller binds delegated
// click handlers via `bindRollableClicks(root)`.
//
// 2026-05-10: Markdown-style bold via asterisks is also recognised:
// `*Melee Attack.*` / `*近战攻击。*` → `<b>...</b>`. Applied to plain
// text segments only (between matched tag spans) so tag attributes
// can't be re-interpreted as markdown.
export function formatTagsClickable(s: string): string {
  if (typeof s !== "string") return "";
  // Process the string in two passes so tag arg / display content
  // gets escaped while the wrapping HTML stays raw. The regex also
  // matches payload-less tags like {@h} (no space, no content).
  let out = "";
  let i = 0;
  const re = /\{@(\w+)(?:\s+([^{}]*))?\}/g;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(s)) !== null) {
    out += renderInlineMarkup(s.slice(i, m.index));
    const tag = m[1].toLowerCase();
    const payload = m[2] ?? "";
    const parsed = parseTagPayload(tag, payload);
    if (parsed.kind === "roll" && parsed.spec.expression) {
      const exprAttr = escapeAttr(parsed.spec.expression);
      const labelAttr = escapeAttr(parsed.spec.label ?? "");
      const title = parsed.spec.label
        ? `${parsed.spec.label} ${parsed.spec.expression}`
        : parsed.spec.expression;
      out += `<span class="rollable" data-expr="${exprAttr}" data-label="${labelAttr}" title="${escapeAttr(title)}">${escapeHtml(parsed.spec.display)}</span>`;
    } else {
      // 2026-05-10: also pass tag-display through renderInlineMarkup
      // because some tag handlers ({@atk}, {@atkr}) emit `*phrase：*`
      // strings expecting markdown-bold treatment downstream. Without
      // this hook those asterisks ended up literal in the output.
      const display = parsed.kind === "text" ? parsed.display : parsed.spec.display;
      out += renderInlineMarkup(display);
    }
    i = re.lastIndex;
  }
  out += renderInlineMarkup(s.slice(i));
  return out;
}

// Lightweight markdown processor for plain-text spans inside monster
// stat blocks. Currently supports:
//   - `*bold*` → `<b>bold</b>` (greedy-shortest, not crossing `*` again)
// Escapes HTML in non-bold portions before stitching. Single isolated
// `*` (no closing partner) is left as a literal asterisk.
function renderInlineMarkup(text: string): string {
  if (!text) return "";
  // Matches `*X*` where X is at least one char and contains no `*`.
  // Reluctant `*?` so the SHORTEST closing match wins — `*a* and *b*`
  // emits two bolds rather than one giant `<b>a* and *b</b>`.
  const re = /\*([^*\n]+?)\*/g;
  let out = "";
  let cursor = 0;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(cursor, m.index));
    out += `<b>${escapeHtml(m[1])}</b>`;
    cursor = re.lastIndex;
  }
  out += escapeHtml(text.slice(cursor));
  return out;
}

// Plain-text strip — no clickable spans, just the visible text. Used
// when the surrounding context already escapes HTML or when clicks
// aren't wanted (e.g. monster panel headers).
export function stripTagsToText(s: string): string {
  if (typeof s !== "string") return "";
  return s.replace(/\{@\w+(?:\s+([^{}]*))?\}/g, (_m, payload?: string) => {
    if (!payload) return "";
    const parts = payload.split("|");
    // 5etools cosmetic tag spec: parts[0] = display name, parts[1] =
    // SOURCE code, parts[2] = optional rename. Fall back to parts[0],
    // never parts[1] — that was the "陷入XPHB状态" bug.
    return (parts[2] && parts[2].trim()) || parts[0] || "";
  });
}

// Wire delegated click → quick-roll on every `.rollable` in the given
// root. Idempotent: tracks the bound state on the element so re-calls
// don't double-bind.
export function bindRollableClicks(root: HTMLElement, opts?: { itemId?: string | null; focus?: boolean }): void {
  if ((root as any)._rollableBound) return;
  (root as any)._rollableBound = true;
  root.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(".rollable");
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const expression = target.dataset.expr ?? "";
    const label = target.dataset.label ?? "";
    if (!expression) return;
    fireQuickRoll({
      expression,
      label,
      itemId: opts?.itemId ?? null,
      focus: !!opts?.focus,
    });
    // Brief visual feedback — flash the span.
    target.classList.remove("rollable-flash");
    void target.offsetWidth;
    target.classList.add("rollable-flash");
  });
}
