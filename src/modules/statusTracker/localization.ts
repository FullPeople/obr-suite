import { DEFAULT_BUFFS, type BuffDef } from "./types";

type Lang = "en" | "zh";
const names: Record<string, string> = {
  u_paralyzed: "Paralyzed", u_stunned: "Stunned", u_charmed: "Charmed", u_invisible: "Invisible",
  u_bardic: "Bardic Inspiration", u_disadvantage: "Disadvantage", u_advantage: "Advantage",
  u_restrained: "Restrained", u_blessing: "Bless", u_guidance: "Guidance", u_hex: "Hex", u_focused: "Concentration",
};
// The existing palette starts with DEFAULT_BUFFS.slice(), whose elements remain
// mutable. A deep snapshot prevents edits to those objects redefining "default".
const originals = new Map(DEFAULT_BUFFS.map(buff => [buff.id, structuredClone(buff)]));
// Some display pages intentionally project only a few fields into a transfer
// payload. Retain the source's customization decision without adding save fields.
const sourceDefaults = new WeakMap<BuffDef, boolean>();
function equalValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aa), ...Object.keys(bb)]);
  return [...keys].every(key => equalValue(aa[key], bb[key]));
}
export function isDefaultStatus(buff: BuffDef): boolean {
  return sourceDefaults.get(buff) ?? equalValue(buff, originals.get(buff.id));
}
export function rememberStatusSource(buff: BuffDef, source: BuffDef): BuffDef {
  sourceDefaults.set(buff, equalValue(source, originals.get(source.id)));
  return buff;
}
/** Display only: never rewrite catalog names, group keys or drag payloads. */
export function statusName(buff: BuffDef, lang: Lang): string {
  return lang === "en" && isDefaultStatus(buff) ? names[buff.id] ?? buff.name : buff.name;
}
export function statusGroup(group: string, catalog: BuffDef[], lang: Lang): string {
  if (lang !== "en" || (group !== "异常" && group !== "增益")) return group;
  const members = catalog.filter(buff => buff.group === group);
  // A mixed/custom category has no stable built-in ID: preserve its author label.
  if (!members.length || !members.every(isDefaultStatus)) return group;
  return group === "异常" ? "Conditions" : "Benefits";
}
export const statusText = (lang: Lang, key: "clear" | "manage" | "preset" | "capture") => ({
  en: { clear: "Clear all statuses", manage: "Manage statuses", preset: "Preset", capture: "Apply status" },
  zh: { clear: "清除全部 buff", manage: "管理 buff", preset: "预设", capture: "应用状态" },
})[lang][key];
