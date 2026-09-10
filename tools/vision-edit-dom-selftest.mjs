import {build} from "rolldown";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {resolve,join} from "node:path";
import {tmpdir} from "node:os";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {chromium}=require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out=mkdtempSync(join(tmpdir(),"suite-vision-dom-"));
let browser, passed=0;
const check=(value,label)=>{if(!value)throw Error(`ASSERTION: ${label}`);passed++;};
try{
 const bundle=join(out,"edit.js");
 await build({input:resolve("src/modules/fullFog/dynfog/light/edit-page.ts"),plugins:[{
  name:"edit-test-transport",resolveId(id){if(id==="@owlbear-rodeo/sdk")return resolve("tools/fixtures/vision-edit-sdk.ts");if(id==="../../../../state")return "\0test-language";},
  load(id){if(id==="\0test-language")return "export const getLocalLang=()=>window.visionMock.lang; export const getState=()=>({fogShareVision:window.visionMock.share!==false}); export const startSceneSync=()=>{}; export const onStateChange=fn=>{window.visionMock.settingsChanged=fn;return()=>{window.visionMock.settingsChanged=null;}};";},
 }],output:{file:bundle,format:"iife"}});
 browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
 const html=readFileSync("fullfog-light-edit.html","utf8").replace(/<script type="module"[^>]*><\/script>/,""),js=readFileSync(bundle,"utf8");
 for(const lang of ["zh","en"]){
  const page=await browser.newPage({viewport:{width:320,height:254}});
  await page.setContent(html);
  await page.evaluate(lang=>{window.visionMock={lang,role:"GM",selection:["a"],players:[{id:"p1",name:"Alice",role:"PLAYER"},{id:"p2",name:"Bob",role:"PLAYER"},{id:"gm",name:"GM",role:"GM"}],items:{a:{id:"a",metadata:{"com.obr-suite/fullFog/light":{attenuationRadius:450}}},b:{id:"b",metadata:{"com.obr-suite/fullFog/light":{attenuationRadius:900}}}}};},lang);
  await page.addScriptTag({content:js});await page.waitForFunction(()=>document.querySelector("select")?.options.length===4);
  check(await page.locator("select").inputValue()==="auto",`${lang} automatic ownership default`);
  check(await page.locator('option[value="auto"]').textContent()===(lang==='zh'?'全部玩家（自动归属）':'All players (automatic)'),`${lang} shared vision uses merged all-player choice`);
  check(await page.locator('option[value="team"]').count()===0,`${lang} redundant party choice removed`);
  await page.evaluate(()=>{document.getElementById('range').value='777';window.visionMock.share=false;window.visionMock.settingsChanged();});
  check(await page.locator('option[value="auto"]').textContent()===(lang==='zh'?'所属玩家（自动归属）':'Owning player (automatic)'),`${lang} open menu follows sharing off`);
  check(await page.locator('#range').inputValue()==='777',`${lang} settings refresh preserves uncommitted range`);
  await page.evaluate(()=>{const m=window.visionMock;m.items.a.metadata['com.obr-suite/fullFog/vision']={mode:'team'};m.emit('items',[]);});
  await page.waitForFunction(()=>document.getElementById('range').value==='450');
  check(await page.locator('select').inputValue()==='auto',`${lang} old party mode displays merged automatic choice`);
  check(await page.evaluate(()=>window.visionMock.items.a.metadata['com.obr-suite/fullFog/vision'].mode==='team'),`${lang} merely opening old scene does not rewrite metadata`);
  check(await page.locator("select option").allTextContents().then(values=>!values.includes("GM")),`${lang} only actual players selectable`);
  check(await page.evaluate(()=>document.querySelector(".actions").getBoundingClientRect().bottom<=254&&document.documentElement.scrollWidth<=320),`${lang} controls fit embedded menu`);
  await page.evaluate(()=>{document.getElementById("range").value="777";window.visionMock.failNext=true;});
  await page.locator("select").selectOption("gm");
  check(await page.locator("select").inputValue()==="auto"&&await page.locator("#panel").isVisible(),`${lang} failed save returns to previous owner without closing panel`);
  check(await page.locator("#range").inputValue()==="777"&&Boolean(await page.locator('[role="status"]').textContent()),`${lang} failed save preserves other draft and explains retry`);
  await page.locator("select").selectOption("owner:p2");
  check(await page.evaluate(()=>window.visionMock.items.a.metadata["com.obr-suite/fullFog/vision"].ownerIds[0]==="p2"),`${lang} retry in same menu saves owner`);
  await page.evaluate(()=>{window.visionMock.holdWrite=true;});await page.locator("select").selectOption("gm");
  await page.evaluate(()=>{window.visionMock.holdWrite=false;});await page.locator("select").selectOption("auto");
  await page.evaluate(()=>window.visionMock.pending.splice(0).forEach(fn=>fn()));
  check(await page.evaluate(()=>!("com.obr-suite/fullFog/vision" in window.visionMock.items.a.metadata)),`${lang} delayed older owner choice cannot replace newer automatic choice`);
  await page.locator("select").selectOption("owner:p2");
  await page.evaluate(()=>{window.visionMock.holdWrite=true;});await page.locator("select").selectOption("gm");
  await page.evaluate(()=>{const m=window.visionMock;m.role="PLAYER";m.emit("player",{role:"PLAYER"});m.pending.splice(0).forEach(fn=>fn());});
  await page.waitForFunction(()=>document.querySelector("select").disabled);
  check(await page.evaluate(()=>window.visionMock.items.a.metadata["com.obr-suite/fullFog/vision"].ownerIds[0]==="p2"),`${lang} demotion blocks delayed ownership write`);
  await page.evaluate(()=>{const m=window.visionMock;m.role="GM";m.holdWrite=false;m.emit("player",{role:"GM"});});
  await page.waitForFunction(()=>!document.querySelector("select").disabled);
  await page.evaluate(()=>{window.visionMock.holdWrite=true;});await page.locator("select").selectOption("gm");
  await page.evaluate(()=>{const m=window.visionMock;m.emit("ready",false);m.pending.splice(0).forEach(fn=>fn());});
  check(await page.evaluate(()=>window.visionMock.items.a.metadata["com.obr-suite/fullFog/vision"].ownerIds[0]==="p2"),`${lang} closed scene blocks delayed ownership write`);
  await page.close();
 }
 console.log(`Vision edit DOM self-test: ${passed} assertions passed`);
}finally{await browser?.close();rmSync(out,{recursive:true,force:true});}
