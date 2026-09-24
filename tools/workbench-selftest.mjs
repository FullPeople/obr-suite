import {build} from 'rolldown';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const web=process.env.DND_CARD_WEB_ROOT||'D:/Desktop/DND-card-web',out=resolve('workbench-test-output');mkdirSync(out,{recursive:true});
const {chromium}=createRequire(join(web,'package.json'))('@playwright/test');
const define={'import.meta.env.BASE_URL':JSON.stringify('/suite-dev/'),'import.meta.env.DEV':'false'};
const environment={name:'environment',transform(code){return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');}};
const plugins=[environment,{name:'sdk-boundary',resolveId(id){if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/workbench-sdk.ts');if(id==='./state'||id==='../state'||id==='../../state'||id==='../modules/bestiary/data')return resolve('tools/fixtures/workbench-modules.ts');}}];
await build({input:resolve('tools/workbench-selftest.entry.ts'),plugins,output:{dir:out,entryFileNames:'background.js',format:'esm'}});
await build({input:resolve('src/workbench/launcher.ts'),plugins,output:{file:join(out,'launcher.js'),format:'esm'}});
await build({input:resolve('src/modules/dice/effect-page.ts'),plugins,output:{file:join(out,'effect.js'),format:'esm'}});
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{const p=new URL(req.url,'http://local').pathname;
 if(p==='/'){res.setHeader('Content-Type','text/html');res.end('<iframe id="bg" src="http://127.0.0.1:5197/background.html"></iframe><iframe id="launcher" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" src="http://127.0.0.1:5197/launcher.html" style="width:420px;height:540px"></iframe>');return;}
 if(p==='/suite-dev/dice-effect.html'){res.setHeader('Content-Type','text/html');res.end(readFileSync('dice-effect.html','utf8').replace('/src/modules/dice/effect-page.ts','/effect.js'));return;}
 if(/^\/suite-dev\/d(?:4|6|8|10|12|20|100)\.png$/.test(p)){try{res.setHeader('Content-Type','image/png');res.end(readFileSync(join('public',p.slice('/suite-dev/'.length))));}catch{res.writeHead(404);res.end();}return;}
 if(p==='/background.html'){res.setHeader('Content-Type','text/html');res.end('<script type="module" src="/background.js"></script>');return;}
 if(p==='/launcher.html'){res.setHeader('Content-Type','text/html');res.end(readFileSync('workbench-launcher.html','utf8').replace('/src/workbench/launcher.ts','/launcher.js'));return;}
 const file=p.startsWith('/suite-dev/workbench/')?join(process.env.DND_WEB_DIST||join(web,'dist'),p.slice('/suite-dev/workbench/'.length)):join(out,p.slice(1));
 try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});await new Promise(r=>server.listen(5197,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1500,height:1000}}),errors=[];
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
const card=name=>({schema_version:'0.3',identity:{character_name:name},meta:{ruleset:'2024'},abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(a=>[a,{total:12}])),classes:[{name:'法师',level:2}],core_stats:{hp:{current:20,max:30,temp:2},ac:15},features:{},background:{},inventory:{},defenses:{custom:'preserved'},combat:{weapons:[{name:'保留的武器'}]}});
let documents={hero:card('阿明'),second:card('贝拉')},saves=0;
await context.route('https://5e.kiwee.top/**',r=>r.fulfill({json:{},headers:{'access-control-allow-origin':'*'}}));
await context.route('https://obr.dnd.center/**',async r=>{const id=r.request().url().includes('/second/')?'second':'hero';if(r.request().method()==='PUT'){documents[id]=r.request().postDataJSON();saves++;await r.fulfill({json:{name:id}});}else await r.fulfill({json:documents[id]});});
let checks=0;const check=(value,name)=>{assert(value,name);console.log('PASS '+name);checks++;};
try{
 const room=await context.newPage();await room.goto('http://localhost:5197/');const launcher=room.frameLocator('#launcher');await launcher.locator('#open[href]').waitFor();
 await room.waitForFunction(()=>true);await launcher.locator('#open').evaluate(async el=>{while(!el.hasAttribute('href'))await new Promise(r=>setTimeout(r,50));});
 await launcher.locator('.tips').waitFor();await launcher.getByRole('button',{name:'时停',exact:true}).waitFor();
 check(await launcher.locator('#row button').count()===6,'action panel contains six tools and no retired popup switches');
 for(const [label,event] of [['时停','com.obr-suite/timestop-toggle'],['同步视口','com.obr-suite/focus-trigger'],['音乐','com.obr-suite/music-board:toggle'],['转场','com.obr-suite/transitions/open']]){
  await launcher.getByRole('button',{name:label,exact:true}).click();
  check(await launcher.locator('body').evaluate((el,event)=>window.wbMock.broadcasts.some(b=>b.name===event),event),'action routes '+label+' to the original module');
 }
 await launcher.getByRole('button',{name:'公告',exact:true}).click();check(await launcher.locator('body').evaluate(()=>window.wbMock.effects.some(e=>e.id==='com.obr-suite/dm-announcement')),'action opens announcement');
 await launcher.getByRole('button',{name:'设置',exact:true}).click();check(await launcher.locator('body').evaluate(()=>window.wbMock.popovers.some(e=>e.id==='com.obr-suite/settings')),'action opens settings');
 await launcher.locator('body').evaluate(()=>window.wbMock.emit('player',{id:'me',role:'PLAYER'}));
 check(await launcher.locator('#row button').count()===3&&await launcher.getByRole('button',{name:'时停',exact:true}).count()===0,'action hides GM-only controls from players');
 await launcher.locator('body').evaluate(()=>window.wbMock.emit('player',{id:'me',role:'GM'}));
 check(await launcher.locator('body').evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth),'action tips and tools fit without overflow');
 await room.locator('#launcher').screenshot({path:join(out,'launcher-tips.png')});
 check(await launcher.locator('#open').evaluate(el=>el.tagName==='A'&&el.rel==='opener'&&new URL(el.href).hash.includes('suite=')), 'native link exposes an actual room-specific URL');
 const middleOpening=context.waitForEvent('page');await launcher.locator('#open').click({button:'middle'});const middle=await middleOpening;await middle.waitForLoadState('domcontentloaded');check(await middle.evaluate(()=>window.opener===null),'documents browser limitation: middle click has no local bridge opener');await middle.close();
 const opening=room.waitForEvent('popup');await launcher.locator('#open').click();const page=await opening;
 const hostCDP=await context.newCDPSession(room),tabCDP=await context.newCDPSession(page);const hostWindow=await hostCDP.send('Browser.getWindowForTarget'),tabWindow=await tabCDP.send('Browser.getWindowForTarget');check(hostWindow.windowId===tabWindow.windowId,'opens a normal tab in the same browser window');await hostCDP.detach();await tabCDP.detach();
 const bg=room.frames().find(f=>f.url().endsWith('/background.html'));
 await page.getByRole('navigation',{name:'枭熊工作台'}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="当前角色"]')?.selectedOptions[0]?.text==='阿明');
 await bg.waitForFunction(()=>window.wbMock.actionCloses>0);check(true,'room action closes after the workbench handshake');
 await page.getByLabel('当前生命值',{exact:true}).fill('16');await bg.waitForFunction(()=>window.wbMock.items.find(x=>x.id==='one').metadata['com.obr-suite/bubbles/data'].health===16);check(true,'character HP input writes final value');
 await bg.evaluate(()=>{window.wbMock.items[0].metadata['com.obr-suite/bubbles/data'].health=12;window.wbMock.emit('items',window.wbMock.items);});await page.waitForFunction(()=>document.querySelector('[aria-label="当前生命值"]').value==='12');check(true,'scene HP reflects on the complete card');
 check(await page.locator('.paper').count()===1&&await page.getByRole('region',{name:'规则资料',exact:true}).count()===1,'complete A4 card and wiki loaded');
 await bg.evaluate(()=>window.wbMock.select(['goblin']));await page.getByRole('heading',{name:'测试怪物甲',exact:true}).waitFor();check(await page.getByLabel('怪物生命',{exact:true}).inputValue()==='8','selection opens monster with token-specific HP');
 await page.getByLabel('怪物生命',{exact:true}).fill('6');await page.getByRole('heading',{name:'测试怪物甲',exact:true}).click();await bg.waitForFunction(()=>window.wbMock.items.find(x=>x.id==='goblin').metadata['com.obr-suite/bubbles/data'].health===6);check(true,'monster writes back to scene');
 await page.getByLabel('跟随选择').uncheck();await bg.evaluate(()=>window.wbMock.select(['two']));await page.waitForTimeout(100);check(await page.getByRole('heading',{name:'测试怪物甲',exact:true}).count()===1,'pin prevents selection switch');
 await page.getByLabel('跟随选择').check();await page.waitForFunction(()=>document.querySelector('[aria-label="当前角色"]')?.selectedOptions[0]?.text==='贝拉');check(true,'unpin resumes character selection');
 await page.getByRole('button',{name:'投骰',exact:true}).click();await page.getByLabel('骰式',{exact:true}).fill('2d6+3');await page.getByRole('button',{name:'投掷',exact:true}).click();await page.locator('.dice-result').first().waitFor();const total=Number((await page.locator('.dice-total').first().innerText()).replace('=',''));check(total>=5&&total<=15,'real dice engine returns shared result');
 await bg.waitForFunction(()=>window.wbMock.effects.length===1);
 const effect=await bg.evaluate(()=>window.wbMock.effects[0]),effectUrl=new URL(effect.url);
 check(effect.id.startsWith('com.obr-suite/dice-effect-')&&effect.disablePointerEvents&&effect.fullScreen&&effectUrl.searchParams.get('itemId')==='two'&&Number(effectUrl.searchParams.get('total'))===total,'roll opens click-through scene animation anchored to selected token with the same total');
 check((await bg.evaluate(()=>window.wbMock.windows)).every(id=>id.startsWith('com.obr-suite/dice-effect-')),'dev dice opens no legacy composer or history popover');
 const visual=await context.newPage();await visual.goto(effect.url);await visual.locator('.dice').first().waitFor();
 await visual.waitForFunction(()=>document.querySelector('.dice').style.transform.length>0);
 const transform=await visual.locator('.dice').first().evaluate(el=>el.style.transform);await visual.waitForTimeout(120);
 check(await visual.locator('.dice').first().evaluate((el,old)=>el.style.transform!==old,transform),'real scene dice renderer animates');

 await visual.waitForFunction(values=>!document.querySelector('.num.rolling')&&[...document.querySelectorAll('.dice .num')].map(el=>el.textContent).join(',')===values,effectUrl.searchParams.get('dvalues'));
 await visual.waitForFunction(()=>{const el=document.querySelector('.dice'),box=el.getBoundingClientRect();return Number(getComputedStyle(el).opacity)>0&&box.right>0&&box.left<innerWidth&&box.bottom>0&&box.top<innerHeight;});await visual.screenshot({path:join(out,'scene-dice-animation.png')});check(true,'scene dice visibly settle on the broadcast face values');
 await visual.waitForFunction(()=>window.wbMock.closedEffects.length>0,{},{timeout:15000});check(true,'scene animation dismisses without an old history panel');await visual.close();
 await bg.evaluate(()=>{const data={rollId:'remote-roll',rollerId:'remote',rollerName:'远端玩家',rollerColor:'#444',dice:[{type:'d6',value:4}],modifier:0,total:4,label:'远端',itemId:'one',winnerIdx:-1};window.wbMock.emit('com.obr-suite/dice-roll',{data,connectionId:'remote'});window.wbMock.emit('com.obr-suite/dice-roll',{data,connectionId:'remote'});});
 await bg.waitForFunction(()=>window.wbMock.effects.length===2);await page.waitForTimeout(100);
 check(await bg.evaluate(()=>window.wbMock.effects.length)===2,'remote roll plays once despite duplicate broadcasts');
 await bg.evaluate(()=>{window.wbMock.role='PLAYER';window.wbMock.emit('com.obr-suite/dice-roll',{data:{rollId:'private-roll',rollerId:'other',dice:[{type:'d20',value:18}],modifier:0,total:18,label:'暗骰',hidden:true}});});await page.waitForTimeout(150);
 check(await bg.evaluate(()=>window.wbMock.effects.length)===2,'another player dark roll does not expose a scene animation');await bg.evaluate(()=>{window.wbMock.role='GM';});
 await page.getByRole('button',{name:'角色卡与 Wiki',exact:true}).click();await page.getByRole('button',{name:'保存角色资料到枭熊'}).click();await page.waitForTimeout(250);check(saves===1&&documents.second.dnd_card_web?.schemaVersion===1&&documents.second.combat.weapons[0].name==='保留的武器','save retains native card and unmapped combat data');
 await room.evaluate(()=>document.querySelector('#launcher')?.remove());await page.reload();await page.waitForFunction(()=>document.querySelector('[aria-label="当前角色"]')?.selectedOptions[0]?.text==='贝拉');check(true,'card reload survives launcher removal');
 await page.setViewportSize({width:640,height:850});await page.getByRole('button',{name:'投骰',exact:true}).click();await page.waitForTimeout(300);await page.screenshot({path:join(out,'tablet-dice.png')});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'tablet half-width has no horizontal overflow');
 await page.setViewportSize({width:1500,height:1000});await page.getByRole('button',{name:'角色卡与 Wiki',exact:true}).click();await bg.evaluate(()=>window.wbMock.select(['one']));await page.waitForFunction(()=>document.querySelector('[aria-label="当前角色"]')?.selectedOptions[0]?.text==='阿明');await page.screenshot({path:join(out,'character-wiki.png')});
 await page.evaluate(()=>window.addEventListener('message',e=>{if(e.data?.protocol==='full-suite-workbench/v1'){window.testHost=e.source;if(e.data.state)window.testTarget=e.data.state;}}));
 await bg.evaluate(()=>{window.wbMock.items[0].name='阿明测试';window.wbMock.emit('items',window.wbMock.items);});await page.waitForFunction(()=>!!window.testTarget);
 const raw=extra=>page.evaluate(extra=>{const t=window.testTarget;window.testHost.postMessage({protocol:'full-suite-workbench/v1',type:'stats',session:new URLSearchParams(location.hash.slice(1)).get('suite'),requestId:'raw-test',key:t.key,itemId:t.itemId,expected:{health:12},patch:{health:10},...extra},location.origin);},extra);
 await raw({});await bg.waitForFunction(()=>window.wbMock.items[0].metadata['com.obr-suite/bubbles/data'].health===10);const writes=await bg.evaluate(()=>window.wbMock.writes);await raw({});await page.waitForTimeout(100);check(await bg.evaluate(()=>window.wbMock.writes)===writes,'duplicate request is acknowledged without a second write');
 await raw({requestId:'stale',patch:{health:999}});await page.waitForTimeout(100);check(await bg.evaluate(()=>window.wbMock.items[0].metadata['com.obr-suite/bubbles/data'].health)===10,'stale expected values cannot overwrite newer HP');
 await page.setViewportSize({width:640,height:850});await page.screenshot({path:join(out,'tablet-card.png')});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'tablet character view fits half width');
 await page.setViewportSize({width:1500,height:1000});
 await bg.evaluate(()=>{window.wbMock.role='PLAYER';window.wbMock.metadata['com.character-cards/list'][0].visibility='dm';window.wbMock.emit('metadata',window.wbMock.metadata);});await page.getByText('没有此角色的阅读权限').first().waitFor();check(await page.locator('.paper').count()===0,'revoked access clears visible character');
 await bg.evaluate(()=>window.wbMock.emit('com.obr-suite/workbench-compose',{connectionId:'connection',data:{expression:'1d8+2',label:'来自资料的攻击'}}));await page.getByRole('region',{name:'投骰工作区'}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="骰式"]').value==='1d8+2');check(true,'legacy dice picker routes to workbench composer');
 check(errors.length===0,'no browser runtime errors: '+errors.join(';'));
 console.log(JSON.stringify({checks,realRoom:false,output:out}));
}finally{await browser.close();server.close();}
