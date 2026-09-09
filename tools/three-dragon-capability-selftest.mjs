#!/usr/bin/env node
import { build } from "rolldown";
import assert from "node:assert/strict";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const out = mkdtempSync(join(tmpdir(), "three-dragon-capability-"));
const sources = ["extensions/three-dragon-ante/src/game/controller.ts", "extensions/three-dragon-ante/src/game/protocol.ts", "extensions/three-dragon-ante/src/game/local-view.ts", "tools/fixtures/three-dragon-controller-room.ts", "tools/three-dragon-capability-selftest.mjs", "extensions/three-dragon-ante/src/game/index.ts"];
const pins = () => Object.fromEntries(sources.map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
const before = pins();
// Narrow source-structure regression for the actual publisher fallback. This
// is deliberately disclosed as AST inspection, not a simulated SDK E2E test.
const indexTree=ts.createSourceFile(sources[5],readFileSync(sources[5],"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const fallbackObjects=[];
function findFallback(node){
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==="view"&&node.initializer&&
     ts.isBinaryExpression(node.initializer)&&node.initializer.operatorToken.kind===ts.SyntaxKind.QuestionQuestionToken&&ts.isObjectLiteralExpression(node.initializer.right))fallbackObjects.push(node.initializer.right);
  ts.forEachChild(node,findFallback);
}
const publish=indexTree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="publish");
assert.ok(publish,"Actual index publisher exists");findFallback(publish);assert.equal(fallbackObjects.length,1,"One actual view fallback in index publisher");
const capability=fallbackObjects[0].properties.filter(node=>ts.isPropertyAssignment(node)&&node.name.getText(indexTree)==="actionReceiptVersion");
assert.equal(capability.length,1);assert.ok(ts.isNumericLiteral(capability[0].initializer));assert.equal(capability[0].initializer.text,"1","New index fallback advertises action capability before the controller exists");
writeFileSync(join(out,"index-fallback-source-check.json"),JSON.stringify({pass:true,scope:"TypeScript AST inspection of actual index.ts publish() null-controller fallback; not executed SDK end-to-end",source:sources[5],sha256:before[sources[5]],line:indexTree.getLineAndCharacterOfPosition(capability[0].getStart(indexTree)).line+1},null,2));
const path = value => JSON.stringify(resolve(value).replaceAll("\\", "/"));
const entry = `
import assert from "node:assert/strict";
import {TableController} from ${path(sources[0])};
import {localViewParts,LocalViewReceiver} from ${path(sources[2])};
import {ControllerRoom,MemoryStore,until} from ${path(sources[3])};
const room=new ControllerRoom(),store=new MemoryStore(),emitted=[];
const options={retryMs:10000,heartbeatMs:30000,timeoutMs:60000,creationSettleMs:5};
const host=new TableController(v=>emitted.push(v),{...options,platform:room.port('host','host'),storage:store});
const guest=new TableController(v=>emitted.push(v),{...options,platform:room.port('guest','guest'),storage:new MemoryStore()});
const all=[host,guest],checks=[];
function check(label){checks.push(label);console.log('PASS '+checks.length+': '+label);}
function roundtrip(view,sequence){const receiver=new LocalViewReceiver('capability-window');let result;
  for(const part of localViewParts(view,'capability-window',sequence).reverse())result=receiver.receive(part)??result;return result;}
try{
  assert.ok(all.every(c=>c.view.actionReceiptVersion===1));
  await Promise.all(all.map(c=>c.start()));
  assert.ok(all.every(c=>c.view.actionReceiptVersion===1&&c.view.connected));
  check('Unstarted and ready empty-room views advertise exact action-receipt capability');
  await host.command({type:'create'});await until(()=>guest.view.connected,'guest private handshake');
  await guest.command({type:'join'});await until(()=>!guest.view.pending&&host.view.table.seats.length===2,'join');
  await host.command({type:'start'});await until(()=>all.every(c=>c.view.game?.phase==='ante'),'game projection');
  assert.ok(emitted.length>3&&emitted.every(v=>v.actionReceiptVersion===1));
  assert.ok(all.every(c=>c.view.actionReceipt===undefined));
  check('Host and remote guest emissions keep capability through lobby/deal without inventing an action outcome');
  for(const c of all){const decoded=roundtrip(c.view,1);assert.deepEqual(decoded,c.view);assert.equal(decoded.actionReceiptVersion,1);}
  check('Actual LOCAL framing preserves capability alongside complete own-hand projection');
  const oldView=structuredClone(guest.view);delete oldView.actionReceiptVersion;
  const legacy=roundtrip(oldView,2);assert.deepEqual(legacy,oldView);assert.equal(legacy.actionReceiptVersion,undefined);
  assert.equal('actionReceiptVersion' in legacy,false);
  check('Old live-background views remain decodable and visibly lack capability; decoder never defaults it to supported');
  assert.equal(store.data.size,1);assert.ok(store.writes>=3);
  assert.equal(JSON.stringify([...store.data.values()]).includes('actionReceiptVersion'),false);
  assert.equal(JSON.stringify(room.table).includes('actionReceiptVersion'),false);
  await Promise.all(all.map(c=>c.stop()));assert.ok(all.every(c=>c.view.actionReceiptVersion===1&&!c.view.actionReceipt));
  assert.equal(room.listeners,0);
  check('Capability is LOCAL-only and remains a capability after stop, never a success receipt');
  console.log(JSON.stringify({checks,scope:'Actual controllers/LOCAL framing/native WebCrypto; simulated room/storage. New-UI disabled-submit behavior belongs to the separate UI test.'}));
}finally{await Promise.all(all.map(c=>c.stop()));}
`;
writeFileSync(join(out,"entry.ts"),entry);
await build({input:join(out,"entry.ts"),platform:"node",output:{file:join(out,"selftest.mjs"),format:"esm",codeSplitting:false}});
try{
  const result=execFileSync(process.execPath,[join(out,"selftest.mjs")],{encoding:"utf8",timeout:20000});
  const after=pins();if(JSON.stringify(after)!==JSON.stringify(before))throw Error("Capability source changed during test");
  writeFileSync(join(out,"result.txt"),result);writeFileSync(join(out,"source-pins.json"),JSON.stringify(after,null,2));
  console.log(result);console.log('PASS: one additional actual index fallback AST source check (not runtime E2E).');console.log('Capability evidence: '+out);
}catch(error){writeFileSync(join(out,"failure.txt"),String(error.stack)+'\n'+(error.stdout??'')+'\n'+(error.stderr??''));console.error(out);throw error;}
