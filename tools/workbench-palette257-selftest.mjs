import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
const root=resolve(import.meta.dirname,'..'),out=process.env.WORKBENCH_SETTINGS_TEST_OUT;
if(!out)throw Error('Set WORKBENCH_SETTINGS_TEST_OUT to a temporary test directory');
const {chromium}=createRequire(join(process.env.DND_CARD_WEB_ROOT||'D:/Desktop/DND-card-web','package.json'))('@playwright/test');
mkdirSync(out,{recursive:true});
const frame=`<!doctype html><body><iframe style="width:680px;height:650px" src="/panels/settings.html?workbench=1&section=features"></iframe><script>
window.calls=[];window.held=[];window.writes=[];window.allowInit=false;window.failNext=false;
function reply(e,result,error){e.source?.postMessage({channel:'workbench-panel-frame/v1',id:e.data.id,result,error},location.origin)}
function initial(){return {roomId:'test-room',playerId:'test-player',preferences:{},reads:{'player.getRole':'GM','scene.isReady':true,'scene.getMetadata':{'com.obr-suite/state':{enabled:{dice:false,inventory:true},crossSceneSyncSettings:false}},'room.getMetadata':{}}}}
window.release=()=>{window.allowInit=true;for(const e of held.splice(0))reply(e,initial())};
window.addEventListener('message',e=>{if(e.data.channel!=='workbench-panel-frame/v1')return;const m=e.data;if(typeof m.night==='boolean'){document.documentElement.dataset.suiteNight=String(m.night);return}if(!m.method)return;calls.push(m.method);if(m.method==='init'){if(window.failNext){window.failNext=false;reply(e,undefined,'test reconnect');return}if(!allowInit){held.push(e);return}reply(e,initial());return}if(m.method.includes('setMetadata'))writes.push(m);const r=m.method==='player.getRole'?'GM':m.method==='scene.isReady'?true:m.method==='scene.getMetadata'?initial().reads['scene.getMetadata']:m.method==='room.getMetadata'?{}:true;reply(e,r)});
</script>`;
const server=createServer((req,res)=>{let path=decodeURIComponent((req.url||'/').split('?')[0]);if(path==='/frame'){res.setHeader('Content-Type','text/html');res.end(frame);return}if(path.endsWith('supporters.zh.json')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify([{name:'A',amount:100},{name:'B',amount:50},{name:'C',amount:20},{name:'D',amount:5}]));return}const file=join(out,path);if(!existsSync(file)){res.statusCode=404;res.end();return}res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.html')?'text/html':'text/plain');res.end(readFileSync(file))});
await new Promise(r=>server.listen(5207,'127.0.0.1',r));
let browser;const checks=[],check=(value,label)=>{if(!value)throw Error(label);checks.push(label);console.log('PASS',label)};
try{
 browser=await chromium.launch({channel:process.env.CI?undefined:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];page.on('pageerror',e=>{errors.push(String(e));console.error('BROWSER',e.stack)});
 await page.goto('http://127.0.0.1:5207/frame');const panel=page.frameLocator('iframe');await panel.locator('[data-feature=dice]').waitFor();
 check(await panel.locator('[data-feature]').count()>=20,'feature structure appears while init is still pending');
 check(await panel.locator('.content').evaluate(e=>e.inert),'unknown shared switches remain inert');
 check(await panel.locator('[data-feature=dice]').isDisabled(),'no actionable placeholder switch before role/settings arrive');
 check(await panel.locator('html').evaluate(e=>getComputedStyle(e).getPropertyValue('--bg').trim())==='#fdfdfc','first paint uses workbench theme from HTML');
 await page.evaluate(()=>window.release());await panel.locator('body[data-bridge-ready=true]').waitFor();
 check(await panel.locator('[data-feature=dice]').getAttribute('aria-pressed')==='false','authoritative false switch replaces placeholder defaults');
 check(!await panel.locator('.content').evaluate(e=>e.inert),'shared controls become usable after actual variables arrive');
 check(await page.evaluate(()=>window.writes.length)===0,'opening settings never writes placeholder defaults');
 check(await page.evaluate(()=>window.calls.filter(v=>['scene.getMetadata','room.getMetadata','player.getRole'].includes(v)).length)===0,'batched init removes separate startup metadata/role round trips');
 await page.evaluate(()=>{window.allowInit=false;document.querySelector('iframe').src='/panels/settings.html?workbench=1'});await panel.locator('#ui-night').waitFor();await panel.locator('#ui-night').check();
 check(await panel.locator('html').getAttribute('data-suite-night')==='true'&&await page.locator('html').getAttribute('data-suite-night')==='true','night mode works locally before Owlbear connects');
 check(await panel.locator('html').evaluate(e=>getComputedStyle(e).getPropertyValue('--bg').trim())==='#202125','night panel uses readable dark palette');
 await page.evaluate(()=>{window.held=[];window.failNext=true;document.querySelector('iframe').src='/panels/settings.html?workbench=1&reload=1'});await panel.locator('#ui-night').waitFor();check(await panel.locator('#ui-night').isChecked(),'night mode survives reopening');await page.evaluate(()=>window.release());await panel.locator('body[data-bridge-ready=true]').waitFor({timeout:7000});check(true,'failed read-only initialization retries and recovers');
 check(await panel.locator('input[type=color],#ui-tone,#tone-hex').count()===0,'settings remove duplicate color controls while preserving night mode');
 await page.evaluate(()=>localStorage.setItem('dnd-card/ui-palette:v1',JSON.stringify({ui:{accent:'#987044',surface:'#323334',ink:'#eeddbb'},wiki:{}})));
 await panel.locator('html').evaluate(async el=>{for(let i=0;i<50;i++){if(getComputedStyle(el).getPropertyValue('--accent').trim()==='#987044')return;await new Promise(r=>setTimeout(r,20));}throw Error('Palette storage event did not reach settings');});
 check(await panel.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--bg').trim())==='#323334','same-origin palette changes reach settings without a duplicate picker');
 await page.evaluate(()=>document.querySelector('iframe').src='/panels/settings.html?workbench=1&paletteReload=1');await panel.locator('body[data-bridge-ready=true]').waitFor();
 check(await panel.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent').trim())==='#987044','saved palette survives panel reload');
 await page.evaluate(()=>localStorage.removeItem('dnd-card/ui-palette:v1'));await panel.locator('html').evaluate(async el=>{for(let i=0;i<50;i++){if(getComputedStyle(el).getPropertyValue('--bg').trim()==='#202125')return;await new Promise(r=>setTimeout(r,20));}throw Error('Palette reset did not restore night defaults');});
 check(await panel.locator('#ui-night').isChecked(),'resetting colors preserves saved night mode');
 check(errors.length===0,'settings have no browser exceptions');const result={checks,realRoomVerified:false};writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2));await page.screenshot({path:join(out,'settings-palette.png')});console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
