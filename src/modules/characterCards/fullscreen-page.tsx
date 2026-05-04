import { render } from "preact";
import { useEffect, useState, useMemo, useCallback } from "preact/hooks";
import { fireQuickRoll } from "../dice/tags";
import { subscribeToSfx } from "../dice/sfx-broadcast";

// ============================================================
// Full-screen character card v2 — data-driven Preact renderer
// ============================================================
//
// Replaces the legacy server-rendered Jinja2 HTML iframe (which was
// hard to wire to live data). This component:
//
//   1. Reads /characters/<roomId>/<cardId>/data.json directly.
//   2. Renders every section the parser produces — identity, stats,
//      abilities + skills, defenses, combat (weapons/armor),
//      spellcasting (slots + spells with tooltip details), features
//      (class/race/feats/special abilities/wondrous items), background
//      story blocks, inventory (currency + encumbrance + items).
//   3. Inline-edits HP/temp HP/AC via local in-memory state and a
//      future-friendly onPatch hook (server PUT path is hooked but
//      stubbed for tonight's iteration).
//   4. Export → downloads the current data.json. Import → uploads a
//      JSON file and replaces the local cache (server persistence
//      pending a /api/character/<room>/<card>/data PUT endpoint).
//
// Palette matches the rest of the suite (cluster, settings, dice
// panel) — dark navy charcoal canvas, signature amber #f5a623 for
// character names + section headers, warm gold for stat values,
// soft red for HP, muted teal for saves, sky blue for clickable
// affordances (used sparingly). Reads as "more suite", not a
// third-party widget.

const SERVER_ORIGIN = "https://obr.dnd.center";

// ===== Types ================================================
interface CharacterData {
  schema_version?: string;
  meta?: any;
  identity?: any;
  classes?: any[];
  total_level?: number;
  abilities?: Record<string, any>;
  core_stats?: any;
  defenses?: any;
  skills?: any[];
  combat?: any;
  spellcasting?: any;
  features?: any;
  background?: any;
  inventory?: any;
  exports?: any;
}

// ===== Const tables ==========================================
const ABL_ORDER = ["str", "dex", "con", "int", "wis", "cha"] as const;
const ABL_LABEL: Record<string, string> = {
  str: "力量", dex: "敏捷", con: "体质", int: "智力", wis: "感知", cha: "魅力",
};
const ABL_ABBR: Record<string, string> = {
  str: "力", dex: "敏", con: "体", int: "智", wis: "感", cha: "魅",
};

type TabKey = "overview" | "combat" | "spells" | "features" | "inventory" | "background";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview",   label: "概览" },
  { key: "combat",     label: "战斗" },
  { key: "spells",     label: "法术" },
  { key: "features",   label: "特性" },
  { key: "inventory",  label: "装备" },
  { key: "background", label: "背景" },
];

