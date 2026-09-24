// Light configuration — field-for-field identical to upstream
// dynamic-fog's `LightConfig`, so the settings panel, the defaults and
// the PRIMARY/SECONDARY behaviour all match the official extension.
//
//   attenuationRadius  outer radius, world px (dpi-scaled)
//   sourceRadius       full-strength core radius
//   falloff            edge curve; small = hard edge
//   innerAngle         cone angle at full strength (360 = omni)
//   outerAngle         cone angle where it reaches zero
//   lightType          PRIMARY casts + reveals; SECONDARY only lights
//                      fog a PRIMARY light already sees
//   rotation           cone direction, DEGREES relative to the parent
//
// Two fields are ours, not upstream's:
//
//   ambient            exempt from wall occlusion — every client always
//                      renders it. For fixed room lighting (sconces,
//                      braziers, daylight) that the party is meant to
//                      see whether or not they carry a torch.

import type { LightType } from "@owlbear-rodeo/sdk";

export interface LightConfig {
  attenuationRadius?: number;
  sourceRadius?: number;
  falloff?: number;
  innerAngle?: number;
  outerAngle?: number;
  lightType?: LightType;
  rotation?: number;
  ambient?: boolean;
}

/** Grid cells of range a freshly added light gets (6 cells = 30 ft on
 *  a 5 ft grid) — upstream's "Add Light" default. */
export const DEFAULT_RANGE_CELLS = 6;
/** Smaller than Owlbear's built-in 50 so a torch fits through a 5 ft
 *  door without spilling round the frame. */
export const DEFAULT_SOURCE_RADIUS = 25;
/** Smaller than the built-in 1 — suits the smaller source radius and
 *  keeps the light edge readable. */
export const DEFAULT_FALLOFF = 0.2;

/** Falloff presets behind the Edge toggle. */
export const FALLOFF_SOFT = 1.5;
export const FALLOFF_HARD = 0.2;

/** Cone angles behind the Angle toggle. */
export const ANGLE_FULL_INNER = 360;
export const ANGLE_FULL_OUTER = 360;
export const ANGLE_CONE_INNER = 45;
export const ANGLE_CONE_OUTER = 60;

/** Values the settings UI shows when a field hasn't been written yet.
 *  Mirrors upstream's `Required<LightConfig>` fallback block. */
export function withDefaults(
  config: LightConfig,
  gridDpi: number,
): Required<LightConfig> {
  return {
    attenuationRadius: 12 * gridDpi,
    sourceRadius: DEFAULT_SOURCE_RADIUS,
    falloff: 1,
    innerAngle: 360,
    outerAngle: 360,
    lightType: "PRIMARY",
    rotation: 0,
    ambient: false,
    ...config,
  };
}

/** Read + sanitise a LightConfig off an item's metadata value. */
export function normaliseLightConfig(raw: unknown): LightConfig | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: LightConfig = {};
  const num = (key: keyof LightConfig) => {
    const v = src[key];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const attenuationRadius = num("attenuationRadius");
  if (attenuationRadius !== undefined && attenuationRadius > 0) {
    out.attenuationRadius = attenuationRadius;
  }
  const sourceRadius = num("sourceRadius");
  if (sourceRadius !== undefined && sourceRadius >= 0) {
    out.sourceRadius = sourceRadius;
  }
  const falloff = num("falloff");
  if (falloff !== undefined && falloff >= 0) out.falloff = falloff;
  const innerAngle = num("innerAngle");
  if (innerAngle !== undefined) out.innerAngle = innerAngle;
  const outerAngle = num("outerAngle");
  if (outerAngle !== undefined) out.outerAngle = outerAngle;
  const rotation = num("rotation");
  if (rotation !== undefined) out.rotation = rotation;
  if (typeof src.ambient === "boolean") out.ambient = src.ambient;
  const lightType = src.lightType;
  if (
    lightType === "PRIMARY" ||
    lightType === "SECONDARY" ||
    lightType === "AUXILIARY"
  ) {
    out.lightType = lightType;
  }
  return out;
}
