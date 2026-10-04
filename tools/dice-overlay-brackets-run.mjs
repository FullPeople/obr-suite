// Orchestration only: uses the unchanged existing SDK/Jolt core browser fixture.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyDiceAssets} from './dice-pinned-assets.mjs';
import {analyzeBracket,ORDER} from './dice-overlay-brackets-summary.mjs';
export const PINS={baseline:'2e2ddb1f642e1375cffda45efad9584b33100008',stage1:'99e3026cbc7ebfc057372ab1fa7f4f41d35fd1aa',harnessBase:'c69903ec977d409dd29300f070de6f40b8eb546c',web:'05dcfdb645339cac9f68d1f6009f44b7e63d5c25'};
const root=resolve('.'),out=resolve('.local-evidence/dice-overlay-brackets'),sources=resolve('.bracket-sources');
const harness=['tools/dice-latency-build.mjs','tools/dice-latency-browser.mjs','tools/dice-latency-fixture-selftest.mjs'];
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const save=(name,data)=>{mkdirSync(out,{recursive:true});writeFileSync(join(out,name),JSON.stringify(data,null,2));};
const sourcePath=condition=>join(sources,condition==='stage1'?'stage1':'baseline');
const env={...process.env,DICE_LATENCY_CORE:'1',DICE_LATENCY_VIDEO:'0',DICE_LATENCY_SCREENSHOTS:'0',DICE_LATENCY_SOFTWARE:'1',DICE_LATENCY_RECOVERY:'0'};
function validatePins(){for(const [key,value]of Object.entries(PINS))assert.match(value,/^[a-f0-9]{40}$/,key+' must be an exact source SHA');assert(process.env.DND_CARD_WEB_ROOT,'DND_CARD_WEB_ROOT required');assert.equal(git('-C',process.env.DND_CARD_WEB_ROOT,'rev-parse','HEAD'),PINS.web);}
function prepare(){
  validatePins();for(const file of harness)assert.equal(readFileSync(file).compare(execFileSync('git',['show',PINS.harnessBase+':'+file])),0,'unchanged pinned harness '+file);assert.equal(git('diff',PINS.harnessBase,'--name-only','--','src','extensions','public','package.json','package-lock.json','vite.config.ts'),'','orchestration branch must not change product/dependencies');
  assert.equal(git('diff',PINS.baseline,PINS.stage1,'--name-only','--','src','extensions','public','package.json','package-lock.json','vite.config.ts'),'extensions/workbench-dice3d/src/research/presentation.ts','stage1 must contain only its reviewed production change');assert.equal(git('rev-parse',PINS.stage1+':extensions/workbench-dice3d/src/research/presentation.ts'),'5d31879ff4a12b0098d65bba1d8c1d2a3cb7edd6','reviewed stage1 presentation blob');
  mkdirSync(sources,{recursive:true});for(const name of ['baseline','stage1']){const target=sourcePath(name);assert(!existsSync(target),'fresh bracket source checkout required: '+target);assert.equal(git('rev-parse',PINS[name]+'^{commit}'),PINS[name]);git('worktree','add','--detach',target,PINS[name]);for(const file of harness)copyFileSync(join(root,file),join(target,file));
    for(const file of [...harness,'package-lock.json','tools/dice-pinned-assets.mjs','tools/workbench-dice3d-sdk-probe.mjs'])assert.equal(sha(join(target,file)),sha(join(root,file)),'same locked dependency/measurement input '+file);
  }
  save('manifest.json',{createdAt:new Date().toISOString(),workflowSource:git('rev-parse','HEAD'),pins:PINS,order:ORDER,harness:Object.fromEntries(harness.map(file=>[file,sha(join(root,file))])),suiteLock:sha('package-lock.json'),webLock:sha(join(process.env.DND_CARD_WEB_ROOT,'package-lock.json')),runId:process.env.GITHUB_RUN_ID??null,runAttempt:process.env.GITHUB_RUN_ATTEMPT??null,runner:process.env.RUNNER_NAME??null,experiment:'One exploratory same-runner baseline → stage1 → baseline bracket; no stability claim',buildsOutsideMeasuredRuns:true,freshBrowserProcessAndContextPerRun:true});
}
function validateBuilds(){validatePins();const builds={};for(const condition of ['baseline','stage1']){const cwd=sourcePath(condition),assets=verifyDiceAssets(join(cwd,'.local-evidence/dice-latency/runtime/dice3d'));assert.equal(assets.verified,59);builds[condition]={source:git('-C',cwd,'rev-parse','HEAD'),assets};}save('build-checks.json',{checkedAt:new Date().toISOString(),pins:PINS,builds});}
function measure(){
  validatePins();const manifest=JSON.parse(readFileSync(join(out,'manifest.json'),'utf8')),runs=[];
  const checked=JSON.parse(readFileSync(join(out,'build-checks.json'),'utf8'));assert.deepEqual(checked.pins,PINS);for(const condition of ['baseline','stage1']){assert.equal(checked.builds[condition].source,PINS[condition]);assert.equal(checked.builds[condition].assets.verified,59);}
  assert.deepEqual(manifest.pins,PINS);assert.equal(manifest.workflowSource,git('rev-parse','HEAD'),'build/harness checkout must remain fixed');
  try{for(const condition of ORDER){const cwd=sourcePath(condition),source=PINS[condition==='stage1'?'stage1':'baseline'];assert.equal(git('-C',cwd,'rev-parse','HEAD'),source);for(const [file,digest]of Object.entries(manifest.harness))assert.equal(sha(join(cwd,file)),digest,'harness changed after preparation');
      const evidence=join(out,condition),startedAt=new Date().toISOString();mkdirSync(evidence,{recursive:true});
      save('progress.json',{manifest,runs:runs.map(({report,...run})=>run),running:{condition,source,startedAt}});
      // No builds, npm, video, screenshots or parallel work inside the timing sequence.
      execFileSync(process.execPath,['tools/dice-latency-browser.mjs'],{cwd,env:{...env,DND_DICE_EVIDENCE:evidence,DND_DICE_LATENCY_BUILD:join(cwd,'.local-evidence/dice-latency/runtime'),DICE_LATENCY_PORT:'5236'},stdio:'inherit'});
      const report=JSON.parse(readFileSync(join(evidence,'result.json'),'utf8'));assert.equal(report.source.suite,source);assert.equal(report.source.web,PINS.web);runs.push({condition,source,startedAt,finishedAt:new Date().toISOString(),rawFile:condition+'/result.json',report});
      save('partial.json',{manifest,runs:runs.map(({report,...run})=>run)});
    }
    save('result.json',{success:true,manifest,runs:runs.map(({report,...run})=>run),analysis:analyzeBracket(runs)});
  }catch(error){save('failure.json',{error:String(error),stack:error.stack,manifest,completedRuns:runs.map(({report,...run})=>run)});throw error;}
}
try{const mode=process.argv[2];if(mode==='prepare')prepare();else if(mode==='validate-builds')validateBuilds();else if(mode==='measure')measure();else throw Error('Use prepare, validate-builds or measure');}catch(error){save('orchestrator-failure.json',{error:String(error),stack:error.stack,mode:process.argv[2],pins:PINS});throw error;}
