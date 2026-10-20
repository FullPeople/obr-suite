import { sha256Hex } from "./sha256";

export const LOCAL_CLASS_CATEGORIES = { class: 5, subclass: 40, classFeature: 30, subclassFeature: 41 } as const;
export type LocalClassKind = keyof typeof LOCAL_CLASS_CATEGORIES;
type Row = Record<string, any>;
export interface LocalClassReference {
  fileId: string;
  kind: LocalClassKind;
  digest: string;
  edition: "2014" | "2024" | "unknown";
}
export interface LocalClassRow {
  ref: LocalClassReference;
  record: Row;
  name: string;
  english: string;
  context: string;
}
export function isLocalClassKind(value: string): value is LocalClassKind {
  return Object.hasOwn(LOCAL_CLASS_CATEGORIES, value);
}
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const equal = (a: unknown, b: unknown) => text(a).toLowerCase() === text(b).toLowerCase();
const editionValue = (row: Row, body: Row) => row.edition || body._meta?.edition || "";
function edition(row: Row, body: Row): LocalClassReference["edition"] {
  const value = String(editionValue(row, body)).toLowerCase();
  return ["classic", "2014"].includes(value) ? "2014" : ["one", "2024"].includes(value) ? "2024" : "unknown";
}
function digest(kind: string, row: Row, body: Row): string {
  // Bind the complete authored record, including context and edition. Different
  // definitions with the same name must not silently select one another.
  return sha256Hex(JSON.stringify([kind, editionValue(row, body), row]));
}
const nameOf = (row: Row) => text(row.name) || text(row._copy?.name) || text(row.ENG_name) || text(row._copy?.ENG_name);
const englishOf = (row: Row) => text(row.ENG_name) || text(row._copy?.ENG_name) || nameOf(row);
const rowsOf = (body: Row, kind: string): Row[] => Array.isArray(body[kind])
  ? body[kind].filter((row: unknown) => row && typeof row === "object" && !Array.isArray(row)) : [];
const cachedRows = new WeakMap<object, { fileId: string; rows: LocalClassRow[] }>();

export function localClassRows(fileId: string, body: Row): LocalClassRow[] {
  const cached = cachedRows.get(body);
  if (cached?.fileId === fileId) return cached.rows;
  const rows: LocalClassRow[] = [];
  for (const kind of Object.keys(LOCAL_CLASS_CATEGORIES) as LocalClassKind[]) {
    for (const record of rowsOf(body, kind)) {
      const name = nameOf(record);
      if (!name) continue;
      const context = [text(record.className), text(record.subclassShortName),
        Number.isFinite(record.level) ? `Lv. ${record.level}` : ""].filter(Boolean).join(" / ");
      rows.push({ ref: { fileId, kind, digest: digest(kind, record, body), edition: edition(record, body) },
        record, name, english: englishOf(record), context });
    }
  }
  cachedRows.set(body, { fileId, rows });
  return rows;
}

/** Read-only presentation of explicit references within the selected pack.
 * External/ambiguous references stay visible; no implicit source is fetched. */
