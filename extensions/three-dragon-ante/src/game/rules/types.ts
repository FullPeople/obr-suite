import type {Card} from "./cards";
export interface SeatConfig { id:string; name:string }
export interface GameConfig { id:string; seats:SeatConfig[]; specialIds?:string[]; seed?:number }
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
export interface GambitResult { number:number; winners:string[]; reason:string; strengths:Record<string,number>; stakes:number }
export interface AcceptedAction { fingerprint:string; revision:number }
export interface GameState {
  version:1; id:string; revision:number; seats:Seat[]; stage:"ante"|"play"|"resolve"|"ended"|"adjudication";
  deck:string[]; discard:string[]; excluded:string[]; committed:Record<string,string>; ante:string[];
  /** Origins of revealed opening antes only. Optional for pre-existing saves. */
  anteOrigins?:{seatId:string;cardId:string}[];
  stakes:number; hole:number; gambit:number; round:number; leader:number; active:number; turnIndex:number;
  roundCards:(string|null)[]; effects:Effect[]; queue:Task[]; pending:Pending|null; choiceSerial:number;
  events:PublicEvent[]; revealed:string[]; accepted:Record<string,AcceptedAction>; randomState?:number;
  lastGambit:GambitResult|null; winners:string[]; issue:string|null; scoring:boolean;
}
export type ActionKind="ante"|"play"|"choose";
export interface GameAction { id:string; revision:number; seatId:string; kind:ActionKind; cardId?:string; choiceId?:string; optionIds?:string[] }
export type ErrorCode="INVALID_CONFIG"|"INVALID_ACTION"|"UNKNOWN_SEAT"|"STALE_REVISION"|"ACTION_ID_CONFLICT"|"NOT_YOUR_TURN"|"CARD_NOT_AVAILABLE"|"INVALID_CHOICE"|"GAME_ENDED"|"ADJUDICATION_REQUIRED";
export type ActionResult={ok:true;state:GameState;duplicate:boolean}|{ok:false;error:{code:ErrorCode}};
export type EligibleAction={kind:"ante"|"play";cardIds:string[]}|{kind:"choose";choice:Choice};
export interface PublicSeat extends SeatConfig { gold:number; debt:number; handCount:number; flight:(FlightCard&{card:Card})[]; strength:number; committed:boolean; archmage:boolean }
export interface PublicView {
  version:1; id:string; revision:number; phase:GameState["stage"]|"choice"; seats:PublicSeat[]; stakes:number; hole:number;
  gambit:number; round:number; leaderSeatId:string|null; activeSeatId:string|null; waitingSeatIds:string[];
  ante:Card[]; discard:Card[]; deckCount:number; revealed:Card[]; events:PublicEvent[];
  anteOrigins?:{seatId:string;cardId:string}[];
  choice:{id:string;seatId:string;code:string;sourceCardId?:string;beneficiarySeatId?:string}|null; lastGambit:GambitResult|null; winners:string[]; issue:string|null;
  effects:{kind:EffectKind;seatId:string;sourceCardId:string}[];
}
export interface SeatView extends PublicView { selfSeatId:string; hand:Card[]; committedAnte:Card|null; actions:EligibleAction[] }
