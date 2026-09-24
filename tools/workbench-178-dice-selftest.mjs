import {build} from 'rolldown';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const out=process.env.DICE178_OUT||'F:/CodexWork/2026-09-20/w-xu/dice178';mkdirSync(out,{recursive:true});
const {chromium}=createRequire('D:/Desktop/DND-card-web/package.json')('@playwright/test');
await build({input:resolve('tools/workbench-178-dice-selftest.entry.ts'),plugins:[{name:'env',transform(code){return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');}},{name:'sdk',resolveId(id){if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/workbench-sdk.ts');if(['../state','../../state','./state'].includes(id))return resolve('tools/fixtures/workbench-modules.ts');}}],output:{file:join(out,'entry.js'),format:'esm'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/entry.js'?'text/javascript':'text/html');res.end(req.url==='/entry.js'?readFileSync(join(out,'entry.js')):'<script type="module" src="/entry.js"></script>');});await new Promise(r=>server.listen(5498,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage();
try{
 await page.goto('http://127.0.0.1:5498');await page.waitForFunction(()=>window.dice178);await page.evaluate(()=>window.dice178.warm());
 const result=await page.evaluate(async()=>{
  window.diceReads=[];const times=[];for(let i=0;i<20;i++){const start=performance.now();await window.dice178.executeRoll({expression:'1d20+3',itemId:'one',label:'敏捷检定'});times.push(performance.now()-start);}
  const repeatedReads=[...window.diceReads],rolls=window.wbMock.broadcasts.filter(r=>r.name==='com.obr-suite/dice-roll');
  let accessCalls=0;const check=async()=>{accessCalls++;throw Error('unauthorized token');};
  await window.dice178.diceRpc('broadcast.sendMessage',['com.obr-suite/dice-quick-roll',{expression:'1d20',itemId:'one'},{destination:'ALL'}],{item:{id:'one'},cardId:'hero'},check);
  const authorizedAccessCalls=accessCalls;let foreignRejected=false;try{await window.dice178.diceRpc('broadcast.sendMessage',['com.obr-suite/dice-quick-roll',{expression:'1d20',itemId:'foreign'},{destination:'ALL'}],{item:{id:'one'},cardId:'hero'},check);}catch{foreignRejected=true;}
  window.dice178.disarmFixedRoll();window.wbMock.role='PLAYER';window.wbMock.emit('player',{id:'me',role:'PLAYER',metadata:{},selection:['one']});
  await window.dice178.diceRpc('broadcast.sendMessage',['com.obr-suite/dice-quick-roll',{expression:'1d20',itemId:'one',hidden:true,fixedArm:{value:20}},{destination:'ALL'}],{item:{id:'one'},cardId:'hero'},check);
  const last=window.wbMock.broadcasts.filter(r=>r.name==='com.obr-suite/dice-roll').at(-1).data;times.sort((a,b)=>a-b);
  return {warmRolls:times.length,sdkGetterReads:repeatedReads,p50:times[10],p95:times[19],authorizedAccessCalls,foreignRejected,foreignAccessCalls:accessCalls,playerHidden:last.hidden,playerFixedArm:!!window.dice178.readFixedRoll(),labels:rolls.every(r=>r.data.label==='敏捷检定'),identities:rolls.every(r=>r.data.rollerId==='me'&&r.data.rollerName==='测试 DM'&&r.data.rollerColor==='#444444')};
 });
 assert.deepEqual(result.sdkGetterReads,[]);assert.equal(result.authorizedAccessCalls,0);assert.equal(result.foreignAccessCalls,1);assert(result.foreignRejected);assert.equal(result.playerHidden,false);assert.equal(result.playerFixedArm,false);assert(result.labels&&result.identities);writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
