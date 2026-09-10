#!/usr/bin/env node
// Real catalog/detail loader and monster-info DOM; only SDK/storage/network
// boundaries are mocked. Mutations run in disposable bundles, never source.
import { build } from 'rolldown';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? 'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const outputRoot = resolve(tmpdir()), out = mkdtempSync(join(outputRoot, 'suite-bestiary-locale-'));
const shots = resolve('../_audit/2026-09-08/bestiary-locale'); mkdirSync(shots, { recursive: true });
const mutations = [
  { name: 'catalog ignores preferred language', file: '/modules/bestiary/data.ts', from: 'return selectContentLibraries(getState().libraries ?? [], getLocalLang());', to: 'return selectContentLibraries(getState().libraries ?? [], getLocalLang()).reverse();' },
  { name: 'aggregated file leaks blocked source', file: '/modules/bestiary/data.ts', from: '!source.disabledSources.has(String(monster.source ?? "").trim().toLowerCase())', to: 'true' },
  { name: 'remote copy overwrites local priority', file: '/modules/bestiary/data.ts', from: 'readyMonsters.push(...remoteMonsters);', to: 'readyMonsters.unshift(...remoteMonsters);' },
  { name: 'detail crosses edition by name', file: '/modules/bestiary/detail-data.ts', from: 'body.monster.find((monster: any) => matches(monster, code, names))', to: 'body.monster.find((monster: any) => matches(monster, monster.source, names))' },
  { name: 'local named copy edits take wrong translated parent', file: '/modules/bestiary/data.ts', from: 'parents.find((candidate) => copyModTargetsAvailable(monster, candidate))', to: 'parents[0]' },
  { name: 'split library parent dependency is dropped', file: '/modules/bestiary/data.ts', from: 'other !== group && (group.source.language', to: 'false && (group.source.language' },
  { name: 'catalog accepts wrong-language auto parent', file: '/modules/bestiary/data.ts', from: 'if (!candidate || !copyModTargetsAvailable(monster, candidate)) continue;', to: 'if (!candidate) continue;' },
  { name: 'detail accepts wrong-language auto parent', file: '/modules/bestiary/detail-data.ts', from: 'if (candidate && copyModTargetsAvailable(found, candidate)) parent = candidate;', to: 'if (candidate) parent = candidate;' },
  { name: 'detail overwrites edited source snapshot', file: '/modules/bestiary/detail-data.ts', from: 'if (savedAuthored) return', to: 'if (false) return' },
  { name: 'old info response overwrites current token', file: '/modules/bestiary/monster-info-page.ts', from: 'if (!isCurrent()) return;', to: '/* no display generation guard */' },
];
let browser, server;
try {
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.endsWith('.js')) { response.writeHead(200, {'Content-Type':'application/javascript'}); response.end(readFileSync(join(out, url.pathname.slice(1)))); }
    else { response.writeHead(200, {'Content-Type':'text/html;charset=utf-8'}); response.end(readFileSync('bestiary-monster-info.html','utf8').replace('/src/modules/bestiary/monster-info-page.ts', `/${url.searchParams.get('bundle')}.js`)); }
  });
  await new Promise(done => server.listen(0,'127.0.0.1',done));
  browser = await chromium.launch({headless:true,channel:'msedge'});
  for (const [index, mutation] of [null, ...(process.argv.includes('--mutations') ? mutations : [])].entries()) {
    const name = `bestiary-${index}`; let mutated = !mutation;
    await build({input:resolve('tools/bestiary-locale-selftest.entry.ts'),platform:'browser',plugins:[{
      name:'bestiary-test-boundaries',
      resolveId(id) {
        if (id === '@owlbear-rodeo/sdk') return resolve('tools/fixtures/bestiary-locale-sdk.ts');
        if (/^(\.\.\/)+state$/.test(id)) return resolve('tools/fixtures/bestiary-locale-state.ts');
        if (id.endsWith('utils/localContent')) return resolve('tools/fixtures/bestiary-locale-local.ts');
        if (id === '../dice/tags') return '\0tags';
        if (id === '../dice/context-menu') return '\0menu';
        if (id === '../dice/sfx-broadcast') return '\0sfx';
        if (id.endsWith('utils/debugOverlay')) return '\0debug';
        if (id.endsWith('utils/panelDrag')) return '\0drag';
        if (id.endsWith('utils/panelLayout')) return '\0layout';
        if (id.endsWith('utils/panelZoom')) return '\0zoom';
        if (id === '../resourceTracker/panel') return '\0resources';
      },
      load(id) {
        if (id === '\0tags') return 'export const resolveClickRollTarget=()=>null;export const formatTagsClickable=value=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replace(/\\{@\\w+\\s+([^}]+)\\}/g,(_,args)=>args.split("|")[2]||args.split("|")[0]);';
        if (id === '\0menu') return 'export const bindRollableClickPopup=()=>{};export const bindRollableContextMenu=()=>{};';
        if (id === '\0sfx') return 'export const subscribeToSfx=()=>{};';
        if (id === '\0debug') return 'export const installDebugOverlay=()=>{};';
        if (id === '\0drag') return 'export const bindPanelDrag=()=>{};';
        if (id === '\0layout') return 'export const PANEL_IDS={monsterInfo:"info"};';
        if (id === '\0zoom') return 'export const installPanelZoom=()=>{};';
        if (id === '\0resources') return 'globalThis.__resourceMounts=0; export const mountResourcePanel=()=>{globalThis.__resourceMounts++;let active=true;return {refresh:async()=>{},unmount:()=>{if(active)globalThis.__resourceMounts--;active=false;}}};';
      },
      transform(code,id) {
        const path=id.replaceAll('\\','/');
        if (mutation && path.endsWith(mutation.file)) {assert.ok(code.includes(mutation.from),`Mutation missing: ${mutation.name}`);code=code.replaceAll(mutation.from,mutation.to);mutated=true;}
        if (path.endsWith('/modules/bestiary/monster-info-page.ts')) code+='\nglobalThis.__monsterInfo={showMonster,reset(){displayRequests.invalidate();resourceMountHandle?.unmount();resourceMountHandle=null;currentSlug=null;currentItemId=null;root.innerHTML="";}};';
        return code;
      },
    }],output:{dir:out,entryFileNames:`${name}.js`,format:'esm'}});
    assert.ok(mutated);
    const page=await browser.newPage({viewport:{width:520,height:700}}), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.__routes={};window.__requests=[];
      window.fetch=async url=>{
        const key=String(url);window.__requests.push(key);
        const route=window.__routes[key]??{status:404,body:{}};
        if(route.delay)await new Promise(done=>setTimeout(done,route.delay));
        // Ignore AbortSignal deliberately to exercise stale-success guards.
        return new Response(JSON.stringify(route.body),{status:route.status??200,headers:{'Content-Type':'application/json'}});
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?bundle=${name}`);
    await page.waitForFunction(()=>window.__monsterInfo&&window.__bestiary&&window.__searchState);
    await page.waitForTimeout(60);
    let passed=0, failed;
    const test=async(title,fn)=>{try{await fn();}catch(error){error.testTitle=title;throw error;}passed++;if(!mutation)console.log(`PASS ${title}`);};
    const setup=async(options={})=>page.evaluate(options=>{
      window.__monsterInfo.reset();localStorage.clear();window.__routes=options.routes??{};window.__requests=[];
      window.__bestiaryLocal.monsters=options.locals??[];
      window.__searchState.setLanguage(options.lang??'en');window.__searchState.setLibraries(options.libraries??[]);
      window.__bestiary.clearMonsterCache();window.__bestiary.clearMonsterDetailCache();
      window.__transitionFixture.metadata={'com.bestiary/monsters':options.table??{}};
      window.__bestiarySdk.tokens=new Map((options.tokens??[]).map(token=>[token.id,token]));window.__bestiarySdk.writes=0;
    },options);
    const zh={id:'zh',name:'Chinese',baseUrl:'https://5e.kiwee.top',enabled:true};
    const en={id:'en',name:'English',baseUrl:'https://cdn.jsdelivr.net/gh/5etools-mirror-3/5etools-src@main',enabled:true};
    const goblin={name:'Goblin',source:'MM',size:['S'],type:'humanoid',cr:'1/4',ac:[15],hp:{average:7,formula:'2d6'},speed:{walk:30},str:8,dex:14,con:10,int:10,wis:8,cha:8,trait:[{name:'Nimble Escape',entries:['The goblin can disengage.']}],action:[{name:'Scimitar',entries:['English weapon action.']}],hasToken:false};
    const cn={...goblin,name:'地精',ENG_name:'Goblin',trait:[{name:'灵巧逃脱',entries:['地精能够撤离。']}],action:[{name:'弯刀',entries:['中文攻击正文。']}]};
    const routes=(extra={})=>({
      [`${zh.baseUrl}/data/bestiary/index.json`]:{body:{MM:'bestiary-mm.json'}},
      [`${en.baseUrl}/data/bestiary/index.json`]:{body:{MM:'bestiary-mm.json'}},
      [`${zh.baseUrl}/data/bestiary/bestiary-mm.json`]:{body:{monster:[cn]}},
      [`${en.baseUrl}/data/bestiary/bestiary-mm.json`]:{body:{monster:[goblin]}},...extra,
    });
    const load=()=>page.evaluate(async()=>await window.__bestiary.loadAllMonsters());
    const detail=slug=>page.evaluate(async slug=>await window.__bestiary.fetchLocalizedMonster(slug),slug);
    const token=(id,hp,owner='other')=>({id,createdUserId:owner,metadata:{'com.obr-suite/bubbles/data':{health:hp,'max health':50,'armor class':17,locked:false}}});
    try {
      await test('English catalog preference preserves translated search aliases',async()=>{
        await setup({libraries:[zh,en],routes:routes()});const data=await load();assert.equal(data.length,1);assert.equal(data[0].name,'Goblin');assert.equal(data[0].size,'Small');assert.ok(data[0].aliases.includes('地精'));
        assert.equal(await page.evaluate(()=>window.__bestiary.getRawMonster('mm::地精').name),'Goblin');
      });
      await test('local authored name and prose win across language changes',async()=>{
        await setup({libraries:[zh,en],routes:routes(),locals:[{...cn,name:'我的地精',trait:[{name:'原创',entries:['我的原文']}]}]});
        assert.equal((await load())[0].name,'我的地精');assert.equal((await detail('MM::Goblin')).trait[0].entries[0],'我的原文');
        await page.evaluate(()=>window.__searchState.setLanguage('zh'));assert.equal((await load())[0].name,'我的地精');
      });
      await test('per-library blacklists isolate aggregated rows without banning other libraries',async()=>{
        const packed={body:{monster:[goblin,{...goblin,name:'New Goblin',source:'XMM'}]}};
        await setup({libraries:[{...en,disabledSources:['mm']},zh],routes:routes({[`${en.baseUrl}/data/bestiary/index.json`]:{body:{XMM:'bestiary-mm.json'}},[`${en.baseUrl}/data/bestiary/bestiary-mm.json`]:packed})});
        const data=await load();assert.equal(data.find(m=>m.source==='MM').name,'地精');assert.equal(data.find(m=>m.source==='XMM').name,'New Goblin');
        await setup({libraries:[{...en,disabledSources:['mm']}],routes:routes({[`${en.baseUrl}/data/bestiary/index.json`]:{body:{XMM:'bestiary-mm.json'}},[`${en.baseUrl}/data/bestiary/bestiary-mm.json`]:packed})});
        assert.equal((await load()).length,1);assert.equal(await page.evaluate(()=>window.__bestiary.getRawMonster('MM::Goblin')),null);
      });
      await test('same host configurations fetch each physical catalog file only once',async()=>{
        await setup({libraries:[{...en,id:'first',disabledSources:['mm']},{...en,id:'second'}],routes:routes()});assert.equal((await load()).length,1);
        const requests=await page.evaluate(()=>window.__requests);assert.equal(requests.filter(url=>url===`${en.baseUrl}/data/bestiary/index.json`).length,1);assert.equal(requests.filter(url=>url.endsWith('/bestiary-mm.json')).length,1);
      });
      await test('fallback scans distinct configured indexes and resolves compact source ids',async()=>{
        await setup({libraries:[{...en,id:'missing',indexPath:'search/missing.json'},{...en,id:'partner',indexPath:'search/partner.json'}],routes:routes({[`${en.baseUrl}/data/bestiary/index.json`]:{status:404,body:{}},[`${en.baseUrl}/search/partner.json`]:{body:{x:[{c:1,s:4}],m:{s:{MM:4}}}}})});
        assert.equal((await load())[0].name,'Goblin');assert.ok((await page.evaluate(()=>window.__requests)).includes(`${en.baseUrl}/search/partner.json`));
      });
      await test('disabled libraries have no implicit remote fallback',async()=>{
        await setup({libraries:[{...zh,enabled:false},{...en,enabled:false}],locals:[cn]});assert.equal((await load()).length,1);assert.equal(await detail('XMM::Goblin'),null);assert.deepEqual(await page.evaluate(()=>window.__requests),[]);
      });
      await test('copy modifications resolve within their own language',async()=>{
        const english={name:'Goblin Captain',source:'MM',_copy:{name:'Goblin',source:'MM',_mod:{trait:{mode:'replaceArr',replace:'Nimble Escape',items:{name:'Captain Escape',entries:['Captain English body']}}}}};
        const chinese={name:'地精队长',ENG_name:'Goblin Captain',source:'MM',_copy:{name:'地精',source:'MM',_mod:{trait:{mode:'replaceArr',replace:'灵巧逃脱',items:{name:'队长逃脱',entries:['队长中文正文']}}}}};
        await setup({libraries:[zh,en],routes:routes({[`${en.baseUrl}/data/bestiary/bestiary-mm.json`]:{body:{monster:[goblin,english]}},[`${zh.baseUrl}/data/bestiary/bestiary-mm.json`]:{body:{monster:[cn,chinese]}}})});
        await load();assert.equal(await page.evaluate(()=>window.__bestiary.getRawMonster('MM::Goblin Captain').trait[0].name),'Captain Escape');assert.equal((await detail('MM::Goblin Captain')).trait[0].name,'Captain Escape');
        await page.evaluate(()=>window.__searchState.setLanguage('zh'));await load();assert.equal(await page.evaluate(()=>window.__bestiary.getRawMonster('MM::Goblin Captain').trait[0].name),'队长逃脱');
      });
      await test('incomplete preferred copy falls back to complete original without leaking raw copies',async()=>{
        await setup({libraries:[zh,en],routes:routes({[`${en.baseUrl}/data/bestiary/bestiary-mm.json`]:{body:{monster:[{name:'Goblin',source:'MM',_copy:{name:'Missing',source:'MM'}}]}}})});
        assert.equal((await load())[0].name,'地精');assert.equal((await detail('MM::Goblin')).name,'地精');
      });
      await test('same-language split libraries retain cross-library parent dependencies',async()=>{
        const extra={...en,id:'extra',baseUrl:'https://english-homebrew.test',language:'en'};
        const child={name:'Captain',source:'HOME',_copy:{name:'Goblin',source:'MM'}};
        await setup({libraries:[extra,en],routes:routes({[`${extra.baseUrl}/data/bestiary/index.json`]:{body:{HOME:'bestiary-home.json'}},[`${extra.baseUrl}/data/bestiary/bestiary-home.json`]:{body:{monster:[child]}}})});
        const selected=(await load()).find(monster=>monster.name==='Captain');assert.ok(selected,'Cross-library child remains available');assert.equal(selected.hp,7);assert.equal((await detail('HOME::Captain')).hp.average,7);
      });
      await test('blocked copy parent cannot be recovered through another source in the same library',async()=>{
        const child={name:'New Goblin',source:'XMM',_copy:{name:'Goblin',source:'MM'}};
        await setup({libraries:[{...en,disabledSources:['mm']}],routes:routes({[`${en.baseUrl}/data/bestiary/index.json`]:{body:{XMM:'bestiary-xmm.json',MM:'bestiary-mm.json'}},[`${en.baseUrl}/data/bestiary/bestiary-xmm.json`]:{body:{monster:[child]}}})});
        assert.equal((await load()).length,0);assert.equal(await detail('XMM::New Goblin'),null);assert.ok(!(await page.evaluate(()=>window.__requests)).some(url=>url.endsWith('/bestiary-mm.json')));
      });
      await test('remote named edits skip an incompatible auto-language parent in catalog and detail',async()=>{
        const extra={...en,id:'extra',baseUrl:'https://english-homebrew.test',language:'en'};
        const child={name:'Captain',source:'HOME',_copy:{name:'Goblin',source:'MM',_mod:{trait:{mode:'replaceArr',replace:'Nimble Escape',items:{name:'Captain Escape',entries:['Correct inherited edit']}}}}};
        const ownRoutes={[`${extra.baseUrl}/data/bestiary/index.json`]:{body:{HOME:'bestiary-home.json'}},[`${extra.baseUrl}/data/bestiary/bestiary-home.json`]:{body:{monster:[child]}}};
        await setup({libraries:[extra,{...zh,language:'auto'},{...en,language:'auto'}],routes:routes(ownRoutes)});
        await load();assert.equal(await page.evaluate(()=>window.__bestiary.getRawMonster('HOME::Captain').trait[0].name),'Captain Escape');
        assert.equal((await detail('HOME::Captain')).trait[0].name,'Captain Escape');
      });
      await test('remote named edits without a compatible parent never publish unchanged inherited stats',async()=>{
        const extra={...en,id:'extra',baseUrl:'https://english-homebrew.test',language:'en'};
        const child={name:'Captain',source:'HOME',_copy:{name:'Goblin',source:'MM',_mod:{trait:{mode:'replaceArr',replace:'Nimble Escape',items:{name:'Captain Escape'}}}}};
        await setup({libraries:[extra,{...zh,language:'auto'}],routes:routes({[`${extra.baseUrl}/data/bestiary/index.json`]:{body:{HOME:'bestiary-home.json'}},[`${extra.baseUrl}/data/bestiary/bestiary-home.json`]:{body:{monster:[child]}}})});
        assert.ok(!(await load()).some(monster=>monster.name==='Captain'));assert.equal(await detail('HOME::Captain'),null);
      });
      await test('detail source identity never crosses MM and XMM',async()=>{
        await setup({libraries:[en],routes:routes({[`${en.baseUrl}/data/bestiary/bestiary-mm.json`]:{body:{monster:[{...goblin,source:'XMM'}]}}})});assert.equal(await detail('MM::Goblin'),null);
      });
      await test('one direct detail does not fetch unrelated libraries',async()=>{
        await setup({libraries:[zh,en],routes:routes()});assert.equal((await detail('mm::goblin')).name,'Goblin');assert.deepEqual(await page.evaluate(()=>window.__requests),[`${en.baseUrl}/data/bestiary/index.json`,`${en.baseUrl}/data/bestiary/bestiary-mm.json`]);
      });
      await test('old unchanged saved original translates only for display',async()=>{
        await setup({libraries:[zh,en],routes:routes()});const result=await page.evaluate(async shared=>({data:await window.__bestiary.fetchLocalizedMonster('MM::Goblin',shared),shared,writes:window.__bestiarySdk.writes}),cn);assert.equal(result.data.name,'Goblin');assert.deepEqual(result.shared,cn);assert.equal(result.writes,0);
      });
      await test('old translated-name binding uses its saved English alias',async()=>{
        await setup({libraries:[zh,en],routes:routes()});const result=await page.evaluate(async shared=>window.__bestiary.fetchLocalizedMonster('MM::地精',shared),cn);assert.equal(result.name,'Goblin');
      });
      await test('new pristine snapshot translates but edited snapshot is preserved without fetch',async()=>{
        await setup({libraries:[zh],routes:routes()});await load();const saved=await page.evaluate(()=>window.__bestiary.getRawMonster('MM::Goblin'));
        await setup({libraries:[zh,en],routes:routes()});assert.equal(await page.evaluate(async saved=>(await window.__bestiary.fetchLocalizedMonster('MM::Goblin',saved)).name,saved),'Goblin');
        await setup({libraries:[zh,en],routes:routes()});const edited={...saved,name:'My named enemy',hp:{average:99}};assert.equal(await page.evaluate(async saved=>(await window.__bestiary.fetchLocalizedMonster('MM::Goblin',saved)).name,edited),'My named enemy');assert.deepEqual(await page.evaluate(()=>window.__requests),[]);
      });
      await test('unknown old authored snapshot is retained with saved-content explanation',async()=>{
        await setup({libraries:[zh,en],routes:routes()});const result=await page.evaluate(async saved=>window.__bestiary.fetchLocalizedMonster('MM::Goblin',saved),{...cn,hp:{average:91}});assert.equal(result.hp.average,91);assert.equal(result._suiteDisplayNote,'saved');
      });
      await test('failed preferred detail retries and does not poison successful fallback',async()=>{
        await setup({libraries:[zh,en],routes:routes({[`${en.baseUrl}/data/bestiary/bestiary-mm.json`]:{status:403,body:{}}})});assert.equal((await detail('MM::Goblin')).name,'地精');
        await page.evaluate(({url,goblin})=>window.__routes[url]={body:{monster:[goblin]}},{url:`${en.baseUrl}/data/bestiary/bestiary-mm.json`,goblin});assert.equal((await detail('MM::Goblin')).name,'Goblin');
      });
      await test('local inherited content uses same complete copy logic in catalog and detail',async()=>{
        const local={name:'My Captain',source:'HOME',_copy:{name:'Goblin',source:'MM',_mod:{trait:{mode:'appendArr',items:{name:'Authored',entries:['Custom trait']}}}}};
        await setup({libraries:[en],routes:routes(),locals:[local]});await load();const raw=await page.evaluate(()=>window.__bestiary.getRawMonster('HOME::My Captain'));const d=await detail('HOME::My Captain');assert.deepEqual(raw.trait,d.trait);assert.equal(d._suiteContent.authored,true);assert.equal(d.hp.average,7);
      });
      await test('authored child of translated parent keeps its own identity',async()=>{
        const local={name:'自定义地精队长',source:'HOME',_copy:{name:'Goblin',source:'MM'}};
        await setup({lang:'zh',libraries:[zh],routes:routes(),locals:[local]});const list=await load();const child=list.find(m=>m.source==='HOME');assert.equal(child.engName,local.name);const d=await detail(`HOME::${local.name}`);assert.equal(d.ENG_name,undefined);assert.equal(d.name,local.name);
      });
      await test('local named copy edits use a matching translated parent in English mode',async()=>{
        const local={name:'自定义地精队长',source:'HOME',_copy:{name:'Goblin',source:'MM',_mod:{trait:{mode:'replaceArr',replace:'灵巧逃脱',items:{name:'我的能力',entries:['自制原文']}}}}};
        await setup({libraries:[zh,en],routes:routes(),locals:[local]});await load();const raw=await page.evaluate(()=>window.__bestiary.getRawMonster('HOME::自定义地精队长'));const d=await detail(`HOME::${local.name}`);assert.equal(raw.trait[0].name,'我的能力');assert.deepEqual(raw.trait,d.trait);assert.equal(d.name,local.name);
      });
      await test('late catalog success cannot replace the new language cache',async()=>{
        await setup({libraries:[zh,en],lang:'zh',routes:routes({[`${zh.baseUrl}/data/bestiary/bestiary-mm.json`]:{delay:200,body:{monster:[cn]}}})});
        const result=await page.evaluate(async()=>{const old=window.__bestiary.loadAllMonsters().catch(()=>null);await new Promise(done=>setTimeout(done,30));window.__searchState.setLanguage('en');const fresh=await window.__bestiary.loadAllMonsters();await old;return {fresh,raw:window.__bestiary.getRawMonster('MM::Goblin')};});assert.equal(result.fresh[0].name,'Goblin');assert.equal(result.raw.name,'Goblin');
      });
      await test('actual English detail shows English body, live HP and original-data note on fallback',async()=>{
        await setup({libraries:[zh,en],routes:routes(),tokens:[token('one',33)]});await page.evaluate(()=>window.__monsterInfo.showMonster('MM::Goblin','one'));
        assert.match(await page.locator('.root').innerText(),/Nimble Escape/);assert.match(await page.locator('.root').innerText(),/English weapon action/);assert.doesNotMatch(await page.locator('.root').innerText(),/灵巧逃脱/);assert.equal(await page.locator('input[data-field="health"]').inputValue(),'33');assert.equal(await page.evaluate(()=>window.__bestiarySdk.writes),0);
        await page.screenshot({path:join(shots,'english-monster.png')});
        await setup({libraries:[zh],routes:routes()});await page.evaluate(()=>window.__monsterInfo.showMonster('MM::Goblin'));assert.match(await page.locator('.content-language').innerText(),/Chinese/);assert.match(await page.locator('.root').innerText(),/中文攻击正文/);
      });
      await test('same monster rapid token selection keeps latest HP and ownership',async()=>{
        await setup({libraries:[en],routes:routes({[`${en.baseUrl}/data/bestiary/bestiary-mm.json`]:{delay:150,body:{monster:[goblin]}}}),tokens:[{...token('one',11),testReadDelay:220},token('two',42,'local-player')]});
        await page.evaluate(async()=>{const first=window.__monsterInfo.showMonster('MM::Goblin','one');await new Promise(done=>setTimeout(done,30));const second=window.__monsterInfo.showMonster('MM::Goblin','two');await Promise.all([first,second]);});assert.equal(await page.locator('input[data-field="health"]').inputValue(),'42');
      });
      await test('actual role gating keeps non-owner read-only and owner editable',async()=>{
        await setup({libraries:[en],routes:routes(),tokens:[token('one',11),token('two',42,'local-player')]});await page.evaluate(async()=>{await window.__transitionFixture.changeRole('PLAYER');await window.__monsterInfo.showMonster('MM::Goblin','one');});assert.equal(await page.locator('input[data-field="health"]').getAttribute('readonly'),'');
        await page.evaluate(()=>window.__monsterInfo.showMonster('MM::Goblin','two'));assert.equal(await page.locator('input[data-field="health"]').getAttribute('readonly'),null);await page.evaluate(()=>window.__transitionFixture.changeRole('GM'));
      });
      await test('language change invalidates old visible request and renders Chinese',async()=>{
        await setup({libraries:[zh,en],routes:routes({[`${en.baseUrl}/data/bestiary/bestiary-mm.json`]:{delay:180,body:{monster:[goblin]}}})});
        await page.evaluate(async()=>{const old=window.__monsterInfo.showMonster('MM::Goblin');await new Promise(done=>setTimeout(done,30));window.__searchState.setLanguage('zh');await old;await new Promise(done=>setTimeout(done,70));});assert.match(await page.locator('.root').innerText(),/灵巧逃脱/);assert.doesNotMatch(await page.locator('.root').innerText(),/English weapon action/);await page.screenshot({path:join(shots,'chinese-monster.png')});
      });
      await test('scene close clears mounted resources and prevents late repaint',async()=>{
        await setup({libraries:[en],routes:routes()});await page.evaluate(()=>window.__monsterInfo.showMonster('MM::Goblin'));assert.equal(await page.evaluate(()=>window.__resourceMounts),1);
        await page.evaluate(()=>window.__transitionFixture.scene(false));assert.equal(await page.evaluate(()=>window.__resourceMounts),0);assert.equal(await page.locator('.root').innerText(),'');
        await setup({libraries:[en],routes:routes({[`${en.baseUrl}/data/bestiary/bestiary-mm.json`]:{delay:150,body:{monster:[goblin]}}})});await page.evaluate(async()=>{const old=window.__monsterInfo.showMonster('MM::Goblin');await new Promise(done=>setTimeout(done,30));await window.__transitionFixture.scene(false);await old;});assert.equal(await page.locator('.root').innerText(),'');
      });
      assert.deepEqual(errors,[]);
    } catch(error) { failed=error; }
    await page.close();
    if(!mutation) {if(failed)throw failed;console.log(`Bestiary locale: ${passed}/${passed} passed`);}
    else {if(!failed)throw Error(`SURVIVED mutation: ${mutation.name}`);if(failed.code!=='ERR_ASSERTION')throw failed;console.log(`KILLED ${mutation.name} by ${failed.testTitle}: ${failed.message.split('\n')[0]}`);}
  }
} finally {
  await browser?.close();await new Promise(done=>server?server.close(done):done());
  if(dirname(out)!==outputRoot)throw Error('Unsafe temporary output path');rmSync(out,{recursive:true,force:true});
}
