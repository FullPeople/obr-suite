/** Where a status buff's single-image item lands in the token's z-stack.
 *
 *  Split out of `bubbles.ts` — which needs an SDK mock to import — because the
 *  decision is pure and easy to get silently wrong: a ground ring rendered over
 *  the token instead of under it looks wrong only on the canvas, never in a
 *  type-check or a diff.
 *
 *  Slots are offsets from `stackBase` (= floor(token.zIndex) × STACK_MULT), so a
 *  token higher in the stack keeps all of its own items above a lower token's.
 */

/** Curved-band background of the buff bubbles. */
const SLOT_BG_MAIN = 0;
/** The band's text label, above the band it sits on. */
const SLOT_LABEL = 100;
/** Overlay WebMs / icons — above the band and label of the same token. */
const SLOT_WEBM = 200;
/** Ground rings — anchored, but for a buff with `webmBelow`. */
const SLOT_WEBM_BELOW = -10;

/** Over the token by default: OBR's ATTACHMENT layer sorts above CHARACTER, so
 *  the effect visibly overlays the character sprite. A ground ring
 *  (`webmBelow`) goes to DRAWING instead, which sorts *below* CHARACTER — the
 *  token art then covers the ring's inner half, leaving the band reading as
 *  encircling the character rather than painted on top of it. The negative slot
 *  only orders the ring beneath its own token's bubbles; a floor effect belongs
 *  under the bubbles, not over them. */
export function webmPlacement(below: boolean, stackBase: number): {
  layer: "ATTACHMENT" | "DRAWING";
  zIndex: number;
} {
  return below
    ? { layer: "DRAWING", zIndex: stackBase + SLOT_WEBM_BELOW }
    : { layer: "ATTACHMENT", zIndex: stackBase + SLOT_WEBM };
}

export const WEBM_SLOTS = { SLOT_BG_MAIN, SLOT_LABEL, SLOT_WEBM, SLOT_WEBM_BELOW } as const;
