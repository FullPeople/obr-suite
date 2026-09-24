import type {Card} from "./cards";
export interface SeatConfig { id:string; name:string }
export type RuleSetId="provided-pack-20260910";
export type DeckId="random-specials-v1"|"selected-specials-v1";
/** Versioned public setup. `specialIds` is present only for the selected deck. */
export interface TableVariant { ruleSetId:RuleSetId; deckId:DeckId; specialIds?:string[] }
export interface GameConfig { id:string; seats:SeatConfig[]; specialIds?:string[]; variant?:TableVariant; seed?:number; startingGold?:number; startingHand?:number }
/** Inject one integer source into create/apply for deterministic simulations.
 * Production defaults to cryptographic randomness; never transmit its state. */
export interface RandomSource { int(upperExclusive:number):number }
export interface FlightCard { cardId:string; wild?:boolean; rider?:boolean }
export interface Seat extends SeatConfig { gold:number; debt:number; hand:string[]; flight:FlightCard[]; rewards:string[]; archmage:boolean }
export type EffectKind="druid"|"priest"|"merchant"|"warlord"|"monarch"|"dracolich";
export interface Effect { kind:EffectKind; seat:number; source:string }
export interface ChoiceOption { id:string; code?:string; cardId?:string; seatId?:string }
export interface Choice { id:string; seatId:string; code:string; options:ChoiceOption[]; min:number; max:number; sourceCardId?:string; beneficiarySeatId?:string }
export interface Pending extends Choice { task:Task }
export type Task = { kind:string; seat:number; source?:string; family?:string; ids?:string[]; target?:number; amount?:number; mode?:string; flag?:boolean; index?:number };
export interface ScoreReport {
 gambit:number; round:number; reason:"round-complete"|"empty-stakes"|"tied"|"warlord"; weakest:boolean;
 rows:{seatId:string;cards:{cardId:string;points:number}[];bonus:number;total:number;eligible:boolean}[];
 winners:string[]; stakes:number; payouts:{seatId:string;amount:number}[];
}
export interface PublicEvent { code:string; seatId?:string; targetSeatId?:string; cardIds?:string[]; amount?:number; effectFamily?:string; score?:ScoreReport }
export type PublicHistoryPhase="ante"|"play"|"resolve"|"ended"|"adjudication"|"choice";
export interface PublicReplaySeat { id:string; name:string; gold:number; debt:number; handCount:number; flight:FlightCard[]; strength:number; scoringStrength:number; committed:boolean; archmage:boolean }
export interface PublicReplayFrame {
  /** A public snapshot captured immediately after the corresponding event. */
  phase:PublicHistoryPhase; gambit:number; round:number; stakes:number; hole:number; deckCount:number;
  leaderSeatId:string|null; activeSeatId:string|null; waitingSeatIds:string[];
  ante:string[]; discard:string[]; discardCount:number; revealed:string[]; anteOrigins?:{seatId:string;cardId:string}[];
  seats:PublicReplaySeat[];
  choice:{id:string;seatId:string;code:string;sourceCardId?:string;beneficiarySeatId?:string}|null;
  resolutionStack:ResolutionStep[];
  lastGambit:GambitResult|null; winners:string[]; issue:string|null;
  effects:{kind:EffectKind;seatId:string;sourceCardId?:string}[];
}
/** Append-only public record used by the history drawer and future replay.
 * It contains no action id, task payload, hidden hand, deck order or random
 * state. `events` remains the bounded animation window; this is the durable
 * public timeline. A frame is also public-only and is optional for legacy
 * entries created before state-frame capture was introduced. */
export interface PublicHistoryEntry { sequence:number; revision:number; phase:PublicHistoryPhase; gambit:number; round:number; activeSeatId:string|null; event:PublicEvent; frame?:PublicReplayFrame }
export interface GambitResult { number:number; winners:string[]; reason:string; strengths:Record<string,number>; stakes:number }
export interface AcceptedAction { fingerprint:string; revision:number }
export type ResolutionStepStatus="active"|"queued";
/** Public, deliberately lossy description of the rules engine's FIFO stack.
 * Never add Task fields here without reviewing their privacy implications. */
