// Buff-catalog defaults migration data.
//
// Split out of `types.ts` because ONLY `status-tracker-page.ts` needs
// it, while `types.ts` is imported by `statusTracker/index.ts` — which
// is in background.ts's graph. That meant ~40 lines of retired-id
// table rode into the chunk every client loads at boot, to serve a
// one-off catalog migration that runs inside a page.
//
// The signature matcher that used to live alongside this (169 lines of
// `OLD_DEFAULT_SIGNATURES` + `OLD_DEFAULT_SIGNATURES_ALT` + `matchesSig`
// + `matchesOldDefault`) is GONE. The migration stopped being
// signature-gated — retired ids are now dropped unconditionally, by
// user request — and its only remaining consumer was a bare
// `void matchesOldDefault;` in migrateDefaultsInPlace, kept "for any
// future diagnostics". It was 169 lines of data existing to be
// discarded; git history has it if a future diagnostic ever wants it.
// Every id we've shipped as a default in any prior version. Combined
// with OLD_DEFAULT_SIGNATURES below so the migration matches on
// FULL shape (not just id) — a user who renamed "魅惑 💘" → "魅惑术"
// keeps theirs even if "charmed" is in this set.
export const DEFAULT_BUFF_RETIRED_IDS = new Set<string>([
  // === Original 32 built-ins (pre-2026-05-18) ===
  "paralyzed", "charmed", "invisible", "bardic", "vicious", "advantage",
  "stunned", "wet", "poisoned", "haste", "flying", "frozen",
  "innate_spell", "wild_shape", "blessing", "frightened", "unconscious",
  "guidance", "hunters_mark", "focused", "deafened", "incapacitated",
  "prone", "slowed", "blinded", "exhaustion", "dead", "petrified",
  "restrained", "grappled", "raging", "frozen_stiff",
  // === 2026-05-18 batch (76 entries from /public/buff-fx/*.webm) ===
  // custom-* group
  "disadvantage",
  // fade-* group
  "fade_broken_heart", "fade_ghost", "fade_sparkles",
  // flash-* group
  "flash_boom", "flash_clown", "flash_fire", "flash_lightning",
  "flash_sparkles", "flash_star",
  // float-* group
  "float_dove", "float_musical_note", "float_sparkles",
  "float_sparkling_heart", "float_tulip", "float_wind", "float_zzz",
  // orbit-* group
  "orbit_dizzy", "orbit_snowflake", "orbit_sparkles", "orbit_star",
  // pulse-* group
  "pulse_brain", "pulse_crystal_ball", "pulse_sloth",
  "pulse_sparkling_heart", "pulse_sun", "pulse_target", "pulse_thumbs_up",
  // radial-* group
  "radial_fire", "radial_moon", "radial_snowflake", "radial_sparkles",
  "radial_star", "radial_sun",
  // rain-* group
  "rain_cherry_blossom", "rain_drop", "rain_hourglass", "rain_leaves",
  "rain_snake", "rain_snowflake", "rain_test_tube",
  // shake-* group
  "shake_angry", "shake_cold_face", "shake_rage", "shake_screaming",
  // static-* group
  "static_broken_heart", "static_chains", "static_crystal_ball",
  "static_headphones", "static_moai", "static_otter",
  "static_people_hugging", "static_red_envelope", "static_skull",
  "static_sunglasses", "static_thumbs_up",
]);
