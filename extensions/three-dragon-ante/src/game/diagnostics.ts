/** Screenshot-friendly diagnostics for the two frames that talk over the LOCAL
 *  channel. Everything here is local presentation: no game, private or room
 *  data leaves the page, and the log never carries a card identity. */
export const DIAG_PREFIX = "[tda]";

/** Any thrown value, as a short string. SDK rejections are plain objects, which
 *  is why `String(error)` used to print nothing but `[object Object]`. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const parts = ["message", "code", "reason", "name", "status", "cause"].flatMap(key => (value[key] === undefined ? [] : [`${key}=${String(value[key])}`]));
    const keys = Object.keys(value).slice(0, 8).join(",");
    return parts.length ? `{${parts.join(" ")}}` : `{keys:${keys || "none"}}`;
  }
  return String(error);
}

/** A JSON view of a value, bounded and circular-safe, for console expansion. */
export function describeValue(value: unknown, limit = 700): string {
  try {
    const text = JSON.stringify(value, (_key, item) => (typeof item === "string" && item.length > 120 ? `${item.slice(0, 120)}…` : item));
    if (text === undefined) return String(value);
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch { return String(value); }
}

/** One line per event, prefixed so a screenshot names its source. */
export function diag(scope: string, message: string, detail?: unknown): void {
  const suffix = detail === undefined ? "" : ` ${describeValue(detail)}`;
  console.warn(`${DIAG_PREFIX}:${scope} ${message}${suffix}`);
}

/** Rate limiting for lines that must appear without flooding the console. */
export function throttle(ms: number): (key: string) => boolean {
  const seen = new Map<string, number>();
  return key => {
    const now = Date.now();
    const last = seen.get(key) ?? 0;
    if (now - last < ms) return false;
    seen.set(key, now);
    if (seen.size > 64) seen.delete(seen.keys().next().value!);
    return true;
  };
}
