import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.MONSTER_SETTINGS_OUT||join(root,'.local-evidence/monster-settings'));
const {chromium,expect}=createRequire(join(process.env.DND_CARD_WEB_ROOT||'D:/Desktop/DND-card-web','package.json'))('@playwright/test');
if(!existsSync(join(out,'panels/settings.html')))throw Error('Build the actual settings panel into MONSTER_SETTINGS_OUT/panels first');
const frame=`<!doctype html><body><iframe title="Settings" style="width:680px;height:650px" src="/panels/settings.html?workbench=1"></iframe><script>
window.role='GM';window.writes=[];window.failNext=false;
window.metadata={'com.obr-suite/state':{crossSceneSyncSettings:false,libraries:[{id:'custom-kept',name:'Kept custom',baseUrl:'https://custom.test',enabled:false,builtin:false,disabledSources:['KEPT'],language:'en'}]}};
function reply(e,result,error){e.source?.postMessage({channel:'workbench-panel-frame/v1',id:e.data.id,result,error},location.origin)}
function initial(){return {roomId:'fixture-room',playerId:'fixture-player',preferences:{},reads:{'player.getRole':role,'scene.isReady':true,'scene.getMetadata':metadata,'room.getMetadata':{}}}}
window.addEventListener('message',e=>{if(e.data.channel!=='workbench-panel-frame/v1')return;const m=e.data;if(!m.method)return;if(m.method==='init'){reply(e,initial());return;}if(m.method==='scene.setMetadata'){if(failNext){failNext=false;reply(e,undefined,'authored save unavailable');return;}Object.assign(metadata,m.args[0]);writes.push(m.args[0]);reply(e,true);return;}const result=m.method==='scene.getMetadata'?metadata:m.method==='room.getMetadata'?{}:m.method==='player.getRole'?role:m.method==='scene.isReady'?true:true;reply(e,result);});
</script>`;
const server=createServer((req,res)=>{
 const path=new URL(req.url||'/','http://fixture.test').pathname;
 if(path==='/frame'){res.setHeader('Content-Type','text/html');res.end(frame);return;}
 const file=resolve(out,'.'+decodeURIComponent(path));
 if(!file.startsWith(out+sep)||!existsSync(file)){res.statusCode=404;res.end();return;}
 res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.html')?'text/html':'text/plain');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:process.env.CI?undefined:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];
 page.on('pageerror',error=>errors.push(String(error)));
 await page.route('https://homebrew.kiwee.top/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/_generated/index-sources.json')return route.fulfill({json:{BREW:'monster/Authored.json',AUTHORED_LONG_BOOK_SOURCE_FOR_NARROW_LAYOUT:'monster/Authored.json',OTHER:'race/Unrelated.json'}});
  if(path==='/_generated/index-props.json')return route.fulfill({json:{monster:{'monster/Authored.json':'monster'}}});
  return route.fulfill({status:404,body:'authored missing'});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/frame`);
 const panel=page.frameLocator('iframe');await panel.locator('body[data-bridge-ready=true]').waitFor();
 await panel.locator('[data-tab=search]').click();
 const toggle=panel.getByRole('button',{name:'启用 kiwee 第三方怪物库',exact:true});
 await expect(toggle).toHaveAttribute('aria-pressed','false',{timeout:5000});
 assert.equal(await page.evaluate(()=>window.writes.length),0);
 console.log('PASS actual workbench settings expose the opt-in collection without writing defaults');
 await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');
 await page.waitForFunction(()=>window.metadata['com.obr-suite/state'].libraries.some(lib=>lib.id==='kiwee-homebrew-monsters'&&lib.enabled));
 await panel.getByRole('button',{name:'选择怪物书籍',exact:true}).click();
 const book=panel.getByRole('checkbox',{name:'BREW',exact:true});await expect(book).toBeChecked();assert.equal(await panel.getByRole('checkbox',{name:'OTHER',exact:true}).count(),0);
 await book.uncheck();await page.waitForFunction(()=>window.metadata['com.obr-suite/state'].libraries.find(lib=>lib.id==='kiwee-homebrew-monsters').disabledSources?.includes('BREW'));
 await page.evaluate(()=>document.querySelector('iframe').src='/panels/settings.html?workbench=1&reopen=1');
 await panel.locator('body[data-bridge-ready=true]').waitFor();await panel.locator('[data-tab=search]').click();
 await expect(toggle).toHaveAttribute('aria-pressed','true');await panel.getByRole('button',{name:'选择怪物书籍',exact:true}).click();await expect(book).not.toBeChecked();
 const custom=await page.evaluate(()=>JSON.parse(JSON.stringify(window.metadata['com.obr-suite/state'].libraries.find(lib=>lib.id==='custom-kept'))));
 assert.deepEqual(custom,{id:'custom-kept',name:'Kept custom',baseUrl:'https://custom.test',enabled:false,builtin:false,disabledSources:['KEPT'],language:'en'});
 console.log('PASS enable and per-book choices survive reopening while existing custom libraries remain unchanged');
 await page.evaluate(()=>window.failNext=true);await toggle.click();await expect(panel.getByRole('alert')).toContainText('authored save unavailable');await expect(toggle).toHaveAttribute('aria-pressed','true');
 await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','false');
 await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');
 mkdirSync(out,{recursive:true});await page.screenshot({path:join(out,'settings-monster-sources-gm.png')});
 console.log('PASS failed save keeps the previously confirmed selection and offers retry');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{document.body.style.margin='0';const frame=document.querySelector('iframe');frame.style.width='100%';frame.style.border='0';});
 await expect(toggle).toBeVisible();
 assert(await panel.locator('[data-monster-library]').evaluate(row=>row.getBoundingClientRect().right<=document.documentElement.clientWidth));
 assert(await panel.locator('[data-monster-book="AUTHORED_LONG_BOOK_SOURCE_FOR_NARROW_LAYOUT"]').evaluate(box=>box.parentElement.getBoundingClientRect().right<=document.documentElement.clientWidth));
 await page.screenshot({path:join(out,'settings-monster-sources-narrow.png')});
 console.log('PASS the actual settings controls and long source codes fit a 390px viewport');
 await page.evaluate(()=>{window.role='PLAYER';document.querySelector('iframe').src='/panels/settings.html?workbench=1&player=1';});
 await panel.locator('body[data-bridge-ready=true]').waitFor();await panel.locator('[data-tab=search]').click();await expect(toggle).toBeDisabled();
 assert.deepEqual(errors,[]);mkdirSync(out,{recursive:true});await page.screenshot({path:join(out,'settings-monster-sources.png')});
 writeFileSync(join(out,'results.json'),JSON.stringify({passed:true,realRoomVerified:false},null,2));
 console.log('PASS actual built settings keep source changes GM-only');
}finally{await browser.close();await new Promise(r=>server.close(r));}
