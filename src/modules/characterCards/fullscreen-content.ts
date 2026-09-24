import { contentConfigurationKey, selectContentLibraries, type ContentLibrary, type ContentSource } from "../../utils/contentLocale";
import { fetchContentJson } from "../../utils/contentRequests";
import type { DataVersion, Language } from "../../state";

export interface SpellContext { libraries: readonly ContentLibrary[]; language: Language; version: DataVersion; ready?: boolean }
export interface SpellEntry { label: string; en: string; cn: string; source: string; aliases: string[] }
export interface SpellDetail { entry: any; language: "zh" | "en" | "auto"; source: string }
export const spellContextKey = (context: SpellContext): string => `${contentConfigurationKey(context.libraries, context.language)}:${context.version}:${context.ready !== false}`;
export function spellVersionAllowed(source: string, version: DataVersion): boolean {
  const code = source.toUpperCase();
  return version === "all" || !["PHB", "MM", "DMG", "XPHB", "XMM", "XDMG"].includes(code) ||
    (version === "2014" ? ["PHB", "MM", "DMG"] : ["XPHB", "XMM", "XDMG"]).includes(code);
}

/** One bounded, configuration-scoped cache per fullscreen iframe. No failed response is cached. */
export function createSpellContent() {
  let context = "", generation = 0, controller = new AbortController();
  const cache = new Map<string, { body: any; expires: number }>();
  const pending = new Map<string, Promise<any>>();
  function clear() { generation++; controller.abort(); controller = new AbortController(); cache.clear(); pending.clear(); }
  function configure(next: SpellContext) { const key = spellContextKey(next); if (context !== key) { context = key; clear(); } return generation; }
  async function read(source: ContentSource, path: string, own: number, valid: (body: any) => boolean = () => true): Promise<any> {
    const key = `${own}:${source.identity}:${path}`;
    const cached = cache.get(key); if (cached && cached.expires > Date.now() && valid(cached.body)) return cached.body;
    const existing = pending.get(key); if (existing) return existing;
    const work = (async () => {
      const response = await fetchContentJson(`${source.base}/${path}`, { cache: "no-cache", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (own !== generation) throw new DOMException("Content changed", "AbortError");
      if (!body || typeof body !== "object" || !valid(body)) throw new Error("Invalid spell data");
      if (cache.size >= 16) cache.delete(cache.keys().next().value!);
      cache.set(key, { body, expires: Date.now() + 300_000 }); return body;
    })().finally(() => { if (pending.get(key) === work) pending.delete(key); });
    pending.set(key, work); return work;
  }
  async function list(next: SpellContext, includeOtherVersions = false): Promise<SpellEntry[]> {
    const own = configure(next), sources = selectContentLibraries(next.libraries, next.language);
    const results = await Promise.allSettled(sources.map(async (source) => {
      const data = await read(source, source.indexPath, own, (body) => Array.isArray(body.x));
      if (!Array.isArray(data.x)) throw new Error("Invalid spell index");
      const sourceMap = new Map(Object.entries(data.m?.s ?? {}).map(([code, id]) => [id, code]));
      return data.x.filter((e: any) => e?.c === 2).map((e: any) => {
        const en = String(e.n ?? "").trim(), cn = String(e.cn ?? "").trim();
        const code = (typeof e.s === "string" ? e.s : sourceMap.get(e.s) ?? "").toUpperCase();
        return { label: next.language === "en" ? en || cn : cn || en, en, cn, source: code, aliases: [en, cn].filter(Boolean) };
      }).filter((e: SpellEntry) => e.label && !source.disabledSources.has(e.source.toLowerCase()) && (includeOtherVersions || spellVersionAllowed(e.source, next.version)));
    }));
    if (own !== generation) throw new DOMException("Content changed", "AbortError");
    if (sources.length && results.every((result) => result.status === "rejected")) throw new Error("Spell libraries unavailable");
    const byKey = new Map<string, SpellEntry>();
    for (const result of results) if (result.status === "fulfilled") for (const entry of result.value) {
      const key = `${(entry.en || entry.cn).toLowerCase()}|${entry.source}`;
      const prior = byKey.get(key);
      if (prior) prior.aliases = [...new Set([...prior.aliases, ...entry.aliases])]; else byKey.set(key, entry);
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, next.language) || a.source.localeCompare(b.source));
  }
  async function detail(reference: SpellEntry, next: SpellContext): Promise<SpellDetail | null> {
    const own = configure(next);
    // A saved PHB reference stays PHB even while the picker shows 2024 entries.
    if (!reference.source) return null;
    for (const source of selectContentLibraries(next.libraries, next.language)) {
      if (source.disabledSources.has(reference.source.toLowerCase())) continue;
      try {
        const index = await read(source, "data/spells/index.json", own, (body) => !Array.isArray(body));
        const file = Object.entries(index).find(([code, path]) => code.toUpperCase() === reference.source && typeof path === "string")?.[1];
        // A library index is data, not authority to fetch an arbitrary URL.
        if (typeof file !== "string" || !/^[a-z0-9_.-]+\.json$/i.test(file)) continue;
        const body = await read(source, `data/spells/${file}`, own, (body) => Array.isArray(body.spell));
        if (!Array.isArray(body.spell)) throw new Error("Invalid spell list");
        const aliases = reference.aliases.map((name) => name.toLowerCase());
        const entry = body.spell.find((spell: any) => String(spell?.source ?? "").toUpperCase() === reference.source &&
          [spell?.name, spell?.ENG_name].some((name) => typeof name === "string" && aliases.includes(name.toLowerCase())));
        if (entry && Array.isArray(entry.entries)) return { entry, language: source.language, source: reference.source };
      } catch (error) { if (own !== generation) throw error; }
    }
    return null;
  }
  return { list, detail, clear };
}

/** Plain text only: imported/library strings never become HTML. Keeps lists and tables readable. */
export function spellEntryText(entry: any): string {
  if (typeof entry === "string") return entry.replace(/\{@\w+\s+([^}]+)\}/g, (_all, args: string) => { const bits = args.split("|"); return bits[2] || bits[0]; });
  if (Array.isArray(entry)) return entry.map(spellEntryText).filter(Boolean).join("\n\n");
  if (!entry || typeof entry !== "object") return "";
  if (entry.roll) return entry.roll.exact != null ? String(entry.roll.exact) : [entry.roll.min, entry.roll.max].filter((value) => value != null).join("–");
  if (entry.type === "table") return [spellEntryText(entry.intro), spellEntryText(entry.caption), Array.isArray(entry.colLabels) ? entry.colLabels.map(spellEntryText).join(" | ") : "", ...((Array.isArray(entry.rows) ? entry.rows : []).map((row: any) => Array.isArray(row?.row ?? row) ? (row.row ?? row).map(spellEntryText).join(" | ") : spellEntryText(row))), spellEntryText(entry.footnotes), spellEntryText(entry.outro)].filter(Boolean).join("\n");
  if (entry.type === "list") return (entry.items ?? []).map((item: any) => `• ${spellEntryText(item)}`).join("\n");
  return [entry.name, spellEntryText(entry.entries ?? entry.entry ?? entry.items)].filter(Boolean).join("\n");
}

