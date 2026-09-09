import type { PublicView, SeatView } from "../rules/types";
import type { HandGesture } from "../gesture";

export type StageZone = "hand" | "ante" | "flight" | "deck" | "discard" | "stakes";
export type StageHit =
  | { kind: "hand" | "card"; cardId: string; zone: StageZone; seatId?: string }
  | { kind: "zone"; zone: StageZone; seatId?: string };
export interface StageModel {
  view: PublicView | SeatView | null;
  language: "zh" | "en";
  connected?: boolean;
  reducedMotion?: boolean;
  selectedCardIds?: readonly string[];
  /** Set false on reconnect/snapshot replacement. Gaps and new games also snap. */
  animate?: boolean;
}
export interface StageQuality {
  webgl: boolean;
  quality: "high" | "low" | "unavailable";
  reason?: "context-lost" | "creation-failed";
}
export interface StageOptions {
  onQuality?(quality: StageQuality): void;
  /** Reserved for integration; renderer never installs input handlers. */
  onInspect?(cardId: string): void;
}
export interface StageAnchorQuery { cardId?: string; zone?: StageZone; seatId?: string }
export interface StageAnchor { x: number; y: number; visible: boolean }
export interface StageDiagnostics {
  frames: number; animations: number; meshes: number; textures: number;
  drawCalls: number; suspended: boolean; destroyed: boolean;
  pendingCardId: string | null; faceCardIds: string[];
}
export interface StageHandle {
  update(model: StageModel): void;
  hitTest(clientX: number, clientY: number): StageHit | null;
  getAnchor(query: StageAnchorQuery): StageAnchor | null;
  setDrag(value: { cardId: string; x: number; y: number } | null): void;
  releaseDrag(options?: { pending?: boolean; zone?: "ante" | "flight" }): void;
  resolvePending(accepted: boolean): void;
  gesture(seatId: string, value: HandGesture | null): void;
  suspend(): void;
  resume(): void;
  destroy(): void;
  diagnostics(): StageDiagnostics;
}
