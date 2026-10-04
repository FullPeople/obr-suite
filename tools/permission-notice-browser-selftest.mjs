// Production Web navigation, permission button/dialog, WorkbenchPanel and Suite guide. Synthetic host SDK/RPC boundaries only.
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,extname,dirname} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {chromium,expect} from '@playwright/test';

const root=resolve(import.meta.dirname,'..');
const out=join(root,'.local-evidence/permission-notice');mkdirSync(out,{recursive:true});
const fixture=`
const mock=top.noticeFixture;
const on=(name,fn)=>{const listener={name,fn};mock.listeners.add(listener);const off=()=>mock.listeners.delete(listener);addEventListener('pagehide',off,{once:true});return off;};
const api={onReady:fn=>fn(),player:{getRole:async()=>mock.role,onChange:fn=>on('player',fn)},scene:{isReady:async()=>true,getMetadata:async()=>({}),onMetadataChange:fn=>on('scene',fn),onReadyChange:fn=>on('ready',fn)},viewport:{getWidth:async()=>innerWidth,getHeight:async()=>innerHeight},modal:{open:async opts=>mock.open(opts),close:async id=>mock.close(id)},broadcast:{onMessage:on,sendMessage:async(name,data)=>mock.emit(name,{data})}};
export default api;`;
const web=resolve(process.env.DND_CARD_WEB_ROOT||'../card-owner-sync');
const requireWeb=createRequire(join(web,'package.json'));
const nav=readFileSync(join(web,'src/ui/Workbench.tsx'),'utf8').match(/<nav className="workbench-modes"[^]*?<\/nav>/)?.[0];assert(nav,'Actual Workbench navigation must exist');
const entryFile=join(out,'web-toolbar.tsx');
writeFileSync(entryFile,`import React from '${join(web,'node_modules/react/index.js').replaceAll('\\','/')}';import {createRoot} from '${join(web,'node_modules/react-dom/client.js').replaceAll('\\','/')}';import {PlayerPermissionButton} from '${join(web,'src/ui/PlayerPermissionButton.tsx').replaceAll('\\','/')}';globalThis.React=React;
const mock=top.noticeFixture,channel=location.pathname.split('/')[1],key='obr-suite/'+(channel==='suite-dev'?'workbench/':'')+'player-permissions-seen';
const workbenchRequest=(type,args)=>mock.request(type,args,window);
function Toolbar(){const [role,setRole]=React.useState(mock.role);React.useEffect(()=>{const listener={name:'player',fn:player=>setRole(player.role)};mock.listeners.add(listener);return()=>mock.listeners.delete(listener);},[]);const wb={role,enabled:{musicBoard:true}},online=true,page='console',change=()=>{};return ${nav};}createRoot(document.getElementById('root')).render(<Toolbar/>);`);
const permissionEntry=join(out,'permission-frame.ts');writeFileSync(permissionEntry,`import ${JSON.stringify(join(root,'src/workbench/player-permission-page.ts'))};import ${JSON.stringify(join(root,'src/workbench/permission-theme.css'))};`);
const workbenchFixture=`export const useWorkbench=()=>({online:true,role:top.noticeFixture.role});export const workbenchRequest=(type,args)=>top.noticeFixture.request(type,args,window);`;
for(const channel of ['suite','suite-dev'])for(const [input,name] of [[entryFile,'toolbar'],[join(root,'src/dm-announcement.ts'),'notice'],[permissionEntry,'permissions']]){
 await build({input,transform:{jsx:{runtime:'automatic',importSource:'react'}},plugins:[{name:'permission-fixture',resolveId(id,importer){if(id.endsWith('.css'))return '\0fixture-css:'+resolve(dirname(importer),id)+'.js';if(id==='../platform/workbench')return '\0workbench';if(id==='@workbench/sdk-builders')return '\0builders';if(id==='@owlbear-rodeo/sdk')return name==='permissions'?join(root,'src/workbench/panel-sdk.ts'):'\0sdk';if(id==='react'||id.startsWith('react/'))return requireWeb.resolve(id);},load(id){if(id==='\0sdk')return fixture;if(id==='\0workbench')return workbenchFixture;if(id==='\0builders')return 'export {};';if(id.startsWith('\0fixture-css:'))return `const style=document.createElement('style');style.textContent=${JSON.stringify(readFileSync(id.slice(13,-3),'utf8'))};document.head.append(style);`;},transform(code){return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/'+channel+'/'));}}],output:{file:join(out,channel+'-'+name+'.js'),format:'esm'},logLevel:'silent'});
}
if(process.env.NOTICE_BUILD_ONLY==='1'){console.log('Permission fixture compiled with the paired React runtime');process.exit(0);}
const host=`window.noticeFixture={rpcCalls:[],subscriptions:new Map(),failAck:false,revokeAfterRoleRead:false,role:new URLSearchParams(location.search).get('role')||'GM',listeners:new Set(),opened:[],closed:[],emit(name,data){for(const listener of [...this.listeners])if(listener.name===name)listener.fn(data);},setRole(role){this.role=role;this.emit('player',{role});for(const {args,caller} of this.subscriptions.values())caller.dispatchEvent(new caller.CustomEvent('workbench-panel-event',{detail:{panel:args.panel,instance:args.instance,event:'player',data:{role}}}));},async request(type,args,caller){const channel=caller.location.pathname.split('/')[1],key='obr-suite/'+(channel==='suite-dev'?'workbench/':'')+'player-permissions-seen';this.rpcCalls.push({type,method:args.method});if(type==='console'){if(this.role!=='GM')throw Error('GM only');if(args.statusOnly)return {seen:localStorage.getItem(key)==='1'};throw Error('Guide must use the inline panel');}if(type!=='panelRpc'||args.panel!=='permissions')throw Error('Unsupported fixture operation');if(args.method==='dispose'){this.subscriptions.delete(args.instance);return;}if(this.role!=='GM')throw Error('GM only');if(args.method==='init')return {roomId:'fixture-room',playerId:'fixture-GM',preferences:{}};if(args.method==='player.getRole'){const role=this.role;if(this.revokeAfterRoleRead){this.revokeAfterRoleRead=false;this.role='PLAYER';}return role;}if(args.method==='subscribe'){if(args.args[0]!=='player')throw Error('Unexpected subscription');this.subscriptions.set(args.instance,{args,caller});return;}if(args.method==='permissions.acknowledge'){if(this.failAck)throw Error('Host acknowledgment unavailable');localStorage.setItem(key,'1');return {seen:true};}throw Error('Unexpected fixture method '+args.method);},open(opts){this.opened.push(opts);document.querySelector('#modal')?.remove();const frame=document.createElement('iframe');frame.id='modal';frame.title='Player permissions';frame.src=opts.url;frame.style='position:fixed;top:100px;left:50%;transform:translateX(-50%);width:min(560px,100vw);height:min(580px,calc(100vh - 110px));border:0';document.body.append(frame);},close(id){this.closed.push(id);document.querySelector('#modal')?.remove();}};`;
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=url.pathname;
 if(path==='/'){const channel=url.searchParams.get('channel')||'suite-dev';res.setHeader('Content-Type','text/html');res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#373942;color:white;font-family:system-ui}#toolbar{border:0;width:100%;height:100vh}</style><script>${host}</script><iframe id="toolbar" title="DM toolbar" src="/${channel}/workbench/toolbar.html"></iframe>`);return;}
 if(path.endsWith('/toolbar.html')){const channel=path.split('/')[1];res.setHeader('Content-Type','text/html');res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui}${readFileSync(join(web,'src/ui/workbench.css'),'utf8')}${readFileSync(join(web,'src/ui/responsive177.css'),'utf8')}</style><div id="root"></div><script type="module" src="/${channel}-toolbar.js"></script>`);return;}
 if(path.endsWith('/workbench-panels/permissions.html')){const channel=path.split('/')[1];res.setHeader('Content-Type','text/html');res.end(readFileSync(join(root,'dm-announcement.html'),'utf8').replace('/src/dm-announcement.ts',`/${channel}-permissions.js`));return;}
 if(path.endsWith('/dm-announcement.html')){const channel=path.split('/')[1];res.setHeader('Content-Type','text/html');res.end(readFileSync(join(root,'dm-announcement.html'),'utf8').replace('/src/dm-announcement.ts',`/${channel}-notice.js`));return;}
 if(/^\/suite(-dev)?-(toolbar|notice|permissions)\.js$/.test(path)){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(join(out,path.slice(1))));return;}
 const publicPath=path.replace(/^\/suite(-dev)?\//,'');const file=join(root,'public',publicPath);
 if(existsSync(file)){res.setHeader('Content-Type',({'.png':'image/png','.md':'text/plain','.json':'application/json'})[extname(file)]||'text/plain');res.end(readFileSync(file));return;}
 if(path.endsWith('/assets/announcement-dev.md')){res.setHeader('Content-Type','text/plain');res.end('# Full Suite\n## 2026-10-03 [release]\n- 1.0.240-dev · retained release\n## 2026-10-02 [history]\nOlder release');return;}
 res.writeHead(404).end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
if(process.env.NOTICE_PREVIEW==='1') { console.log(`Permission notice preview: ${base}`); await new Promise(()=>{}); }
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1100,height:780}}),results=[],errors=[];
await context.tracing.start({screenshots:true,snapshots:true,sources:true});
context.on('page',page=>page.on('pageerror',error=>{errors.push(error.message);console.error('FIXTURE PAGE ERROR',error.message);}));
const key=channel=>`obr-suite/${channel==='suite-dev'?'workbench/':''}player-permissions-seen`;
async function open({role='GM',channel='suite-dev'}={}){const page=await context.newPage();await page.goto(`${base}/?channel=${channel}&role=${role}`);await page.frameLocator('#toolbar').getByRole('button',{name:'音乐板',exact:true}).waitFor();return page;}
const entry=page=>page.frameLocator('#toolbar').getByRole('button',{name:'关于玩家分配卡和权限',exact:true});
const dialog=page=>page.frameLocator('#toolbar').locator('.player-permission-dialog');
const modal=page=>page.frameLocator('#toolbar').frameLocator('.player-permission-dialog iframe');
const dismiss=page=>page.frameLocator('#toolbar').getByRole('button',{name:'关闭权限说明',exact:true}).click();
async function openGuide(page){await entry(page).click();await modal(page).locator('.announcement-important img').last().waitFor();await modal(page).locator('.announcement-important img').evaluateAll(images=>Promise.all(images.map(image=>image.complete?Promise.resolve():new Promise(r=>{image.onload=r;image.onerror=r;}))));}
async function scrollBottom(page){await modal(page).locator('#body').evaluate(body=>{body.scrollTop=body.scrollHeight;body.dispatchEvent(new Event('scroll'));});}
async function check(name,run){await run();results.push(name);console.log('PASS',results.length,name);}
try{
 await check('DM red bold entry sits immediately to the right of music',async()=>{
  const page=await open();await expect(entry(page)).toBeVisible();
  assert.equal(await entry(page).evaluate(button=>button.previousElementSibling.textContent),'音乐板');
  const style=await entry(page).evaluate(button=>({color:getComputedStyle(button).color,weight:getComputedStyle(button).fontWeight}));assert.equal(style.color,'rgb(189, 37, 37)');assert(Number(style.weight)>=700);
  await page.screenshot({path:join(out,'toolbar-wide.png')});await page.setViewportSize({width:390,height:844});await entry(page).scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'toolbar-narrow.png')});await page.close();
 });
 await check('players never see the entry; promotion/demotion updates without reload',async()=>{
  const page=await open({role:'PLAYER'});await expect(entry(page)).toHaveCount(0);await page.evaluate(()=>noticeFixture.setRole('GM'));await expect(entry(page)).toBeVisible();await page.evaluate(()=>noticeFixture.setRole('PLAYER'));await expect(entry(page)).toHaveCount(0);await page.close();
 });
 await check('opening, premature click, dismiss and scroll without acknowledgment remain unread',async()=>{
  const page=await open();await openGuide(page);const ack=modal(page).getByRole('button',{name:'我真的知道了',exact:true});await expect(ack).toBeDisabled();
  await ack.dispatchEvent('click');assert.equal(await page.evaluate(k=>localStorage.getItem(k),key('suite-dev')),null);
  await dismiss(page);await expect(entry(page)).toBeVisible();await openGuide(page);await scrollBottom(page);await expect(ack).toBeEnabled();await dismiss(page);await expect(entry(page)).toBeVisible();await page.reload();await expect(entry(page)).toBeVisible();await page.close();
 });
 await check('only bottom plus explicit acknowledgment persists; release acknowledgment is independent',async()=>{
  const page=await open();await page.evaluate(()=>localStorage.setItem('obr-suite/workbench/announce-seen-version','release-marker'));await openGuide(page);const ack=modal(page).getByRole('button',{name:'我真的知道了',exact:true});
  await page.screenshot({path:join(out,'guide-wide-unread.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'guide-narrow-unread.png')});await scrollBottom(page);await expect(ack).toBeEnabled();await page.screenshot({path:join(out,'guide-narrow-bottom.png')});await ack.click();await expect(dialog(page)).toHaveCount(0);await expect(entry(page)).toHaveCount(0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('obr-suite/workbench/announce-seen-version')),'release-marker');assert.equal(await page.evaluate(k=>localStorage.getItem(k),key('suite-dev')),'1');await page.reload();await expect(entry(page)).toHaveCount(0);await page.close();
 });
 await check('stable and dev guide acknowledgments remain separate; short content can acknowledge',async()=>{
  const page=await open({channel:'suite'});await expect(entry(page)).toBeVisible();await openGuide(page);await modal(page).locator('#body').evaluate(body=>{body.querySelector('.announcement-important').innerHTML='<p>Short notice</p>';});await expect(modal(page).getByRole('button',{name:'我真的知道了',exact:true})).toBeEnabled();await modal(page).getByRole('button',{name:'我真的知道了',exact:true}).click();assert.equal(await page.evaluate(k=>localStorage.getItem(k),key('suite')),'1');await page.close();
 });
 await check('language reset and growing content cannot inherit an old bottom position',async()=>{
  const page=await open();await page.evaluate(k=>localStorage.removeItem(k),key('suite-dev'));await page.reload();await openGuide(page);await scrollBottom(page);await expect(modal(page).getByRole('button',{name:'我真的知道了',exact:true})).toBeEnabled();await modal(page).locator('#ann-lang-en').click();await expect(modal(page).locator('#btn-close')).toBeDisabled();await modal(page).locator('#ann-lang-zh').click();await scrollBottom(page);await modal(page).locator('.announcement-important').evaluate(body=>{body.insertAdjacentHTML('beforeend','<div style="height:1200px">Additional content</div>');});await expect(modal(page).locator('#btn-close')).toBeDisabled();await page.close();
 });
 await check('role revocation disables acknowledgment and cannot persist',async()=>{
  const page=await open();await openGuide(page);await scrollBottom(page);await page.evaluate(()=>noticeFixture.revokeAfterRoleRead=true);await modal(page).getByRole('button',{name:'我真的知道了',exact:true}).click();await expect(modal(page).locator('#credit')).toContainText('未能保存确认');await expect(dialog(page)).toBeVisible();assert.equal(await page.evaluate(()=>noticeFixture.role),'PLAYER');assert.equal(await page.evaluate(()=>noticeFixture.rpcCalls.some(call=>call.method==='permissions.acknowledge')),true);assert.equal(await page.evaluate(k=>localStorage.getItem(k),key('suite-dev')),null);await page.evaluate(()=>noticeFixture.setRole('PLAYER'));await expect(dialog(page)).toHaveCount(0);await expect(entry(page)).toHaveCount(0);assert.equal(await page.evaluate(k=>localStorage.getItem(k),key('suite-dev')),null);await page.close();
 });
 await check('host acknowledgment failure stays open and unread until explicit retry succeeds',async()=>{
  const page=await open();await openGuide(page);await scrollBottom(page);await page.evaluate(()=>noticeFixture.failAck=true);await modal(page).getByRole('button',{name:'我真的知道了',exact:true}).click();await expect(dialog(page)).toBeVisible();await expect(modal(page).locator('#credit')).toContainText('未能保存确认');assert.equal(await page.evaluate(k=>localStorage.getItem(k),key('suite-dev')),null);await page.evaluate(()=>noticeFixture.failAck=false);await modal(page).getByRole('button',{name:'我真的知道了',exact:true}).click();await expect(dialog(page)).toHaveCount(0);await expect(entry(page)).toHaveCount(0);assert.equal(await page.evaluate(k=>localStorage.getItem(k),key('suite-dev')),'1');await page.close();
 });
 await check('ordinary release announcement keeps its guide, histories, and acknowledgment',async()=>{
  const page=await open();await page.evaluate(()=>noticeFixture.open({id:'com.obr-suite/workbench-announcement',url:'/suite-dev/dm-announcement.html'}));const release=page.frameLocator('#modal');await expect(release.locator('.announcement-important summary')).toContainText('关于设置玩家单独权限的重要说明');await expect(release.getByRole('button',{name:/^我知道了/})).toBeVisible();assert.equal(await release.locator('.announcement-important').evaluate(node=>node.open),false);await page.close();
 });
 assert.deepEqual(errors,[]);writeFileSync(join(out,'results.json'),JSON.stringify({passed:results.length,results,errors,realRoomVerified:false,scope:'Production Web button/dialog/WorkbenchPanel and Suite guide/panel-sdk; synthetic host RPC/SDK. Actual panel-rpc dispatcher is covered separately by six unit scenarios, not this browser fixture.'},null,2));
 console.log(`Permission notice: ${results.length} browser scenarios passed; synthetic SDK, no live Owlbear room verification.`);
}catch(error){for(const [index,page] of context.pages().entries()){await page.screenshot({path:join(out,`failure-${index}.png`),fullPage:true}).catch(()=>{});writeFileSync(join(out,`failure-${index}.html`),await page.content().catch(()=>''));}writeFileSync(join(out,'failure.json'),JSON.stringify({results,errors,error:String(error)},null,2));throw error;}finally{await context.tracing.stop({path:join(out,'trace.zip')});await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
