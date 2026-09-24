// The three strings the portals module needs, split out of `i18n.ts`.
//
// Why a separate file for three entries: `portals/index.ts` is in
// `background.ts`'s import graph, so it is on the boot path that EVERY
// client pays before the extension can do anything. It was the only
// thing in that graph importing `i18n.ts`, and `i18n.ts` is one flat
// ~600-key object literal — indexed dynamically, so rollup cannot
// tree-shake individual keys and all 46 kB came along for three
// strings.
//
// `i18n.ts` spreads this back into its own table, so these remain the
// single definition. Nothing iterates `TR` — `t()` is a single-key
// lookup and `applyI18nDom` looks up keys named by DOM attributes — so
// where the entries physically live, and their order in the object, is
// unobservable.
//
// If you add a portal string, add it HERE, not to `i18n.ts`.

export const PORTAL_I18N = {
  portalToolName: { zh: "传送门", en: "Portal" },
  portalToolHint: { zh: "画圈创建传送门", en: "Drag to create a portal" },
  portalUnnamed: { zh: "(未命名)", en: "(unnamed)" },
} as const;
