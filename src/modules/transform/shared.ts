export const TRANSFORM_STACK_KEY = "com.obr-suite/transform:stack";
export const TRANSFORM_POLICY_KEY = "com.obr-suite/transform:policy";

export type TransformHpMode = "monster" | "card";

export interface TransformPolicy {
  enabled: boolean;
  typeQuery: string;
  minCr: number | null;
  maxCr: number | null;
}

export const DEFAULT_TRANSFORM_POLICY: TransformPolicy = {
  enabled: false,
  typeQuery: "",
  minCr: null,
  maxCr: null,
};

export function normalizeTransformHpMode(raw: unknown): TransformHpMode {
  return raw === "card" ? "card" : "monster";
}

function cleanCr(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

export function normalizeTransformPolicy(raw: unknown): TransformPolicy {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TRANSFORM_POLICY };
  const r = raw as Record<string, unknown>;
  let minCr = cleanCr(r.minCr);
  let maxCr = cleanCr(r.maxCr);
  if (minCr !== null && maxCr !== null && minCr > maxCr) {
    const tmp = minCr;
    minCr = maxCr;
    maxCr = tmp;
  }
  return {
    enabled: r.enabled === true,
    typeQuery: typeof r.typeQuery === "string" ? r.typeQuery.trim() : "",
    minCr,
    maxCr,
  };
}

export function parseTransformCr(value: unknown): number {
  const text = String(value ?? "").trim();
  if (text === "1/8") return 0.125;
  if (text === "1/4") return 0.25;
  if (text === "1/2") return 0.5;
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : 0;
}

const TYPE_ALIAS_GROUPS: string[][] = [
  ["aberration", "异怪"],
  ["beast", "野兽"],
  ["celestial", "天界生物", "天界"],
  ["construct", "构装生物", "构装"],
  ["dragon", "龙"],
  ["elemental", "元素生物", "元素"],
  ["fey", "精类生物", "精类", "妖精"],
  ["fiend", "邪魔"],
  ["giant", "巨人"],
  ["humanoid", "类人生物", "类人"],
  ["monstrosity", "怪兽"],
  ["ooze", "泥形怪"],
  ["plant", "植物"],
  ["undead", "不死生物", "不死"],
];

function typeNeedles(term: string): string[] {
  const lower = term.trim().toLowerCase();
  if (!lower) return [];
  for (const group of TYPE_ALIAS_GROUPS) {
    if (group.some((v) => v.toLowerCase() === lower)) {
      return group.map((v) => v.toLowerCase());
    }
  }
  return [lower];
}

function splitTypeQuery(value: string): string[] {
  return value
    .split(/[\s,，、/|]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function transformPolicyAllowsMonster(
  policy: TransformPolicy,
  monster: { type?: unknown; cr?: unknown },
): boolean {
  if (!policy.enabled) return false;

  const typeTerms = splitTypeQuery(policy.typeQuery);
  if (typeTerms.length > 0) {
    const type = String(monster.type ?? "").toLowerCase();
    const typeOk = typeTerms.some((term) =>
      typeNeedles(term).some((needle) => type.includes(needle)),
    );
    if (!typeOk) return false;
  }

  const cr = parseTransformCr(monster.cr);
  if (policy.minCr !== null && cr < policy.minCr) return false;
  if (policy.maxCr !== null && cr > policy.maxCr) return false;
  return true;
}
