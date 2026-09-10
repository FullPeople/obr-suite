import type { ContentSource } from "../../utils/contentLocale";

export function canonicalMonsterKey(slug: string): string {
  const separator = slug.indexOf("::");
  return separator < 0 ? slug : `${slug.slice(0, separator).trim().toUpperCase()}::${slug.slice(separator + 2).trim().toLowerCase()}`;
}

export function annotateMonster(monster: any, source?: ContentSource): any {
  return { ...monster, _suiteContent: { version: 1, authored: !source, libraryId: source?.id,
    language: source?.language ?? "auto", base: source?.base, fingerprint: monsterFingerprint(monster) } };
}

/** Deterministic change detection, not an authorization/security signature. */
export function monsterFingerprint(monster: any): string {
  const normalize = (value: any): any => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).filter((key) => !key.startsWith("_suite") && value[key] !== undefined)
      .sort().map((key) => [key, normalize(value[key])]));
  };
  const text = JSON.stringify(normalize(monster)) ?? "null";
  let a = 2166136261, b = 2246822507;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 3266489909);
  }
  return `${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}:${text.length}`;
}
