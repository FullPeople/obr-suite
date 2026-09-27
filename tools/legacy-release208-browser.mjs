// Existing production legacy host; only SDK readiness and candidate files are fixtures.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(resolve('../web/package.json'))('@playwright/test');
const live=process.argv.includes('--live'),origin='https://obr.dnd.center',out='D:/Temp/DND-card-release208-storage/release208';
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']}),errors=[],checks=[];
try{
 const context=await browser.newContext({viewport:{width:1100,height:950},serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 if(!live)await context.route(origin+'/suite/**',r=>{const path=decodeURIComponent(new URL(r.request().url()).pathname).slice('/suite/'.length);const file=path.startsWith('card-viewer/')?resolve('dist-workbench-dev',path):['announcement.md','manifest.json'].includes(path)?resolve('public',path):null;if(!file)return r.continue();assert.ok(existsSync(file));return r.fulfill({body:readFileSync(file),contentType:({'.js':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html;charset=utf-8','.md':'text/plain;charset=utf-8'})[extname(file)]||'application/octet-stream'});});
 await page.route(origin+'/legacy208-fixture',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0}iframe{border:0;width:100%;height:100%}</style><iframe src="/suite/dm-announcement.html?obrref=${Buffer.from(origin+' release208-legacy').toString('base64')}" onload="this.contentWindow.postMessage({id:'OBR_READY',data:{ref:'fixture',userId:'probe'}},location.origin)"></iframe>`}));
 await page.goto(origin+'/legacy208-fixture');const frame=page.frames().find(f=>f.parentFrame());await frame.locator('.release-current').waitFor();assert.equal(await frame.locator('.release-current h2').innerText(),'2026-09-27-二');
 const history=frame.locator('.release-history');assert.equal(await history.locator('summary').innerText(),'2026-09-27-一');assert.equal(await history.evaluate(el=>el.open),false);await history.locator('summary').click();assert.match(await history.innerText(),/XLSX/);await history.locator('summary').click();checks.push('Existing legacy announcement renderer displays the current dated batch and a closed previous batch; XLSX remains supported');
 await page.screenshot({path:out+'/'+(live?'live':'candidate')+'-legacy-announcement.png'});
 const sample=JSON.parse(readFileSync('public/cc-example-card.json','utf8'));
 const attacks=await page.evaluate(async sample=>{const {normalizeLegacyUpload}=await import('/suite/card-viewer/bridge.js');const converted=normalizeLegacyUpload(sample),native=converted.dnd_card_web;native.quickbarActions=[{id:'release208-bow',name:'发布检查长弓',attack:'+7',damage:'1d8+4'}];const once=normalizeLegacyUpload({format:'dnd-card-web',character:native}),twice=normalizeLegacyUpload(once);return {once:once.combat.weapons,twice:twice.combat.weapons};},sample);
 assert.deepEqual(attacks.once,attacks.twice);assert.ok(attacks.once.some(w=>w.name==='发布检查长弓'&&w.attack_bonus==='+7'&&w.damage==='1d8+4'));checks.push('Deployed legacy JSON bridge preserves native weapon attack and damage across two conversions');
 assert.deepEqual(errors,[]);writeFileSync(out+'/'+(live?'live':'candidate')+'-legacy-ui.json',JSON.stringify({checks,errors,scope:'Production legacy announcement and real browser import bridge; SDK readiness simulated, synthetic character only; no player data written.'},null,2));console.log(checks.join('\n'));
}finally{await browser.close();}
