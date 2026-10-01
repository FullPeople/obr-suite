import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),deps=process.env.DND_SUITE_DEPS||root,out=process.env.DND_DICE_EVIDENCE||root+'/.local-evidence/dice219';mkdirSync(out,{recursive:true});
const req=createRequire(deps+'/package.json'),{build}=await import(pathToFileURL(req.resolve('rolldown')).href);
const plugins=[{name:'frame-boundaries',resolveId(id){if(id==='@owlbear-rodeo/sdk')return '\0sdk';if(id==='./observation')return '\0observation';if(id.endsWith('/src/controller'))return '\0controller';},load(id){if(id==='\0sdk')return 'export default new Proxy({}, {get:(_,key)=>globalThis.diceTestSDK[key]});';if(id==='\0observation')return 'export const workbenchObservation=()=>globalThis.diceTestObservation;';if(id==='\0controller')return 'export class Controller {constructor(...args){return new globalThis.diceTestController(...args);}}';}}];
await build({input:root+'/src/workbench/dice3d.ts',platform:'node',external:[/^node:/],plugins,output:{file:out+'/dice-host.mjs',format:'esm'}});
// The production adapter is used by initiative-panel and every old shared entry.
await build({input:root+'/tools/workbench-dice3d-vite.ts',platform:'node',external:[/^node:/],output:{file:out+'/adapter.mjs',format:'esm'}});
const {workbenchDice3dPlugin}=await import(pathToFileURL(out+'/adapter.mjs').href),{readFileSync,existsSync}=await import('node:fs');
const adapted=workbenchDice3dPlugin(true).transform(readFileSync(root+'/src/modules/dice/index.ts','utf8'),root+'/src/modules/dice/index.ts');
const bridge=adapted.includes("from '../../workbench/dice-submit'")?'dice-submit':'dice3d';
await build({input:root+'/src/workbench/'+bridge+'.ts',platform:'node',external:[/^node:/],plugins,output:{file:out+'/dice-frame.mjs',format:'esm'}});
writeFileSync(out+'/adapter-route.json',JSON.stringify({bridge,secondControllerPossible:bridge==='dice3d'},null,2));
execFileSync(process.execPath,[root+'/tools/workbench-dice-frame-219.test.mjs',out],{stdio:'inherit'});
