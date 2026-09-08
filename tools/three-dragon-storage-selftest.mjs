#!/usr/bin/env node
import assert from "node:assert/strict";
import { build } from "rolldown";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? "C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const parent = resolve(tmpdir()), out = mkdtempSync(join(parent, "three-dragon-storage-"));
let server, browser;
try {
  const source = `import { TableStore } from ${JSON.stringify(resolve("src/modules/threeDragonAnte/store.ts").replaceAll("\\", "/"))};
    import { createGame, projectPublic, projectSeat } from ${JSON.stringify(resolve("src/modules/threeDragonAnte/rules/index.ts").replaceAll("\\", "/"))};
    import { packPublic, packSeat, unpackPublic, unpackSeat } from ${JSON.stringify(resolve("src/modules/threeDragonAnte/wire.ts").replaceAll("\\", "/"))};
    window.tableTest = {TableStore,createGame,projectPublic,projectSeat,packPublic,packSeat,unpackPublic,unpackSeat};`;
  await build({input:"virtual:test",platform:"browser",plugins:[{name:"entry",resolveId(id){if(id==="virtual:test")return "\0entry";},load(id){if(id==="\0entry")return source;}}],output:{file:join(out,"test.js"),format:"esm"}});
  server = createServer((request,response)=>{response.setHeader("Content-Type",request.url==="/test.js"?"application/javascript":"text/html");response.end(request.url==="/test.js"?readFileSync(join(out,"test.js")):'<!doctype html><script type="module" src="/test.js"></script>');});
  await new Promise(done=>server.listen(0,"127.0.0.1",done));
  browser = await chromium.launch({headless:true,channel:"msedge"});
  const context = await browser.newContext(), errors=[];
  let page=await context.newPage(); page.on("pageerror",error=>errors.push(error.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.goto(url); await page.waitForFunction(()=>window.tableTest);
  const initial=await page.evaluate(async()=>{
    const {TableStore,createGame,projectPublic,projectSeat,packPublic,packSeat,unpackPublic,unpackSeat}=window.tableTest;
    const game=createGame({id:"table-one",seed:101,seats:[{id:"alice",name:"Alice"},{id:"bob",name:"Bob"}]});
    const view=projectSeat(game,"alice"), publicView=projectPublic(game), packed=packSeat(view), publicWire=packPublic(view);
    const store=new TableStore(), table={version:1,id:game.id,hostPlayerId:"alice",hostConnectionId:"alice-old",hostName:"Alice",stage:"playing",revision:1,seats:[{playerId:"alice",seatId:"alice",name:"Alice"},{playerId:"bob",seatId:"bob",name:"Bob"}]};
    const saved=await store.save({version:1,roomId:"room-one",table,game,serial:0},null);
    await store.close();
    return {saved,view,publicView,publicWire,unpacked:unpackSeat(packed),unpackedPublic:unpackPublic(publicWire),publicKeys:Object.keys(publicWire),privateSize:JSON.stringify(packed).length,viewSize:JSON.stringify(view).length};
  });
  assert.deepEqual(initial.unpacked,initial.view); assert.deepEqual(initial.unpackedPublic,initial.publicView);
  for(const key of ["hand","committedAnte","actions","selfSeatId","deck","excluded","randomState","accepted"]) assert.ok(!initial.publicKeys.includes(key),`public wire exposed ${key}`);
  assert.ok(initial.privateSize<initial.viewSize); assert.equal(initial.saved.serial,1);
  await page.close(); page=await context.newPage(); page.on("pageerror",error=>errors.push(error.message));
  await page.goto(url); await page.waitForFunction(()=>window.tableTest);
  const recovery=await page.evaluate(async()=>{
    const store=new window.tableTest.TableStore();
    const saved=await store.load("room-one","table-one"), foreignRoom=await store.load("room-two","table-one"),foreignTable=await store.load("room-one","other-table");
    const competing=await Promise.allSettled([store.save({...saved,table:{...saved.table,hostConnectionId:"new-a"}},saved.serial),new window.tableTest.TableStore().save({...saved,table:{...saved.table,hostConnectionId:"new-b"}},saved.serial)]);
    const current=await store.load("room-one","table-one");
    let staleError="";try{await store.save(saved,saved.serial);}catch(error){staleError=error.message;}
    let duplicateError="";try{await store.save(saved,null);}catch(error){duplicateError=error.message;}
    const afterFailure=await store.load("room-one","table-one");
    return {saved,foreignRoom,foreignTable,competing:competing.map(result=>({status:result.status,error:result.reason?.message})),current,staleError,duplicateError,afterFailure};
  });
  assert.deepEqual(recovery.saved,initial.saved,"closing the original page must preserve complete private host recovery");
  assert.equal(recovery.foreignRoom,null); assert.equal(recovery.foreignTable,null);
  assert.equal(recovery.competing.filter(result=>result.status==="fulfilled").length,1);
  assert.equal(recovery.competing.find(result=>result.status==="rejected").error,"staleTable");
  assert.equal(recovery.current.serial,2); assert.equal(recovery.staleError,"staleTable"); assert.equal(recovery.duplicateError,"staleTable");
  assert.deepEqual(recovery.current,recovery.afterFailure); assert.deepEqual(recovery.current.game,initial.saved.game); assert.deepEqual(errors,[]);
  console.log("THREE_DRAGON_STORAGE: actual Edge IndexedDB close/reopen, complete private recovery, room/table isolation, concurrent compare-and-write and stale-write preservation PASS; wire round-trip, public field allowlist and smaller private payload PASS");
} finally {
  await browser?.close(); await new Promise(done=>server?server.close(done):done());
  if(dirname(resolve(out))!==parent)throw Error("Unexpected temporary directory");rmSync(out,{recursive:true,force:true});
}