// ===== Helpers ===============================================
function fmtMod(n: unknown): string {
  if (typeof n !== "number") return "?";
  return n >= 0 ? `+${n}` : `${n}`;
}
function getQS(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}
function downloadJson(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ===== Subcomponents =========================================
function Header({ data, onExport, onImport, onRefresh }: {
  data: CharacterData;
  onExport: () => void;
  onImport: () => void;
  onRefresh: () => void;
}) {
  const id = data.identity || {};
  const cs = data.core_stats || {};
  const name = id.display_name || id.character_name || "未命名";
  const englishName = id.character_name && id.display_name && id.character_name !== id.display_name
    ? id.character_name : null;

  const cls = (data.classes || [])
    .filter((c) => c?.name)
    .map((c) => `${c.name}${c.subclass ? `（${c.subclass}）` : ""}${c.level ? ` Lv${c.level}` : ""}`)
    .join(" / ") || "—";

  const race = [id.race?.name, id.race?.subrace].filter(Boolean).join("·") || "—";
  const totalLv = data.total_level != null ? data.total_level : "?";

  return (
    <div class="cc-head">
      <div class="cc-head-left">
        <div class="cc-head-name">
          {name}
          {englishName && <span class="en">{englishName}</span>}
        </div>
        <div class="cc-head-meta">
          <span class="pip"><b>{race}</b></span>
          <span class="pip"><b>{cls}</b></span>
          <span class="pip">总等级 <b>{totalLv}</b></span>
          {id.alignment && <span class="pip">阵营 <b>{id.alignment}</b></span>}
          {cs.size && <span class="pip">体型 <b>{cs.size}</b></span>}
          {id.faith && <span class="pip">信仰 <b>{id.faith}</b></span>}
        </div>
      </div>
      <div class="cc-head-right">
        <button class="cc-btn" onClick={onRefresh} title="重新拉取服务器上的最新数据">
          <span class="ic">↻</span>刷新
        </button>
        <button class="cc-btn primary" onClick={onExport} title="把当前角色卡数据导出为 JSON 文件">
          <span class="ic">⬇</span>导出 JSON
        </button>
        <button class="cc-btn" onClick={onImport} title="从 JSON 文件加载角色卡（仅本地预览，未保存到服务器）">
          <span class="ic">⬆</span>导入 JSON
        </button>
      </div>
    </div>
  );
}

function StatsBanner({
  data, onPatch,
}: {
  data: CharacterData;
  onPatch: (patch: Partial<CharacterData>) => void;
}) {
  const cs = data.core_stats || {};
  const hp = cs.hp || {};
  const hd = cs.hit_dice || {};

  const setHp = (which: "current" | "max" | "temp", val: string) => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) return;
    const next = { ...hp, [which]: n };
    onPatch({ core_stats: { ...cs, hp: next } });
  };
  const setAc = (val: string) => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) return;
    onPatch({ core_stats: { ...cs, ac: n } });
  };
  const setHdCur = (val: string) => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) return;
    onPatch({ core_stats: { ...cs, hit_dice: { ...hd, current: n } } });
  };

  return (
    <div class="cc-stats">
      <div class="stat-cell hp">
        <div class="stat-cell-label">HP</div>
        <div class="stat-cell-val">
          <input class="stat-input big"
            value={hp.current ?? 0}
            onChange={(e: any) => setHp("current", e.target.value)} />
          <span class="slash">/</span>
          <input class="stat-input small"
            value={hp.max ?? 0}
            onChange={(e: any) => setHp("max", e.target.value)} />
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">临时</div>
        <div class="stat-cell-val">
          <input class="stat-input big"
            value={hp.temp ?? 0}
            onChange={(e: any) => setHp("temp", e.target.value)} />
        </div>
      </div>
      <div class="stat-cell ac">
        <div class="stat-cell-label">AC</div>
        <div class="stat-cell-val">
          <input class="stat-input big"
            value={cs.ac ?? 10}
            onChange={(e: any) => setAc(e.target.value)} />
        </div>
      </div>
      <div class="stat-cell init">
        <div class="stat-cell-label">先攻</div>
        <div class="stat-cell-val">
          <span class="big">{fmtMod(cs.initiative)}</span>
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">速度</div>
        <div class="stat-cell-val">
          <span class="big">{cs.speed ?? "?"}</span>
          <span class="unit">尺</span>
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">被察</div>
        <div class="stat-cell-val">
          <span class="big">{cs.passive_perception ?? "?"}</span>
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">熟练</div>
        <div class="stat-cell-val">
          <span class="big">{fmtMod(cs.proficiency_bonus)}</span>
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">生命骰</div>
        <div class="stat-cell-val">
          <input class="stat-input big" value={hd.current ?? 0}
            onChange={(e: any) => setHdCur(e.target.value)} />
          <span class="slash">/</span>
          <span class="small">{hd.max ?? "?"}{hd.die_size ?? ""}</span>
        </div>
      </div>
    </div>
  );
}

function rollExpr(label: string, expr: string, advMode?: "adv" | "dis") {
  if (!expr) return;
  fireQuickRoll({ expression: expr, label, advMode }).catch(() => {});
}

