import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const baseline=process.env.DICE_AUDIO_BASELINE;
const output=resolve(process.env.DND_DICE_EVIDENCE||'.cache/dice-audio-warmup');mkdirSync(output,{recursive:true});
await build({input:'tools/dice-audio-warmup.test.ts',platform:'node',external:[/^node:/],plugins:[...(baseline?[{name:'immutable-audio-baseline',load(id){
  const relative=id.replaceAll('\\','/').match(/extensions\/workbench-dice3d\/src\/(audio|audio-mixer|overlay)\.ts$/)?.[0];
  if(relative)return execFileSync('git',['show',baseline+':'+relative],{encoding:'utf8'});
}}]:[]),{name:'headless-overlay-visual-boundary',load(id){
  if(id.endsWith('.css'))return {code:'',moduleType:'js'};
  if(id.replaceAll('\\','/').endsWith('/extensions/workbench-dice3d/src/renderer.ts'))return `
    export class DiceRenderer { constructor(container,catalog,report){this.report=report;}
      async init(){await globalThis.__diceOverlayVisual.promise;this.report('renderer-ready',{testVisualBoundary:true});}
    }`;
}}],output:{file:join(output,'selftest.mjs'),format:'esm',codeSplitting:false}});
execFileSync(process.execPath,[join(output,'selftest.mjs')],{stdio:'inherit',env:{...process.env,DND_DICE_EVIDENCE:output}});
