// Follow — auto-follow plugin.
//
// Right-click a token → "跟随" → click another token to bind.
// The source token then auto-moves to keep its initial offset from
// the target whenever the target's position changes (after drag
// commit, NOT mid-drag — OBR.scene.items.onChange fires on commit).

export const FOLLOW_PLUGIN_ID = "com.obr-suite/follow";

/** Per-token metadata key holding the FollowConfig. */
export const FOLLOW_KEY = `${FOLLOW_PLUGIN_ID}/data`;

/** Custom tool registered for the binding-line phase. Hidden from
 *  the toolbar by filtering its mode to its own activeTools — but
 *  the tool itself sits in the sidebar so users can re-enter the
 *  binding flow without going through the context menu. */
export const FOLLOW_TOOL_ID = `${FOLLOW_PLUGIN_ID}/tool`;
export const FOLLOW_MODE_ID = `${FOLLOW_PLUGIN_ID}/mode`;

/** Context-menu entry IDs — separate add / remove so the menu shows
 *  the right label based on whether the token is already a follower. */
export const CTX_FOLLOW_ADD = `${FOLLOW_PLUGIN_ID}/ctx-add`;
export const CTX_FOLLOW_REMOVE = `${FOLLOW_PLUGIN_ID}/ctx-remove`;

export interface FollowConfig {
  /** ID of the token this follower is tracking. */
  targetId: string;
  /** World-space offset = source.position − target.position captured
   *  at bind time. Source stays at target.position + offset whenever
   *  target moves. */
  offset: { x: number; y: number };
}
