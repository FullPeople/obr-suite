// Stable resource-id scheme (checklist §2).
//
// The card server's parser used to strip every non-ASCII character from
// ability names, so ALL Chinese-named special resources shared the
// degenerate id "auto-" — clicking one resource mutated another,
// deleting one deleted all. The fixed scheme is:
//
//   auto-{slug}-{digest}          slug  = lowercased name, keeping
//                                         ASCII alnum AND CJK (一-鿿)
//   auto-{digest}                 when the slug is empty
//   …-2, -3 ordinals              same-name entries, by occurrence
//
// digest = sha256(utf8 name) hex[:8]. MUST stay byte-identical to
// character-cards-server/parser.py `_rid` so ids repaired client-side
// equal the server's canonical ids for the same name.

import { sha256Hex } from "../../utils/sha256";

/** True for ids that must be repaired: missing / empty / the legacy
 *  degenerate "auto-" (with or without the dash). */
export function isDegenerateResourceId(id: unknown): boolean {
  if (typeof id !== "string") return true;
  const s = id.trim();
  if (!s) return true;
  return /^auto-?$/.test(s);
}

/** Deterministic id for `name`, unique against `seen`. Adds the chosen
 *  id to `seen`. */
export function stableResourceId(name: string, seen: Set<string>): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const digest = sha256Hex(name).slice(0, 8);
  const base = slug ? `auto-${slug}-${digest}` : `auto-${digest}`;
  let rid = base;
  let n = 2;
  while (seen.has(rid)) rid = `${base}-${n++}`;
  seen.add(rid);
  return rid;
}
