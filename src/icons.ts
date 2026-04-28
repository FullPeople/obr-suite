// Inline SVG icon set — replaces emoji glyphs that varied across OS/font
// renderers and looked inconsistent. All icons share:
//   - 24×24 viewBox, currentColor stroke/fill
//   - 1em width/height so they scale with surrounding text font-size
//   - vertical-align tuned so the icon sits centered next to text
//
// Use in HTML templates:   `${ICONS.swords} 武器 / 攻击`
// Use in Preact JSX:       <span dangerouslySetInnerHTML={{ __html: ICONS.swords }} />

function svg(content: string, opts: { fill?: string; sw?: number } = {}): string {
  const fill = opts.fill ?? "none";
  const sw = opts.sw ?? 2;
  return (
    `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="${fill}" ` +
    `stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" ` +
    `stroke-linejoin="round" style="vertical-align:-0.18em">${content}</svg>`
  );
}

export const ICONS = {
  // 💖 — heart with a small 4-point spark; soft fill for warmth
  heartSpark: svg(
    `<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" fill="currentColor" fill-opacity="0.18"/>` +
    `<path d="M19.5 3.5l.7 1.4 1.4.7-1.4.7-.7 1.4-.7-1.4-1.4-.7 1.4-.7z"/>`
  ),
  // 📌 — push pin
  pin: svg(
    `<path d="M12 17v5"/>` +
    `<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>`
  ),
  // 📚 — library / data version (book on shelf)
  library: svg(
    `<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>` +
    `<line x1="9" y1="6" x2="14" y2="6"/>`
  ),
  // ⏸ — clock with pause bars (time stop)
  clockPause: svg(
    `<circle cx="12" cy="12" r="9.5"/>` +
    `<line x1="9.5" y1="8" x2="9.5" y2="16"/>` +
    `<line x1="14.5" y1="8" x2="14.5" y2="16"/>`
  ),
  // 🎯 — crosshair (sync viewport)
  crosshair: svg(
    `<circle cx="12" cy="12" r="9.5"/>` +
    `<circle cx="12" cy="12" r="2"/>` +
    `<line x1="22" y1="12" x2="18" y2="12"/>` +
    `<line x1="6" y1="12" x2="2" y2="12"/>` +
    `<line x1="12" y1="6" x2="12" y2="2"/>` +
    `<line x1="12" y1="22" x2="12" y2="18"/>`
  ),
  // 🐉 — horned creature head (bestiary)
  dragon: svg(
    `<path d="M5 3l3 4M19 3l-3 4"/>` +
    `<path d="M8 7c0-2 2-3 4-3s4 1 4 3v4c0 4-2 7-4 9-2-2-4-5-4-9V7z"/>` +
    `<circle cx="10" cy="11" r="0.8" fill="currentColor"/>` +
    `<circle cx="14" cy="11" r="0.8" fill="currentColor"/>` +
    `<path d="M10.5 16h3"/>`
  ),
  // 📇 — id card (character cards)
  idCard: svg(
    `<rect x="3" y="5" width="18" height="14" rx="2"/>` +
    `<circle cx="9" cy="11" r="2"/>` +
    `<path d="M5.5 17a4 4 0 0 1 7 0"/>` +
    `<line x1="15" y1="9" x2="19" y2="9"/>` +
    `<line x1="15" y1="13" x2="18" y2="13"/>`
  ),
  // ⚔ — crossed swords (initiative / weapons / attack)
  swords: svg(
    `<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/>` +
    `<line x1="13" y1="19" x2="19" y2="13"/>` +
    `<line x1="16" y1="16" x2="20" y2="20"/>` +
    `<line x1="19" y1="21" x2="21" y2="19"/>` +
    `<polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/>` +
    `<line x1="5" y1="14" x2="9" y2="18"/>` +
    `<line x1="7" y1="17" x2="4" y2="20"/>` +
    `<line x1="3" y1="19" x2="5" y2="21"/>`
  ),
  // 🔍 — magnifier (search)
  search: svg(
    `<circle cx="11" cy="11" r="7.5"/>` +
    `<line x1="21" y1="21" x2="16.5" y2="16.5"/>`
  ),
  // ☕ — coffee cup
  coffee: svg(
    `<path d="M17 8h1a4 4 0 1 1 0 8h-1"/>` +
    `<path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>` +
    `<line x1="6" y1="2" x2="6" y2="4"/>` +
    `<line x1="10" y1="2" x2="10" y2="4"/>` +
    `<line x1="14" y1="2" x2="14" y2="4"/>`
  ),
  // ♥ — solid heart (Afdian / love)
  heart: svg(
    `<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/>`,
    { fill: "currentColor", sw: 1.5 }
  ),
  // 📮 — envelope (feedback / mail)
  mail: svg(
    `<rect x="2.5" y="4.5" width="19" height="15" rx="2"/>` +
    `<path d="m21 7-9 5.5L3 7"/>`
  ),
  // 👤 — person (Owner / player)
  user: svg(
    `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>` +
    `<circle cx="12" cy="7" r="4"/>`
  ),
  // ⚠️ — warning triangle
  warning: svg(
    `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>` +
    `<line x1="12" y1="9" x2="12" y2="13.5"/>` +
    `<circle cx="12" cy="17" r="0.8" fill="currentColor"/>`
  ),
  // ✓ — check
  check: svg(`<polyline points="20 6 9 17 4 12"/>`, { sw: 2.5 }),
  // 📖 — open book
  book: svg(
    `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>` +
    `<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`
  ),
  // ✦ — 4-point sparkle (traits)
  sparkle4: svg(
    `<path d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2 2-7z"/>`,
    { fill: "currentColor", sw: 0.5 }
  ),
  // ⚡ — lightning (bonus action / ambush)
  zap: svg(
    `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
    { fill: "currentColor", sw: 1.5 }
  ),
  // 🛡 — shield (reaction)
  shield: svg(
    `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>`
  ),
  // ★ — solid 5-point star (legendary)
  star: svg(
    `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
    { fill: "currentColor", sw: 1.5 }
  ),
  // ✨ — radiant sparkles (spellcasting)
  sparkles: svg(
    `<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.5 5.5l2 2M16.5 16.5l2 2M5.5 18.5l2-2M16.5 7.5l2-2"/>` +
    `<circle cx="12" cy="12" r="3" fill="currentColor"/>`
  ),
  // ⏹ — stop square (end combat)
  stop: svg(
    `<rect x="6" y="6" width="12" height="12" rx="1.5"/>`,
    { fill: "currentColor" }
  ),
  // 🎲 — d20 (vertex view). Matches the user's reference: clean hex
  // silhouette + sparse internal triangulation (top-V from peak, single
  // horizontal band, bottom-V back up to bottom vertex). Two small pip
  // dots on the upper-front face.
  d20: svg(
    `<polygon points="12,2 20.5,7 20.5,17 12,22 3.5,17 3.5,7" stroke-linejoin="round"/>` +
    `<line x1="12" y1="2" x2="7.5" y2="16"/>` +
    `<line x1="12" y1="2" x2="16.5" y2="16"/>` +
    `<line x1="7.5" y1="16" x2="16.5" y2="16"/>` +
    `<line x1="12" y1="22" x2="7.5" y2="16"/>` +
    `<line x1="12" y1="22" x2="16.5" y2="16"/>` +
    `<circle cx="9" cy="8.2" r="0.55" fill="currentColor" stroke="none"/>` +
    `<circle cx="10.2" cy="12.4" r="0.55" fill="currentColor" stroke="none"/>`
  ),
  // ◐ — portal swirl (concentric arcs forming a vortex)
  portal: svg(
    `<circle cx="12" cy="12" r="9"/>` +
    `<path d="M12 3 a9 9 0 0 1 0 18 a5 5 0 0 1 0 -10 a2 2 0 0 1 0 4" stroke-width="1.6"/>`
  ),
};

export type IconName = keyof typeof ICONS;
