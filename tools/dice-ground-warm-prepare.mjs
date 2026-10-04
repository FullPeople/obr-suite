// Generate an observation-only runtime; no browser is launched by this command.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {instrumentGroundWarmRuntime,RUNTIME_SHA256,sha} from './dice-ground-warm-transform.mjs';
const out=resolve(process.env.DICE_GROUND_WARM_DIR||'.local-evidence/dice-ground-warm');mkdirSync(out,{recursive:true});
const source=readFileSync('tools/dice-ground-live-runtime.mjs','utf8'),instrumented=instrumentGroundWarmRuntime(source);
writeFileSync(resolve(out,'profile-runtime.mjs'),instrumented);
writeFileSync(resolve(out,'profile-source.json'),JSON.stringify({sourceSha256:RUNTIME_SHA256,profileSha256:sha(instrumented),addedGPUCalls:0,checksRemoved:0,behaviorChanges:0},null,2));
console.log(JSON.stringify({runtime:resolve(out,'profile-runtime.mjs'),sourceSha256:RUNTIME_SHA256,profileSha256:sha(instrumented)}));
