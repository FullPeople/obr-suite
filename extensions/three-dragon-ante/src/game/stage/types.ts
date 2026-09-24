import type { OmniscientView, PublicView, SeatView } from "../rules/types";
import type { HandGesture } from "../gesture";
import type { PowerTargetRelation } from "../power-sequence";
import type { PowerEffectShape } from "../power-effects";

export type StageZone = "hand" | "ante" | "coins" | "flight" | "deck" | "discard" | "stakes";
export type StageQualityMode = "auto" | "high" | "low";
export type StageQualityLevel = "high" | "low" | "unavailable";
/** Pure timing contract; importing this module does not load Three.js. */
export const REVEAL_PRESENTATION_MS = 1720;
export type RevealPhase = "placing" | "revealing" | "price" | "payment" | "discard";
export type StageHit =
  | { kind: "hand" | "card"; cardId: string; zone: StageZone; seatId?: string }
  | { kind: "zone"; zone: StageZone; seatId?: string };
export interface StageModel {
  /** OmniscientView is host-local only; the stage may render its private
   * inspection faces, but it is never a transport or public projection. */
  view: PublicView | SeatView | OmniscientView | null;
  language: "zh" | "en";
  connected?: boolean;
  reducedMotion?: boolean;
  selectedCardIds?: readonly string[];
  /** Public effect sources only; an ID never reveals a private card by itself. */
  activeEffectCardIds?: readonly string[];
  /** The public source of the step currently being resolved, plus a local
   * presentation cue while the power explanation is open. This is kept
   * separate from persistent effects so the stage can use a quieter, finite
   * resolution highlight without turning every active card into a permanent
   * glow. */
  activeResolutionCardIds?: readonly string[];
  /** Public target seat for the active resolution step. */
  resolutionTargetSeatId?: string | null;
  /** Public semantic relation for the active target line. */
  resolutionTargetRelation?: PowerTargetRelation | null;
  /** Public ability family used only to choose the active burst's visual language. */
  activeResolutionFamily?: string;
  /** Explicit public currency paths. `stakes` and `hole` are non-seat endpoints. */
  goldFlows?: readonly StageGoldFlow[];
  /** Provided by the UI only while that own-seat action is legal and unlocked. */
  legalDropZone?: null | "ante" | "flight";
  /** Set false on reconnect/snapshot replacement. Gaps and new games also snap. */
  animate?: boolean;
}
export interface StageGoldFlow { key:string; fromSeatId:string; toSeatId:string; amount:number; code?:string }
export interface StageQuality {
  webgl: boolean;
  quality: StageQualityLevel;
  mode?: StageQualityMode;
  reason?: "context-lost" | "creation-failed" | "auto-small-screen" | "auto-coarse-input" | "manual";
}
export interface StageOptions {
  /** Local-only renderer preference. It never enters a projection or room value. */
  quality?: StageQualityMode;
  onQuality?(quality: StageQuality): void;
  onRevealPhase?(phase: RevealPhase | null): void;
  /** Reserved for integration; renderer never installs input handlers. */
  onInspect?(cardId: string): void;
}
export interface StageAnchorQuery { cardId?: string; zone?: StageZone; seatId?: string }
export interface StageAnchor { x: number; y: number; visible: boolean }
export interface StageDiagnostics {
  frames: number; animations: number; meshes: number; textures: number;
  drawCalls: number; suspended: boolean; destroyed: boolean;
  pendingCardId: string | null; faceCardIds: string[];
  /** Landing/coin motions alive right now; the presentation scheduler uses the
   *  same counter through `settled()`, so a probe can prove the hand-off. */
  motions?: number;
  /** Revision of the projection this renderer has actually adopted. A value
   *  below the cue's revision proves the stage has not seen the card yet. */
  viewRevision?: number | null;
  /** `zone:cardId` of every mesh currently moving, in registration order. */
  motionCards?: string[];
  /** Finite presentation cues currently alive; useful for browser UAT probes. */
  powerPulses?: number;
  powerBursts?: number;
  powerBurstThemes?: string[];
  /** The actual formation silhouette used by each finite public burst. */
  powerBurstShapes?: string[];
  /** Public flight combinations currently marked on the table. */
  flightFormations?: { seatId: string; kind: "color" | "strength" | "mortal" }[];
  resolutionLinkVisible?: boolean;
  /** Static public marker at the target endpoint, shaped by relation. */
  resolutionTargetMarkerVisible?: boolean;
  resolutionLinkRelation?: PowerTargetRelation | null;
  /** Active transient coins created from explicit public gold flows. */
  goldTransfers?: number;
  /** Local-only probe of the private hand's engine-authored visual states. */
  handPowerStates?: { cardId: string; state: "power-ready" | "playable-no-power" | "" }[];
  /** Local-only probe of the private hand's glowing ready-power edge. */
  handPowerOutlines?: { cardId: string; state: "power-ready" | "playable-no-power" | ""; theme: string; shape: PowerEffectShape; visible: boolean; pulse: number }[];
  /** Local-only probe of the seating light: which seats are lit and why. */
  beamStates?: { seatId: string; committed: boolean; presence: number; focus: number; targetPresence: number; visible: boolean }[];
  /** Public acting-seat spotlight; it never contains private hand data. */
  spotlightSeatId?: string | null;
  spotlightAnimating?: boolean;
  /** Local probe of public table slaps: active cues and the scene jolt they drive. */
  slapStates?: { seatId: string; sequence: number; start: number }[];
  sceneJolt?: { x: number; y: number; z: number };
  strikeHandVisible?: boolean;
  /** Local probe of the slap landing ring at the point the palm hits the felt. */
  slapRingVisible?: boolean;
  /** Local renderer facts only; never a game or network field. */
  quality?: StageQualityLevel;
  qualityMode?: StageQualityMode;
  pixelRatio?: number;
  shadowsEnabled?: boolean;
}
export interface StageHandle {
  update(model: StageModel): void;
  /** Change the local renderer profile without touching game state. */
  setQuality(mode: StageQualityMode): void;
  hitTest(clientX: number, clientY: number): StageHit | null;
  /** Drop point of an in-flight drag, in the same client pixels as `hitTest`.
   *  Null when nothing is being dragged. */
  dragPoint(): { x: number; y: number } | null;
  /** Local-only intensity multiplier for the seating light. Never a projection
   *  or network field; it exists so the light can be tuned from the page. */
  setBeamIntensity(scale: number): void;
  getAnchor(query: StageAnchorQuery): StageAnchor | null;
  setDrag(value: { cardId: string; x: number; y: number } | null): void;
  releaseDrag(options?: { pending?: boolean; zone?: "ante" | "flight" }): void;
  resolvePending(accepted: boolean): void;
  gesture(seatId: string, value: HandGesture | null): void;
  /** True while any card, coin or cue is still moving. The presentation
   *  scheduler waits for this to clear before it shows the next step. */
  settled(): boolean;
  /** True only when nothing at all is animating, including ability effects. */
  idle(): boolean;
  suspend(): void;
  resume(): void;
  destroy(): void;
  diagnostics(): StageDiagnostics;
}