/** Keep mechanical spell fields beside the full rules body. Unknown fields stay source text. */
export function spellMechanicalText(entry: any, language: Language): string[] {
  const word = (en: string, zh: string) => language === "en" ? en : zh;
  const schools: Record<string, string> = { A: word("Abjuration", "防护"), C: word("Conjuration", "咒法"), D: word("Divination", "预言"), E: word("Enchantment", "惑控"), V: word("Evocation", "塑能"), I: word("Illusion", "幻术"), N: word("Necromancy", "死灵"), T: word("Transmutation", "变化") };
  const unit = (value: string) => language === "en" ? ({ bonus: "bonus action", instant: "instantaneous" } as Record<string, string>)[value] ?? value : ({ action: "动作", bonus: "附赠动作", reaction: "反应", round: "轮", minute: "分钟", hour: "小时", day: "天", feet: "尺", miles: "英里", self: "自身", touch: "接触", sight: "视野", unlimited: "无限", instantaneous: "瞬间", instant: "瞬间", permanent: "永久", special: "特殊", cone: "锥形", line: "线形", sphere: "球形", cube: "立方体", cylinder: "柱形", hemisphere: "半球形", radius: "半径" } as Record<string, string>)[value] ?? value;
  const numberUnit = (value: any) => [value?.number ?? value?.amount, unit(String(value?.unit ?? value?.type ?? "")), value?.condition].filter((part) => part != null && part !== "").join(" ");
  const result: string[] = [];
  if (entry.school) result.push(schools[entry.school] ?? String(entry.school));
  if (Array.isArray(entry.time)) result.push(`${word("Casting time", "施法时间")}: ${entry.time.map(numberUnit).join(" / ")}`);
  if (entry.range) {
    const range = entry.range;
    result.push(`${word("Range", "射程")}: ${[range.type !== "point" ? unit(range.type) : "", numberUnit(range.distance)].filter(Boolean).join(" ")}`);
  }
  if (entry.components) {
    const c = entry.components;
    result.push(`${word("Components", "成分")}: ${[c.v ? "V" : "", c.s ? "S" : "", c.m ? `M${typeof c.m === "string" ? ` (${c.m})` : typeof c.m?.text === "string" ? ` (${c.m.text})` : ""}` : ""].filter(Boolean).join(", ")}`);
    if (typeof c.m?.cost === "number") result.push(`${word("Material value", "材料价值")}: ${c.m.cost / 100} ${word("gp", "金币")}`);
    if (c.m?.consume) result.push(word(c.m.consume === "optional" ? "Material may be consumed" : "Material is consumed", c.m.consume === "optional" ? "可选择消耗材料" : "消耗材料"));
  }
  if (Array.isArray(entry.duration)) result.push(`${word("Duration", "持续时间")}: ${entry.duration.map((duration: any) => [duration.concentration ? word("Concentration", "专注") : "", duration.duration?.upTo ? word("up to", "至多") : "", duration.type === "timed" ? numberUnit(duration.duration) : unit(duration.type), duration.ends?.join(" / ")].filter(Boolean).join(" ")).join(" / ")}`);
  if (entry.meta?.ritual) result.push(word("Ritual", "仪式"));
  return result;
}