export function localClassDetails(ref: LocalClassReference, body: Row, language: "zh" | "en"): Row | null {
  if (!isLocalClassKind(ref.kind)) return null;
  const selected = localClassRows(ref.fileId, body).find(row => row.ref.kind === ref.kind && row.ref.digest === ref.digest && row.ref.edition === ref.edition);
  if (!selected) return null;
  const tr = (zh: string, en: string) => language === "en" ? en : zh;
  const notice = (title: string, message: string) => ({ type: "entries", name: title, entries: [message], _localClassNotice: true });
  const seen = new Set<string>();

  function copyInput(kind: string, row: Row, visited = new Set<string>()): Row | null {
    if (!row._copy) return row;
    const key = digest(kind, row, body), copy = row._copy;
    if (visited.has(key) || visited.size >= 24 || Object.keys(copy._mod || {}).length) return null;
    visited.add(key);
    const parents = rowsOf(body, kind).filter(parent => parent !== row && edition(parent, body) === ref.edition &&
      [parent.name, parent.ENG_name].some(value => equal(value, copy.name) || (copy.ENG_name && equal(value, copy.ENG_name))) &&
      ["source", "className", "classSource", "shortName"].every(field => !copy[field] || equal(parent[field], copy[field])));
    if (parents.length !== 1) return null;
    const parent = copyInput(kind, parents[0], visited);
    return parent ? { ...parent, ...row, _copy: undefined } : null;
  }

  function reference(kind: string, uid: unknown, depth: number): any {
    if (typeof uid !== "string") return notice(tr("引用格式暂不支持", "Unsupported reference"), String(uid ?? ""));
    const parts = uid.split("|");
    const name = parts[0];
    let candidates = rowsOf(body, kind).filter(row => edition(row, body) === ref.edition &&
      [row.name, row.ENG_name, row._copy?.name, row._copy?.ENG_name].some(value => equal(value, name)));
    // Source UID defaults follow the existing card Wiki reference contract:
    // subclass source defaults independently to PHB; feature source to its owner.
    if (kind === "classFeature" || kind === "subclassFeature") {
      const sub = kind === "subclassFeature", classSource = parts[2] || "PHB", subSource = parts[4] || "PHB";
      candidates = candidates.filter(row => [row.className, row.classEnglish].some(value => equal(value, parts[1])) &&
        equal(row.classSource || "PHB", classSource) && Number(row.level) === Number(parts[sub ? 5 : 3]) &&
        equal(row.source || (sub ? row.subclassSource : row.classSource) || "PHB", sub ? parts[6] || subSource : parts[4] || classSource) &&
        (!sub || ([row.subclassShortName, row.subclassEnglish].some(value => equal(value, parts[3])) && equal(row.subclassSource || "PHB", subSource))));
    } else candidates = candidates.filter(row => equal(row.source || "PHB", parts[1] || "PHB"));
    candidates = [...new Map(candidates.map(row => [digest(kind, row, body), row])).values()];
    if (candidates.length !== 1) return notice(name || tr("资料引用", "Reference"), candidates.length
      ? tr(`引用有多个候选，未自动选择：${uid}`, `Ambiguous reference; no definition selected: ${uid}`)
      : tr(`引用资料未载入：${uid}`, `Referenced content is not loaded: ${uid}`));
    const row = candidates[0];
    return { type: "entries", name: [nameOf(row), Number.isFinite(row.level) ? `Lv. ${row.level}` : ""].filter(Boolean).join(" · "), entries: expandRecord(kind, row, depth + 1) };
  }

  function expand(value: any, depth: number): any {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(item => expand(item, depth));
    const kind = ({ refClassFeature: "classFeature", refSubclassFeature: "subclassFeature", refOptionalfeature: "optionalfeature" } as Record<string, string>)[value.type];
    if (kind) return reference(kind, value[kind], depth + 1);
    const result = { ...value };
    for (const key of ["entries", "items", "entry", "rows"]) if (key in value) result[key] = expand(value[key], depth + 1);
    return result;
  }

  function expandRecord(kind: string, row: Row, depth: number): any[] {
    const key = digest(kind, row, body);
    if (depth > 24 || seen.has(key)) return [notice(nameOf(row), tr("循环或过深的引用，未继续展开", "Cyclic or overly deep reference; expansion stopped"))];
    seen.add(key);
    try {
      const inherited = copyInput(kind, row);
      const input = inherited || row;
      const prefix: any[] = [];
      if (row._copy && !inherited) {
        const copy = row._copy;
        prefix.push(notice(nameOf(row), tr(`引用的基础资料未载入，或继承关系暂不能解析：${copy.name || copy.ENG_name || ""} | ${copy.source || ""}`,
          `Referenced base is not loaded, or inheritance cannot be resolved: ${copy.name || copy.ENG_name || ""} | ${copy.source || ""}`)));
      }
      const output = [...prefix, ...expand(Array.isArray(input.entries) ? input.entries : [], depth + 1)];
      const featureKey = kind === "class" ? "classFeatures" : kind === "subclass" ? "subclassFeatures" : "";
      const featureKind = kind === "class" ? "classFeature" : "subclassFeature";
      if (featureKey && Array.isArray(input[featureKey])) for (const feature of input[featureKey]) {
        output.push(reference(featureKind, typeof feature === "string" ? feature : feature?.[featureKind], depth + 1));
      }
      for (const group of [...(input.classTableGroups || []), ...(input.subclassTableGroups || [])]) {
        if (Array.isArray(group?.rows)) output.push({ type: "entries", name: group.title || "", entries: [{ type: "table", colLabels: group.colLabels || [], rows: group.rows }] });
      }
      if (!output.length) output.push(notice(nameOf(row), tr("此条目没有可显示的说明正文", "This entry has no displayable description")));
      return output;
    } finally { seen.delete(key); }
  }
  return { ...selected.record, name: selected.name, ENG_name: selected.english, entries: expandRecord(ref.kind, selected.record, 0), _contentLanguage: "auto" };
}
