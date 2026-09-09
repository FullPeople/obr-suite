import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),out=mkdtempSync(join(tmpdir(),'tda-direction-'));
const game=join(root,'extensions/three-dragon-ante/src/game');
const entry=`import assert from 'node:assert/strict';
import{seatPlacements}from ${JSON.stringify(join(game,'stage/layout.ts'))};
import{createGame,projectSeat,projectPublic}from ${JSON.stringify(join(game,'rules/index.ts'))};
const checks=[];
for(let count=2;count<=6;count++){
 const state=createGame({id:'direction',seed:7341,seats:Array.from({length:count},(_,i)=>({id:'s'+i,name:'Seat '+i}))});
 for(let viewer=0;viewer<count;viewer++){
  const seats=seatPlacements(projectSeat(state,'s'+viewer)),self=seats[viewer];
  assert.ok(Math.abs(self.x)<1e-8&&self.z>0,'every player is at their own bottom edge');
  if(count>2){
   assert.ok(seats[(viewer+1)%count].x<0,'next turn is clockwise from bottom toward screen-left');
   assert.ok(seats[(viewer+count-1)%count].x>0,'previous turn is counterclockwise from bottom toward screen-right');
   for(let i=0;i<count;i++){const a=seats[i],b=seats[(i+1)%count];assert.ok(a.x*b.z-a.z*b.x>0,'every edge advances clockwise in screen x/down coordinates')}
  }
  checks.push(count+' seats, viewpoint '+viewer);
 }
 const publicSeats=seatPlacements(projectPublic(state)),firstSeats=seatPlacements(projectSeat(state,'s0'));
 assert.deepEqual(publicSeats.map(s=>[s.id,s.x,s.z]),firstSeats.map(s=>[s.id,s.x,s.z]),'spectator orientation matches first seat');
}
console.log(JSON.stringify({passed:checks.length,checks}));`;
await build({input:'directions',platform:'node',plugins:[{name:'directions',resolveId(id){if(id==='directions')return '\0directions.ts'},load(id){if(id==='\0directions.ts')return entry}}],output:{file:join(out,'test.mjs'),format:'esm'},logLevel:'silent'});
const report=JSON.parse(execFileSync(process.execPath,[join(out,'test.mjs')],{encoding:'utf8'}));
for(const file of ['text.ts','tutorial.ts','onboarding/index.ts','rules/prompts.ts'])assert.ok(!/右邻|左邻|右边玩家|你左边|你右边|right-hand player|left-hand player|on your left|on your right/.test(readFileSync(join(game,file),'utf8')),file+' uses explicit circular directions');
writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}));
