import {build} from 'rolldown';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {workbenchAnnouncement} from './workbench-announcement.mjs';
const web=process.env.DND_CARD_WEB_ROOT||'D:/Desktop/DND-card-web',out=resolve('workbench-test-output');mkdirSync(out,{recursive:true});
const {chromium}=createRequire(join(web,'package.json'))('@playwright/test');
const define={'import.meta.env.BASE_URL':JSON.stringify('/suite-dev/'),'import.meta.env.DEV':'false'};
const environment={name:'environment',transform(code){return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');}};
const plugins=[environment,{name:'sdk-boundary',resolveId(id){if(id.endsWith('dice-history.html?raw'))return '\0dice-history-markup';if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/workbench-sdk.ts');if(id==='./state'||id==='../state'||id==='../../state'||id==='../modules/bestiary/data')return resolve('tools/fixtures/workbench-modules.ts');},load(id){if(id==='\0dice-history-markup')return 'export default '+JSON.stringify(readFileSync('dice-history.html','utf8'));}}];
await build({input:resolve('tools/workbench-selftest.entry.ts'),plugins,output:{dir:out,entryFileNames:'background.js',format:'esm'}});
await build({input:resolve('src/workbench/launcher.ts'),plugins,output:{file:join(out,'launcher.js'),format:'esm',codeSplitting:false}});
await build({input:resolve('src/modules/dice/effect-page.ts'),plugins,output:{file:join(out,'effect.js'),format:'esm',codeSplitting:false}});
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'};
const shared=new Map();
const server=createServer(async(req,res)=>{const p=new URL(req.url,'http://local').pathname;
 if(p==='/suite-dev/relay'){
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET'){setTimeout(()=>{if(!res.destroyed)res.end('[]');},20000);return;}
  const parts=[];for await(const part of req)parts.push(part);let bytes=Buffer.concat(parts);if(req.headers['content-encoding']==='gzip')bytes=gunzipSync(bytes);const body=JSON.parse(bytes);
  if(body.saveCard){const request=body.saveCard,doc=documents[request.card];if(!doc||createHash('sha256').update(JSON.stringify(doc)).digest('hex')!==request.expected){res.writeHead(409);res.end('{"error":"conflict"}');return;}for(const change of request.changes){let target=doc;for(const part of change.path.slice(0,-1))target=target[part]??={};if(change.remove)delete target[change.path.at(-1)];else target[change.path.at(-1)]=change.after;}saves++;}
  if(body.sharedDocument){const request=body.sharedDocument,old=shared.get(request.key)||{revision:0,data:null};if(request.operation==='write'){if(request.expected!==old.revision){res.writeHead(409);res.end('{"error":"conflict"}');return;}shared.set(request.key,{revision:old.revision+1,data:request.data});}res.end(JSON.stringify(shared.get(request.key)||old));return;}
  res.end('{}');return;
 }
 if(p==='/'){res.setHeader('Content-Type','text/html');res.end('<iframe id="bg" src="http://127.0.0.1:5197/background.html"></iframe><iframe id="launcher" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" src="http://127.0.0.1:5197/launcher.html" style="width:420px;height:540px"></iframe>');return;}
 if(p==='/suite-dev/dice-effect.html'){res.setHeader('Content-Type','text/html');res.end(readFileSync('dice-effect.html','utf8').replace('/src/modules/dice/effect-page.ts','/effect.js'));return;}
 if(/^\/suite-dev\/d(?:4|6|8|10|12|20|100)\.png$/.test(p)){try{res.setHeader('Content-Type','image/png');res.end(readFileSync(join('public',p.slice('/suite-dev/'.length))));}catch{res.writeHead(404);res.end();}return;}
 if(p==='/background.html'){res.setHeader('Content-Type','text/html');res.end('<script type="module" src="/background.js"></script>');return;}
 if(p==='/launcher.html'){res.setHeader('Content-Type','text/html');res.end(readFileSync('workbench-launcher.html','utf8').replace('/src/workbench/launcher.ts','/launcher.js'));return;}
 const file=p.startsWith('/suite-dev/workbench/')?join(process.env.DND_WEB_DIST||join(web,'dist'),p.slice('/suite-dev/workbench/'.length)):join(out,p.slice(1));
 try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});await new Promise(r=>server.listen(5197,'127.0.0.1',r));
const browser=await chromium.launch({channel:process.env.CI?undefined:'msedge',headless:!process.env.CI}),context=await browser.newContext({viewport:{width:1500,height:1000}}),errors=[];
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
// A Suite-only engine patch need not republish the paired Web announcement.
// Seed this fixture with the announcement it actually serves, then keep all
// pointer/character assertions active. Announcement behavior has its own tests.
const noticeVersion=(await workbenchAnnouncement(web)).match(/^- (\d+\.\d+\.\d+-dev) ·/m)?.[1];
assert(noticeVersion,'Actual paired announcement version');
await context.addInitScript(version=>{try{localStorage.setItem('dnd-card:announcement-ack:suite',version);localStorage.setItem('dnd-card:rules-setup:v1','done');}catch{}},noticeVersion);
const card=name=>({schema_version:'0.3',identity:{character_name:name},meta:{ruleset:'2024'},abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(a=>[a,{total:12}])),classes:[{name:'法师',level:2}],core_stats:{hp:{current:20,max:30,temp:2},ac:15},features:{},background:{},inventory:{},defenses:{custom:'preserved'},combat:{weapons:[{name:'保留的武器'}]}});
let documents={hero:card('阿明'),second:card('贝拉')},saves=0;
await context.route('https://5e.kiwee.top/**',r=>r.fulfill({json:{},headers:{'access-control-allow-origin':'*'}}));
await context.route('https://obr.dnd.center/**',async r=>{const id=r.request().url().includes('/second/')?'second':'hero';if(r.request().method()==='PUT'){documents[id]=r.request().postDataJSON();saves++;await r.fulfill({json:{name:id}});}else await r.fulfill({json:documents[id]});});
await context.route('http://127.0.0.1:5197/characters/**',r=>r.fulfill({json:documents[r.request().url().includes('/second/')?'second':'hero']}));
let checks=0;const check=(value,name)=>{assert(value,name);console.log('PASS '+name);checks++;};
try{
 const room=await context.newPage();await room.goto('http://127.0.0.1:5197/');const launcher=room.frameLocator('#launcher');await launcher.locator('#open[href]').waitFor();
 await room.waitForFunction(()=>true);await launcher.locator('#open').evaluate(async el=>{while(!el.hasAttribute('href'))await new Promise(r=>setTimeout(r,50));});
 await launcher.locator('.tips').waitFor();
 check(await launcher.getByRole('tab',{name:'角色卡 · 规则资料',exact:true}).count()===1&&await launcher.getByRole('tab',{name:'历史',exact:true}).count()===1,'action contains the current home and history tabs');
 check(await launcher.getByRole('button',{name:'公告',exact:true}).count()===0&&await launcher.getByRole('button',{name:'设置',exact:true}).count()===0,'action does not expose retired host popup controls');
 check(await launcher.locator('body').evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth),'action tips and tools fit without overflow');
 await room.locator('#launcher').screenshot({path:join(out,'launcher-tips.png')});
 check(await launcher.locator('#open').evaluate(el=>el.tagName==='A'&&el.rel==='opener'&&new URL(el.href).hash.includes('suite=')), 'native link exposes an actual room-specific URL');
 // Headless Chromium on Linux suppresses native middle-click tab creation.
 // The native anchor remains checked above; use the normal click to verify the bridge.
 const opening=room.waitForEvent('popup');await launcher.locator('#open').click();const page=await opening;
 const hostCDP=await context.newCDPSession(room),tabCDP=await context.newCDPSession(page);const hostWindow=await hostCDP.send('Browser.getWindowForTarget'),tabWindow=await tabCDP.send('Browser.getWindowForTarget');check(hostWindow.windowId===tabWindow.windowId,'opens a normal tab in the same browser window');await hostCDP.detach();await tabCDP.detach();
 const bg=room.frames().find(f=>f.url().endsWith('/background.html'));
 await page.getByRole('navigation',{name:'枭熊工作台'}).waitFor();
 const playerTabs=page.getByRole('tablist',{name:'房间角色卡'});
 await playerTabs.getByRole('tab',{name:'阿明',exact:true}).click();
 await page.getByLabel('当前生命值',{exact:true}).waitFor();
 await bg.waitForFunction(()=>window.wbMock.actionCloses>0);check(true,'room action closes after the workbench handshake');
 await page.getByRole('button',{name:'定位到角色',exact:true}).first().click();await bg.waitForFunction(()=>window.wbMock.viewport?.scale===1);check(true,'card locates a readable scene binding without modifying the token');
 await page.getByLabel('当前生命值',{exact:true}).fill('16');await page.getByLabel('当前生命值',{exact:true}).press('Enter');await bg.waitForFunction(()=>window.wbMock.items.find(x=>x.id==='one').metadata['com.obr-suite/bubbles/data'].health===16);check(true,'character HP input writes final value');
 await bg.evaluate(()=>{window.wbMock.items[0].metadata['com.obr-suite/bubbles/data'].health=12;window.wbMock.emit('items',window.wbMock.items);});await page.waitForFunction(()=>document.querySelector('[aria-label="当前生命值"]').value==='12');check(true,'scene HP reflects on the complete card');
 check(await page.locator('.paper').count()===1&&await page.getByRole('region',{name:'规则资料',exact:true}).count()===1,'complete A4 card and wiki loaded');
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('当前生命值',{exact:true}).waitFor();check(true,'repeating settings returns to the character view');
 await bg.evaluate(()=>window.wbMock.select(['goblin']));await page.getByRole('heading',{name:'测试怪物',exact:true}).waitFor();check(await page.getByLabel('怪物生命',{exact:true}).inputValue()==='8','selection opens monster with token-specific HP');
 await page.getByLabel('怪物生命',{exact:true}).fill('6');await page.getByRole('heading',{name:'测试怪物',exact:true}).click();await bg.waitForFunction(()=>window.wbMock.items.find(x=>x.id==='goblin').metadata['com.obr-suite/bubbles/data'].health===6);check(true,'monster writes back to scene');
 check(await playerTabs.getByRole('tab',{name:/怪物/}).count()===0&&await page.getByRole('tablist',{name:'场景怪物'}).count()===1,'monster tabs are separate from player names');
 await page.getByRole('switch',{name:'怪物编辑模式'}).click();await page.getByRole('button',{name:'JSON 模式',exact:true}).click();const monsterJson=page.getByLabel('怪物完整 JSON');const draft=JSON.parse(await monsterJson.inputValue());draft.unknown260={preserved:true};draft.hp.formula='2d8+1';await monsterJson.fill(JSON.stringify(draft));await page.getByRole('button',{name:'完整展示',exact:true}).click();await page.locator('.monster-editor-document').getByRole('button',{name:'修改怪物 HP',exact:true}).click();await page.getByLabel('怪物平均 HP',{exact:true}).fill('13');await page.getByRole('button',{name:'完成修改',exact:true}).click();await page.getByRole('button',{name:'保存资料',exact:true}).click();await bg.waitForFunction(()=>window.wbMock.items.find(x=>x.id==='goblin').metadata['com.obr-suite/workbench/monster']?.revision>0);const monsterKey=await bg.evaluate(()=>window.wbMock.items.find(x=>x.id==='goblin').metadata['com.obr-suite/workbench/monster'].key);const savedMonster=shared.get(monsterKey).data;check(savedMonster.unknown260.preserved&&savedMonster.hp.formula==='2d8+1','monster document edits preserve JSON extensions and untouched fields');await page.screenshot({path:join(out,'monster-document-edit260.png')});if(await page.getByRole('switch',{name:'怪物编辑模式'}).getAttribute('aria-checked')==='true')await page.getByRole('switch',{name:'怪物编辑模式'}).click();
 await page.getByLabel('跟随选择').uncheck();await bg.evaluate(()=>window.wbMock.select(['two']));await page.waitForTimeout(100);check(await page.locator('.workbench-monster').isVisible(),'pin prevents selection switch');
 await page.getByLabel('跟随选择').check();await playerTabs.getByRole('tab',{name:'贝拉',exact:true}).click();await page.getByLabel('当前生命值',{exact:true}).waitFor();check(true,'unpin resumes character selection');
 await page.getByLabel('当前生命值',{exact:true}).fill('15');await page.getByLabel('当前生命值',{exact:true}).blur();await bg.waitForFunction(()=>window.wbMock.items.find(x=>x.id==='two').metadata['com.obr-suite/bubbles/data'].health===15);check(documents.second.combat.weapons[0].name==='保留的武器','native combat data remains intact while stats synchronize');
 // Reload and transport recovery use the official SDK cold-start fixture in CI.
 await page.setViewportSize({width:640,height:850});await page.screenshot({path:join(out,'tablet-card.png')});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'tablet character view fits half width');
 await page.setViewportSize({width:1500,height:1000});await playerTabs.getByRole('tab',{name:'阿明',exact:true}).click();await page.getByLabel('当前生命值',{exact:true}).waitFor();await page.screenshot({path:join(out,'character-wiki.png')});
 await bg.evaluate(()=>{const mock=window.wbMock;mock.role='PLAYER';mock.metadata['com.character-cards/list'][0].visibility='dm';mock.metadata['com.character-cards/list'][0].locked=true;mock.metadata['com.character-cards/list'][0].owner_ids=[];mock.items[0].createdUserId='other';mock.emit('player',{role:'PLAYER'});mock.emit('items',mock.items);mock.emit('metadata',mock.metadata);});await page.waitForFunction(()=>![...document.querySelectorAll('[aria-label="房间角色卡"] button')].some(el=>el.textContent.includes('阿明')));check(await playerTabs.getByRole('tab',{name:'阿明',exact:true}).count()===0,'revoked card disappears from the readable character directory');
 check(errors.length===0,'no browser runtime errors: '+errors.join(';'));
 console.log(JSON.stringify({checks,realRoom:false,output:out}));
}catch(error){console.error('Browser errors:',JSON.stringify(errors));for(const [i,p] of context.pages().entries())await p.screenshot({path:join(out,'failure-'+i+'.png')}).catch(()=>{});throw error;}finally{await browser.close();server.close();}
