// Suite-wide colour presets. The <html data-suite-theme> attribute selects a
// token set in src/styles/suite-ui.css; every popover reads its colours from
// those tokens. The chosen preset lives in localStorage so each client picks
// its own look, and the inline boot script (vite.config.ts → suiteUi()) applies
// it before first paint on every page.
import { ICONS } from "../icons";

export const SUITE_THEME_KEY = "full-suite/ui-theme";
export type SuiteThemeId = "night" | "graphite" | "parchment" | "celadon";

export interface SuiteThemeDef {
  id: SuiteThemeId;
  zh: string;
  en: string;
  descZh: string;
  descEn: string;
  /** True for the two light presets — mirrors the workbench night flag. */
  dark: boolean;
  /** Swatch colours: bg, card, accent, text. */
  swatch: [string, string, string, string];
}

export const SUITE_THEMES: SuiteThemeDef[] = [
  { id: "night", zh: "夜航", en: "Night", descZh: "深蓝夜色，默认外观", descEn: "Dark navy, the default look", dark: true, swatch: ["#292d3c", "#323748", "#5dade2", "#e6e8ee"] },
  { id: "graphite", zh: "石墨", en: "Graphite", descZh: "中性深灰，低饱和", descEn: "Neutral dark grey", dark: true, swatch: ["#202125", "#2a2c32", "#8fb4f0", "#ebebef"] },
  { id: "parchment", zh: "羊皮纸", en: "Parchment", descZh: "暖色纸面，适合明亮环境", descEn: "Warm paper for bright rooms", dark: false, swatch: ["#f3ead9", "#fbf5e8", "#8a5424", "#352a1e"] },
  { id: "celadon", zh: "青瓷", en: "Celadon", descZh: "浅色青绿，清爽明亮", descEn: "Light teal, crisp and bright", dark: false, swatch: ["#edf4f1", "#ffffff", "#24806f", "#1c2f2c"] },
];

export const DEFAULT_SUITE_THEME: SuiteThemeId = "night";

export function isSuiteTheme(value: unknown): value is SuiteThemeId {
  return SUITE_THEMES.some((theme) => theme.id === value);
}

export function readSuiteTheme(): SuiteThemeId {
  try {
    const stored = localStorage.getItem(SUITE_THEME_KEY);
    if (isSuiteTheme(stored)) return stored;
  } catch {}
  return DEFAULT_SUITE_THEME;
}

/** Apply a preset to this document (no persistence). */
export function applySuiteTheme(id: SuiteThemeId = readSuiteTheme()): void {
  document.documentElement.dataset.suiteTheme = isSuiteTheme(id) ? id : DEFAULT_SUITE_THEME;
}

/** Persist + apply. Other open popovers follow via the `storage` event. */
export function saveSuiteTheme(id: SuiteThemeId): void {
  try { localStorage.setItem(SUITE_THEME_KEY, id); } catch {}
  applySuiteTheme(id);
}

export function suiteThemeDef(id: SuiteThemeId = readSuiteTheme()): SuiteThemeDef {
  return SUITE_THEMES.find((theme) => theme.id === id) ?? SUITE_THEMES[0];
}

/** Four swatch cards; the pressed one is the active preset. */
export function renderThemePicker(lang: "zh" | "en", active: SuiteThemeId = readSuiteTheme()): string {
  return `<div class="theme-grid" role="group" aria-label="${lang === "zh" ? "配色方案" : "Colour scheme"}">${SUITE_THEMES.map((theme) =>
    `<button type="button" class="theme-card" data-suite-theme-pick="${theme.id}" aria-pressed="${theme.id === active}">` +
      `<span class="theme-swatch" aria-hidden="true">${theme.swatch.map((color) => `<i style="background:${color}"></i>`).join("")}</span>` +
      `<span class="theme-name">${theme.id === active ? ICONS.checkCircle : ICONS.palette}${lang === "zh" ? theme.zh : theme.en}</span>` +
      `<span class="theme-desc">${lang === "zh" ? theme.descZh : theme.descEn}</span>` +
    `</button>`).join("")}</div>`;
}

/** Wire the cards rendered by renderThemePicker. `onPick` runs after the preset is saved. */
export function bindThemePicker(root: ParentNode, onPick?: (theme: SuiteThemeDef) => void): void {
  const cards = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-suite-theme-pick]"));
  for (const card of cards) {
    card.addEventListener("click", () => {
      const id = card.dataset.suiteThemePick;
      if (!isSuiteTheme(id)) return;
      saveSuiteTheme(id);
      for (const other of cards) {
        const on = other === card;
        other.setAttribute("aria-pressed", String(on));
        const name = other.querySelector<HTMLElement>(".theme-name");
        if (name) {
          name.querySelector("svg")?.remove();
          name.insertAdjacentHTML("afterbegin", on ? ICONS.checkCircle : ICONS.palette);
        }
      }
      onPick?.(suiteThemeDef(id));
    });
  }
}
