/* Twemoji-based emoji catalog + image loader.
 *
 * Mirrors the Python generator's EMOJI_CODEPOINTS so the studio can
 * produce visually-identical WebMs. Files come from jsdelivr's
 * Twemoji mirror; the browser cache holds them after the first
 * pull.
 *
 * The `load(name)` function returns a Promise<HTMLImageElement>
 * suitable for `ctx.drawImage()` in the canvas templates.
 */

// codepoint → label (CN-friendly for the search box).
export const EMOJI_CATALOG = {
  // Combat / magic
  lightning:        { code: "26a1",  label: "闪电 lightning",      char: "⚡" },
  dizzy:            { code: "1f4ab", label: "晕 dizzy",            char: "💫" },
  swirl:            { code: "1f300", label: "漩涡 swirl",          char: "🌀" },
  boom:             { code: "1f4a5", label: "爆炸 boom",           char: "💥" },
  sparkles:         { code: "2728",  label: "闪烁 sparkles",       char: "✨" },
  fire:             { code: "1f525", label: "火 fire",             char: "🔥" },
  snowflake:        { code: "2744",  label: "雪花 snowflake",      char: "❄" },
  star:             { code: "2b50",  label: "星 star",             char: "⭐" },
  crystal_ball:     { code: "1f52e", label: "水晶球 crystal ball", char: "🔮" },
  moon:             { code: "1f319", label: "月 moon",             char: "🌙" },
  sun:              { code: "2600",  label: "太阳 sun",            char: "☀" },

  // Liquid / status
  test_tube:        { code: "1f9ea", label: "试管 test tube",      char: "🧪" },
  drop:             { code: "1f4a7", label: "水滴 drop",           char: "💧" },
  snake:            { code: "1f40d", label: "蛇 snake",            char: "🐍" },
  nauseated:        { code: "1f922", label: "想吐 nauseated",      char: "🤢" },
  skull:            { code: "1f480", label: "头骨 skull",          char: "💀" },

  // Hearts
  sparkling_heart:  { code: "1f496", label: "心心 sparkling heart",char: "💖" },
  heart_pink:       { code: "1f495", label: "粉心 heart pink",     char: "💕" },
  broken_heart:     { code: "1f494", label: "碎心 broken heart",   char: "💔" },
  red_envelope:     { code: "1f9e7", label: "红包 red envelope",   char: "🧧" },

  // Faces
  clown:            { code: "1f921", label: "小丑 clown",          char: "🤡" },
  ghost:            { code: "1f47b", label: "幽灵 ghost",          char: "👻" },
  angry:            { code: "1f620", label: "生气 angry",          char: "😠" },
  rage:             { code: "1f621", label: "愤怒 rage",           char: "😡" },
  screaming:        { code: "1f631", label: "尖叫 screaming",      char: "😱" },
  cold_face:        { code: "1f976", label: "冷脸 cold face",      char: "🥶" },
  sleepy:           { code: "1f634", label: "睡 sleepy",           char: "😴" },

  // Sound
  musical_note:     { code: "1f3b5", label: "音符 musical note",   char: "🎵" },
  headphones:       { code: "1f3a7", label: "耳机 headphones",     char: "🎧" },

  // Objects
  target:           { code: "1f3af", label: "靶心 target",         char: "🎯" },
  moai:             { code: "1f5ff", label: "摩艾 moai",           char: "🗿" },
  chains:           { code: "1f517", label: "锁链 chains",         char: "🔗" },
  hourglass:        { code: "231b",  label: "沙漏 hourglass",      char: "⌛" },
  zzz:              { code: "1f4a4", label: "ZZZ zzz",             char: "💤" },
  thumbs_up:        { code: "1f44d", label: "点赞 thumbs up",      char: "👍" },
  sunglasses:       { code: "1f576", label: "墨镜 sunglasses",     char: "🕶" },

  // Movement / nature
  wind:             { code: "1f4a8", label: "风 wind",             char: "💨" },
  dove:             { code: "1f54a", label: "鸽子 dove",           char: "🕊" },
  leaves:           { code: "1f343", label: "落叶 leaves",         char: "🍃" },
  cherry_blossom:   { code: "1f338", label: "樱花 cherry blossom", char: "🌸" },
  tulip:            { code: "1f337", label: "郁金香 tulip",        char: "🌷" },

  // Animals
  snail:            { code: "1f40c", label: "蜗牛 snail",          char: "🐌" },
  sloth:            { code: "1f9a5", label: "树懒 sloth",          char: "🦥" },
  otter:            { code: "1f9a6", label: "水獭 otter",          char: "🦦" },
  people_hugging:   { code: "1fac2", label: "拥抱 people hugging", char: "🫂" },

  // Body / mind
  brain:            { code: "1f9e0", label: "大脑 brain",          char: "🧠" },
};

// jsdelivr Twemoji mirror — same set my Python generator uses.
const TWEMOJI_URL = (code) =>
  `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${code}.png`;

const _cache = new Map();

/** Async-load a Twemoji PNG by catalog name. Returns an
 *  HTMLImageElement ready for `ctx.drawImage()`. Cached. */
export async function loadEmoji(name) {
  if (_cache.has(name)) return _cache.get(name);
  const entry = EMOJI_CATALOG[name];
  if (!entry) throw new Error(`unknown emoji: ${name}`);
  const url = TWEMOJI_URL(entry.code);
  const img = await loadImage(url);
  _cache.set(name, img);
  return img;
}

/** Generic image loader. Returns a Promise<HTMLImageElement>. Handles
 *  both data: URIs and remote URLs (assumes CORS is OK). */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`image load failed: ${src} (${e?.message ?? e})`));
    img.src = src;
  });
}

/** Build search index for the emoji picker. Matches catalog name,
 *  CN label, EN label, codepoint, and the character itself. */
export function searchEmoji(query) {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return Object.keys(EMOJI_CATALOG);
  const out = [];
  for (const [name, e] of Object.entries(EMOJI_CATALOG)) {
    const hay = `${name} ${e.label} ${e.code} ${e.char}`.toLowerCase();
    if (hay.includes(q)) out.push(name);
  }
  return out;
}
