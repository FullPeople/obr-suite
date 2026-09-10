import { getState, getLocalLang } from "../../state";
import { getAllLocalMonsters, initLocalContent, getLocalContentSignature } from "../../utils/localContent";
import { contentConfigurationKey, selectContentLibraries, type ContentSource } from "../../utils/contentLocale";
import { fetchContentJson } from "../../utils/contentRequests";
import { makeSlug, resolveCopy, copyModTargetsAvailable } from "./data";
import { annotateMonster, canonicalMonsterKey, monsterFingerprint } from "./provenance";

let context = "";
let generation = 0;
let controller = new AbortController();
const files = new Map<string, any>();
const pending = new Map<string, Promise<any>>();
export function clearMonsterDetailCache(): void {
  generation++;
  controller.abort(); controller = new AbortController();
  files.clear(); pending.clear();
}
async function read(source: ContentSource, file: string): Promise<any | null> {
  const key = `${generation}:${source.identity}:${file}`;
  if (files.has(key)) return files.get(key);
  const existing = pending.get(key); if (existing) return existing;
  const own = generation;
  const signal = controller.signal;
  const request = (async () => {
    const response = await fetchContentJson(`${source.base}/data/bestiary/${file}`, { cache: "no-cache", signal });
    if (!response.ok) { if (response.status === 404) return null; throw new Error(`HTTP ${response.status}`); }
    const body = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid monster data");
    if (own !== generation) throw new DOMException("Content changed", "AbortError");
    files.set(key, body); return body;
  })().finally(() => { if (pending.get(key) === request) pending.delete(key); });
  pending.set(key, request); return request;
}
const matches = (monster: any, source: string, names: string[]) => monster &&
  String(monster.source ?? "").trim().toUpperCase() === source.trim().toUpperCase() &&
  [monster.ENG_name, monster.name].some((name) => typeof name === "string" && names.some((query) => query.toLowerCase() === name.toLowerCase()));

/** Read one source at a time. Parents prefer their own library, with compatible
 * enabled libraries supplying missing core dependencies. Known translations
 * stay apart so name-based _mod edits apply to the correct language. */
async function fromSource(source: ContentSource, code: string, names: string[], stack = new Set<string>(), libraries: ContentSource[] = []): Promise<any | null> {
  if (source.disabledSources.has(code.trim().toLowerCase())) return null;
  const identity = canonicalMonsterKey(makeSlug(code, names[0]));
  if (stack.has(identity)) return null;
  const nextStack = new Set(stack).add(identity);
  const index = await read(source, "index.json");
  const indexed = Object.entries(index ?? {}).find(([key, value]) => key.toLowerCase() === code.toLowerCase() && typeof value === "string")?.[1];
  const candidates = indexed ? [String(indexed)] : [...new Set([code.toLowerCase(), code, code.toUpperCase()].map((value) => `bestiary-${value}.json`))];
  for (const file of candidates) {
    const body = await read(source, file); if (!body) continue;
    if (!Array.isArray(body.monster)) throw new Error("Invalid monster list");
    const found = body.monster.find((monster: any) => matches(monster, code, names));
    if (!found) continue;
    let resolved = found;
    if (found._copy) {
      const parentNames = [found._copy.ENG_name, found._copy.name].filter((value): value is string => typeof value === "string" && !!value);
      if (!parentNames.length || !found._copy.source) return null;
      const compatible = [source, ...libraries.filter((other) => other.identity !== source.identity &&
        (source.language === "auto" || other.language === "auto" || other.language === source.language))];
      let parent: any = null;
      for (const library of compatible) {
        try {
          const candidate = await fromSource(library, found._copy.source, parentNames, nextStack, libraries);
          if (candidate && copyModTargetsAvailable(found, candidate)) parent = candidate;
        } catch {}
        if (parent) break;
      }
      if (!parent) return null;
      resolved = resolveCopy(found, new Map(parentNames.map((name) => [makeSlug(found._copy.source, name), parent])), new Set());
    }
    return annotateMonster(resolved, source);
  }
  return null;
}

