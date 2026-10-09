// Real announcement DOM and scoped read-state functions; synthetic SDK only.
// No actual room, account, publishing or deployed-host verification.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {createServer} from 'node:http';
import {build} from 'rolldown';
import {chromium} from '@playwright/test';
import {workbenchAnnouncement} from './workbench-announcement.mjs';
const root=resolve(import.meta.dirname,'..').replaceAll('\\','/'),web=process.env.DND_CARD_WEB_ROOT;
assert.ok(web,'Set DND_CARD_WEB_ROOT to the exact paired Web checkout');
const out=join(root,'.local-evidence/announcement-scope');mkdirSync(out,{recursive:true});
const notes={suite:readFileSync(join(root,'public/announcement.md'),'utf8'),'suite-dev':await workbenchAnnouncement(web)};
assert.ok(notes.suite.includes('该插件不再更新'));
assert.ok(!notes['suite-dev'].includes('该插件不再更新'));
const versions=Object.fromEntries(Object.entries(notes).map(([key,value])=>[key,value.match(/^\s*-\s*(\d+\.\d+\.\d+(?:[-.][\w]+)*)\s*[·\-—]/m)[1]]));
function functions(file,names){const text=readFileSync(join(root,file),'utf8');return names.map(name=>{const match=text.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n}', 'm'));assert.ok(match,'Missing actual source function '+name);return match[0];}).join('\n');}
const state=functions('src/cluster-row.ts',['fetchAnnouncementVersion','applyAnnounceBlink','refreshAnnouncementVersion','onAnnounce']);

for(const channel of ['suite','suite-dev']){
 const entry=join(out,channel+'.ts');
 writeFileSync(entry,`import {WORKBENCH_DEV} from '${root}/src/workbench/channel';import {dailyAnnouncement} from '${root}/src/announcement-lifecycle';import {StartupPresentation} from '${root}/src/workbench/startup-presentation';import '${root}/src/dm-announcement';import {assetUrl} from '${root}/src/asset-base';import {ANNOUNCEMENT_FILE,ANNOUNCEMENT_MODAL_ID,ANNOUNCEMENT_SEEN_KEY,ANNOUNCEMENT_DAILY_KEY} from '${root}/src/announcement-source';import OBR from '@owlbear-rodeo/sdk';
 const ANNOUNCEMENT_MD_URL=assetUrl(ANNOUNCEMENT_FILE),ANNOUNCEMENT_URL=assetUrl('dm-announcement.html'),LS_ANNOUNCE_SEEN=ANNOUNCEMENT_SEEN_KEY;let cachedAnnounceVersion:string|null=null;
 const ANNOUNCE_MD_URL=ANNOUNCEMENT_MD_URL,ANNOUNCE_URL=ANNOUNCEMENT_URL,ANNOUNCE_MODAL_ID=ANNOUNCEMENT_MODAL_ID,LS_ANNOUNCE_DAILY=ANNOUNCEMENT_DAILY_KEY,LS_ANNOUNCE_SEEN_VERSION=ANNOUNCEMENT_SEEN_KEY;
 ${state}\nconst presentation=new StartupPresentation();const maybeShowDailyAnnouncement=dailyAnnouncement({role:()=>OBR.player.getRole(),readDay:()=>localStorage.getItem(LS_ANNOUNCE_DAILY),presentation,open:()=>OBR.modal.open({id:ANNOUNCE_MODAL_ID,url:ANNOUNCE_URL+'?daily=1'}),warn:()=>{}});
 (window as any).noticeProbe={presentation,refresh:refreshAnnouncementVersion,open:onAnnounce,daily:maybeShowDailyAnnouncement,seenKey:ANNOUNCEMENT_SEEN_KEY,dailyKey:ANNOUNCEMENT_DAILY_KEY};`);
 await build({input:entry,plugins:[{name:'sdk-boundary',transform(code){return code.includes('import.meta.env.BASE_URL')?code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/'+channel+'/')):undefined;},resolveId(id){if(id==='@owlbear-rodeo/sdk')return '\0sdk';},load(id){if(id==='\0sdk')return `export default {onReady:fn=>fn(),player:{getRole:async()=> 'GM'},broadcast:{sendMessage:async (topic,data)=>{window.controlRequests=(window.controlRequests||[]).concat({topic,data})}},modal:{open:async value=>{window.openedModals=(window.openedModals||[]).concat(value)},close:async id=>{window.closedModal=id}}};`;}}],output:{file:join(out,channel+'.js'),format:'esm'}});
}
const html=readFileSync(join(root,'dm-announcement.html'),'utf8');
const requests=[],errors=[],checks=[],contexts=[];let failure;function check(name,value){checks.push({name,passed:!!value});assert.ok(value,name);}
const server=createServer((req,res)=>{const path=req.url.split('?')[0],channel=path.split('/')[1];try{let body,type='text/plain';
 if(path.endsWith('/dm-announcement.html')){body=html.replace('<script type="module" src="/src/dm-announcement.ts"></script>',`<button id="btnAnnounce">Notice</button><script type="module" src="/${channel}/notice.js"></script>`);type='text/html';}
 else if(path.endsWith('/notice.js')){body=readFileSync(join(out,channel+'.js'));type='text/javascript';}
 else if(path=== '/suite/announcement.md'||path==='/suite-dev/assets/announcement-dev.md')body=notes[channel];
 else if(path.endsWith('/manifest.json')||path.endsWith('/manifest-dev.json')){body=JSON.stringify({version:channel==='suite'?'1.3.14':'1.0.227-dev'});type='application/json';}
 else if(/\/owner-step[123]\.png$/.test(path)){body=readFileSync(join(root,'public',path.split('/').at(-1)));type='image/png';}
 else {res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',type);res.end(body);
 }catch(error){res.writeHead(500);res.end(String(error));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
let browser;try{browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
for(const width of [360,1280]){
 const context=await browser.newContext({viewport:{width,height:800}});
 const record={context,width,active:true};contexts.push(record);await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 for(const channel of ['suite','suite-dev']){
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>requests.push({channel,width,url:r.url()}));
  await page.goto(origin+'/'+channel+'/dm-announcement.html');await page.locator('.announcement-important').waitFor();
  const guide=page.locator('.announcement-important');check(`${width} ${channel} guide collapsed`,!await guide.evaluate(el=>el.open));
  check(`${width} ${channel} exact Chinese title`,await guide.locator('summary').innerText()==='关于设置玩家单独权限的重要说明');
  const body=await page.locator('#body').innerText();check(`${width} ${channel} no wrong release`,channel==='suite'?body.includes('该插件不再更新'):!body.includes('该插件不再更新'));
  check(`${width} ${channel} own notice version`,(await page.locator('.cl-version').first().innerText())===versions[channel]);
  await guide.locator('summary').click();check(`${width} ${channel} original guide retained`,(await guide.innerText()).includes('每个 Token 单独指派；一个玩家可以拥有多个角色（PC + 召唤物等）。'));
  await page.waitForFunction(()=>[...document.querySelectorAll('.announcement-important img')].every(img=>img.complete&&img.naturalWidth>0));
  check(`${width} ${channel} three own-channel images`,await guide.locator('img').count()===3&&await guide.locator('img').evaluateAll((imgs,channel)=>imgs.every(img=>new URL(img.src).pathname.startsWith('/'+channel+'/')),channel));
  check(`${width} ${channel} no width overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:join(out,`${width}-${channel}-important.png`)});
  await page.locator('#ann-lang-en').click();check(`${width} ${channel} English guide`,(await guide.innerText()).includes('Important: setting player Owner permissions'));await guide.locator('summary').click();check(`${width} ${channel} full English text`,(await guide.innerText()).includes('Per-token assignment; one player can own multiple tokens'));
  await page.locator('#ann-lang-zh').click();check(`${width} ${channel} language repeat safe`,await page.locator('.announcement-important').count()===1);
  await page.evaluate(()=>{const p=window.noticeProbe;localStorage.removeItem(p.seenKey);localStorage.removeItem(p.dailyKey);return p.refresh();});check(`${width} ${channel} cold unread`,await page.locator('#btnAnnounce').evaluate(el=>el.classList.contains('blink')));
  await page.evaluate(()=>window.noticeProbe.open());check(`${width} ${channel} open request stays unread`,await page.locator('#btnAnnounce').evaluate(el=>el.classList.contains('blink')));if(channel==='suite-dev')check(`${width} new notice opens in local workbench`,await page.evaluate(()=>window.controlRequests.at(-1).data.page==='announcement'&&!window.openedModals?.length));
  await page.waitForFunction(()=>!document.querySelector('#btn-close').disabled);await page.locator('#btn-close').click();await page.evaluate(()=>window.noticeProbe.refresh());check(`${width} ${channel} explicit visible acknowledgement`,!await page.locator('#btnAnnounce').evaluate(el=>el.classList.contains('blink')));
  await page.reload();await page.locator('.announcement-important').waitFor();await page.evaluate(()=>window.noticeProbe.refresh());check(`${width} ${channel} reload keeps read`,!await page.locator('#btnAnnounce').evaluate(el=>el.classList.contains('blink')));
  await page.evaluate(()=>{localStorage.setItem(window.noticeProbe.seenKey,'older-release');return window.noticeProbe.refresh();});check(`${width} ${channel} changed release unread`,await page.locator('#btnAnnounce').evaluate(el=>el.classList.contains('blink')));
  await page.evaluate(()=>{window.noticeProbe.presentation.hello('card-first','playing',window,200);return window.noticeProbe.daily();});check(`${width} ${channel} host does not interrupt intro`,await page.evaluate(()=>!window.openedModals?.length));
  await page.evaluate(()=>{window.noticeProbe.presentation.update('card-first','cancelled');window.noticeProbe.presentation.releaseClosedWindow();return window.noticeProbe.daily();});check(`${width} ${channel} navigation gap never releases the host notice`,await page.evaluate(()=>!window.openedModals?.length));
  await page.evaluate(()=>{window.noticeProbe.presentation.hello('card-next','loading',window,300);window.noticeProbe.presentation.hello('first-seen-old','complete',window,100);return window.noticeProbe.daily();});check(`${width} ${channel} stale hello cannot unlock replacement`,await page.evaluate(()=>!window.openedModals?.length));
  await page.evaluate(()=>{window.noticeProbe.presentation.update('card-next','fading');return window.noticeProbe.daily();});check(`${width} ${channel} host waits through fade-out`,await page.evaluate(()=>!window.openedModals?.length));
  await page.evaluate(()=>{window.noticeProbe.presentation.update('card-next','complete');return window.noticeProbe.daily();});check(`${width} ${channel} host opens after completion`,await page.evaluate(()=>window.openedModals.length)===1);
  check(`${width} ${channel} opening alone is not read or shown`,await page.evaluate(()=>localStorage.getItem(window.noticeProbe.seenKey)==='older-release'&&!localStorage.getItem(window.noticeProbe.dailyKey)));
  await page.goto(origin+'/'+channel+'/dm-announcement.html?daily=1');await page.waitForFunction(()=>!!window.noticeProbe&&!!localStorage.getItem(window.noticeProbe.dailyKey));
  check(`${width} ${channel} visible content is not acknowledged yet`,await page.evaluate(()=>localStorage.getItem(window.noticeProbe.seenKey)==='older-release'));
  await page.evaluate(()=>window.noticeProbe.daily());check(`${width} ${channel} daily remains once after visible content`,await page.evaluate(()=>!window.openedModals?.length));
  await page.waitForFunction(()=>!document.querySelector('#btn-close').disabled);await page.locator('#btn-close').click();check(`${width} ${channel} own modal close`,await page.evaluate(()=>window.closedModal)===(channel==='suite'?'com.obr-suite/dm-announcement':'com.obr-suite/workbench-announcement'));
  await page.close();
 }
 // Both channels share origin/storage: acknowledging new must not overwrite old.
 const page=await context.newPage();await page.goto(origin+'/suite/dm-announcement.html');await page.waitForFunction(()=>!!window.noticeProbe);
 check(`${width} read states independent`,await page.evaluate(expected=>localStorage.getItem('obr-suite/announce-seen-version')===expected.suite&&localStorage.getItem('obr-suite/workbench/announce-seen-version')===expected['suite-dev'],versions));
 await page.close();await context.tracing.stop({path:join(out,width+"-trace.zip")});record.active=false;await context.close();
}
check('no browser script errors',!errors.length);
check('no wrong-channel content requests',requests.every(r=>!r.url.endsWith(r.channel==='suite'?'/assets/announcement-dev.md':'/announcement.md')));
}catch(error){failure=String(error?.stack||error);throw error;}finally{for(const record of contexts)if(record.active){for(const [index,page] of record.context.pages().entries())await page.screenshot({path:join(out,record.width+'-failure-'+index+'.png')}).catch(()=>{});await record.context.tracing.stop({path:join(out,record.width+'-failure-trace.zip')}).catch(()=>{});}writeFileSync(join(out,'results.json'),JSON.stringify({checks,errors,requests,failure,realRoomVerified:false},null,2));await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,out}));
