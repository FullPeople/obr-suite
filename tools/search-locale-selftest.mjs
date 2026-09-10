#!/usr/bin/env node
// Actual search loader + renderer + DOM, with deterministic library responses.
// Mutations are applied to temporary bundles only, never shared product files.
import { build } from "rolldown";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? "C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const outputRoot = resolve(tmpdir()), out = mkdtempSync(join(outputRoot, "suite-search-locale-"));
const shots = resolve("../_audit/2026-09-08/search-locale"); mkdirSync(shots, { recursive: true });
const mutations = [
  { name: "ignore preferred data language", file: "/utils/contentLocale.ts", from: "return sources.sort((a, b) => rank(a) - rank(b));", to: "return sources;" },
  { name: "ignore disabled source blacklist", file: "/modules/search/page.ts", from: "!source.disabledSources.has(code.toLowerCase())", to: "true" },
  { name: "cross-edition name fallback", file: "/modules/search/page.ts", from: 'if (source && String(data.source ?? "").toUpperCase() !== source) return false;', to: "/* accepts other editions */" },
  { name: "book cache ignores language and library", file: "/modules/search/page.ts", from: '`${BOOKS_CACHE_KEY}:${getLocalLang()}:${source.identity}`', to: 'BOOKS_CACHE_KEY' },
  { name: "lose English duration", file: "/modules/search/page.ts", from: 'if (getLocalLang() === "en") return en.durationEn(d);', to: "/* Chinese duration fallback */" },
];
let browser, server;
try {
  server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname.endsWith(".js")) {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end(readFileSync(join(out, url.pathname.slice(1))));
    } else {
      response.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
      response.end(readFileSync("search-bar.html", "utf8").replace("/src/modules/search/page.ts", `/${url.searchParams.get("bundle") ?? "search"}.js`));
    }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  for (const [index, mutation] of [null, ...(process.argv.includes("--mutations") ? mutations : [])].entries()) {
    const name = `search-${index}`;
    let mutated = !mutation;
    await build({ input: resolve("src/modules/search/page.ts"), platform: "browser", plugins: [{
      name: "search-test-boundaries",
      resolveId(id) {
        if (id === "@owlbear-rodeo/sdk") return resolve("tools/fixtures/suite-wiring-sdk.ts");
        if (/^(\.\.\/)+state$/.test(id)) return resolve("tools/fixtures/search-locale-state.ts");
        if (id.endsWith("utils/localContent")) return resolve("tools/fixtures/search-locale-local.ts");
        if (id === "../dice/tags") return "\0dice-tags";
        if (id === "../dice/context-menu") return "\0dice-menu";
        if (id === "../dice/sfx-broadcast") return "\0dice-sfx";
        if (id.endsWith("utils/debugOverlay")) return "\0debug";
        if (id.endsWith("utils/panelDrag")) return "\0drag";
        if (id.endsWith("utils/panelLayout")) return "\0layout";
      },
      load(id) {
        if (id === "\0dice-tags") return 'export const resolveClickRollTarget = () => null; export const formatTagsClickable = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replace(/\\{@\\w+\\s+([^}]+)\\}/g, (_, args) => args.split("|")[2] || args.split("|")[0]);';
        if (id === "\0dice-menu") return "export const bindRollableClickPopup = () => {};";
        if (id === "\0dice-sfx") return "export const subscribeToSfx = () => {};";
        if (id === "\0debug") return "export const installDebugOverlay = () => {};";
        if (id === "\0drag") return "export const bindPanelDrag = () => {};";
        if (id === "\0layout") return 'export const PANEL_IDS = {search:"search"};';
      },
      transform(code, id) {
        const path = id.replaceAll("\\", "/");
        if (mutation && path.endsWith(mutation.file)) {
          if (!code.includes(mutation.from)) throw Error(`Mutation no longer matches: ${mutation.name}`);
          code = code.replaceAll(mutation.from, mutation.to); mutated = true;
        }
        if (path.endsWith("/modules/search/page.ts")) code += '\nglobalThis.__search = { loadIndex, findEntryData, renderPreviewFor, renderResults, renderPreviewIdle, invalidateSearchContent, search, loadBooks, sourceLabel, categoryInfo, chipsFor, renderMonster, renderSpell, renderItem, renderAdventure, renderBook, renderEntries, matchesEntry };';
        if (path.endsWith("/utils/contentLocale.ts")) code += '\nglobalThis.__contentLocale = {getLibraryLanguage, selectContentLibraries, contentConfigurationKey};';
        return code;
      },
    }], output: { dir: out, entryFileNames: `${name}.js`, format: "esm" } });
    assert.ok(mutated);
    const page = await browser.newPage({ viewport: { width: 720, height: 460 } });
    const pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message));
    await page.addInitScript(() => {
      window.__routes = {}; window.__requests = [];
      window.fetch = async (url, options) => {
        const key = String(url); window.__requests.push(key);
        const route = window.__routes[key] ?? {status:404, body:{}};
        if (route.delay) await new Promise(resolve => setTimeout(resolve, route.delay));
        // Deliberately ignores AbortSignal: old successful replies must still
        // be rejected by generation/preview guards after transport cancellation.
        return new Response(JSON.stringify(route.body), {status:route.status ?? 200, headers:{"Content-Type":"application/json"}});
      };
    });
    await page.goto(`${base}/?bundle=${name}`);
    await page.waitForFunction(() => window.__search && window.__searchState);
    await page.waitForTimeout(300); // Finish the normal optional index warmup.
    let passed = 0;
    const test = async (title, fn) => { await fn(); passed++; if (!mutation) console.log(`PASS ${title}`); };
    const setup = async (options = {}) => page.evaluate(({options}) => {
      document.getElementById("q").value = "";
      window.__searchLocal.index = options.localIndex ?? {x:[],m:{s:{}}}; window.__searchLocal.data = options.localData ?? {};
      localStorage.clear(); window.__routes = options.routes ?? {}; window.__requests = [];
      window.__searchState.setLanguage(options.lang ?? "en");
      window.__searchState.setLibraries(options.libraries ?? []);
      window.__search.invalidateSearchContent();
    }, {options});
    const zh = {id:"zh",name:"Chinese",baseUrl:"https://5e.kiwee.top",enabled:true};
    const en = {id:"en",name:"English",baseUrl:"https://cdn.jsdelivr.net/gh/5etools-mirror-3/5etools-src@main",enabled:true};
    const entry = {id:1,c:2,u:"fireball_phb",n:"Fireball",cn:"火球术",s:"PHB"};
    const spell = {name:"Fireball",source:"PHB",level:3,school:"V",time:[{number:1,unit:"action"}],range:{type:"point",distance:{type:"feet",amount:150}},duration:[{type:"instant"}],entries:["English fireball body"]};
    const routes = (extra={}) => ({
      [`${zh.baseUrl}/search/index.json`]:{body:{x:[entry],m:{s:{}}}},
      [`${en.baseUrl}/search/index.json`]:{body:{x:[{...entry,cn:undefined}],m:{s:{}}}},
      [`${zh.baseUrl}/data/spells/spells-phb.json`]:{body:{spell:[{...spell,ENG_name:"Fireball",name:"火球术",entries:["中文原始内容"]}]}},
      [`${en.baseUrl}/data/spells/spells-phb.json`]:{body:{spell:[spell]}}, ...extra,
    });
    let failed;
    try {
      await test("legacy language inference is limited, explicit auto stays auto", async () => {
        const result = await page.evaluate(({zh,en}) => [zh,en,{...en,language:"auto"},{...en,baseUrl:"https://example.org/5etools-mirror-3"},{...zh,baseUrl:"https://5e.kiwee.top.evil.test"}].map(window.__contentLocale.getLibraryLanguage),{zh,en});
        assert.deepEqual(result,["zh","en","auto","auto","auto"]);
      });
      await test("preferred index and detail use English without fetching every library", async () => {
        await setup({libraries:[zh,en],routes:routes()});
        const result = await page.evaluate(async () => {const idx = await window.__search.loadIndex(); window.__requests=[]; const data = await window.__search.findEntryData(idx.x[0]); return {idx,data,requests:window.__requests};});
        assert.equal(result.idx.x.length,1); assert.equal(result.idx.x[0].contentLanguage,"en"); assert.equal(result.idx.x[0].cn,"火球术"); assert.deepEqual(result.data.entries,["English fireball body"]);
        assert.deepEqual(result.requests,[`${en.baseUrl}/data/spells/spells-phb.json`]);
      });
      await test("property index keeps full English names, alternate aliases and warmed file cache", async () => {
        await setup({libraries:[zh,en],routes:routes({[`${en.baseUrl}/data/items-base.json`]:{body:{itemProperty:[{abbreviation:"L",entries:[{name:"Light",entries:["English light property"]}]}]}},[`${zh.baseUrl}/data/items-base.json`]:{body:{itemProperty:[{abbreviation:"L",entries:[{name:"轻型",ENG_name:"Light",entries:["中文属性"]}]}]}}})});
        const result=await page.evaluate(async ()=>{const index=await window.__search.loadIndex();const entry=index.x.find(entry=>entry.c===58);window.__requests=[];return {entry,data:await window.__search.findEntryData(entry),requests:window.__requests};});
        assert.equal(result.entry.n,"Light"); assert.equal(result.entry.cn,"轻型"); assert.deepEqual(result.data.entries,["English light property"]); assert.deepEqual(result.requests,[]);
      });
      await test("all libraries disabled means no implicit network fallback", async () => {
        await setup({libraries:[{...zh,enabled:false},{...en,enabled:false}]});
        const result=await page.evaluate(async entry=>({idx:await window.__search.loadIndex(),detail:await window.__search.findEntryData(entry),requests:window.__requests}),entry);
        assert.equal(result.idx.x.length,0); assert.equal(result.detail,null); assert.deepEqual(result.requests,[]);
      });
      await test("source blacklist remains effective in detail fallback", async () => {
        await setup({libraries:[{...en,disabledSources:["phb"]},zh],routes:routes()});
        const result=await page.evaluate(async entry=>({data:await window.__search.findEntryData(entry),requests:window.__requests}),entry);
        assert.deepEqual(result.data.entries,["中文原始内容"]); assert.ok(!result.requests.some(url=>url.startsWith(en.baseUrl)&&url.includes("/data/spells")));
      });
      await test("local matching authored entry wins but unrelated local entry does not mask remote", async () => {
        await setup({libraries:[en],routes:routes(),localData:{spell:[{...spell,name:"Unrelated",entries:["Unrelated authored text"]}]}});
        assert.deepEqual(await page.evaluate(async entry=>(await window.__search.findEntryData(entry)).entries,entry),["English fireball body"]);
        await setup({libraries:[en],routes:routes(),localData:{spell:[{...spell,entries:["玩家写的 Fireball 原文"]}]}});
        assert.deepEqual(await page.evaluate(async entry=>(await window.__search.findEntryData(entry)).entries,entry),["玩家写的 Fireball 原文"]);
        await setup({libraries:[en],routes:routes(),localData:{spell:[{...spell,ENG_name:"Fireball",name:"我自制的火球",entries:["玩家写的 Fireball 原文"]}]}});
        await page.evaluate(entry=>window.__search.renderPreviewFor(entry),entry);
        assert.equal(await page.locator(".prev-title").innerText(),"我自制的火球");
      });
      await test("same names in 2014 and 2024 preserve source identity", async () => {
        await setup({libraries:[en],routes:routes({[`${en.baseUrl}/data/spells/spells-phb.json`]:{body:{spell:[{...spell,source:"XPHB",entries:["wrong edition"]}]}}})});
        assert.equal(await page.evaluate(entry=>window.__search.findEntryData(entry),entry),null);
      });
      await test("2014 and 2024 filters include matching core guide books and preserve other sources", async () => {
        const filtered=await page.evaluate(entry=>["2014","2024"].map(dataVersion=>window.__search.search("Fire",{x:["PHB","XPHB","DMG","XDMG","HOMEBREW"].map((s,id)=>({...entry,id,s})),m:{s:{}}},{language:"en",dataVersion,isGM:true,allowPlayerMonsters:true}).map(hit=>hit.s)),entry);
        assert.deepEqual(filtered,[["PHB","DMG","HOMEBREW"],["XPHB","XDMG","HOMEBREW"]]);
      });
      await test("missing translation preserves and labels original language", async () => {
        await setup({libraries:[zh,en],routes:routes({[`${en.baseUrl}/data/spells/spells-phb.json`]:{body:{spell:[]}}})});
        await page.evaluate(entry=>window.__search.renderPreviewFor(entry),entry);
        assert.match(await page.locator("#prev-body").innerText(),/中文原始内容/); assert.match(await page.locator(".prev-meta").innerText(),/Original: Chinese/);
      });
      await test("late selection replies and optional book names cannot replace new preview", async () => {
        const newer={...entry,n:"Shield",cn:undefined,u:"shield_phb"};
        await setup({libraries:[en],routes:routes({[`${en.baseUrl}/data/spells/spells-phb.json`]:{delay:100,body:{spell:[spell,{...spell,name:"Shield",entries:["Shield body"]}]}},[`${en.baseUrl}/data/books.json`]:{delay:250,body:{book:[{id:"PHB",name:"Player's Handbook"}]}}})});
        await page.evaluate(({entry,newer})=>{window.__search.renderPreviewFor(entry);window.__search.renderPreviewFor(newer);},{entry,newer});
        assert.equal(await page.locator(".prev-title").innerText(),"Shield");
        await page.waitForTimeout(350); assert.match(await page.locator("#prev-body").innerText(),/Shield body/); assert.doesNotMatch(await page.locator("#prev-body").innerText(),/English fireball body/);
      });
      await test("language switch rejects slow book metadata from previous language", async () => {
        await setup({libraries:[zh,en],routes:routes({[`${zh.baseUrl}/data/books.json`]:{delay:200,body:{book:[{id:"PHB",name:"旧中文书名"}]}},[`${en.baseUrl}/data/books.json`]:{body:{book:[{id:"PHB",name:"English Handbook"}]}}}),lang:"zh"});
        await page.evaluate(async entry=>{const idx=await window.__search.loadIndex(); window.__search.renderPreviewFor(idx.x[0]);},entry);
        await page.waitForTimeout(20);
        await page.evaluate(async ()=>{window.__searchState.setLanguage("en");const idx=await window.__search.loadIndex();await window.__search.renderPreviewFor(idx.x[0]);});
        await page.waitForTimeout(250); assert.match(await page.locator(".prev-meta").innerText(),/English Handbook/); assert.doesNotMatch(await page.locator(".prev-meta").innerText(),/旧中文书名/);
      });
      await test("successful book cache cannot leak across a later language switch", async () => {
        await setup({libraries:[zh,en],routes:routes({[`${zh.baseUrl}/data/books.json`]:{body:{book:[{id:"PHB",name:"已缓存中文书名"}]}},[`${en.baseUrl}/data/books.json`]:{body:{book:[{id:"PHB",name:"English Handbook"}]}}}),lang:"zh"});
        await page.evaluate(async ()=>{const idx=await window.__search.loadIndex();await window.__search.renderPreviewFor(idx.x[0]);});
        await page.waitForFunction(()=>document.querySelector(".prev-meta").textContent.includes("已缓存中文书名"));
        await page.evaluate(async ()=>{window.__searchState.setLanguage("en");const idx=await window.__search.loadIndex();await window.__search.renderPreviewFor(idx.x[0]);});
        await page.waitForTimeout(50); assert.match(await page.locator(".prev-meta").innerText(),/English Handbook/);
      });
      await test("slow index from a removed library cannot overwrite new configuration", async () => {
        const next={...en,id:"next",baseUrl:"https://next.example",language:"en"};
        await setup({libraries:[zh],routes:{[`${zh.baseUrl}/search/index.json`]:{delay:200,body:{x:[{...entry,n:"Old entry"}],m:{s:{}}}},[`${next.baseUrl}/search/index.json`]:{body:{x:[{...entry,n:"New entry"}],m:{s:{}}}}}});
        await page.evaluate(()=>{window.__oldIndex=window.__search.loadIndex().catch(error=>error.name);});
        await page.waitForTimeout(20);
        const current=await page.evaluate(async next=>{window.__searchState.setLibraries([next]);return window.__search.loadIndex();},next);
        assert.equal(current.x[0].n,"New entry");
        await page.waitForTimeout(250);
        assert.equal(await page.evaluate(async ()=>(await window.__search.loadIndex()).x[0].n),"New entry");
      });
      await test("failed preferred detail is retried and does not poison original content", async () => {
        await setup({libraries:[zh,en],routes:routes({[`${en.baseUrl}/data/spells/spells-phb.json`]:{status:403,body:{}}})});
        assert.deepEqual(await page.evaluate(async entry=>(await window.__search.findEntryData(entry)).entries,entry),["中文原始内容"]);
        await page.evaluate(({url,spell})=>{window.__routes[url]={body:{spell:[spell]}};},{url:`${en.baseUrl}/data/spells/spells-phb.json`,spell});
        assert.deepEqual(await page.evaluate(async entry=>(await window.__search.findEntryData(entry)).entries,entry),["English fireball body"]);
      });
      await test("class feature uses parent hash and source; only the needed class is fetched", async () => {
        const feature={...entry,c:30,n:"Wizard 1; Spellcasting",cn:"法师 1; 施法",u:"spellcasting_wizard_phb_1_phb"};
        await setup({libraries:[en],routes:{[`${en.baseUrl}/data/class/index.json`]:{body:{wizard:"class-wizard.json",fighter:"class-fighter.json"}},[`${en.baseUrl}/data/class/class-wizard.json`]:{body:{classFeature:[{name:"Spellcasting",className:"Wizard",level:1,source:"PHB",entries:["Wizard feature"]}]}}}});
        assert.deepEqual(await page.evaluate(async entry=>(await window.__search.findEntryData(entry)).entries,feature),["Wizard feature"]);
        assert.ok(!(await page.evaluate(()=>window.__requests)).some(url=>url.includes("class-fighter")));
      });
      await test("English spell chips include correct plural time, range and concentration", async () => {
        const data={...spell,time:[{number:1,unit:"bonus"},{number:2,unit:"hour"}],duration:[{type:"timed",concentration:true,duration:{amount:2,type:"minute"}}],range:{type:"cone",distance:{amount:60,type:"feet"}},components:{v:true,m:{text:"a pearl",cost:50,consume:true}},classes:{fromClassList:[{name:"Wizard"}]},entriesHigherLevel:["Higher level text"]};
        const html=await page.evaluate(({entry,data})=>window.__search.chipsFor(entry,data)+window.__search.renderSpell(entry,data),{entry,data});
        assert.match(html,/1 bonus action or 2 hours/); assert.match(html,/Concentration, up to 2 minutes/); assert.match(html,/60 ft. Cone/); assert.match(html,/0.5 gp/); assert.match(html,/Classes: /); assert.doesNotMatch(html,/[\u4e00-\u9fff]/);
        assert.doesNotMatch(await page.evaluate(entry=>window.__search.chipsFor(entry,{level:null}),entry),/Cantrip/);
      });
      await test("monster, weapon and adventure renderers contain no fixed Chinese labels in English", async () => {
        const html=await page.evaluate(entry=>window.__search.renderMonster({...entry,c:1},{size:["L"],type:"dragon",alignment:["L","E"],speed:{walk:30,fly:60},save:{str:"+5"},skill:{perception:"+4"},languages:["Common"],senses:["darkvision 60 ft."],passive:14,trait:[{name:"Trait",entries:["Text"]}],action:[{name:"Bite"}],legendary:[{name:"Move"}],spellcasting:[{will:["Light"],daily:{"1e":["Shield"]},rest:{"2e":["Fireball"]},spells:{"1":{slots:2,spells:["Shield"]}}}]})+window.__search.renderItem(entry,{dmg1:"1d6",dmg2:"1d8",dmgType:"O",property:["F","2H"],range:"20/60",entries:["Body"]})+window.__search.renderAdventure(entry,{author:"Author",published:"2024",level:{start:1,end:10},storyline:"Story",contents:[{name:"Chapter"}]}),entry);
        assert.doesNotMatch(html,/[\u4e00-\u9fff]/); assert.match(html,/force/); assert.match(html,/Finesse/); assert.match(html,/1\/day each/); assert.match(html,/2\/rest each/);
      });
      await test("all supported category labels and unsupported-detail feedback are English", async () => {
        const labels=await page.evaluate(()=>[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,27,29,30,31,32,33,34,35,36,37,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58].map(c=>window.__search.categoryInfo(c).label));
        assert.ok(labels.every(label=>!/[\u4e00-\u9fff]/.test(label)));
        await page.evaluate(entry=>window.__search.renderPreviewFor({...entry,c:50}),entry); assert.doesNotMatch(await page.locator("#prev-body").innerText(),/[\u4e00-\u9fff]/);
      });
      await test("actual results show English title and preserve authored body and source", async () => {
        await setup({libraries:[en],routes:routes()});
        await page.evaluate(async entry=>{document.getElementById("wrap").classList.add("has-q");document.getElementById("q").value="Fire";window.__search.renderResults([entry],"Fire");await window.__search.renderPreviewFor(entry);},entry);
        assert.equal(await page.locator(".row-item .name").innerText(),"Fireball"); assert.match(await page.locator("#prev-body").innerText(),/English fireball body/);
        assert.doesNotMatch(await page.locator(".row-item").innerText(),/[\u4e00-\u9fff]/, "English results should not display the retained Chinese search alias");
        if (!mutation) await page.screenshot({path:join(shots,"search-english-spell.png")});
        assert.deepEqual(pageErrors,[]);
      });
      await test("switching back to Chinese retains Chinese formatting and source prose", async () => {
        await setup({libraries:[zh,en],routes:routes(),lang:"zh"});
        await page.evaluate(async ()=>{const idx=await window.__search.loadIndex();document.getElementById("wrap").classList.add("has-q");document.getElementById("q").value="火球";window.__search.renderResults(idx.x,"火球");await window.__search.renderPreviewFor(idx.x[0]);});
        assert.equal(await page.locator(".prev-title").innerText(),"火球术");
        const body=await page.locator("#prev-body").innerText(); assert.match(body,/中文原始内容/); assert.match(body,/1 动作/); assert.match(body,/150 尺/);
        if (!mutation) await page.screenshot({path:join(shots,"search-chinese-spell.png")});
      });
    } catch(error) { failed=error; }
    await page.close();
    if (mutation) { if (!failed) throw Error(`SURVIVED: ${mutation.name}`); if (failed.code !== "ERR_ASSERTION") throw failed; console.log(`REJECTED ${mutation.name}`); }
    else { if (failed) throw failed; console.log(`SEARCH_LOCALE ${passed}/${passed}`); }
  }
  if (process.argv.includes("--mutations")) console.log(`SEARCH_LOCALE_MUTATIONS ${mutations.length}/${mutations.length}`);
} finally {
  await browser?.close(); await new Promise(done=>server?server.close(done):done());
  if (dirname(resolve(out))!==outputRoot) throw Error("Unexpected temporary output path"); rmSync(out,{recursive:true,force:true});
}
