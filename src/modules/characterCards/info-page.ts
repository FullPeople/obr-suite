import OBR from "@owlbear-rodeo/sdk";
import { ICONS } from "../../icons";
import { fireQuickRoll, resolveClickRollTarget } from "../dice/tags";
import { bindRollableContextMenu } from "../dice/context-menu";
import { subscribeToSfx } from "../dice/sfx-broadcast";

const SHOW_MSG = "com.character-cards/info-show";

const root = document.getElementById("root") as HTMLDivElement;

// The token id this card is currently bound to. Updated whenever the
// info popover is shown for a different character. Quick-rolls fire
// on this token (for camera focus + dice anchoring above the head).
let boundItemId: string | null = null;

const ABBR: Record<string, string> = {
  str: "力", dex: "敏", con: "体", int: "智", wis: "感", cha: "魅",
};
// Full Chinese names for the dice-roll label (e.g. "敏捷检定" rather
// than "敏检定"). Used for the panel-page formula label / history
// display — the chip itself still shows the single-char ABBR.
const FULL: Record<string, string> = {
  str: "力量", dex: "敏捷", con: "体质", int: "智力", wis: "感知", cha: "魅力",
};
const ORDER = ["str", "dex", "con", "int", "wis", "cha"];

function escapeHtml(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function fmtMod(n: unknown): string {
  if (typeof n !== "number") return "?";
  return n >= 0 ? `+${n}` : `${n}`;
}

// attack_bonus is either "+3" (weapons) or "D20+7" (spells). Normalise to
// just the signed bonus like "+7".
function extractBonus(s: unknown): string {
  const str = String(s ?? "");
  const m = /([+-]\s*\d+)\s*$/.exec(str);
  if (!m) return str || "?";
  return m[1].replace(/\s+/g, "");
}

function classesStr(d: any): string {
  if (!Array.isArray(d.classes)) return "";
  return d.classes
    .map((c: any) => {
      const nm = c.name || c.class_name || c.cls || "";
      const lv = c.level ?? c.lvl ?? "";
      return `${nm}${lv}`;
    })
    .filter(Boolean)
    .join("/");
}

let currentCardId: string | null = null;
const cardCache = new Map<string, any>();

async function showCard(cardId: string, roomId: string) {
  currentCardId = cardId;

  // Cache hit: render instantly, 0 network wait, 0 intermediate frame.
  const cached = cardCache.get(cardId);
  if (cached) {
    render(cached, cardId, roomId);
    return;
  }

  // Cold load: only show "loading" if nothing's rendered yet (first open).
  // When switching between bound characters, keep the previous card's content
  // on screen until the new data arrives — single atomic A→B swap, no flash.
  const isEmpty = root.childElementCount === 0;
  if (isEmpty) {
    root.innerHTML = '<div class="loading">加载中…</div>';
  }

  try {
    const res = await fetch(
      `https://obr.dnd.center/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data.json`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    // If user switched cards between fetch start and end, ignore.
    if (currentCardId !== cardId) return;
    cardCache.set(cardId, d);
    render(d, cardId, roomId);
  } catch (e: any) {
    if (currentCardId !== cardId) return;
    root.innerHTML = `<div class="err">加载失败：${escapeHtml(e?.message ?? e)}</div>`;
  }
}

function render(d: any, cardId: string, roomId: string) {
  const id = d.identity || {};
  const cs = d.core_stats || {};
  const ab = d.abilities || {};
  const cb = d.combat || {};
  const sp = d.spellcasting || {};

  const name = id.display_name || id.character_name || "未命名";
  const race = [id.race?.name, id.race?.subrace].filter(Boolean).join("·");
  const cls = classesStr(d);
  const lvl = d.total_level != null ? `Lv${d.total_level}` : "";
  const sub = [race, cls, lvl].filter(Boolean).join(" ");

  const rawUrl = `https://obr.dnd.center/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/`;

  const hp = cs.hp || {};
  const hpStr = `${hp.current ?? "?"}/${hp.max ?? "?"}${hp.temp ? `+${hp.temp}` : ""}`;
  const speedStr = cs.speed != null ? `${cs.speed}尺` : "?";
  const castAbility = sp.spellcasting_ability || "—";

  const chips = `
    <div class="chip hp"><span class="k">HP</span><span class="v">${escapeHtml(hpStr)}</span></div>
    <div class="chip ac"><span class="k">AC</span><span class="v">${escapeHtml(cs.ac)}</span></div>
    <div class="chip init"><span class="k">先攻</span><span class="v">${fmtMod(cs.initiative)}</span></div>
    <div class="chip"><span class="k">速度</span><span class="v">${escapeHtml(speedStr)}</span></div>
    <div class="chip"><span class="k">被动察觉</span><span class="v">${escapeHtml(cs.passive_perception)}</span></div>
    <div class="chip"><span class="k">熟练</span><span class="v">${fmtMod(cs.proficiency_bonus)}</span></div>
    <div class="chip"><span class="k">豁免DC</span><span class="v">${escapeHtml(cs.dc)}</span></div>
    <div class="chip"><span class="k">施法关键属性</span><span class="v">${escapeHtml(castAbility)}</span></div>
  `;

  // Group skills by their ability key — each ability card embeds its own
  // list of associated skills (e.g. DEX card shows 特技/巧手/隐匿).
  const skills = Array.isArray(d.skills) ? d.skills : [];
  const skillsByAbil: Record<string, any[]> = {};
  for (const s of skills) {
    const k = String(s?.ability ?? "").toLowerCase();
    if (!k) continue;
    (skillsByAbil[k] ??= []).push(s);
  }

  const renderSkillRow = (s: any) => {
    const cls = s.proficiency === "expertise"
      ? "sk sk-exp"
      : s.proficiency === "proficient"
        ? "sk sk-prof"
        : "sk";
    const total = typeof s.total === "number" ? s.total : 0;
    const expr = `1d20${total >= 0 ? `+${total}` : total}`;
    const lbl = `${s.name ?? "?"}`;
    return `<div class="${cls} rollable" data-expr="${expr}" data-label="${escapeHtml(lbl)}" title="${escapeHtml(lbl)} ${expr}">
      <span class="sk-n">${escapeHtml(s.name ?? "?")}</span>
      <span class="sk-v">${fmtMod(s.total)}</span>
    </div>`;
  };

  const abl = ORDER
    .map((k) => {
      const a = ab[k] || {};
      const prof = !!a.save?.proficient;
      const skList = skillsByAbil[k] ?? [];
      const skHtml = skList.map(renderSkillRow).join("");
      // Ability check: 1d20+modifier. Saving-throw uses the same
      // modifier unless the save has its own bonus stored separately.
      const aMod = typeof a.modifier === "number" ? a.modifier : 0;
      const aExpr = `1d20${aMod >= 0 ? `+${aMod}` : aMod}`;
      const aLbl = `${FULL[k] ?? ABBR[k] ?? k}检定`;
      // Saving throw — different label, may have its own bonus.
      const saveBonus = typeof a.save?.bonus === "number"
        ? a.save.bonus
        : (a.save?.proficient ? aMod + (cs.proficiency_bonus ?? 0) : aMod);
      const saveExpr = `1d20${saveBonus >= 0 ? `+${saveBonus}` : saveBonus}`;
      const saveLbl = `${FULL[k] ?? ABBR[k] ?? k}豁免`;
      return `<div class="abl${prof ? " prof" : ""}">
        <div class="abl-head">
          <span class="a rollable" data-expr="${saveExpr}" data-label="${escapeHtml(saveLbl)}" title="${escapeHtml(saveLbl)} ${saveExpr}">${ABBR[k]}</span>
          <span class="t">${escapeHtml(a.total)}</span>
          <span class="m rollable" data-expr="${aExpr}" data-label="${escapeHtml(aLbl)}" title="${escapeHtml(aLbl)} ${aExpr}">${fmtMod(a.modifier)}</span>
        </div>
        ${skHtml ? `<div class="abl-skills">${skHtml}</div>` : ""}
      </div>`;
    })
    .join("");

  const weaponRows: string[] = [];

  // Spell attack row (first so it's easy to find). Only if character casts.
  if (sp.attack_bonus) {
    const bonus = extractBonus(sp.attack_bonus);
    const bn = parseInt(bonus.replace(/[^\d-]/g, ""), 10) || 0;
    const atkExpr = `1d20${bn >= 0 ? `+${bn}` : bn}`;
    const atkLbl = `法术攻击`;
    weaponRows.push(`<div class="wp spell">
      <span class="n">近战/远程法术攻击</span>
      <span class="atk rollable" data-expr="${atkExpr}" data-label="${escapeHtml(atkLbl)}" title="${escapeHtml(atkLbl)} ${atkExpr}">${escapeHtml(bonus)}</span>
      <span class="dmg">DC ${escapeHtml(sp.save_dc ?? cs.dc ?? "?")}</span>
    </div>`);
  }

  if (Array.isArray(cb.weapons)) {
    for (const w of cb.weapons) {
      const prop = w.properties ? `<span class="prop">${escapeHtml(w.properties)}</span>` : "";
      const dmgRaw = [w.damage, w.damage_type].filter(Boolean).join(" ");
      const wpName = w.name ?? "?";
      // Attack roll: parse the leading sign+number from attack_bonus.
      const atkBonusStr = String(w.attack_bonus ?? "").trim();
      const atkM = /([+-]?\s*\d+)/.exec(atkBonusStr);
      const atkBn = atkM ? parseInt(atkM[1].replace(/\s+/g, ""), 10) : 0;
      const atkExpr = `1d20${atkBn >= 0 ? `+${atkBn}` : atkBn}`;
      const atkLbl = `${wpName} 命中`;
      // Damage: extract the raw dice expression from `w.damage`. Most
      // entries are like "1d8+3" or "2d6+4" — pass through directly.
      const dmgExprRaw = String(w.damage ?? "").replace(/\s+/g, "");
      const dmgExprMatch = /\d*d\d+([+-]\d+)?/.exec(dmgExprRaw);
      const dmgExpr = dmgExprMatch ? dmgExprMatch[0] : dmgExprRaw;
      const dmgLbl = `${wpName} 伤害${w.damage_type ? `(${w.damage_type})` : ""}`;
      const dmgClickable = dmgExpr
        ? `<span class="rollable" data-expr="${escapeHtml(dmgExpr)}" data-label="${escapeHtml(dmgLbl)}" title="${escapeHtml(dmgLbl)} ${escapeHtml(dmgExpr)}">${escapeHtml(dmgRaw || "?")}</span>`
        : escapeHtml(dmgRaw || "?");
      weaponRows.push(`<div class="wp">
        <span class="n">${escapeHtml(wpName)}</span>
        <span class="atk rollable" data-expr="${atkExpr}" data-label="${escapeHtml(atkLbl)}" title="${escapeHtml(atkLbl)} ${atkExpr}">${escapeHtml(w.attack_bonus ?? "?")}</span>
        <span class="dmg">${dmgClickable}</span>
        ${prop}
      </div>`);
    }
  }

  const weps = weaponRows.length ? weaponRows.join("") : '<div class="empty">无</div>';

  // ── Searchable chips: features / feats / spells ────────────────
  // Each chip is a tiny compact name-only box. Clicking fills the
  // cluster's search input with that name (BC_SEARCH_QUERY) so the
  // 5etools search popover opens with matching results — letting
  // the player look up a feature definition without leaving OBR.
  const featuresHtml = renderSearchChips(d);

  root.innerHTML = `
    <div class="hdr">
      <div class="name">${escapeHtml(name)}</div>
      <div class="sub">${escapeHtml(sub)}</div>
      <a class="raw-link" href="${rawUrl}" target="_blank" rel="noopener">原始数据</a>
    </div>
    <div class="row">${chips}</div>
    <div class="abil">${abl}</div>
    <div class="sect">${ICONS.swords} 武器 / 攻击</div>
    ${weps}
    ${featuresHtml}
  `;
}

// Compact name-only chips. Click → fires BC_SEARCH_QUERY to populate
// the cluster's search input. The cluster echoes its own input value
// from this broadcast so the user sees the chip text appear in the
// search box and the search popover opens with matching results.
function renderSearchChips(d: any): string {
  const sections: string[] = [];
  const features = d.features ?? {};

  const renderChips = (items: any[]) => items
    .filter((x) => x && x.name)
    .map((x) => {
      const nm = String(x.name);
      return `<span class="srch-chip" data-q="${escapeHtml(nm)}">${escapeHtml(nm)}</span>`;
    })
    .join("");

  // 特性 = race_features + class_features (merged into one tight grid).
  const featList: any[] = [];
  if (Array.isArray(features.race_features)) featList.push(...features.race_features);
  if (Array.isArray(features.class_features)) featList.push(...features.class_features);
  if (featList.length) {
    sections.push(`<div class="srch-sect">
      <div class="srch-sect-h">特性</div>
      <div class="srch-grid">${renderChips(featList)}</div>
    </div>`);
  }

  // 专长 — class feats list.
  if (Array.isArray(features.feats) && features.feats.length) {
    sections.push(`<div class="srch-sect">
      <div class="srch-sect-h">专长</div>
      <div class="srch-grid">${renderChips(features.feats)}</div>
    </div>`);
  }

  // 法术 — flatten always_known + prepared + cantrips_known into one
  // grid (de-duplicated by name).
  const sp = d.spellcasting ?? {};
  const allSpells: any[] = [];
  for (const key of ["cantrips_known", "always_known", "prepared"]) {
    const arr = sp[key];
    if (Array.isArray(arr)) for (const s of arr) if (s && s.name) allSpells.push(s);
  }
  if (allSpells.length) {
    const seen = new Set<string>();
    const uniq = allSpells.filter((s) => {
      if (seen.has(s.name)) return false;
      seen.add(s.name);
      return true;
    });
    sections.push(`<div class="srch-sect">
      <div class="srch-sect-h">法术</div>
      <div class="srch-grid">${renderChips(uniq)}</div>
    </div>`);
  }

  return sections.join("");
}

// Single delegated click handler for ALL rollable spans inside the
// card. Reads the bound token id at click time so dice anchor on the
// currently-selected character (falls back to live selection if the
// info popover wasn't opened with one).
async function resolveBoundToken(): Promise<string | null> {
  if (boundItemId) return boundItemId;
  return resolveClickRollTarget();
}

root.addEventListener("click", async (e) => {
  // Search-chip click → fill the cluster's search input so the
  // 5etools popover opens with matching results.
  const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(".srch-chip");
  if (chip) {
    e.preventDefault();
    e.stopPropagation();
    const q = chip.dataset.q ?? "";
    if (q) {
      try {
        OBR.broadcast.sendMessage(
          "com.obr-suite/search-query",
          { q },
          { destination: "LOCAL" },
        );
      } catch {}
    }
    chip.classList.remove("srch-flash");
    void chip.offsetWidth;
    chip.classList.add("srch-flash");
    return;
  }

  const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(".rollable");
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  const expression = target.dataset.expr ?? "";
  const label = target.dataset.label ?? "";
  if (!expression) return;
  const itemId = await resolveBoundToken();
  fireQuickRoll({
    expression,
    label,
    itemId,
    focus: !!itemId,
  });
  target.classList.remove("rollable-flash");
  void target.offsetWidth;
  target.classList.add("rollable-flash");
});

// Right-click → context menu (投掷 / 优势 / 劣势 / 添加到骰盘).
// Anchors on the bound character token so dice / camera focus are
// consistent with the left-click behavior above.
//
// The cc-info popover is opened from `characterCards/index.ts` with
// anchorPosition = { left: vw − RIGHT_OFFSET, top: anchorTop } and
// anchorOrigin = RIGHT/BOTTOM. That puts the iframe's BOTTOM-RIGHT
// in viewport at (vw − RIGHT_OFFSET, anchorTop), so its TOP-LEFT is
// (vw − RIGHT_OFFSET − innerWidth, anchorTop − innerHeight). Constants
// mirrored from characterCards/index.ts.
const CC_RIGHT_OFFSET = 12;
const CC_BOTTOM_OFFSET = 160;
const CC_INFO_GAP = 8;
const CC_BUTTON_HEIGHT = 48 + 8;
bindRollableContextMenu(
  root,
  () => "open",
  () => resolveBoundToken(),
  async () => {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth().catch(() => 1280),
      OBR.viewport.getHeight().catch(() => 720),
    ]);
    const anchorTop = vh - CC_BOTTOM_OFFSET - CC_BUTTON_HEIGHT - CC_INFO_GAP;
    return {
      left: Math.round(vw - CC_RIGHT_OFFSET - window.innerWidth),
      top: Math.round(anchorTop - window.innerHeight),
    };
  },
);

OBR.onReady(() => {
  subscribeToSfx();
  // Initial card from URL — popover is opened on-demand by background.ts
  // with the ids in the query string. While the popover stays open, background
  // broadcasts in-place swaps when a different bound character is selected.
  try {
    const params = new URLSearchParams(location.search);
    const cardId = params.get("cardId");
    const roomId = params.get("roomId");
    const itemId = params.get("itemId");
    if (itemId) boundItemId = itemId;
    if (cardId && roomId) showCard(cardId, roomId);
  } catch {}

  OBR.broadcast.onMessage(SHOW_MSG, (ev: any) => {
    const p = ev?.data || {};
    // Update the bound-token used by quick-roll clicks (selecting a
    // different character should make rolls anchor on the new token).
    if (typeof p.itemId === "string") boundItemId = p.itemId;
    else if (p.itemId === null) boundItemId = null;
    if (p.cardId && p.roomId) showCard(String(p.cardId), String(p.roomId));
  });
});
