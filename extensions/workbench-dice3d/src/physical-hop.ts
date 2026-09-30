import type {Contact,Kind} from './types';
/** A physical rule-presentation flip. Original engraved surfaces must match the rule target;
 * no glyph replacement and no new random result. */
export interface PhysicalHop{ids:string[];kinds:Kind[];fps:120;frames:number;poses:Float32Array;contacts:Contact[];duration:number;landings:number[];surfaces:number[];physicsMs:number;diagnostics?:{attempts:number;rejected:string[]}}
