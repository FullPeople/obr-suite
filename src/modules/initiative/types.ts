export interface InitiativeData {
  count: number;
  active: boolean;
  rolled?: boolean;
  /** Stable random decimal [0,1) used as final tiebreaker, stored once per item */
  tiebreak?: number;
  /** Owner player ID (who added the token to initiative or owns the token) */
  ownerId?: string;
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
}

export interface CombatState {
  inCombat: boolean;
  preparing: boolean;
  round: number;
}
