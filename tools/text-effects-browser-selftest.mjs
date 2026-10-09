import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from '@playwright/test';
const out=resolve(process.env.TEXT_EFFECT_EVIDENCE||'.local-evidence/text-effects/browser');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:process.platform==='win32'?{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const base=process.env.TEXT_EFFECT_TEST_URL||'http://127.0.0.1:5197',url=base+'/tests/fixtures/text-effects/index.html#suite=text-effects-test&bridge='+encodeURIComponent(base);
const frame=()=>page.frameLocator('iframe[title="Full Suite 文字演出"]'),field=name=>frame().getByLabel(name,{exact:true}),button=name=>frame().getByRole('button',{name,exact:true});
const wait=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await page.waitForTimeout(50);}throw Error('Timed out waiting for browser state');};
const commands=()=>page.evaluate(()=>window.requests.filter(r=>r.method==='broadcast.sendMessage').map(r=>r.args[1]));
let count=0;async function check(name,fn){await fn();console.log('PASS',++count,name);}
try{
 await page.goto(url);await page.getByRole('button',{name:'文字演出',exact:true}).click();await button('播放到房间').waitFor();await wait(async()=>await button('播放到房间').isEnabled());
 await check('production navigation places the independent button directly after Music Board',async()=>{const names=await page.locator('.workbench-modes button').allTextContents();assert.equal(names[names.indexOf('音乐板')+1],'文字演出');});
 await check('literal user text stays text; changing fields and local preview never submit room commands',async()=>{
  await field('标题').fill('<img src=x onerror=alert(1)>');assert.equal(await frame().locator('.te-title').textContent(),'<img src=x onerror=alert(1)>');assert.equal(await frame().locator('.te-title img').count(),0);
  await field('标题').fill('星火将燃');await field('副标题').fill('先看见，再决定');await field('入场（秒）').fill('0.2');await field('停留（秒）').fill('0.5');await field('退场（秒）').fill('0.2');
  await button('播放预览').click();await wait(async()=>await button('停止预览').isDisabled());assert.equal((await commands()).length,0);
 });
 await check('custom presets and the working draft survive closing and reopening',async()=>{
  await field('预设名称').fill('测试预设');await button('保存预设').click();await wait(async()=>(await field('演出预设').locator('option').allTextContents()).includes('我的预设 · 测试预设'));await page.getByRole('button',{name:'总览',exact:true}).click();await page.locator('iframe[title="Full Suite 文字演出"]').waitFor({state:'detached'});await page.getByRole('button',{name:'文字演出',exact:true}).click();await wait(async()=>await button('播放到房间').isEnabled());assert.equal(await field('标题').inputValue(),'星火将燃');const names=await field('演出预设').locator('option').allTextContents();assert.ok(names.includes('我的预设 · 测试预设'),JSON.stringify(names));
 });
 await check('all six entrances and five decorations render and complete',async()=>{
  for(const [i,motion]of ['fade','rise','left','right','zoom','typewriter'].entries()){await field('文字入场').selectOption(motion);await field('画面效果').selectOption(['none','rays','mist','sparks','rings'][i%5]);await button('播放预览').click();await wait(async()=>await button('停止预览').isDisabled());}
 });
 await check('self preview and room play transmit the exact selected parameters and stop is explicit',async()=>{
  await field('停留（秒）').fill('1.5');await button('在枭熊中预览').click();await wait(async()=>(await commands()).length===1);assert.equal((await commands())[0].preview,true);await wait(async()=>await button('停止本次演出').isEnabled());const native=page.frameLocator('iframe.native-effect');await native.locator('.te-title').waitFor();assert.equal(await native.locator('.te-title').textContent(),'星火将燃');assert.equal(await page.locator('iframe.native-effect').evaluate(el=>getComputedStyle(el).pointerEvents),'none');await button('停止本次演出').click();await wait(async()=>await button('停止本次演出').isDisabled());assert.equal(await page.locator('iframe.native-effect').count(),0);
  await button('播放到房间').click();await wait(async()=>(await commands()).length===3);const sent=(await commands()).at(-1);assert.equal(sent.preview,false);assert.equal(sent.config.title,'星火将燃');assert.equal(sent.config.motion,'typewriter');assert.equal(sent.config.enter,200);await button('停止本次演出').click();await wait(async()=>await button('播放到房间').isEnabled());assert.equal((await commands()).at(-1).action,'stop');await field('停留（秒）').fill('0.5');
 });
 await check('duplicate clicks are locked and failed commands are not retried automatically',async()=>{
  await page.evaluate(()=>{window.hold=true;});const before=(await commands()).length;await button('播放到房间').evaluate(b=>{b.dispatchEvent(new MouseEvent('click',{bubbles:true}));b.dispatchEvent(new MouseEvent('click',{bubbles:true}));});await wait(async()=>(await commands()).length===before+1);assert.equal(await button('在枭熊中预览').isDisabled(),true);await page.evaluate(()=>window.release());await wait(async()=>await button('播放到房间').isEnabled());await button('停止本次演出').click();await wait(async()=>await button('播放到房间').isEnabled());
  await page.evaluate(()=>{window.failNext=true;});const failedBefore=(await commands()).length;await button('播放到房间').click();await frame().getByRole('alert').waitFor();assert.match(await frame().getByRole('alert').textContent(),/模拟播放失败/);assert.equal((await commands()).length,failedBefore+1);assert.equal(await button('播放到房间').isEnabled(),true);
 });
 await check('role revocation disables room controls and scene closure retains local preview',async()=>{
  await page.evaluate(()=>window.refresh('PLAYER'));await wait(async()=>await button('播放到房间').isDisabled());assert.equal(await button('在枭熊中预览').isEnabled(),true);await page.evaluate(()=>window.scene(false));await wait(async()=>await button('在枭熊中预览').isDisabled());assert.equal(await button('播放预览').isEnabled(),true);await page.evaluate(()=>{window.refresh('GM');window.scene(true);});await wait(async()=>await button('播放到房间').isEnabled());assert.match(await frame().locator('#status').textContent(),/已连接枭熊/);
 });
 await check('320px and 390px layouts keep controls inside the frame',async()=>{
  await button('应用预设').click();
  for(const width of [390,320]){await page.setViewportSize({width,height:900});const dimensions=await frame().locator('html').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));await button('播放到房间').scrollIntoViewIfNeeded();await frame().locator('body').evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(out,`text-effects-${width}.png`)});}
 });
 await check('long narration paginates, long titles fit and reduced motion removes decoration',async()=>{
  await field('标题').fill('这是需要完整显示的长标题。'.repeat(10));await field('副标题').fill('这是一段较长的副标题。'.repeat(15));await field('正文').fill('脚步声在空旷的走廊中回响，远处的火光正在摇曳。'.repeat(60));
  await frame().locator('.te-motion').evaluate(el=>{if(el.scrollHeight>el.clientHeight+2)throw Error('Narration overflows the presentation');});assert.ok(Number(await frame().locator('#preview').getAttribute('data-pages'))>1);
  await field('标题').fill('星火将燃');await field('副标题').fill('先看见，再决定');await field('正文').fill('');await frame().getByLabel('简化动态效果',{exact:true}).check();assert.equal(await frame().locator('.te-ornament.te-none').count(),1);await frame().getByLabel('简化动态效果',{exact:true}).uncheck();
 });
 await page.setViewportSize({width:1440,height:1000});await field('演出预设').selectOption('builtin:0');await button('应用预设').click();await frame().locator('body').evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(out,'text-effects-desktop.png')});
 assert.deepEqual(errors,[]);writeFileSync(join(out,'result.json'),JSON.stringify({passed:count,realRoomVerified:false,pageErrors:errors},null,2));console.log(`Text effects browser: ${count} scenarios passed; synthetic host only.`);
}catch(error){console.error('Browser diagnostics',JSON.stringify({errors,editor:await frame().locator('body').evaluate(()=>({status:document.querySelector('#status')?.textContent,error:document.querySelector('#error')?.textContent,presets:document.querySelector('#presets')?.textContent,name:document.querySelector('#preset-name')?.value})).catch(()=>null)}));await page.screenshot({path:join(out,'failure.png')});throw error;}finally{await browser.close();}
