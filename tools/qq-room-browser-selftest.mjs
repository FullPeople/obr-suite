// Actual QQ UI, HTTP permissions and built five-page editor; synthetic SDK/accounts.
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'..'),web=resolve(process.env.DND_CARD_WEB_ROOT||'');
assert(process.env.DND_CARD_WEB_ROOT&&existsSync(join(web,'dist-cloud-server/server.mjs')),'Build the exact paired Web cloud package first');
const {CloudStore,createCloudServer}=await import(pathToFileURL(join(web,'dist-cloud-server/server.mjs')));
const {chromium}=createRequire(join(web,'package.json'))('@playwright/test');
const {ANNOUNCEMENT_KEY,APP_VERSION,announcementVersionFor}=await import(pathToFileURL(join(web,'src/platform/announcement.ts')));
const out=join(root,'.local-evidence/qq-room');mkdirSync(out,{recursive:true});
const sdk=join(out,'sdk.ts');
writeFileSync(sdk,`const handlers=new Set<()=>void>();(window as any).qqMetadataChanged=()=>handlers.forEach(fn=>fn());
export default {onReady:(fn:()=>void)=>queueMicrotask(fn),room:{id:'synthetic-qq-room',getMetadata:()=>((window as any).qqFixture('read')),setMetadata:(update:unknown)=>(window as any).qqFixture('write',update),onMetadataChange:(fn:()=>void)=>{handlers.add(fn);return()=>handlers.delete(fn);}},player:{getId:async()=>'synthetic-player'},modal:{close:async()=>{}}};`);
await build({input:join(root,'src/modules/characterCards/qq-page.ts'),plugins:[{name:'synthetic-sdk',resolveId:id=>id==='@owlbear-rodeo/sdk'?sdk:undefined,transform:code=>code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/'))}],output:{file:join(out,'page.js'),format:'esm',codeSplitting:false}});
const store=new CloudStore(':memory:'),owner=store.provisionVerifiedAccount('fixture:qq-owner'),other=store.provisionVerifiedAccount('fixture:qq-other'),issued=store.issueVerifiedSession(owner.id);
await build({input:join(web,'src/core/model.ts'),output:{file:join(out,'model.mjs'),format:'esm',codeSplitting:false}});
const {newCharacter}=await import(pathToFileURL(join(out,'model.mjs'))),source=newCharacter();
const card=store.create(owner,{...source,id:crypto.randomUUID(),name:'QQ 插件房间验收'});store.create(other,{...source,id:crypto.randomUUID(),name:'他人私有卡应不可见'});
const server=createCloudServer(store,'https://dnd.center');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const api='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:process.env.CI?undefined:'msedge'}),contexts=[],pages=[],errors=[];let metadata={};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
async function context(authenticated=false){
 const context=await browser.newContext({viewport:{width:1440,height:960}});contexts.push(context);
 const QQ_CARDS='com.obr-suite/qq-cards';
 const rpcSource=readFileSync(join(root,'src/workbench/panel-rpc.ts'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function panelBridge','function panelBridge');
 const rpcContext=vm.createContext({QQ_CARDS,setupServerAdmission(){},tableWorkbench:()=>async()=>{},OBR:{room:{id:'synthetic-qq-room',getMetadata:async()=>structuredClone(metadata),setMetadata:async update=>{metadata={...metadata,...update};},onMetadataChange:()=>()=>{}},player:{getId:async()=>'synthetic-player'}}});
 vm.runInContext(ts.transpileModule(rpcSource+'\nglobalThis.bridge=panelBridge(()=>{});',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,rpcContext);
 await context.exposeBinding('qqFixture',async(_source,operation,update)=>{if(operation==='panel')return rpcContext.bridge(update.panel,update.instance,update.method,update.args);if(operation==='write'){metadata={...metadata,...update};return;}return structuredClone(metadata);});
 if(authenticated)await context.addCookies([{name:'dnd_cloud',value:issued.token,url:'https://dnd.center/api/',secure:true,httpOnly:true,sameSite:'Strict'}]);
 await context.route('https://dnd.center/api/**',async route=>{const request=route.request(),url=new URL(request.url()),response=await context.request.fetch(api+url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),data:request.postData()||undefined});await route.fulfill({response});});
 await context.route(/https:\/\/(?:obr\.)?dnd\.center\/(?!api\/).*/,async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/qq-fixture/'){await route.fulfill({contentType:'text/html',body:readFileSync(join(root,'cc-qq.html'),'utf8').replace('/src/modules/characterCards/qq-page.ts','/qq-fixture/page.js')});return;}
  if(pathname==='/qq-fixture/page.js'){await route.fulfill({contentType:'text/javascript',body:readFileSync(join(out,'page.js'),'utf8')});return;}
  if(pathname==='/qq-workbench-host/'){
   const target='https://obr.dnd.center/suite-dev/workbench/index.html#suite=qq-entry-fixture&bridge=https%3A%2F%2Fobr.dnd.center';
   await route.fulfill({contentType:'text/html',body:`<!doctype html><a id="open" href="${target}" target="qq-entry-fixture">Open workbench</a><script>
const protocol='full-suite-workbench/v1',session='qq-entry-fixture';window.qqRequests=[];
addEventListener('message',async e=>{if(e.origin!==location.origin||e.data?.protocol!==protocol||e.data.session!==session)return;const m=e.data;qqRequests.push(m.type);const send=(type,data={})=>e.source.postMessage({protocol,session,type,hostStarted:1,...data},location.origin);
if(m.type==='hello'){send('ready',{rolls:[]});send('catalog',{sequence:1,cards:[],monsters:[],role:'PLAYER',enabled:{characterCards:true}});}
else if(m.type==='ping')send('pong');else if(m.type==='panelRpc'){try{send('ack',{requestId:m.requestId,ok:true,result:await qqFixture('panel',m)});}catch(error){send('ack',{requestId:m.requestId,ok:false,message:String(error)});}}
else if(m.requestId)send('ack',{requestId:m.requestId,ok:true,result:{}});});</script>`});return;
  }
  if(pathname.startsWith('/suite-dev/workbench/')||pathname.startsWith('/suite-dev/workbench-panels/')){
   const file=resolve(root,'dist-workbench-dev',pathname.slice('/suite-dev/'.length)+(pathname.endsWith('/')?'index.html':''));
   await route.fulfill(existsSync(file)?{contentType:mime[extname(file)]||'application/octet-stream',body:readFileSync(file)}:{status:404,body:'Workbench fixture asset missing'});return;
  }
  const relative=pathname.startsWith('/suite-dev/card-viewer/')?'dist/'+pathname.slice('/suite-dev/card-viewer/'.length):'dist-cloud/'+pathname.slice(1);
  const file=resolve(web,relative+(pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(web+String.fromCharCode(92))&&!file.startsWith(web+'/'))throw Error('Fixture path escaped');
  await route.fulfill(existsSync(file)?{contentType:mime[extname(file)]||'application/octet-stream',body:readFileSync(file)}:{status:404,body:'Fixture asset missing'});
 });
 await context.route(/https:\/\/(?:5e|homebrew)\.kiwee\.top\//,route=>route.fulfill({json:{},headers:{'access-control-allow-origin':'*'}}));
 await context.addInitScript(([key,standalone,suite])=>{try{localStorage.setItem('dnd-card:rules-setup:v1','done');localStorage.setItem('dnd-card:editing','true');localStorage.setItem(key,standalone);localStorage.setItem(key+':suite',suite);}catch{/* Blank frames have no storage origin. */}},[ANNOUNCEMENT_KEY,APP_VERSION,existsSync(join(root,'dist-workbench-dev/workbench-panels/qq.html'))?JSON.parse(readFileSync(join(root,'public/manifest-dev.json'),'utf8')).version:announcementVersionFor('suite')]);
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 const page=await context.newPage();pages.push(page);await page.goto('https://obr.dnd.center/qq-fixture/');return page;
}
const {expect}=createRequire(join(web,'package.json'))('@playwright/test');
try{
 const host=await context(true);await expect(host.locator('#cards')).toContainText('登录后读取自己的卡库');
 const popupEvent=host.context().waitForEvent('page');await host.locator('#login').click();const popup=await popupEvent;
 await popup.getByRole('button',{name:'连接当前账号'}).click();await expect(host.locator('#cards')).toContainText(card.character.name);await expect(host.locator('#cards')).not.toContainText('他人私有卡');
 const workbenchChecks=[];
 if(existsSync(join(root,'dist-workbench-dev/workbench-panels/qq.html'))){
  const room=await host.context().newPage();await room.goto('https://obr.dnd.center/qq-workbench-host/');
  const event=host.context().waitForEvent('page');await room.locator('#open').click();const workspace=await event;
  const entry=workspace.getByRole('button',{name:'我的 QQ 卡库',exact:true});await entry.click();
  const frame=workspace.frameLocator('iframe[title="Full Suite 我的 QQ 卡库"]');
  await expect(frame.locator('#cards')).toContainText(card.character.name);await expect(frame.locator('#cards')).not.toContainText('他人私有卡');
  assert(!(await room.evaluate(()=>window.qqRequests)).includes('qqLibrary'),'Entry must stay visible in the active workbench tab');
  await frame.locator('#logout').click();await expect(frame.locator('#login')).toBeVisible();
  const loginEvent=host.context().waitForEvent('page');await frame.locator('#login').click();const loginPage=await loginEvent;
  await loginPage.getByRole('button',{name:'连接当前账号'}).click();await expect(frame.locator('#cards')).toContainText(card.character.name);
  workspace.once('dialog',dialog=>dialog.accept());await frame.locator('#cards button').click();await expect(frame.getByRole('button',{name:'解锁给房间成员'})).toBeVisible();
  await expect(frame.frameLocator('#editor').getByRole('textbox',{name:'角色姓名',exact:true})).toHaveValue(card.character.name);
  await frame.getByRole('button',{name:'移出房间'}).click();await expect(frame.locator('#roomCards button')).toHaveCount(0);
  await workspace.screenshot({path:join(out,'qq-workbench.png')});
  await entry.click();await expect(workspace.locator('iframe[title="Full Suite 我的 QQ 卡库"]')).toHaveCount(0);
  await entry.click();await expect(frame.locator('#cards')).toContainText(card.character.name);
  await frame.locator('#close').click();await expect(workspace.locator('iframe[title="Full Suite 我的 QQ 卡库"]')).toHaveCount(0);
  workbenchChecks.push('actual-workbench-button-shows-library-in-active-tab','workbench-login-popup-connects-account','workbench-owner-only-library','workbench-load-opens-five-page-editor','workbench-toggle-and-close-restore-previous-page');
  await workspace.close();await room.close();
 }
 host.once('dialog',dialog=>dialog.accept());await host.locator('#cards button').click();await expect(host.locator('#roomCards')).toContainText('解锁给房间成员');
 assert.equal(Object.keys(metadata).length,1);assert(!JSON.stringify(metadata).includes(issued.token),'Website session must never enter room metadata');
 const ownName=host.frameLocator('#editor').getByRole('textbox',{name:'角色姓名',exact:true});await expect(ownName).toHaveValue('QQ 插件房间验收');await ownName.fill('卡主锁定状态修改');await expect.poll(()=>store.read(card.id,owner).character.name).toBe('卡主锁定状态修改');
 const member=await context();await expect(member.locator('#roomCards button')).toHaveCount(0);
 await host.getByRole('button',{name:'解锁给房间成员'}).click();await expect(host.getByRole('button',{name:'重新锁定'})).toBeVisible();await member.locator('#refresh').click();await expect(member.locator('#roomCards button')).toHaveCount(1);await member.locator('#roomCards button').click();
 const editor=member.frameLocator('#editor'),name=editor.getByRole('textbox',{name:'角色姓名',exact:true});await expect(name).toHaveValue('卡主锁定状态修改');await name.fill('成员自动写回云端原卡');
 await expect.poll(()=>store.read(card.id,owner).character.name).toBe('成员自动写回云端原卡');
 assert.equal(store.slots(owner).used,1);await host.getByRole('button',{name:'重新锁定'}).click();await expect(host.getByRole('button',{name:'解锁给房间成员'})).toBeVisible();await member.locator('#refresh').click();await expect(member.locator('#roomCards button')).toHaveCount(0);await expect(member.locator('#editor')).toHaveAttribute('src','about:blank');
 await host.getByRole('button',{name:'移出房间'}).click();assert.equal(store.slots(owner).used,1);assert.equal(store.read(card.id,owner).character.name,'成员自动写回云端原卡');
 host.once('dialog',dialog=>dialog.accept());await host.locator('#cards button').click();await expect(host.getByRole('button',{name:'移出房间'})).toBeVisible();store.db.exec('UPDATE room_cards SET expires=0');
 await host.getByRole('button',{name:'移出房间'}).click();await expect(host.locator('#roomCards button')).toHaveCount(0);assert.equal(store.slots(owner).used,1);
 host.once('dialog',dialog=>dialog.accept());await host.locator('#cards button').click();await expect(host.getByRole('button',{name:'移出房间'})).toBeVisible();store.delete(card.id,owner,store.read(card.id,owner).revision);
 await host.getByRole('button',{name:'移出房间'}).click();await expect(host.locator('#roomCards button')).toHaveCount(0);assert.equal(store.slots(owner).used,0);
 assert.deepEqual(errors,[]);await host.screenshot({path:join(out,'qq-owner.png')});
 const result={synthetic:true,realQQ:false,realRoom:false,checks:[...workbenchChecks,'popup-pkce-connection','own-library-only','personal-session-not-in-metadata','loaded-card-default-locked','unlocked-member-five-page-editor','automatic-original-writeback','owner-relock-removes-member-editor','room-remove-retains-original','locked-owner-five-page-edit','expired-room-entry-can-be-removed','deleted-original-room-entry-can-be-removed']};
 writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));store.close();}
