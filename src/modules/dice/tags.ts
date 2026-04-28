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

const BC_QUICK_ROLL = "com.obr-suite/dice-quick-roll";

export interface QuickRollRequest {
  expression: string;
  label?: string;
  itemId?: string | null;
  hidden?: boolean;
  focus?: boolean;
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
function parseTagPayload(tag: string, payload: string):
  | { kind: "roll"; spec: RollSpec }
  | { kind: "text"; display: string } {
  const parts = payload.split("|");
  const arg = parts[0] ?? "";
  const display = parts[parts.length >= 3 && parts[2] ? 2 : 1] ?? arg;

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
      const labels: Record<string, string> = {
        mw: "近战武器攻击",
        rw: "远程武器攻击",
        ms: "近战法术攻击",
        rs: "远程法术攻击",
        m: "近战攻击",
        r: "远程攻击",
      };
      const phrase = codes.map((c) => labels[c] ?? c).join("/");
      return { kind: "text", display: `*${phrase}：*` };
    }
    case "atkr": {
      // 2024 attack-roll variant. arg is "m"/"r"/"mw"/"rw" etc.
      const codes = arg.split(",").map((s) => s.trim().toLowerCase());
      const labels: Record<string, string> = {
        m: "近战攻击",
        r: "远程攻击",
        mw: "近战武器攻击",
        rw: "远程武器攻击",
      };
      return { kind: "text", display: `*${codes.map((c) => labels[c] ?? c).join("/")}：*` };
    }
    case "h":
      return { kind: "text", display: "命中：" };
    case "hom":
      return { kind: "text", display: "或命中：" };
    case "m":
      return { kind: "text", display: "落空：" };
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
    case "5etoolsImg":
    case "code":
    case "style":
    case "comic":
    case "comicH1":
    case "comicH2":
    case "comicH3":
    case "comicH4":
    case "comicNote":
    case "deck":
    case "card":
    case "loader":
    case "footnote":
    case "link":
    case "actSave":
    case "actSaveSuccess":
    case "actSaveFail":
    case "actSaveFailBy":
    case "actTrigger":
    case "actResponse":
      return { kind: "text", display };
    case "recharge":
      return { kind: "text", display: arg ? `（充能 ${arg}-6）` : "（充能）" };

    default:
      // Unknown tag — keep the display portion (5etools convention:
      // first non-empty pipe segment is the visible text).
      return { kind: "text", display };
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
    out += escapeHtml(s.slice(i, m.index));
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
      out += escapeHtml(parsed.display);
    }
    i = re.lastIndex;
  }
  out += escapeHtml(s.slice(i));
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
    if (parts.length >= 3 && parts[2]) return parts[2];
    return parts[1] ?? parts[0] ?? "";
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