/** Returns display data only: never writes the room's saved monster snapshot. */
export async function fetchLocalizedMonster(slug: string, shared?: any): Promise<any | null> {
  await initLocalContent();
  const signature = `${contentConfigurationKey(getState().libraries ?? [], getLocalLang())}:${getLocalContentSignature()}`;
  if (signature !== context) { context = signature; clearMonsterDetailCache(); }
  const own = generation;
  const separator = slug.indexOf("::"); if (separator < 0) return shared ?? null;
  const code = slug.slice(0, separator), name = slug.slice(separator + 2);
  // Old bindings sometimes used the translated title instead of ENG_name.
  // The saved record supplies that alias without changing its authored text.
  const names = [...new Set([name, ...(shared && matches(shared, code, [name]) ? [shared.ENG_name] : [])]
    .filter((value): value is string => typeof value === "string" && !!value))];
  const allSources = selectContentLibraries(getState().libraries ?? [], getLocalLang());
  const sources = allSources.filter((source) => !source.disabledSources.has(code.trim().toLowerCase()));
  const locals = getAllLocalMonsters();
  const local = locals.find((monster) => matches(monster, code, names));
  const resolveLocal = async (monster: any, stack = new Set<string>()): Promise<any | null> => {
    const identity = canonicalMonsterKey(makeSlug(monster.source, monster.ENG_name || monster.name));
    if (stack.has(identity)) return null;
    if (!monster._copy) return annotateMonster(monster);
    const nextStack = new Set(stack).add(identity);
    const copy = monster._copy;
    const names = [copy.ENG_name, copy.name].filter((value): value is string => typeof value === "string" && !!value);
    if (!copy.source || !names.length) return null;
    const localParent = locals.find((candidate) => matches(candidate, copy.source, names));
    let parent = localParent ? await resolveLocal(localParent, nextStack) : null;
    if (parent && !copyModTargetsAvailable(monster, parent)) parent = null;
    if (!localParent) for (const source of allSources) {
      try {
        const candidate = await fromSource(source, copy.source, names, nextStack, allSources);
        if (candidate && copyModTargetsAvailable(monster, candidate)) parent = candidate;
      } catch {}
      if (parent) break;
    }
    if (!parent) return null;
    return annotateMonster(resolveCopy(monster, new Map(names.map((parentName) => [makeSlug(copy.source, parentName), parent])), new Set()));
  };
  if (local) {
    const resolved = await resolveLocal(local);
    if (own !== generation) return null;
    return resolved ?? (shared ? { ...shared, _suiteDisplayNote: "saved" } : null);
  }
  const sharedMarker = shared?._suiteContent;
  const savedAuthored = sharedMarker?.authored === true || (sharedMarker?.fingerprint && sharedMarker.fingerprint !== monsterFingerprint(shared));
  if (savedAuthored) return { ...shared, _suiteDisplayNote: "saved" };
  let preferred: any | null = null;
  let knownOriginal = !!sharedMarker?.fingerprint;
  const sharedFingerprint = shared ? monsterFingerprint(shared) : "";
  for (const source of sources) {
    try {
      const monster = await fromSource(source, code, names, new Set(), allSources);
      if (own !== generation) return null;
      if (!monster) continue;
      preferred ??= monster;
      // Old saves without provenance can contain hand edits. Only switch their
      // displayed language after identifying an unchanged source snapshot.
      if (shared && monsterFingerprint(monster) === sharedFingerprint) knownOriginal = true;
      if (!shared || knownOriginal) break;
    } catch (error) {
      if (own !== generation) return null;
      console.warn("[bestiary] detail source unavailable", { base: source.base, code, error });
    }
  }
  if (shared && !knownOriginal) return { ...shared, _suiteDisplayNote: "saved" };
  if (preferred) return preferred;
  return shared ? { ...shared, _suiteDisplayNote: "saved" } : null;
}
