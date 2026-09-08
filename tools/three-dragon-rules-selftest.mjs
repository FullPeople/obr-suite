import {build} from "rolldown";
import {execFileSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
const out=mkdtempSync(join(tmpdir(),"three-dragon-rules-"));
const mutations={
 "bad-starting-gold":["engine.ts","gold:config.seats.length*10","gold:10"],
 "ante-tie-leader":["engine.ts","unique[0]?.index??null","unique[0]?.index??0"],
 "trigger-too-strong":["engine.ts","card(id).strength<=card(previous).strength","card(id).strength>card(previous).strength"],
 "drop-hole-debt":["engine.ts","payer.debt+=amount-paid","payer.debt+=0"],
 "no-hand-limit":["engine.ts","s.seats[seat].hand.length<10","s.seats[seat].hand.length<100"],
 "no-empty-stakes-end":["engine.ts","if(!s.stakes)emptyStakes(s)","if(false)emptyStakes(s)"],
 "wrong-druid":["engine.ts","s.effects.some(e=>e.kind===\"druid\")?Math.min(...values):Math.max(...values)","Math.max(...values)"],
 "rider-too-early":["engine.ts","if(scoring&&f.rider)","if(f.rider)"],
 "wrong-priest-rounding":["engine.ts","Math.ceil(stakes/2)","Math.floor(stakes/2)"],
 "god-ability-copied":["engine.ts",'case "tiamat":break;', 'case "tiamat":effect(s,"druid",seat,source);break;'],
 "stale-action-accepted":["engine.ts","if(action.revision!==state.revision)","if(false)"],
 "wrong-seat-accepted":["engine.ts","||state.active!==seat",""],
 "leak-hidden-ante":["projection.ts","ante:s.ante.map(id=>copy(card(id)))","ante:[...s.ante,...Object.values(s.committed)].map(id=>copy(card(id)))"],
 "leak-seer-options":["projection.ts","choice:s.pending?{id:s.pending.id,seatId:s.pending.seatId,code:s.pending.code}:null","choice:s.pending?copy(s.pending):null"],
 "sorcerer-early-ante":["engine.ts",'addFront(s,{kind:"sorcerer-ante",seat,ids:t.ids!.filter(value=>value!==id)});','s.ante.push(...t.ids!.filter(value=>value!==id));'],
 "sorcerer-lost-leftovers":["engine.ts",'for(const task of s.queue)if(task.kind==="sorcerer-ante")s.discard.push(...task.ids!);',''],
 "copper-late-discard":["engine.ts",'s.discard.push(old);const next=top(s,rng);if(!next)return null;','const next=top(s,rng);if(!next)return null;s.discard.push(old);'],
 "delayed-reshuffle":["engine.ts",'const id=s.deck.shift()!;','return s.deck.shift()!;const id="unreachable";'],
};
try{
 for(const name of process.argv.includes("--mutations")?["baseline",...Object.keys(mutations)]:["baseline"]){
  const mutation=mutations[name];let applied=0;const file=join(out,`${name}.mjs`);
  await build({input:resolve("tools/three-dragon-rules-selftest.entry.ts"),platform:"node",plugins:mutation?[{
   name:"rules-mutation",transform(code,id){if(!id.replaceAll("\\","/").endsWith(`/rules/${mutation[0]}`))return;if(!code.includes(mutation[1]))throw Error(`Missing mutation: ${name}`);applied++;return code.replaceAll(mutation[1],mutation[2]);},
  }]:[],output:{file,format:"esm"}});
  if(mutation&&!applied)throw Error(`Mutation not applied: ${name}`);
  let failed=false;try{execFileSync(process.execPath,[file],{stdio:mutation?"pipe":"inherit"});}catch(error){failed=true;if(!mutation)throw error;if(!(String(error.stdout)+String(error.stderr)).includes("ASSERTION:"))throw Error(`Mutation crashed without assertion: ${name}\n${error.stderr}`);}
  if(mutation){if(!failed)throw Error(`Mutation survived: ${name}`);console.log(`Mutation rejected: ${name}`);}
 }
}finally{rmSync(out,{recursive:true,force:true});}