export interface ResolutionStep { id:string; kind:string; status:ResolutionStepStatus; /** Public executor/beneficiary. */ seatId?:string; /** Public affected or responding seat. */ targetSeatId?:string; sourceCardId?:string; amount?:number; code?:string }
export interface GameState {
  /** Original total currency for recovery conservation; old saves use n*n*10. */
  initialGold?:number;
  version:1; id:string; revision:number; seats:Seat[]; stage:"ante"|"play"|"resolve"|"ended"|"adjudication";
  deck:string[]; discard:string[]; excluded:string[]; committed:Record<string,string>; ante:string[];
  /** Origins of revealed opening antes only. Optional for pre-existing saves. */
  anteOrigins?:{seatId:string;cardId:string}[];
  stakes:number; hole:number; gambit:number; round:number; leader:number; active:number; turnIndex:number;
  roundCards:(string|null)[]; effects:Effect[]; queue:Task[]; pending:Pending|null; choiceSerial:number;
  events:PublicEvent[]; /** Bounded suffix used by finite live presentation. */
  history?:PublicHistoryEntry[]; /** Full public timeline for new saves. */
  historyComplete?:boolean; /** False for a legacy save reconstructed from its 100-event suffix. */
  /** New games always carry the frozen rule/deck choice. Old saves may omit it
   * and are interpreted through the current compatibility default. */
  variant?:TableVariant;
  revealed:string[]; accepted:Record<string,AcceptedAction>; randomState?:number;
  lastGambit:GambitResult|null; winners:string[]; issue:string|null; scoring:boolean;
}
export type ActionKind="ante"|"play"|"choose";
export interface GameAction { id:string; revision:number; seatId:string; kind:ActionKind; cardId?:string; choiceId?:string; optionIds?:string[] }
export type ErrorCode="INVALID_CONFIG"|"INVALID_ACTION"|"UNKNOWN_SEAT"|"STALE_REVISION"|"ACTION_ID_CONFLICT"|"NOT_YOUR_TURN"|"CARD_NOT_AVAILABLE"|"INVALID_CHOICE"|"GAME_ENDED"|"ADJUDICATION_REQUIRED";
export type ActionResult={ok:true;state:GameState;duplicate:boolean}|{ok:false;error:{code:ErrorCode}};
export type EligibleAction={kind:"ante"|"play";cardIds:string[]}|{kind:"choose";choice:Choice};
export interface PublicSeat extends SeatConfig { gold:number; debt:number; handCount:number; flight:(FlightCard&{card:Card})[]; strength:number; scoringStrength:number; committed:boolean; archmage:boolean }
export type HandPowerState="unavailable"|"playable-no-power"|"power-ready";
export type HandPowerReason="card-not-in-hand"|"phase-locked"|"ante-phase"|"choice-pending"|"not-your-turn"|"first-player"|"archmage"|"not-higher-than-neighbor"|"higher-than-neighbor"|"missing-neighbor-card"|"no-ordinary-power"|"legacy-sync";
/** Private, authoritative UI hint for each card in the owner's hand. It is
 * derived by the rules engine and never inferred from card strength in UI. */
export interface HandPowerHint { cardId:string; state:HandPowerState; reason:HandPowerReason; ruleTriggers:boolean; comparedCardId?:string; comparedStrength?:number }
export interface PublicView {
  version:1; id:string; revision:number; phase:GameState["stage"]|"choice"; seats:PublicSeat[]; stakes:number; hole:number;
  variant:TableVariant;
  gambit:number; round:number; leaderSeatId:string|null; activeSeatId:string|null; waitingSeatIds:string[];
  ante:Card[]; discard:Card[]; deckCount:number; revealed:Card[]; events:PublicEvent[];
  history:PublicHistoryEntry[]; historyComplete:boolean; historyStartSequence:number;
  anteOrigins?:{seatId:string;cardId:string}[];
  choice:{id:string;seatId:string;code:string;sourceCardId?:string;beneficiarySeatId?:string}|null; resolutionStack:ResolutionStep[]; lastGambit:GambitResult|null; winners:string[]; issue:string|null;
  effects:{kind:EffectKind;seatId:string;sourceCardId:string}[];
}
export interface SeatView extends PublicView { selfSeatId:string; hand:Card[]; committedAnte:Card|null; actions:EligibleAction[]; handPowerHints:HandPowerHint[] }
/** Host-only local inspection. It is intentionally not a PublicView field and
 * must never be passed to packSeat/packPublic. */
export interface OmniscientView extends SeatView { omniscient:true; privateHands:Record<string,Card[]>; privateCommittedAntes:Record<string,Card|null>; /** Host-local trigger hints for every locally revealed hand. */ privateHandPowerHints:Record<string,HandPowerHint[]>; /** Host-local: the unseen piles, so an editor can offer any card as a replacement. */ privateDeck?:Card[]; privateExcluded?:Card[] }
