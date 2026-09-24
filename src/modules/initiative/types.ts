export interface InitiativeData {
  count: number;
  active: boolean;
  rolled?: boolean;
  /** Stable random decimal [0,1) used as final tiebreaker, stored once per item */
  tiebreak?: number;
  /** Owner player ID (who added the token to initiative or owns the token) */
  ownerId?: string;
  /** GM-toggled stealth flag. When true: filtered out of player panel except
   *  on its own active turn (where it shows as a `?` placeholder), camera
   *  focus is suppressed for players, initiative rolls are dark, and a
   *  shimmer overlay is rendered locally on the DM's canvas. */
  invisible?: boolean;
}

export interface InitiativeItem {
  id: string;
  name: string;
  count: number;
  modifier: number;
  active: boolean;
  rolled: boolean;
  visible: boolean;
  imageUrl: string;
  tiebreak: number;
  ownerId: string;
  invisible: boolean;
  /** Captured from bubbles metadata so the panel can render a
   *  numberless HP track above the count chip. -1 when this token
   *  has no HP data. The panel gates display by viewer role / lock
   *  state matching the bubbles silhouette rules. */
  hp: number;
  maxHp: number;
  bubblesLocked: boolean;
  /** The bubbles `hide` flag (DM marked this token's stats hidden).
   *  The on-token bar shows nothing at all to players for these, so
   *  the strip must not leak a percentage bar either. */
  bubblesHide: boolean;
}

export interface CombatState {
  inCombat: boolean;
  preparing: boolean;
  round: number;
}

// §8 (2026-08-21) — payload of BROADCAST_TURN_CHANGE, sent by the
// advancing client after the active-pointer write commits. activeName
// is withheld (null) when the active entry is invisible, so the wire
// carries nothing beyond what the stealth-turn overlay already
// announces; the owner's client renders a generic prompt instead.
// nextOwnerId/nextName describe the next PUBLIC player-owned entry —
// invisible units are skipped in that walk, so neither the hint's
// content nor its timing can leak their count or position.
export interface TurnChangePayload {
  activeOwnerId: string | null;
  activeName: string | null;
  activeInvisible: boolean;
  nextOwnerId: string | null;
  nextName: string | null;
  round: number;
}
