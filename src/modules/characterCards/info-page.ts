import OBR from "@owlbear-rodeo/sdk";

const SHOW_MSG = "com.character-cards/info-show";

const root = document.getElementById("root") as HTMLDivElement;

const ABBR: Record<string, string> = {
  str: "力", dex: "敏", con: "体", int: "智", wis: "感", cha: "魅",
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
    return `<div class="${cls}">
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
      return `<div class="abl${prof ? " prof" : ""}">
        <div class="abl-head">
          <span class="a">${ABBR[k]}</span>
          <span class="t">${escapeHtml(a.total)}</span>
          <span class="m">${fmtMod(a.modifier)}</span>
        </div>
        ${skHtml ? `<div class="abl-skills">${skHtml}</div>` : ""}
      </div>`;
    })
    .join("");

  const weaponRows: string[] = [];

  // Spell attack row (first so it's easy to find). Only if character casts.
  if (sp.attack_bonus) {
    const bonus = extractBonus(sp.attack_bonus);
    weaponRows.push(`<div class="wp spell">
      <span class="n">近战/远程法术攻击</span>
      <span class="atk">${escapeHtml(bonus)}</span>
      <span class="dmg">DC ${escapeHtml(sp.save_dc ?? cs.dc ?? "?")}</span>
    </div>`);
  }

  if (Array.isArray(cb.weapons)) {
    for (const w of cb.weapons) {
      const prop = w.properties ? `<span class="prop">${escapeHtml(w.properties)}</span>` : "";
      const dmg = [w.damage, w.damage_type].filter(Boolean).join(" ");
      weaponRows.push(`<div class="wp">
        <span class="n">${escapeHtml(w.name ?? "?")}</span>
        <span class="atk">${escapeHtml(w.attack_bonus ?? "?")}</span>
        <span class="dmg">${escapeHtml(dmg || "?")}</span>
        ${prop}
      </div>`);
    }
  }

  const weps = weaponRows.length ? weaponRows.join("") : '<div class="empty">无</div>';

  root.innerHTML = `
    <div class="hdr">
      <div class="name">${escapeHtml(name)}</div>
      <div class="sub">${escapeHtml(sub)}</div>
      <a class="raw-link" href="${rawUrl}" target="_blank" rel="noopener">原始数据</a>
    </div>
    <div class="row">${chips}</div>
    <div class="abil">${abl}</div>
    <div class="sect">⚔ 武器 / 攻击</div>
    ${weps}
  `;
}

OBR.onReady(() => {
  // Initial card from URL — popover is opened on-demand by background.ts
  // with the ids in the query string. While the popover stays open, background
  // broadcasts in-place swaps when a different bound character is selected.
  try {
    const params = new URLSearchParams(location.search);
    const cardId = params.get("cardId");
    const roomId = params.get("roomId");
    if (cardId && roomId) showCard(cardId, roomId);
  } catch {}

  OBR.broadcast.onMessage(SHOW_MSG, (ev: any) => {
    const p = ev?.data || {};
    if (p.cardId && p.roomId) showCard(String(p.cardId), String(p.roomId));
  });
});
