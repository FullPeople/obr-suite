export const BUILD='suite-3d-5';
export const CHANNEL='com.obr-suite/workbench-dice3d.v1';
export type Kind='d4'|'d6'|'d8'|'d10'|'d12'|'d20'|'d_percentile';
export const KINDS:Kind[]=['d4','d6','d8','d10','d12','d20','d_percentile'];
export type ThemeID='godot_blue_cat_eye'|'royal_ember_resin'|'stage6_calibration'|'brushed_metal'|'ink_sketch'|'comic_print'|'flowing_ink'|'neon_runes';
export interface DieAsset {kind:Kind;model:string;hull:number[][];outcomes:{value:number;normal:number[]}[];nominal:number}
export type ImpactStrength='light'|'medium'|'heavy';
/** The strict theme audio contract: ten wavs plus the four mix gains (native schema v7). */
export interface ThemeAudio{impacts:Record<'die_on_ground'|'die_on_die',Record<ImpactStrength,string>>;
  rolling:string;tension:string;natural_1:string;natural_20:string;
  mix:{impact_gain:number;rolling_gain:number;tension_gain:number;stinger_gain:number}}
export interface Theme {id:ThemeID;name:string;style?:import('./material-styles').MaterialStyle;color:number[];glyph:number[];roughness:number;metalness:number;masks:Record<Kind,string>;texture:string;
  audio:ThemeAudio;naturalOne:number[];naturalTwenty:number[]}
export interface Catalog {version:number;dice:Record<Kind,DieAsset>;themes:Record<ThemeID,Theme>}
export interface Request {id:string;source:string;name:string;kind:Kind|'mixed';count:number;theme:ThemeID;seed:number;authority?:string;bodyColor?:string;modifier?:number;visibility?:import('./hidden-roll').Visibility;
  recipe?:boolean;groupSize?:number;batch?:{id:string;index:number;size:number};formula?:string;formulas?:string[];contexts?:NonNullable<Request['context']>[];context?:{itemId:string|null;label:string;rollerId:string;collectiveId?:string;expression?:string;ts?:number;visibility?:import('./hidden-roll').Visibility};preset?:{dice:{type:string;value:number;loser?:boolean;originalValue?:number;subtract?:boolean;burstParent?:number}[];total:number;rowStarts?:number[]}}
export interface FormulaData {ids:string[];rows:Omit<import('./research/formula').FormulaRow,'compute'>[];logicalRows?:Omit<import('./research/formula').FormulaRow,'compute'>[];births:number[];timeline:import('./research/rule-timeline').RuleTimeline;context?:Request['context'];contexts?:Request['contexts'];expression:string}
export interface Viewport {w:number;h:number}
/** One recorded physics contact. Positions are visual units; speed is m/s and impulse N·s, so the
 *  audio mapper can apply the native thresholds unchanged. */
export interface Contact {t:number;kind:0|1;a:number;b:number;seq:number;x:number;y:number;z:number;speed:number;impulse:number}
export interface Roll {version:2;request:Request;kinds:Kind[];results:number[];fps:120;frames:number;poses:Float32Array;contacts:Contact[];physicsMs:number;steps:number;collisions:number;duration:number;
  masked?:boolean;secret?:import('./hidden-roll').SecretPack;formulaData?:FormulaData;births?:number[];
  bounds?:{minX:number;maxX:number;minZ:number;maxZ:number};
  diagnostics?:{attempts:number;rejected:string[];simulationSeed:number;incumbentContacts:number;boundaryContacts:number;retained:number;substeps:number;inertiaCorrections?:number}}
export interface RollMeta extends Omit<Roll,'poses'> {}
export interface EventRecord {at:number;event:string;detail:unknown}
export interface Peer {id:string;session?:string;name:string;color?:string;role?:import('./hidden-roll').Role;lastSeen:number;ready:boolean;rtt:number;offset:number;version:string;born:number;tracePacketV1?:boolean}
export const ASSET_VERSION='dice-assets-225';
export const url=(p:string)=>'/suite-dev/dice3d/'+p+'?v='+ASSET_VERSION;
export const now=()=>performance.timeOrigin+performance.now();
export {errorText} from '../../../src/utils/errorText';
