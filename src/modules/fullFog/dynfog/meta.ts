// Typed metadata reader — port of upstream `src/util/getMetadata.ts`.

import type { Metadata } from "@owlbear-rodeo/sdk";

/**
 * Widen the type of the default so `getMetadata(md, k, 1)` yields
 * `number`, not the literal `1`.
 */
type ToPrimitive<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T;

/** Read `key` from a Metadata bag, falling back when missing or of the
 *  wrong primitive type. Objects / arrays are returned as-is when the
 *  default is an object (`typeof` can't distinguish them), so callers
 *  that need array-ness must still check. */
export function getMetadata<T>(
  metadata: Metadata | undefined,
  key: string,
  defaultValue: ToPrimitive<T>,
): ToPrimitive<T> {
  if (!metadata) return defaultValue;
  const value = (metadata as Record<string, unknown>)[key];
  if (typeof value === typeof defaultValue) {
    return value as ToPrimitive<T>;
  }
  return defaultValue;
}

/** True when `value` is a non-null, non-array object literal. */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
