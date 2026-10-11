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
  // 📦 — box / package, used by the World Pack tab. Slanted 3D look
  // so it reads as "container with stuff inside" rather than a flat
  // square.
  box: svg(
    `<path d="M3 7 L12 3 L21 7 L21 17 L12 21 L3 17 Z"/>` +
    `<path d="M3 7 L12 11 L21 7"/>` +
    `<line x1="12" y1="11" x2="12" y2="21"/>` +
    `<path d="M7.5 5 L16.5 9" stroke-dasharray="2 2"/>`,
    { sw: 1.7 }
  ),
  // 🔭 — telescope tube on tripod. Same artwork as
  // public/metadata-inspector-icon.svg so the OBR tool icon and the
  // Settings tab use the same glyph.
  telescope: svg(
    `<path d="M19.5 4.5 L21 6 L7.5 19.5 L6 18 Z"/>` +
    `<line x1="18" y1="3" x2="22.5" y2="7.5"/>` +
    `<line x1="5" y1="17" x2="8" y2="20"/>` +
    `<line x1="6.5" y1="18.5" x2="3.5" y2="22"/>` +
    `<line x1="6.5" y1="18.5" x2="6.5" y2="22"/>` +
    `<line x1="6.5" y1="18.5" x2="9.5" y2="22"/>`,
    { sw: 1.6 }
  ),
  // 🎵 — vinyl record + center label. Mirrors public/music-board-icon.svg.
  // Used by the music board tool button and settings tab.
  music: svg(
    `<circle cx="12" cy="12" r="9"/>` +
    `<circle cx="12" cy="12" r="3"/>`,
    { sw: 1.6 }
  ),
  // 👁️ — eye + light rings, fullFog plugin glyph. Mirrors
  // public/fullfog-icon.svg.
  eye: svg(
    `<path d="M2 12 c2.5 -4.5 5.7 -6.5 10 -6.5 s7.5 2 10 6.5 c-2.5 4.5 -5.7 6.5 -10 6.5 s-7.5 -2 -10 -6.5 z"/>` +
    `<circle cx="12" cy="12" r="3.2"/>` +
    `<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>`,
    { sw: 1.8 }
  ),
  // ⊙ — central circle ringed by 4 cardinal + 4 diagonal dots,
  // mirrors public/status-icon.svg (status-tracker glyph used by
  // the SCG-style condition wheel UI).
  statusWheel: svg(
    `<circle cx="12" cy="12" r="3.2"/>` +
    `<circle cx="12" cy="4" r="1.6"/>` +
    `<circle cx="20" cy="12" r="1.6"/>` +
    `<circle cx="12" cy="20" r="1.6"/>` +
    `<circle cx="4" cy="12" r="1.6"/>` +
    `<circle cx="17.5" cy="6.5" r="1.2"/>` +
    `<circle cx="6.5" cy="17.5" r="1.2"/>` +
    `<circle cx="17.5" cy="17.5" r="1.2"/>` +
    `<circle cx="6.5" cy="6.5" r="1.2"/>`
  ),
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
  // Three-panel folding screen / triptych unfolding toward the viewer
  // — bestiary tool glyph. Mirrors public/bestiary-icon.svg so the
  // OBR tool icon and the settings tab use the same artwork.
  dragon: svg(
    // Left wing
    `<path d="M2.7 6.3 L7.5 5 L7.5 19 L2.7 17.7 Z"/>` +
    `<line x1="5.1" y1="7.5" x2="5.1" y2="16.5"/>` +
    // Centre panel
    `<path d="M7.5 5 L16.5 5 L16.5 19 L7.5 19 Z"/>` +
    `<line x1="12" y1="6" x2="12" y2="18"/>` +
    // Right wing
    `<path d="M16.5 5 L21.3 6.3 L21.3 17.7 L16.5 19 Z"/>` +
    `<line x1="18.9" y1="7.5" x2="18.9" y2="16.5"/>` +
    // Top + bottom trim
    `<path d="M2.7 6.3 L7.5 5 L16.5 5 L21.3 6.3"/>` +
    `<path d="M2.7 17.7 L7.5 19 L16.5 19 L21.3 17.7"/>`
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
  // 👀 — two heads peeking from behind a wall, "where's the trickster?"
  trickster: svg(
    `<path d="M2 14 h20 v8 h-20 z"/>` +
    `<path d="M5 14 c0 -3.4 1.7 -5.4 4 -5.4 c2.3 0 4 2 4 5.4" stroke-width="1.6"/>` +
    `<path d="M14 14 c0 -2.6 1.4 -4.2 3 -4.2 c1.6 0 3 1.6 3 4.2" stroke-width="1.6"/>` +
    `<circle cx="9" cy="11.6" r="0.9" fill="currentColor" stroke="none"/>` +
    `<circle cx="17" cy="12" r="0.8" fill="currentColor" stroke="none"/>`
  ),
  // ⊙ — circular crop frame: outer ring + inner content boundary
  circleImage: svg(
    `<circle cx="12" cy="12" r="9.5"/>` +
    `<circle cx="12" cy="12" r="6" stroke-width="1.6"/>` +
    `<path d="M9.2 13.5 l1.6 -1.9 l1.1 1.3 l1.4 -1.7 l2.1 2.3" stroke-width="1.4"/>`
  ),
  // 🔗 — two circles connected by a dashed arrow, "follow"
  follow: svg(
    `<circle cx="6.5" cy="12" r="2.4"/>` +
    `<circle cx="17.5" cy="12" r="2.4"/>` +
    `<path d="M9 12 L15 12" stroke-dasharray="2 2"/>` +
    `<path d="M13 9 L15 12 L13 15"/>`,
    { sw: 1.8 }
  ),
  // --- 2026-10 unified controls: close, chevrons, refresh, grips, tool glyphs ---
  close: svg(`<path d="M6 6 L18 18 M18 6 L6 18"/>`),
  chevronDown: svg(`<path d="M6 9 L12 15 L18 9"/>`),
  chevronRight: svg(`<path d="M9 6 L15 12 L9 18"/>`),
  chevronUp: svg(`<path d="M6 15 L12 9 L18 15"/>`),
  chevronLeft: svg(`<path d="M15 6 L9 12 L15 18"/>`),
  refresh: svg(`<path d="M20 12 a8 8 0 1 1 -2.3 -5.7"/><path d="M20 4 v5 h-5"/>`),
  undo: svg(`<path d="M8 7 H4 V3"/><path d="M4.5 7.5 A8 8 0 1 1 4 12.5"/>`),
  redo: svg(`<path d="M16 7 h4 V3"/><path d="M19.5 7.5 A8 8 0 1 0 20 12.5"/>`),
  folder: svg(`<path d="M3 7 a2 2 0 0 1 2 -2 h4.5 l2 2 H19 a2 2 0 0 1 2 2 v9 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2 -2 Z"/>`, { sw: 1.8 }),
  clipboard: svg(`<rect x="6" y="5" width="12" height="16" rx="1.5"/><path d="M9 5 a3 3 0 0 1 6 0"/><path d="M9 11 h6 M9 15 h6"/>`, { sw: 1.8 }),
  upload: svg(`<path d="M12 16 V4 m0 0 l-4 4 m4 -4 l4 4"/><path d="M4 17 v2 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-2"/>`, { sw: 1.8 }),
  download: svg(`<path d="M12 4 v12 m0 0 l-4 -4 m4 4 l4 -4"/><path d="M4 17 v2 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-2"/>`, { sw: 1.8 }),
  lock: svg(`<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5 V7 a4 4 0 0 1 8 0 v3.5 M12 14.5 v2.5"/>`, { sw: 1.8 }),
  link: svg(`<path d="M10 14 a4 4 0 0 0 5.7 0 l3 -3 a4 4 0 0 0 -5.7 -5.7 l-1.2 1.2"/><path d="M14 10 a4 4 0 0 0 -5.7 0 l-3 3 a4 4 0 0 0 5.7 5.7 l1.2 -1.2"/>`, { sw: 1.8 }),
  trash: svg(`<path d="M4 7 h16 M9 7 V4 h6 v3 M6 7 l1 13 h10 l1 -13"/><path d="M10 11 v6 M14 11 v6"/>`, { sw: 1.8 }),
  plus: svg(`<path d="M12 5 v14 M5 12 h14"/>`),
  minus: svg(`<path d="M5 12 h14"/>`),
  grip: svg(`<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>`, { sw: 1.8 }),
  edit: svg(`<path d="M4 20 h4 L19 9 l-4 -4 L4 16 Z"/><path d="M13 7 l4 4"/>`, { sw: 1.8 }),
  film: svg(`<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M7 5 v14 M17 5 v14 M3 9 h4 M3 15 h4 M17 9 h4 M17 15 h4"/>`, { sw: 1.6 }),
  phone: svg(`<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18 h2"/>`, { sw: 1.8 }),
  books: svg(`<path d="M4 4 h4 v16 H4 Z M10 4 h4 v16 h-4 Z"/><path d="M14.5 4.6 l3.8 -1 l4 15.5 l-3.8 1 Z"/>`, { sw: 1.6 }),
  chart: svg(`<path d="M4 20 h16"/><rect x="6" y="11" width="3" height="7"/><rect x="11" y="6" width="3" height="12"/><rect x="16" y="14" width="3" height="4"/>`, { sw: 1.8 }),
  checkCircle: svg(`<circle cx="12" cy="12" r="9"/><path d="M8 12.5 l2.5 2.5 L16 9.5"/>`, { sw: 1.8 }),
  xCircle: svg(`<circle cx="12" cy="12" r="9"/><path d="M9 9 l6 6 M15 9 l-6 6"/>`, { sw: 1.8 }),
  triangleUp: svg(`<path d="M12 5 L20 18 H4 Z" fill="currentColor" stroke="none"/>`, { sw: 1 }),
  triangleDown: svg(`<path d="M12 19 L4 6 H20 Z" fill="currentColor" stroke="none"/>`, { sw: 1 }),
  dot: svg(`<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>`, { sw: 1 }),
  die: svg(`<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>`, { sw: 1.8 }),
  moon: svg(`<path d="M20 14.5 A8.5 8.5 0 1 1 9.5 4 a7 7 0 0 0 10.5 10.5 Z"/>`, { sw: 1.8 }),
  scales: svg(`<path d="M12 3 v18 M5 21 h14 M4 7 h16"/><path d="M7 7 l-3.5 7 a3.5 2.5 0 0 0 7 0 Z M17 7 l-3.5 7 a3.5 2.5 0 0 0 7 0 Z"/>`, { sw: 1.6 }),
  help: svg(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5 a2.5 2.5 0 1 1 3.5 2.3 c-0.8 0.4 -1 0.9 -1 1.7"/><circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none"/>`, { sw: 1.8 }),
  hand: svg(`<path d="M8 11 V5.5 a1.5 1.5 0 0 1 3 0 V11 M11 10 V4 a1.5 1.5 0 0 1 3 0 v6 M14 10.5 V6 a1.5 1.5 0 0 1 3 0 v7.5 a6 6 0 0 1 -6 6 h-1 a6 6 0 0 1 -5 -2.7 L3.5 14 a1.5 1.5 0 0 1 2.5 -1.6 L8 14"/>`, { sw: 1.6 }),
  brush: svg(`<path d="M14 4 l6 6 -8 8 -6 -6 Z"/><path d="M6 12 l-2 2 a3 3 0 0 0 4 4 l2 -2"/>`, { sw: 1.8 }),
  eraser: svg(`<path d="M3 16 l9 -9 a2 2 0 0 1 2.8 0 l4.2 4.2 a2 2 0 0 1 0 2.8 L13 20 H8 Z"/><path d="M8 20 l-5 -4 M13 20 h8"/>`, { sw: 1.8 }),
  circle: svg(`<circle cx="12" cy="12" r="8"/>`, { sw: 1.8 }),
  hexagon: svg(`<path d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z"/>`, { sw: 1.8 }),
  wand: svg(`<path d="M4 20 L15 9"/><path d="M15 3 l0.7 1.6 L17.3 5.3 l-1.6 0.7 L15 7.6 l-0.7 -1.6 L12.7 5.3 l1.6 -0.7 Z"/><path d="M19 10 l0.5 1 1 0.5 -1 0.5 -0.5 1 -0.5 -1 -1 -0.5 1 -0.5 Z"/>`, { sw: 1.8 }),
  bucket: svg(`<path d="M5 9 l7 -5 7 5 -2 10 H7 Z"/><path d="M5 9 c2 1.5 12 1.5 14 0"/>`, { sw: 1.8 }),
  drop: svg(`<path d="M12 3 c3 4 6 7.5 6 11 a6 6 0 0 1 -12 0 c0 -3.5 3 -7 6 -11 Z"/>`, { sw: 1.8 }),
  door: svg(`<path d="M5 21 V4 h11 v17"/><path d="M16 4 l3 2 v15 M12 12 h1"/>`, { sw: 1.8 }),
  ruler: svg(`<path d="M3 17 L17 3 l4 4 L7 21 Z"/><path d="M8 16 l2 2 M11 13 l2 2 M14 10 l2 2"/>`, { sw: 1.8 }),
  eyeOff: svg(`<path d="M3 3 l18 18"/><path d="M10.5 6.3 A10 10 0 0 1 22 12 a10.5 10.5 0 0 1 -3.2 3.8 M6.8 8.2 A10.5 10.5 0 0 0 2 12 c2.5 4.5 5.7 6.5 10 6.5 a9 9 0 0 0 3.6 -0.8"/>`, { sw: 1.8 }),
  gear: svg(`<path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 3 3-1 2 2 3-1 1-3 3-2-1-3 1-3-3-2-3 1Z"/><circle cx="12" cy="11" r="3"/>`, { sw: 1.8 }),
  magnet: svg(`<path d="M6 3 v9 a6 6 0 0 0 12 0 V3"/><path d="M6 3 h4 v9 a2 2 0 0 0 4 0 V3 h4"/>`, { sw: 1.8 }),
  fit: svg(`<path d="M4 9 V4 h5 M15 4 h5 v5 M20 15 v5 h-5 M9 20 H4 v-5"/><circle cx="12" cy="12" r="3"/>`, { sw: 1.8 }),
};

export type IconName = keyof typeof ICONS;
