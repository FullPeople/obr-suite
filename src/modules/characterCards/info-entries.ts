import { ccName, ccText, type CardLanguage } from "./localization";
import { fullDescription } from "./fullscreen-localization";

function escape(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

/** Read authored descriptions locally; searching remains an explicit option. */
export function renderCardEntries(data: any, lang: CardLanguage, openEntries = new Set<string>()): string {
  const features = data.features ?? {};
  const groups: [string, string, any[]][] = [];
  const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
  groups.push(["features", "features", [...array(features.race_features), ...array(features.class_features)]]);
  groups.push(["fightingStyle", "fightingStyle", array(features.fighting_style_feats)]);
  groups.push(["specialAbilities", "specialAbilities", array(features.special_abilities)]);
  groups.push(["feats", "feats", array(features.feats)]);

  const spells = data.spellcasting ?? {}, seen = new Set<string>();
  const spellList = ["cantrips_known", "always_known", "prepared"].flatMap(key => array(spells[key])).filter(entry => {
    const name = typeof entry?.name === "string" ? entry.name : ccName(entry, lang);
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  groups.push(["spells", "spells", spellList]);

  return groups.map(([slot, label, items]) => {
    const chips = items.map((entry, index) => {
      const name = ccName(entry, lang);
      if (!name.trim()) return "";
      const text = fullDescription(entry, lang), id = `${slot}:${index}`;
      const search = `<button type="button" class="srch-chip" data-q="${escape(name)}" title="${escape(name)}">${escape(text ? ccText("search", lang) : name)}</button>`;
      if (!text.trim()) return search;
      return `<details class="cc-entry" data-entry-id="${id}"${openEntries.has(id) ? " open" : ""}>
        <summary class="srch-chip" title="${escape(name)}">${escape(name)}</summary>
        <div class="cc-entry-body">${escape(text)}</div>
        <div class="cc-entry-actions">${search}</div>
      </details>`;
    }).join("");
    return chips ? `<section class="srch-sect" data-entry-group="${slot}">
      <div class="srch-sect-h">${ccText(label, lang)}</div><div class="srch-grid">${chips}</div>
    </section>` : "";
  }).join("");
}
