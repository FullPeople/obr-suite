// CI ONLY. Reuse the real SDK/Jolt runner, reduced to two candidate observations.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {instrumentGroundWarmBrowser,instrumentGroundWarmRuntime,sha,RUNTIME_SHA256,BROWSER_SHA256} from './dice-ground-warm-transform.mjs';
assert.equal(process.env.CI,'true','Local browser execution is not authorized');
const dir=resolve(process.env.DICE_GROUND_WARM_DIR||'.local-evidence/dice-ground-warm');mkdirSync(dir,{recursive:true});
const runtime=readFileSync('tools/dice-ground-live-runtime.mjs','utf8'),expected=instrumentGroundWarmRuntime(runtime);
const build=resolve(process.env.DICE_GROUND_SEQUENCE_BUILD||'.local-evidence/dice-ground-sequence/runtime');
const evidence=JSON.parse(readFileSync(resolve(build,'ground-sequence-source.json'),'utf8'));
assert.equal(evidence.runtimeSha256,sha(expected),'Diagnostic build does not contain the exact observation runtime');
let source=instrumentGroundWarmBrowser(readFileSync('tools/dice-ground-sequence-browser.mjs','utf8'));
source=source.replace(/from '(\.\/dice-ground-sequence-[^']+)'/g,(_all,path)=>'from '+JSON.stringify(pathToFileURL(resolve('tools',path)).href));
process.env.DICE_GROUND_SEQUENCE_OUT=resolve(process.env.DICE_GROUND_SEQUENCE_OUT||resolve(dir,'results'));
process.env.DICE_GROUND_SEQUENCE_ROUNDS='1';
writeFileSync(resolve(dir,'runner-source.json'),JSON.stringify({runtimeSourceSha256:RUNTIME_SHA256,sequenceBrowserSha256:BROWSER_SHA256,profileRuntimeSha256:sha(expected),derivedBrowserSha256:sha(source),cases:['single-20d6/cache','two-client-20d6/cache'],strictPixelsNotRun:true},null,2));
const generated=resolve(dir,'profile-browser.mjs');writeFileSync(generated,source);await import(pathToFileURL(generated).href);
