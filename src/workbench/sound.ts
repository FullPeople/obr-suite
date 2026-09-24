import {PLAYERS,primeAudio,type SfxName} from '../modules/dice/sfx';

// Runs in the workbench document, whose user gestures unlock Web Audio.
export function prime(){primeAudio();}
export function play(name:string){const player=Object.prototype.hasOwnProperty.call(PLAYERS,name)?PLAYERS[name as SfxName]:undefined;if(player)player();}