function AbilitiesAndSkills({ data }: { data: CharacterData }) {
  const ab = data.abilities || {};
  const cs = data.core_stats || {};
  const skills = Array.isArray(data.skills) ? data.skills : [];
  const skBy: Record<string, any[]> = {};
  for (const s of skills) (skBy[s.ability] ??= []).push(s);

  return (
    <div class="sec">
      <div class="sec-h">
        <span class="sec-h-title">属性 · 豁免 · 技能</span>
      </div>
      <div class="sec-body">
        <div class="abl-grid">
          {ABL_ORDER.map((k) => {
            const a = ab[k] || {};
            const mod = typeof a.modifier === "number" ? a.modifier : 0;
            const profBonus = cs.proficiency_bonus ?? 0;
            const saveBonus = typeof a.save?.bonus === "number"
              ? a.save.bonus
              : (a.save?.proficient ? mod + profBonus : mod);
            const aExpr = `1d20${mod >= 0 ? "+" : ""}${mod}`;
            const sExpr = `1d20${saveBonus >= 0 ? "+" : ""}${saveBonus}`;
            return (
              <div class="abl">
                <div class="abl-name">{ABL_LABEL[k]}</div>
                <div class="abl-total">{a.total ?? "?"}</div>
                <div class="abl-mod"
                  onClick={() => rollExpr(`${ABL_LABEL[k]}检定`, aExpr)}
                  onContextMenu={(e: any) => { e.preventDefault(); rollExpr(`${ABL_LABEL[k]}检定（优势）`, aExpr, "adv"); }}
                  title={`${ABL_LABEL[k]}检定 ${aExpr}\n（左键投，右键优势）`}>
                  {fmtMod(a.modifier)}
                </div>
                <div class={`abl-save ${a.save?.proficient ? "is-prof" : ""}`}
                  onClick={() => rollExpr(`${ABL_LABEL[k]}豁免`, sExpr)}
                  title={`${ABL_LABEL[k]}豁免 ${sExpr}`}>
                  豁免 <b>{fmtMod(saveBonus)}</b>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: "12px" }}>
          <div class="sk-list">
            {ABL_ORDER.flatMap((k) =>
              (skBy[k] || []).map((s) => {
                const total = typeof s.total === "number" ? s.total : 0;
                const expr = `1d20${total >= 0 ? "+" : ""}${total}`;
                const cls = s.proficiency === "expertise" ? "exp" : s.proficiency === "proficient" ? "prof" : "";
                return (
                  <div class={`sk ${cls}`}
                    onClick={() => rollExpr(`${s.name}检定`, expr)}
                    onContextMenu={(e: any) => { e.preventDefault(); rollExpr(`${s.name}检定（优势）`, expr, "adv"); }}
                    title={`${s.name}检定 ${expr}\n（左键投，右键优势）`}>
                    <span class="sk-prof">{cls === "exp" ? "★" : cls === "prof" ? "●" : "○"}</span>
                    <span class="sk-name">{s.name}</span>
                    <span class="sk-abil">{ABL_ABBR[s.ability] || ""}</span>
                    <span class="sk-val">{fmtMod(s.total)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Defenses({ data }: { data: CharacterData }) {
  const d = data.defenses || {};
  const id = data.identity || {};
  const langs: string[] = Array.isArray(id.languages) ? id.languages : [];
  const tools: string[] = Array.isArray(id.tool_proficiencies) ? id.tool_proficiencies : [];

  const empty = !d.resistances?.length && !d.immunities?.length && !d.advantages?.length && !d.disadvantages?.length;
  if (empty && !langs.length && !tools.length) return null;

  return (
    <div class="sec">
      <div class="sec-h"><span class="sec-h-title">防御 · 语言 · 工具</span></div>
      <div class="sec-body">
        {!!d.resistances?.length && (
          <div class="def-row">
            <span class="def-label">抗性</span>
            {d.resistances.map((x: string) => <span class="def-tag res">{x}</span>)}
          </div>
        )}
        {!!d.immunities?.length && (
          <div class="def-row">
            <span class="def-label">免疫</span>
            {d.immunities.map((x: string) => <span class="def-tag imm">{x}</span>)}
          </div>
        )}
        {!!d.advantages?.length && (
          <div class="def-row">
            <span class="def-label">优势</span>
            {d.advantages.map((x: string) => <span class="def-tag adv">{x}</span>)}
          </div>
        )}
        {!!d.disadvantages?.length && (
          <div class="def-row">
            <span class="def-label">劣势</span>
            {d.disadvantages.map((x: string) => <span class="def-tag dis">{x}</span>)}
          </div>
        )}
        {!!langs.length && (
          <div class="def-row">
            <span class="def-label">语言</span>
            {langs.map((x) => <span class="def-tag">{x}</span>)}
          </div>
        )}
        {!!tools.length && (
          <div class="def-row">
            <span class="def-label">工具</span>
            {tools.map((x) => <span class="def-tag">{x}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

function CombatSection({ data }: { data: CharacterData }) {
  const cb = data.combat || {};
  const armor = cb.armor || {};
  const shield = cb.shield || {};
  const weapons: any[] = Array.isArray(cb.weapons) ? cb.weapons : [];

  return (
    <div class="sec">
      <div class="sec-h">
        <span class="sec-h-title">战斗 · 武器 · 护甲</span>
      </div>
      <div class="sec-body dense">
        {(armor.name || armor.ac_base != null) && (
          <div class="weap" style={{ background: "rgba(138,111,63,0.06)" }}>
            <div class="weap-name">
              🛡 {armor.name || "护甲"}
              {armor.equipped && <span class="weap-prof">已装备</span>}
              {armor.attuned && <span class="weap-prof">同调</span>}
            </div>
            <div class="weap-atk" title="基础 AC + 敏捷上限">
              AC {armor.ac_base ?? "?"}
              {typeof armor.dex_bonus_cap === "number" && ` (+敏≤${armor.dex_bonus_cap})`}
            </div>
            <div class="weap-dmg" style={{ visibility: "hidden" }}>—</div>
            {armor.weight != null && (
              <div class="weap-props">重量 {armor.weight} 磅</div>
            )}
          </div>
        )}
        {shield.ac_bonus != null && (
          <div class="weap" style={{ background: "rgba(138,111,63,0.06)" }}>
            <div class="weap-name">⛨ 盾牌
              {shield.equipped && <span class="weap-prof">已装备</span>}
              {shield.attuned && <span class="weap-prof">同调</span>}
            </div>
            <div class="weap-atk">+{shield.ac_bonus} AC</div>
            <div class="weap-dmg" style={{ visibility: "hidden" }}>—</div>
          </div>
        )}
        {weapons.length === 0 && !armor.name && !shield.ac_bonus && (
          <div style={{ color: "var(--ink-mute)", fontStyle: "italic", padding: "8px" }}>
            暂未配置武器或护甲
          </div>
        )}
        {weapons.map((w) => {
          const atkMatch = /([+-]?\d+)/.exec(String(w.attack_bonus ?? ""));
          const atkBn = atkMatch ? parseInt(atkMatch[1], 10) : 0;
          const atkExpr = `1d20${atkBn >= 0 ? "+" : ""}${atkBn}`;
          const dmgRaw = String(w.damage ?? "").replace(/\s+/g, "");
          const dmgMatch = /\d*d\d+([+-]\d+)?/.exec(dmgRaw);
          const dmgExpr = dmgMatch ? dmgMatch[0] : dmgRaw;
          return (
            <div class="weap">
              <div class="weap-name">
                ⚔ {w.name || "?"}
                {w.proficient && <span class="weap-prof">熟</span>}
              </div>
              <div class="weap-atk"
                onClick={() => rollExpr(`${w.name} 命中`, atkExpr)}
                onContextMenu={(e: any) => { e.preventDefault(); rollExpr(`${w.name} 命中（优势）`, atkExpr, "adv"); }}
                title={`左键投，右键优势 · ${atkExpr}`}>
                {w.attack_bonus || `${fmtMod(atkBn)}`}
              </div>
              <div class="weap-dmg"
                onClick={() => rollExpr(`${w.name} 伤害${w.damage_type ? `(${w.damage_type})` : ""}`, dmgExpr)}
                title={`${w.damage} ${w.damage_type ?? ""}`}>
                {w.damage ?? "—"} {w.damage_type ? <span style={{ opacity: 0.7, fontSize: "10px" }}>{w.damage_type}</span> : ""}
              </div>
              {w.extra_damage && (
                <div class="weap-dmg weap-dmg-extra"
                  onClick={(e: any) => {
                    e.stopPropagation();
                    rollExpr(
                      `${w.name} 附加伤害${w.extra_damage_type ? `(${w.extra_damage_type})` : ""}`,
                      String(w.extra_damage).replace(/\s+/g, ""),
                    );
                  }}
                  title={`附加伤害骰 ${w.extra_damage}${w.extra_damage_type ? ` · ${w.extra_damage_type}` : ""}`}>
                  +{w.extra_damage} {w.extra_damage_type ? <span style={{ opacity: 0.7, fontSize: "10px" }}>{w.extra_damage_type}</span> : ""}
                </div>
              )}
              {(w.properties || w.weight != null || w.ammo_type) && (
                <div class="weap-props">
                  {[
                    w.properties,
                    w.weight != null ? `${w.weight}磅` : null,
                    w.ammo_type ? `弹药:${w.ammo_type}` : null,
                  ].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SpellsSection({ data }: { data: CharacterData }) {
  const sp = data.spellcasting || {};
  const cs = data.core_stats || {};
  const slots = sp.spell_slots || {};
  const cantrips: any[] = Array.isArray(sp.cantrips_known) ? sp.cantrips_known : [];
  const always: any[] = Array.isArray(sp.always_known) ? sp.always_known : [];
  const prepared: any[] = Array.isArray(sp.prepared) ? sp.prepared : [];

  const [openSpell, setOpenSpell] = useState<string | null>(null);

  if (!cantrips.length && !always.length && !prepared.length && !sp.attack_bonus && !sp.save_dc) {
    return null;
  }

  // Group prepared by group number (1/2/3) — falls back to single
  // group when group field absent.
  const groups: Record<string, any[]> = {};
  for (const s of prepared) {
    const g = String(s.group ?? "1");
    (groups[g] ??= []).push(s);
  }

  const renderSpell = (s: any, idx: number, prefix: string) => {
    const key = `${prefix}-${idx}`;
    const isOpen = openSpell === key;
    return (
      <>
        <div class="spell"
          onClick={() => setOpenSpell(isOpen ? null : key)}
          title="点击展开法术详情">
          <span class={`spell-lv ${(s.level ?? 0) === 0 ? "cantrip" : ""}`}>
            {(s.level ?? 0) === 0 ? "戏" : `${s.level}环`}
          </span>
          <span class="spell-name">{s.name}</span>
          {s.meta?.concentration && <span class="spell-tag conc">专注</span>}
          {s.meta?.ritual && <span class="spell-tag ritual">仪式</span>}
        </div>
        {isOpen && s.description && (
          <div class="spell-detail">
            {s.meta && (
              <div class="meta">
                {s.meta.school && <span>{s.meta.school}</span>}
                {s.meta.casting_time && <span>施法 {s.meta.casting_time}</span>}
                {s.meta.range && <span>距离 {s.meta.range}</span>}
                {s.meta.components && <span>{s.meta.components}</span>}
                {s.meta.duration && <span>持续 {s.meta.duration}</span>}
                {s.meta.source && <span>《{s.meta.source}》</span>}
              </div>
            )}
            {s.description}
          </div>
        )}
      </>
    );
  };

  return (
    <div class="sec">
      <div class="sec-h">
        <span class="sec-h-title">法术</span>
        {(sp.spellcasting_ability || sp.save_dc) && (
          <span class="sec-h-meta">
            {sp.spellcasting_ability && `关键属性: ${sp.spellcasting_ability}`}
            {sp.save_dc != null && `  ·  豁免DC: ${sp.save_dc}`}
            {sp.attack_bonus && `  ·  攻击: ${sp.attack_bonus}`}
            {sp.max_prepared != null && `  ·  最大准备: ${sp.max_prepared}`}
          </span>
        )}
      </div>
      <div class="sec-body">
        {/* Spell slots */}
        <div class="spell-slots">
          {[1,2,3,4,5,6,7,8,9].map((lv) => {
            const s = slots[String(lv)];
            const has = s && (s.max ?? 0) > 0;
            return (
              <div class={`slot ${has ? "has-slots" : ""}`}>
                <div class="slot-lv">{lv}环</div>
                <div class="slot-cur">{has ? (s.current ?? 0) : "—"}</div>
                <div class="slot-max">{has ? `/${s.max}` : ""}</div>
              </div>
            );
          })}
        </div>

        {sp.sorcery_points && (
          <div style={{
            marginBottom: "10px", padding: "6px 10px",
            background: "var(--bg-soft)", border: "1px solid var(--gold-soft)",
            borderRadius: "5px", fontSize: "11.5px",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ color: "var(--ink-dim)", fontWeight: 600 }}>术法点</span>
            <span style={{ fontFamily: "Georgia,serif", color: "var(--gold)", fontWeight: 700, fontSize: "14px" }}>
              {sp.sorcery_points.current ?? 0} / {sp.sorcery_points.max ?? 0}
            </span>
          </div>
        )}

        {/* Cantrips */}
        {!!cantrips.length && (
          <div class="spell-group">
            <div class="spell-group-h">戏法</div>
            {cantrips.map((s, i) => renderSpell(s, i, "cantrip"))}
          </div>
        )}

        {/* Always known */}
        {!!always.length && (
          <div class="spell-group">
            <div class="spell-group-h">始终准备</div>
            {always.map((s, i) => renderSpell(s, i, "always"))}
          </div>
        )}

        {/* Prepared groups */}
        {Object.entries(groups).map(([g, list]) => (
          <div class="spell-group">
            <div class="spell-group-h">准备法术 · 组 {g}</div>
            {list.map((s, i) => renderSpell(s, i, `g${g}`))}
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureBlock({ title, items }: { title: string; items: any[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (!items?.length) return null;
  return (
    <div style={{ marginBottom: "10px" }}>
      <div class="spell-group-h" style={{ marginBottom: "6px" }}>{title}</div>
      {items.map((f, i) => {
        const isOpen = openIdx === i;
        return (
          <div class={`feat ${isOpen ? "is-open" : ""}`}>
            <div class="feat-h" onClick={() => setOpenIdx(isOpen ? null : i)}>
              <span class="feat-name">
                {f.name}
                {f.level != null && <span class="lv">Lv{f.level}</span>}
                {f.category && <span class="lv" style={{ borderColor: "var(--teal-soft)", color: "var(--teal)" }}>{f.category}</span>}
              </span>
              <span class="feat-toggle">▼</span>
            </div>
            {isOpen && f.description && <div class="feat-body">{f.description}</div>}
          </div>
        );
      })}
    </div>
  );
}

function FeaturesSection({ data }: { data: CharacterData }) {
  const f = data.features || {};
  const cls: any[] = Array.isArray(f.class_features) ? f.class_features : [];
  const race: any[] = Array.isArray(f.race_features) ? f.race_features : [];
  const feats: any[] = Array.isArray(f.feats) ? f.feats : [];
  // New schema fields (v0.3+, may not exist in older data):
  const fightingStyle: any[] = Array.isArray(f.fighting_style_feats) ? f.fighting_style_feats : [];
  const special: any[] = Array.isArray(f.special_abilities) ? f.special_abilities : [];

  if (!cls.length && !race.length && !feats.length && !fightingStyle.length && !special.length) return null;

  return (
    <div class="sec">
      <div class="sec-h"><span class="sec-h-title">特性 · 专长</span></div>
      <div class="sec-body">
        <FeatureBlock title="职业特性" items={cls} />
        <FeatureBlock title="种族特性" items={race} />
        <FeatureBlock title="战斗风格" items={fightingStyle} />
        <FeatureBlock title="特殊能力" items={special} />
        <FeatureBlock title="专长" items={feats} />
      </div>
    </div>
  );
}

function BackgroundSection({ data }: { data: CharacterData }) {
  const bg = data.background || {};
  const id = data.identity || {};
  const blocks = [
    { label: "外貌", body: bg.appearance },
    { label: "性格", body: bg.personality },
    { label: "特质", body: bg.traits },
    { label: "理念", body: bg.ideals },
    { label: "羁绊", body: bg.bonds },
    { label: "缺陷", body: bg.flaws },
    { label: "故事", body: bg.story },
    { label: "其他", body: bg.description },
  ].filter((b) => b.body);

  return (
    <div class="sec">
      <div class="sec-h">
        <span class="sec-h-title">背景 · 个人</span>
        {bg.background_name && <span class="sec-h-meta">背景：{bg.background_name}</span>}
      </div>
      <div class="sec-body">
        <dl class="kv" style={{ marginBottom: "12px" }}>
          {id.player && (<><dt>玩家</dt><dd>{id.player}</dd></>)}
          {id.gender && (<><dt>性别</dt><dd>{id.gender}</dd></>)}
          {id.age != null && (<><dt>年龄</dt><dd>{id.age}</dd></>)}
          {id.height && (<><dt>身高</dt><dd>{id.height}</dd></>)}
          {id.weight && (<><dt>体重</dt><dd>{id.weight}</dd></>)}
          {id.hometown && (<><dt>家乡</dt><dd>{id.hometown}</dd></>)}
        </dl>
        {!!blocks.length && (
          <div class="bio-grid">
            {blocks.map((b) => (
              <div class="bio-block">
                <div class="bio-block-h">{b.label}</div>
                <div class="bio-block-body">{b.body}</div>
              </div>
            ))}
          </div>
        )}
        {!blocks.length && (
          <div style={{ color: "var(--ink-mute)", fontStyle: "italic" }}>暂无背景信息</div>
        )}
      </div>
    </div>
  );
}

function InventorySection({ data }: { data: CharacterData }) {
  const inv = data.inventory || {};
  const w = inv.currency?.wallet || {};
  const enc = inv.encumbrance || {};
  const items: any[] = Array.isArray(inv.items) ? inv.items : [];
  // Wondrous items (奇物) — new schema field, ships when present.
  const wondrous: any[] = Array.isArray(inv.wondrous_items) ? inv.wondrous_items : [];

  return (
    <div class="sec">
      <div class="sec-h">
        <span class="sec-h-title">装备 · 货币 · 负重</span>
        {inv.currency?.total_gp_raw && <span class="sec-h-meta">总值 {inv.currency.total_gp_raw}</span>}
      </div>
      <div class="sec-body">
        <div class="coin-row">
          <div class="coin pp"><div class="coin-name">铂PP</div><div class="coin-val">{w.pp ?? 0}</div></div>
          <div class="coin gp"><div class="coin-name">金GP</div><div class="coin-val">{w.gp ?? 0}</div></div>
          <div class="coin ep"><div class="coin-name">银EP</div><div class="coin-val">{w.ep ?? 0}</div></div>
          <div class="coin sp"><div class="coin-name">铜SP</div><div class="coin-val">{w.sp ?? 0}</div></div>
          <div class="coin cp"><div class="coin-name">铜CP</div><div class="coin-val">{w.cp ?? 0}</div></div>
        </div>

        {(enc.equipment_weight != null || enc.total_weight != null) && (
          <div style={{ marginBottom: "10px" }}>
            <div class="bio-block-h" style={{ marginBottom: "5px" }}>负重</div>
            <div class="enc-bar">
              <div class="enc-cell">装备 <div class="v">{enc.equipment_weight ?? 0}</div></div>
              <div class="enc-cell">背包 <div class="v">{(enc.pack1_weight ?? 0) + (enc.pack2_weight ?? 0)}</div></div>
              <div class="enc-cell">总计 <div class="v">{enc.total_weight ?? 0}</div></div>
              <div class="enc-cell">上限 <div class="v">{enc.max_capacity ?? "?"}</div></div>
            </div>
          </div>
        )}

        {!!wondrous.length && (
          <FeatureBlock title="奇物 / 魔法物品" items={wondrous} />
        )}

        {items.length === 0 && !wondrous.length && (
          <div style={{ color: "var(--ink-mute)", fontStyle: "italic", padding: "6px 0" }}>
            （暂无背包细目，可在 xlsx 角色卡 "背包1/2" 表更新）
          </div>
        )}
        {!!items.length && (
          <div style={{ marginTop: "8px" }}>
            <div class="bio-block-h" style={{ marginBottom: "5px" }}>背包</div>
            {items.map((it: any) => (
              <div class="weap">
                <div class="weap-name">{it.name || "?"}</div>
                <div class="weap-atk" style={{ visibility: "hidden" }}>—</div>
                <div class="weap-dmg" style={{ background: "transparent", border: "0", color: "var(--ink-dim)" }}>
                  {it.weight != null ? `${it.weight} 磅` : ""} {it.location ? `· ${it.location}` : ""}
                </div>
                {it.description && <div class="weap-props">{it.description}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Main app ==============================================
function App() {
  const [data, setData] = useState<CharacterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const roomId = getQS("room") || "";
  const cardId = getQS("card") || "";

  const loadData = useCallback(async () => {
    if (!roomId || !cardId) {
      setError("URL 缺少 room 或 card 参数");
      return;
    }
    setError(null);
    try {
      const res = await fetch(
        `${SERVER_ORIGIN}/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data.json`,
        { cache: "no-cache" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(`加载失败：${e?.message || String(e)}`);
    }
  }, [roomId, cardId]);

  useEffect(() => { void loadData(); }, [loadData]);

  // Patch handler — for now updates local state only. Future: PUT to
  // server when /api/character/<room>/<card>/data endpoint exists.
  const onPatch = useCallback((patch: Partial<CharacterData>) => {
    setData((prev) => prev ? { ...prev, ...patch } : prev);
  }, []);

  const onExport = useCallback(() => {
    if (!data) return;
    const id = data.identity || {};
    const name = id.display_name || id.character_name || "character";
    downloadJson(`${name}-${cardId.slice(0,6)}.json`, data);
  }, [data, cardId]);

  const onImport = useCallback(() => {
    const inp = document.getElementById("ccFileInput") as HTMLInputElement | null;
    if (!inp) return;
    inp.value = "";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || !("abilities" in parsed || "identity" in parsed)) {
          window.alert("JSON 不像是角色卡数据（缺少 identity / abilities 字段）");
          return;
        }
        // Update local state immediately for snappy UI feedback.
        setData(parsed);

        // Persist to server so other clients pick it up on their
        // next fetch / refresh. Falls back to local-only preview
        // when the PUT endpoint isn't available (e.g. older server
        // build that doesn't have /data PUT yet).
        try {
          const url = `${SERVER_ORIGIN}/api/character/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data`;
          const res = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsed),
          });
          if (!res.ok) {
            const body = await res.text();
            window.alert(
              `已加载本地 JSON。\n但保存到服务器失败（HTTP ${res.status}），仅本地预览：\n${body.slice(0, 200)}`,
            );
            return;
          }
          const result = await res.json();
          if (result.render_warning) {
            window.alert(
              `已保存到服务器，但旧版静态 HTML 渲染失败：${result.render_warning}\n（不影响新全屏面板查看）`,
            );
          } else {
            window.alert(`✓ 已保存为 ${result.name}\n其他客户端刷新后可看到。`);
          }
        } catch (e: any) {
          window.alert(
            `已加载本地 JSON。\n但保存到服务器失败，仅本地预览：${e?.message || String(e)}`,
          );
        }
      } catch (e: any) {
        window.alert(`导入失败：${e?.message || String(e)}`);
      }
    };
    inp.click();
  }, [roomId, cardId]);

  if (error) {
    return <div class="cc-error">{error}</div>;
  }
  if (!data) {
    return <div class="cc-loading">加载角色卡…</div>;
  }

  return (
    <>
      <Header data={data} onExport={onExport} onImport={onImport} onRefresh={loadData} />
      <StatsBanner data={data} onPatch={onPatch} />
      <div class="cc-tabs">
        {TABS.map((t) => (
          <button class={`cc-tab ${tab === t.key ? "is-on" : ""}`}
            onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div class="cc-body">
        {tab === "overview" && (
          <div class="cc-grid">
            <AbilitiesAndSkills data={data} />
            <div>
              <Defenses data={data} />
            </div>
          </div>
        )}
        {tab === "combat" && (
          <CombatSection data={data} />
        )}
        {tab === "spells" && (
          <SpellsSection data={data} />
        )}
        {tab === "features" && (
          <FeaturesSection data={data} />
        )}
        {tab === "inventory" && (
          <InventorySection data={data} />
        )}
        {tab === "background" && (
          <BackgroundSection data={data} />
        )}
      </div>
    </>
  );
}

const appEl = document.getElementById("app");
if (appEl) {
  // Subscribe to dice SFX broadcasts so click-to-roll plays sound
  // even though this iframe normally doesn't have audio context warmed.
  try { subscribeToSfx(); } catch {}
  render(<App />, appEl);
}
