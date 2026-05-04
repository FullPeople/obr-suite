// Status Tracker — types + default catalog.
//
// Stored on each token under STATUS_BUFFS_KEY (string[] of buff ids)
// and STATUS_RESOURCES_KEY (Resource[]).

export const PLUGIN_ID = "com.obr-suite/status";
export const STATUS_BUFFS_KEY = `${PLUGIN_ID}/buffs`;
export const STATUS_RESOURCES_KEY = `${PLUGIN_ID}/resources`;

// Per-room (scene metadata) catalog of available buffs. Defaulted
// from the baked-in DEFAULT_BUFFS list below; the DM can add /
// remove entries.
export const SCENE_BUFF_CATALOG_KEY = `${PLUGIN_ID}/buff-catalog`;
// Per-room catalog of resource templates (name + max). Picking
// from this list when adding a resource to a token keeps the same
// resource consistent across the party.
export const SCENE_RESOURCE_CATALOG_KEY = `${PLUGIN_ID}/resource-catalog`;

export interface BuffDef {
  id: string;
  name: string;
  /** Hex color like #ff00d0. Used as the bubble background on the token. */
  color: string;
  /** Optional grouping tag — purely for the modal palette filter. */
  group?: string;
}

export interface ResourceItem {
  id: string;
  name: string;
  current: number;
  max: number;
}

export interface ResourceTemplate {
  id: string;
  name: string;
  max: number;
}

// Pick a sensible text color (black or white) given a background
// hex — keeps the buff bubble readable without the user picking a
// text color separately.
export function textColorFor(bgHex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bgHex.trim());
  if (!m) return "#ffffff";
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  // Standard luminance — anything brighter than ~0.6 gets black text.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

// 32 baked-in defaults sourced from the user's "Bubbles" export.
// Names kept in Chinese (the bestiary + cc panels are CN-first too).
// The trailing emoji on most names is the upstream label format —
// kept verbatim so existing scenes that already track these buffs
// keep matching by name.
export const DEFAULT_BUFFS: BuffDef[] = [
  { id: "paralyzed",   name: "麻痹 ⚡",      color: "#ffff00", group: "异常" },
  { id: "charmed",     name: "魅惑 💘",      color: "#ff00d0", group: "异常" },
  { id: "invisible",   name: "隐形😶‍🌫️",    color: "#ffffff", group: "Buffs" },
  { id: "bardic",      name: "诗人激励 🎵", color: "#7300ff", group: "Buffs" },
  { id: "vicious",     name: "被骂🤡",       color: "#000000", group: "异常" },
  { id: "deafened",    name: "耳聋 🎧",      color: "#ffffff", group: "异常" },
  { id: "slowed",      name: "缓慢术⌛",     color: "#e805f4", group: "异常" },
  { id: "guidance",    name: "神导术👍",     color: "#ffff00", group: "Buffs" },
  { id: "blessing",    name: "祝🧧术",       color: "#ffff00", group: "Buffs" },
  { id: "petrified",   name: "石化 🪨",      color: "#ffffff", group: "异常" },
  { id: "stunned",     name: "眩晕 💫",      color: "#ffffff", group: "异常" },
  { id: "blinded",     name: "目盲🕶️",      color: "#ffffff", group: "异常" },
  { id: "hunters_mark",name: "猎人印记🫵",   color: "#00ff26", group: "Extra" },
  { id: "raging",      name: "狂暴😠",       color: "#f20808", group: "Extra" },
  { id: "wet",         name: "濡湿💧",       color: "#ffffff", group: "异常" },
  { id: "dead",        name: "死亡💀",       color: "#000000", group: "Extra" },
  { id: "restrained",  name: "束缚 🪢",      color: "#ffffff", group: "异常" },
  { id: "unconscious", name: "昏迷 💤",      color: "#ffffff", group: "异常" },
  { id: "grappled",    name: "擒抱 🫂",      color: "#ffffff", group: "异常" },
  { id: "frightened",  name: "恐慌 😱",      color: "#ffffff", group: "异常" },
  { id: "incapacitated",name: "失能 💘",     color: "#ffffff", group: "异常" },
  { id: "exhaustion",  name: "力竭🦥",       color: "#ff0000", group: "异常" },
  { id: "frozen_stiff",name: "冻僵🥶",       color: "#00ffff", group: "异常" },
  { id: "frozen",      name: "冰冻❄️",       color: "#0000ff", group: "异常" },
  { id: "innate_spell",name: "先天术法⚡️",  color: "#08fdfd", group: "Extra" },
  { id: "prone",       name: "倒地 🦦",      color: "#ffffff", group: "异常" },
  { id: "poisoned",    name: "中毒 🤢",      color: "#008000", group: "异常" },
  { id: "focused",     name: "专注🧠",       color: "#ffffff", group: "Extra" },
  { id: "haste",       name: "急速术",        color: "#04a3ff", group: "Buffs" },
  { id: "flying",      name: "飞行术🪽",     color: "#d5d5d5", group: "Buffs" },
  { id: "wild_shape",  name: "野性形态💥",   color: "#ff0000", group: "Extra" },
];
