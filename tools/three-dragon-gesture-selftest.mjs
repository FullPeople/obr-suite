#!/usr/bin/env node
import { build } from "rolldown";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const directory=mkdtempSync(join(tmpdir(),"three-dragon-gesture-")),file=join(directory,"selftest.mjs");
await build({input:resolve("tools/three-dragon-gesture-selftest.entry.ts"),platform:"node",output:{file,format:"esm",codeSplitting:false}});
try{
 const log=execFileSync(process.execPath,[file],{encoding:"utf8",timeout:30000,stdio:['ignore','pipe','pipe']});writeFileSync(join(directory,"result.log"),log);console.log(log);
 const mutations=[
  {name:'private-fields',file:'gesture.ts',from:'return { gameId: g.gameId,',to:'return { ...g, gameId: g.gameId,',assertion:'private payload must be stripped before broadcast'},
  {name:'send-rate',file:'gesture.ts',from:'GESTURE_INTERVAL_MS = 125',to:'GESTURE_INTERVAL_MS = 75',assertion:'no rolling second exceeds 8 gesture sends'},
  {name:'dropped-clear',file:'controller.ts',from:'const previous = this.gesturePending ?? this.gestureLast;',to:'if (performance.now() - this.gestureSentAt < GESTURE_INTERVAL_MS) return; const previous = this.gesturePending ?? this.gestureLast;',assertion:'clear is never discarded by sender rate limit'},
  {name:'sender-seat',file:'controller.ts',from:'member?.id === envelope.playerId && seat?.seatId === envelope.seatId && !!visible',to:'!!visible',assertion:'SDK sender cannot claim another seat'},
 ];
 for(const m of mutations){let changed=false;const target=join(directory,m.name+'.mjs');await build({input:resolve('tools/three-dragon-gesture-selftest.entry.ts'),platform:'node',plugins:[{name:'valid-gesture-mutation',load(id){if(id.replaceAll('\\','/').endsWith('/game/'+m.file)){const source=readFileSync(id,'utf8');assert.equal(source.split(m.from).length,2,m.name+' unique patch');changed=true;return source.replace(m.from,m.to);}}}],output:{file:target,format:'esm',codeSplitting:false}});assert.ok(changed);let caught=false;try{execFileSync(process.execPath,[target],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});}catch(error){const output=(error.stdout||'')+'\n'+(error.stderr||'');writeFileSync(join(directory,m.name+'.log'),output);assert.ok(output.includes('ERR_ASSERTION')&&output.includes(m.assertion),m.name+' must fail its designated product assertion');caught=true;}assert.ok(caught,m.name+' survived');console.log('PASS valid mutation '+m.name+' -> '+m.assertion);}
 writeFileSync(join(directory,'mutations.json'),JSON.stringify(mutations,null,2));
}catch(error){const log=(error.stdout||'')+'\n'+(error.stderr||String(error));writeFileSync(join(directory,"failure.log"),log);console.error(log);process.exitCode=1;}finally{console.log("Gesture evidence: "+directory);}
