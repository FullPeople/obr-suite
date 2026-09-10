import type { Language, LibraryConfig } from "../state";

export type ContentLanguage = Language | "auto";
export type ContentLibrary = LibraryConfig & { language?: ContentLanguage };
export interface ContentSource {
  identity: string;
  id: string;
  base: string;
  indexPath: string;
  language: ContentLanguage;
  disabledSources: Set<string>;
}

/** Infer legacy presets only. An explicit auto value never guesses a language. */
export function getLibraryLanguage(library: ContentLibrary): ContentLanguage {
  if (library.language === "zh" || library.language === "en" || library.language === "auto") return library.language;
  try {
    const url = new URL(library.baseUrl);
    if (url.hostname === "5e.kiwee.top") return "zh";
    if ((url.hostname === "cdn.jsdelivr.net" && /^\/gh\/5etools-mirror-3\/5etools-src@[^/]+(?:\/|$)/i.test(url.pathname)) ||
        (url.hostname === "raw.githubusercontent.com" && /^\/5etools-mirror-3\/5etools-src\/[^/]+(?:\/|$)/i.test(url.pathname))) return "en";
  } catch { /* Invalid/unknown hosts remain unclassified, never replaced. */ }
  return "auto";
}

/** No implicit libraries. Keep configured order within each language tier. */
export function selectContentLibraries(libraries: readonly ContentLibrary[], language: Language): ContentSource[] {
  const sources = libraries.filter((library) => library.enabled && typeof library.baseUrl === "string" && library.baseUrl.trim())
    .map((library) => {
      const base = library.baseUrl.trim().replace(/\/+$/, "");
      const indexPath = library.indexPath?.replace(/^\/+/, "") || "search/index.json";
      const locale = getLibraryLanguage(library);
      const disabledSources = new Set((library.disabledSources ?? []).map((source) => source.trim().toLowerCase()).filter(Boolean));
      const identity = JSON.stringify([library.id, base, indexPath, locale, [...disabledSources].sort()]);
      return { identity, id: library.id, base, indexPath, language: locale, disabledSources };
    });
  const rank = (source: ContentSource) => source.language === language ? 0 : source.language === "auto" ? 1 : 2;
  return sources.sort((a, b) => rank(a) - rank(b));
}

export function contentConfigurationKey(libraries: readonly ContentLibrary[], language: Language): string {
  return JSON.stringify([language, selectContentLibraries(libraries, language).map((source) => source.identity)]);
}
