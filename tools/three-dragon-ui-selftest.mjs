import {build} from "rolldown";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {resolve,join} from "node:path";
import {tmpdir} from "node:os";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),{chromium}=require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out=mkdtempSync(join(tmpdir(),"three-dragon-ui-"));let browser,assertions=0,baseView;
const check=(value,label)=>{if(!value)throw Error(`ASSERTION: ${label}`);assertions++;};
try{
 const file=join(out,"ui.js");await build({input:resolve("tools/three-dragon-ui-selftest.entry.ts"),output:{file,format:"iife"}});
 browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
 for(const language of ["en","zh"]){
  const page=await browser.newPage({viewport:{width:390,height:780}});
  await page.setContent('<main id="table-app"></main>');await page.addStyleTag({content:readFileSync("extensions/three-dragon-ante/src/game/style.css","utf8")});await page.addScriptTag({path:file});
  baseView=await page.evaluate(()=>window.base);
  await page.evaluate(lang=>window.ui.language(lang),language);
  await page.evaluate(()=>window.ui.failed());check((await page.locator("#status").textContent()).includes(language==="en"?"No result":"未收到"),`${language}: no initial view gives visible same-page retry`);
  await page.evaluate(()=>window.set({...window.base,table:null,game:null}));await page.locator("#toolbar button").first().click();
  check(await page.evaluate(()=>window.commands.at(-1).type==="create"),`${language}: one click creates`);
  await page.evaluate(()=>window.set({...window.base,isHost:false,selfPlayerId:"p2",game:null,table:{...window.base.table,stage:"lobby"}}));await page.locator("#toolbar button").first().click();
  check(await page.evaluate(()=>window.commands.at(-1).type==="join"),`${language}: one click joins`);
  await page.evaluate(()=>window.set({...window.base,game:null,table:{...window.base.table,stage:"lobby"}}));
  check((await page.locator("#toolbar button").allTextContents()).includes(language==="en"?"Start game":"开始游戏"),`${language}: creator can start without a GM flag`);
  await page.evaluate(()=>window.set(window.base));
  check(await page.locator("#hand .card").count()===6,`${language}: own six-card hand shown`);
  check(await page.evaluate(()=>!window.otherHand.some(id=>[...document.querySelectorAll("#hand [data-option]")].some(e=>e.dataset.option===id))),`${language}: no other player's hand options`);
  check(await page.locator("#players h2").first().textContent().then(s=>s.includes("<script>"))&&await page.locator("#players script").count()===0,`${language}: seat names are plain text`);
  await page.locator("#hand [data-option]").first().click();
  const selected=await page.locator('#hand [aria-pressed="true"]').getAttribute("data-option");
  await page.evaluate(()=>window.set({...window.base,pending:true}));check(await page.locator("#confirm-action").isDisabled(),`${language}: processing locks action`);
  await page.evaluate(()=>window.set(window.base));check(await page.locator('#hand [aria-pressed="true"]').getAttribute("data-option")===selected,`${language}: repeated view preserves local selection`);
  await page.evaluate(()=>{const v=structuredClone(window.base);v.game.revision=5;window.set(v);});await page.locator("#confirm-action").click();
  check(await page.evaluate(()=>window.commands.at(-1).action.revision===5&&window.commands.at(-1).action.seatId==="s0"),`${language}: action uses latest revision and own seat`);
  check(await page.locator("#confirm-action").isDisabled(),`${language}: repeated click cannot dispatch twice`);
  await page.evaluate(()=>window.set({...window.base,isHost:false,selfPlayerId:"watcher",game:window.publicGame}));
  check(await page.locator("#hand").isHidden()&&await page.locator("#confirm-action").count()===0,`${language}: spectator cannot play or see a hand`);
  check(!(await page.locator("#players").textContent()).includes(language==="en"?"(You)":"(你)"),`${language}: spectator transition clears former self-seat marker`);
  check(!(await page.locator("#toolbar").textContent()).includes(language==="en"?"New game":"重新开局"),`${language}: non-host has no reset`);
  await page.evaluate(()=>window.set({...window.base,connected:false,message:"hostOffline"}));check((await page.locator("#status").textContent()).includes(language==="en"?"offline":"离线"),`${language}: host offline explicit`);
  check(await page.locator("#hand button").first().isDisabled(),`${language}: offline state locks cards`);
  await page.evaluate(()=>window.set({...window.base,connected:false,message:"recoveryMissing"}));
  check((await page.locator("#status").textContent()).includes(language==="en"?"recovery":"恢复"),`${language}: missing recovery explicit`);
  await page.locator("#toolbar button").first().click();check(await page.locator("#reset-dialog").isVisible(),`${language}: reset asks before clearing`);
  const beforeCancel=await page.evaluate(()=>window.commands.length);await page.locator("#cancel-reset").click();check(await page.evaluate(()=>window.commands.length)===beforeCancel,`${language}: cancel does not reset`);
  await page.locator("#toolbar button").first().click();await page.locator("#confirm-reset").click();check(await page.evaluate(()=>window.commands.at(-1).type==="newGame"),`${language}: explicit confirm resets recovery-missing game`);
  for(const code of ["BLUE_DESTINATION","GIVE_DRAGON_OR_GOLD","LOWEST_ANTE_CARD","KEEP_ONE_ANTE_CARD","REPLACE_OTHER_FLIGHT_CARD","REPLACE_WYRMLING","TRIGGER_REPLACEMENT","WEAKEST_OPPONENT","STRONGEST_OPPONENT","REMOVE_WEAKER_DRAGON","EXCHANGE_HAND_CARDS","SWAP_MORTAL","NEXT_GOOD_DRAGON_POWER","COPY_HAND_DRAGON","KEEP_SEER_CARD","SEER_HAND_FULL_KEEP_TOP","SORCERER_REPLACEMENT","STRENGTH_FLIGHT_ANTE"]){
   await page.evaluate(code=>window.set(window.choice(code)),code);
   check(!(await page.locator("#turn h2").textContent()).includes(code),`${language}: ${code} has human prompt`);
   check(await page.locator("#turn [data-option]").count()===4,`${language}: ${code} renders card/seat/text options`);
   check((await page.locator("#turn").textContent()).includes("Bob"),`${language}: ${code} identifies ability owner`);
  }
  await page.evaluate(()=>window.set(window.choice("EXCHANGE_HAND_CARDS",0,2)));
  check(await page.locator("#confirm-action").isEnabled(),`${language}: optional zero selection can confirm`);
  await page.locator('[data-option="c1"]').click();await page.locator('[data-option="c2"]').click();
  check(await page.locator('[data-option="s1"]').isDisabled(),`${language}: selection cannot exceed max`);
  await page.locator('[data-option="c2"]').focus();await page.evaluate(()=>window.set(window.choice("EXCHANGE_HAND_CARDS",0,2)));
  check(await page.evaluate(()=>document.activeElement.dataset.option==="c2")&&await page.locator('#turn [aria-pressed="true"]').count()===2,`${language}: unchanged choice preserves focus and drafts`);
  await page.locator("#confirm-action").click();check(await page.evaluate(()=>window.commands.at(-1).action.optionIds.join(",")==="c1,c2"),`${language}: multi-choice sends exact selected IDs`);
  await page.evaluate(()=>window.set(window.choice("EXCHANGE_HAND_CARDS",2,2)));await page.locator('[data-option="c1"]').click();
  check(await page.locator("#confirm-action").isDisabled(),`${language}: below minimum cannot confirm`);
  for(const family of await page.evaluate(()=>[...new Set(window.cards.map(c=>c.family))])){
   await page.evaluate(family=>{const v=window.choice("COPY_HAND_DRAGON");const c=window.cards.find(c=>c.family===family);v.game.actions[0].choice.options=[{id:c.id,cardId:c.id}];window.set(v);},family);
   check((await page.locator("#turn .card-hint").textContent()).length>5,`${language}: ${family} displays useful ability hint`);
  }
  await page.evaluate(()=>{const v=structuredClone(window.base);v.game.phase="adjudication";v.game.actions=[];v.game.issue="RULE_EMPTY_STAKES_TIE";window.set(v);});
  check((await page.locator("#turn").textContent()).includes(language==="en"?"paused":"暂停")&&await page.locator("#confirm-action").count()===0,`${language}: adjudication clearly pauses without invented actions`);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=390),`${language}: narrow layout has no horizontal overflow`);
  if(process.env.THREE_DRAGON_UI_SCREENSHOT){await page.evaluate(()=>window.set(window.base));await page.screenshot({path:process.env.THREE_DRAGON_UI_SCREENSHOT.replace("{lang}",language),fullPage:true});}
  const beforeClose=await page.evaluate(()=>window.commands.length);await page.locator("#close").click();
  check(await page.evaluate(n=>window.commands.length===n+1&&window.commands.at(-1).type==="close",beforeClose),`${language}: close sends no leave command`);
  await page.close();
 }
 const shell=join(out,"page.js");await build({input:resolve("extensions/three-dragon-ante/src/game/page.ts"),plugins:[{
  name:"table-shell-sdk",resolveId(id){if(id==="@owlbear-rodeo/sdk")return "\0table-sdk";if(id==="../locale")return "\0table-lang";if(id.endsWith(".css"))return "\0table-css";},
  load(id){if(id==="\0table-css")return "";if(id==="\0table-lang")return 'export const getLocalLang=()=>"en";export const onLangChange=()=>()=>{};export const setLocalLang=()=>{};';if(id==="\0table-sdk")return 'const m=window.tableSDK;export default {player:{getConnectionId:async()=>"local-connection"},onReady:fn=>{void fn()},broadcast:{onMessage:(topic,fn)=>{m.handler=fn;(m.handlers??={})[topic]=fn;return ()=>{m.unsubscribed=true;delete m.handlers[topic]}},sendMessage:async(topic,data,options)=>{m.sent.push({topic,data,options})}}};';},
 }],output:{file:shell,format:"iife"}});
 const page=await browser.newPage();await page.route('http://localhost/table',route=>route.fulfill({contentType:'text/html',body:'<main id="table-app"></main>'}));await page.goto('http://localhost/table');
 await page.evaluate(()=>{window.tableSDK={sent:[],unsubscribed:false};const original=window.setTimeout;window.setTimeout=(fn,delay,...args)=>{if(delay===12000){window.tableSDK.timeout=fn;return 9981;}return original(fn,delay,...args);};});
 await page.addScriptTag({path:shell});await page.waitForFunction(()=>window.tableSDK.sent.length>0);
 check(await page.evaluate(()=>window.tableSDK.sent[0].topic.endsWith("/ready")&&window.tableSDK.sent[0].options.destination==="LOCAL"),"shell asks local background for view");
 const deliver=async(view,sequence,sender="local-connection")=>page.evaluate(({view,sequence,sender})=>{
   // Construct the public transport envelope, retaining all card IDs. The
   // receiver and actual UI are production code in page.js.
   const g=view.game, packed=g&&{...g,ante:g.ante.map(c=>c.id),discard:g.discard.map(c=>c.id),revealed:g.revealed.map(c=>c.id),seats:g.seats.map(s=>({...s,flight:s.flight.map(({card,...f})=>f)})),...("hand"in g?{hand:g.hand.map(c=>c.id),committedAnte:g.committedAnte?.id??null}:{})};
   const bytes=new TextEncoder().encode(JSON.stringify({...view,game:packed}));let raw="";for(const b of bytes)raw+=String.fromCharCode(b);const encoded=btoa(raw),total=Math.ceil(encoded.length/10000),clientId=window.tableSDK.sent[0].data.clientId;
   for(let part=total-1;part>=0;part--)window.tableSDK.handler({connectionId:sender,data:{version:1,clientId,sequence,part,total,payload:encoded.slice(part*10000,(part+1)*10000)}});
 },{view,sequence,sender});
 await deliver(baseView,1);check(await page.locator("#hand .card").count()===6,"shell accepts own-connection projection");
 const restore=async(sender,instance)=>page.evaluate(({sender,instance})=>{const ready=window.tableSDK.sent[0].data,game=window.testProjection.game;window.tableSDK.handlers['com.fullpeople/three-dragon-ante/ui-restore']({connectionId:sender,data:{clientId:ready.clientId,instance,draft:{tableId:window.testProjection.table.id,gameId:game.id,selectionKey:game.id+':'+game.gambit+':'+game.round+':ante:',selected:[game.actions[0].cardIds[0]],boardScroll:0,handScroll:0,open:[]}}});},{sender,instance});
 await page.evaluate(value=>window.testProjection=value,baseView);
 await restore('remote-attacker','');check(await page.locator('#hand [aria-pressed=true]').count()===0,'shell rejects remote UI draft restore');
 await restore('local-connection','old-instance');check(await page.locator('#hand [aria-pressed=true]').count()===0,'shell rejects UI draft from a prior window instance');
 await restore('local-connection','');check(await page.locator('#hand [aria-pressed=true]').count()===1,'shell accepts same-instance own-connection legal UI draft without action');
 check(await page.evaluate(()=>!window.tableSDK.sent.some(message=>message.data.command?.type==='action')),'UI draft restoration sends no automatic rules action');

 await deliver({...baseView,game:null},2,"remote-attacker");check(await page.locator("#hand .card").count()===6,"shell rejects remote projection injection");
 const largeView=structuredClone(baseView);largeView.message='跨分片 🐉 "\\'.repeat(1800);largeView.game.seats[0].name='跨分片 🐉 "\\'.repeat(15);largeView.game.discard=Array.from({length:48},()=>baseView.game.hand[0]);largeView.game.events=Array.from({length:100},(_,i)=>({code:'CARD_PLAYED',seatId:baseView.game.selfSeatId,amount:i,cardIds:[baseView.game.hand[0].id]}));
 await deliver(largeView,3);check((await page.locator('#players .seat h2').first().textContent()).includes(largeView.game.seats[0].name),'actual page reassembles large escaped multibyte view without truncation');
 check(await page.locator('#discard-cards .card').count()===0,'closed discard details defer card DOM');
 await page.locator('#discard-title').click();await page.waitForFunction(()=>document.querySelectorAll('#discard-cards .card').length===48);check(await page.locator('#discard-cards .card').count()===48,'all public discard cards can be inspected');
 check((await page.locator('#events li').first().textContent()).includes('99'),'latest event survives fragmented delivery');
 await deliver(baseView,2);check(await page.locator('#discard-cards .card').count()===48,'stale view cannot roll back the actual card table');
 await deliver({...baseView,pending:true},4);await page.evaluate(()=>window.tableSDK.timeout());
 check((await page.locator("#status").textContent()).includes("No result")&&await page.getByRole("button",{name:"Reconnect",exact:true}).isEnabled(),"shell pending timeout permits same-page reconnect");
 check(await page.locator("#hand button").first().isDisabled(),"shell timeout does not reopen stale card actions");
 await page.getByRole("button",{name:"Reconnect",exact:true}).click();check(await page.evaluate(()=>window.tableSDK.sent.at(-1).data.command.type==="retry"&&window.tableSDK.sent.at(-1).data.clientId===window.tableSDK.sent[0].data.clientId&&window.tableSDK.sent.at(-1).options.destination==="LOCAL"),"shell retries through local command contract");
 await page.evaluate(()=>window.dispatchEvent(new Event("pagehide")));
 check(await page.evaluate(()=>window.tableSDK.unsubscribed&&!window.tableSDK.sent.some(e=>e.data?.type==="leave")),"shell cleanup unsubscribes without leaving table");await page.close();
 console.log(`Three-dragon UI: ${assertions} browser DOM assertions passed`);
}finally{await browser?.close();rmSync(out,{recursive:true,force:true});}
