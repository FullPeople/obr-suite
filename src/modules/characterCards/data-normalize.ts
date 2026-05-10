function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function readBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (["false", "0", "no", "off", "unequipped", "未装备", "否"].includes(normalized)) return false;
  if (["true", "1", "yes", "on", "equipped", "已装备", "是"].includes(normalized)) return true;
  return false;
}

function normalizeGearEntry(entry: unknown): unknown {
  if (!isRecord(entry)) return entry;
  return {
    ...entry,
    equipped: readBooleanFlag(entry.equipped),
    attuned: readBooleanFlag(entry.attuned),
  };
}

export function normalizeCombatGearFlags<T>(data: T): T {
  if (!isRecord(data) || !isRecord(data.combat)) return data;

  const combat = data.combat;
  return {
    ...data,
    combat: {
      ...combat,
      armor: normalizeGearEntry(combat.armor),
      shield: normalizeGearEntry(combat.shield),
    },
  };
}
