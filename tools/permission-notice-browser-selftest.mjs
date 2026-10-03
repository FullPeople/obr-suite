// Production Web navigation JSX + permission button + Suite modal. Synthetic SDK/bridge only.
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
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
const workbenchRequest=async(type,args)=>{if(mock.role!=='GM')throw Error('GM only');if(args.statusOnly)return {seen:localStorage.getItem(key)==='1'};mock.open({id:'com.obr-suite/'+(channel==='suite-dev'?'workbench-':'')+'player-permissions',url:'/'+channel+'/dm-announcement.html?permissions=1'});};
function Toolbar(){const [role,setRole]=React.useState(mock.role);React.useEffect(()=>{const listener={name:'player',fn:player=>setRole(player.role)};mock.listeners.add(listener);return()=>mock.listeners.delete(listener);},[]);const wb={role,enabled:{musicBoard:true}},online=true,page='console',change=()=>{};return ${nav};}createRoot(document.getElementById('root')).render(<Toolbar/>);`);
for(const channel of ['suite','suite-dev'])for(const [input,name] of [[entryFile,'toolbar'],[join(root,'src/dm-announcement.ts'),'notice']]){
 await build({input,transform:{jsx:{runtime:'automatic',importSource:'react'}},plugins:[{name:'permission-fixture',resolveId(id){if(id==='@owlbear-rodeo/sdk')return '\0sdk';if(id==='react'||id.startsWith('react/'))return requireWeb.resolve(id);},load(id){if(id==='\0sdk')return fixture;},transform(code){return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/'+channel+'/'));}}],output:{file:join(out,channel+'-'+name+'.js'),format:'esm'},logLevel:'silent'});
}
if(process.env.NOTICE_BUILD_ONLY==='1'){console.log('Permission fixture compiled with the paired React runtime');process.exit(0);}
const host=`window.noticeFixture={role:new URLSearchParams(location.search).get('role')||'GM',listeners:new Set(),opened:[],closed:[],emit(name,data){for(const listener of [...this.listeners])if(listener.name===name)listener.fn(data);},setRole(role){this.role=role;this.emit('player',{role});},open(opts){this.opened.push(opts);document.querySelector('#modal')?.remove();const frame=document.createElement('iframe');frame.id='modal';frame.title='Player permissions';frame.src=opts.url;frame.style='position:fixed;top:100px;left:50%;transform:translateX(-50%);width:min(560px,100vw);height:min(580px,calc(100vh - 110px));border:0';document.body.append(frame);},close(id){this.closed.push(id);document.querySelector('#modal')?.remove();}};`;
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=url.pathname;
 if(path==='/'){const channel=url.searchParams.get('channel')||'suite-dev';res.setHeader('Content-Type','text/html');res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#373942;color:white;font-family:system-ui}#toolbar{border:0;width:100%;height:90px}</style><script>${host}</script><iframe id="toolbar" title="DM toolbar" src="/${channel}/toolbar.html"></iframe>`);return;}
 if(path.endsWith('/toolbar.html')){const channel=path.split('/')[1];res.setHeader('Content-Type','text/html');res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui}${readFileSync(join(web,'src/ui/workbench.css'),'utf8')}${readFileSync(join(web,'src/ui/responsive177.css'),'utf8')}</style><div id="root"></div><script type="module" src="/${channel}-toolbar.js"></script>`);return;}
 if(path.endsWith('/dm-announcement.html')){const channel=path.split('/')[1];res.setHeader('Content-Type','text/html');res.end(readFileSync(join(root,'dm-announcement.html'),'utf8').replace('/src/dm-announcement.ts',`/${channel}-notice.js`));return;}
 if(/^\/suite(-dev)?-(toolbar|notice)\.js$/.test(path)){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(join(out,path.slice(1))));return;}
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
const modal=page=>page.frameLocator('#modal');
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
  await page.evaluate(()=>document.querySelector('#modal').remove());await expect(entry(page)).toBeVisible();await openGuide(page);await scrollBottom(page);await expect(ack).toBeEnabled();await page.evaluate(()=>document.querySelector('#modal').remove());await expect(entry(page)).toBeVisible();await page.reload();await expect(entry(page)).toBeVisible();await page.close();
 });
 await check('only bottom plus explicit acknowledgment persists; release acknowledgment is independent',async()=>{
  const page=await open();await page.evaluate(()=>localStorage.setItem('obr-suite/workbench/announce-seen-version','release-marker'));await openGuide(page);const ack=modal(page).getByRole('button',{name:'我真的知道了',exact:true});
  await page.screenshot({path:join(out,'guide-wide-unread.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'guide-narrow-unread.png')});await scrollBottom(page);await expect(ack).toBeEnabled();await page.screenshot({path:join(out,'guide-narrow-bottom.png')});await ack.click();await expect(page.locator('#modal')).toHaveCount(0);await expect(entry(page)).toHaveCount(0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('obr-suite/workbench/announce-seen-version')),'release-marker');assert.equal(await page.evaluate(k=>localStorage.getItem(k),key('suite-dev')),'1');await page.reload();await expect(entry(page)).toHaveCount(0);await page.close();
 });
 await check('stable and dev guide acknowledgments remain separate; short content can acknowledge',async()=>{
  const page=await open({channel:'suite'});await expect(entry(page)).toBeVisible();await openGuide(page);await modal(page).locator('#body').evaluate(body=>{body.querySelector('.announcement-important').innerHTML='<p>Short notice</p>';});await expect(modal(page).getByRole('button',{name:'我真的知道了',exact:true})).toBeEnabled();await modal(page).getByRole('button',{name:'我真的知道了',exact:true}).click();assert.equal(await page.evaluate(k=>localStorage.getItem(k),key('suite')),'1');await page.close();
 });
 await check('language reset and growing content cannot inherit an old bottom position',async()=>{
  const page=await open();await page.evaluate(k=>localStorage.removeItem(k),key('suite-dev'));await page.reload();await openGuide(page);await scrollBottom(page);await expect(modal(page).getByRole('button',{name:'我真的知道了',exact:true})).toBeEnabled();await modal(page).locator('#ann-lang-en').click();await expect(modal(page).locator('#btn-close')).toBeDisabled();await modal(page).locator('#ann-lang-zh').click();await scrollBottom(page);await modal(page).locator('.announcement-important').evaluate(body=>{body.insertAdjacentHTML('beforeend','<div style="height:1200px">Additional content</div>');});await expect(modal(page).locator('#btn-close')).toBeDisabled();await page.close();
 });
 await check('role revocation disables acknowledgment and cannot persist',async()=>{
  const page=await open();await openGuide(page);await scrollBottom(page);await page.evaluate(()=>noticeFixture.setRole('PLAYER'));await expect(modal(page).locator('#btn-close')).toBeDisabled();await modal(page).locator('#btn-close').dispatchEvent('click');assert.equal(await page.evaluate(k=>localStorage.getItem(k),key('suite-dev')),null);await page.close();
 });
 await check('ordinary release announcement keeps its guide, histories, and acknowledgment',async()=>{
  const page=await open();await page.evaluate(()=>noticeFixture.open({id:'com.obr-suite/workbench-announcement',url:'/suite-dev/dm-announcement.html'}));await expect(modal(page).locator('.announcement-important summary')).toContainText('关于设置玩家单独权限的重要说明');await expect(modal(page).getByRole('button',{name:/^我知道了/})).toBeVisible();assert.equal(await modal(page).locator('.announcement-important').evaluate(node=>node.open),false);await page.close();
 });
 assert.deepEqual(errors,[]);writeFileSync(join(out,'results.json'),JSON.stringify({passed:results.length,results,errors,realRoomVerified:false},null,2));
 console.log(`Permission notice: ${results.length} browser scenarios passed; synthetic SDK, no live Owlbear room verification.`);
}catch(error){for(const [index,page] of context.pages().entries()){await page.screenshot({path:join(out,`failure-${index}.png`),fullPage:true}).catch(()=>{});writeFileSync(join(out,`failure-${index}.html`),await page.content().catch(()=>''));}writeFileSync(join(out,'failure.json'),JSON.stringify({results,errors,error:String(error)},null,2));throw error;}finally{await context.tracing.stop({path:join(out,'trace.zip')});await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
