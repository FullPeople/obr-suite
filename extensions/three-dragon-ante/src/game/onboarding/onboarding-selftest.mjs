// Actual onboarding component and CSS in Edge. No SDK, room, storage or network fixture.
import { build } from 'rolldown';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE??'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=mkdtempSync(join(tmpdir(),'tda-onboarding-'));
const shots=resolve(process.env.TDA_ONBOARDING_OUTPUT??resolve(here,'..','..','..','..','..','..','_audit/2026-09-09/three-dragon-onboarding'));
mkdirSync(shots,{recursive:true});
const pins=()=>Object.fromEntries(['index.ts','art.ts','style.css','onboarding-selftest.mjs'].map(name=>[name,createHash('sha256').update(readFileSync(join(here,name))).digest('hex')]));
const initialPins=pins();
await build({input:join(here,'index.ts'),platform:'browser',plugins:[{name:'inline-actual-css',transform(code,id){if(id===join(here,'index.ts').replaceAll('\\','/')||id.replaceAll('\\','/').endsWith('/onboarding/index.ts'))return code.replace("import './style.css';",'');}}],output:{file:join(out,'guide.js'),format:'esm'}});
const css=readFileSync(join(here,'style.css'),'utf8');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><style>body{margin:0;background:#13392e;color:#eee;font:16px system-ui}#open{margin:25px;padding:12px}#room{position:fixed;inset:20% 10%;background:#254e3e;border:15px solid #766247;border-radius:50%;display:grid;place-items:center}#room b{opacity:.4;letter-spacing:5px}button{position:relative}${css}</style><div id="room"><b>THE TABLE</b></div><button id="open">Open introduction</button><main id="host"></main><script type="module">import{mountOnboarding}from'/guide.js';window.calls={close:0,practice:0,anchor:0};window.makeGuide=(language='en',anchorMode='valid')=>{window.guide?.destroy();document.querySelector('#open').focus();window.guide=mountOnboarding(document.querySelector('#host'),{language,onClose(){calls.close++},onPractice(){calls.practice++},getAnchor(){calls.anchor++;if(anchorMode==='throw')throw Error('anchor gone');if(anchorMode==='offscreen')return new DOMRect(-500,-500,10,10);return new DOMRect(100,100,80,90)}});};document.querySelector('#open').onclick=()=>makeGuide();window.ready=true;</script></html>`;
const server=createServer((req,res)=>{if(req.url==='/guide.js'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(join(out,'guide.js')));}else{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'msedge'}),checks=[],errors=[],requests=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
 await page.evaluate(()=>makeGuide('en'));
 check('native modal opens with focused title',await page.evaluate(()=>document.querySelector('dialog').matches(':modal')&&document.activeElement===document.querySelector('dialog h1')));
 await page.keyboard.press('Shift+Tab');check('backward Tab from heading focuses last control',await page.locator('.tda-guide-next').evaluate(e=>document.activeElement===e));
 await page.keyboard.press('Tab');check('Tab from last control wraps to close',await page.locator('.tda-guide-close').evaluate(e=>document.activeElement===e));
 for(let i=0;i<4;i++){
  check('page '+i+' has exactly one current progress marker',await page.locator('[aria-current="step"]').count()===1&&await page.locator('dialog').getAttribute('data-step')===String(i));
  check('page '+i+' has meaningful body', (await page.locator('.tda-guide-description').innerText()).length>100);
  check('page '+i+' has three directly defined terms',await page.locator('.tda-guide-glossary dt').count()===3&&await page.locator('.tda-guide-glossary dd').count()===3);
  const terms=await page.locator('.tda-guide-glossary').innerText();
  check('page '+i+' glossary matches current rules',terms.includes(['Gambit','Tied','Flight','Total strength'][i]));
  if(i===0){check('first page uses exact name and five-step flow',await page.locator('h1').innerText()==='Three-Dragon Ante'&&await page.locator('.tda-guide-flow li').count()===5);}
  if(i===1){check('ante payment and leader are separate large consequences',await page.locator('.tda-guide-results p').count()===2&&await page.locator('.tda-guide-results p').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>parseFloat(getComputedStyle(document.querySelector('.tda-guide-description')).fontSize)));
   check('ante includes tied-highest price and highest-untied leader example',(await page.locator('.tda-guide-results').innerText()).includes('including tied highest')&&(await page.locator('.tda-guide-tip').innerText()).includes('9, 9, 6'));
   check('public antes have an explicit lifetime',(await page.locator('.tda-guide-caption').innerText()).includes('until taken by an effect or the gambit ends'));
  }
  if(i===2)check('turn instructions retain ability conditions and no voluntary pass or buy',(await page.locator('.tda-guide-description').innerText()).includes('no greater than')&&(await page.locator('.tda-guide-tip').innerText()).includes('cannot pass or buy'));
  if(i===3)check('scoring distinguishes gambit from game end',(await page.locator('.tda-guide-description').innerText()).includes('everyone plays another round')&&(await page.locator('.tda-guide-tip').innerText()).includes('If anyone now has no gold'));
  await page.screenshot({path:join(shots,'en-'+(i+1)+'-1440.png')});
  if(i<3)await page.locator('.tda-guide-next').click();
 }
 await page.locator('.tda-guide-next').click();
 check('practice removes guide and calls only practice once',await page.evaluate(()=>calls.practice===1&&calls.close===0&&!document.querySelector('dialog')));
 check('practice leaves original focus available',await page.locator('#open').evaluate(e=>document.activeElement===e));
 await page.evaluate(()=>makeGuide('en'));await page.keyboard.press('ArrowRight');
 await page.locator('.tda-guide-next').focus();await page.evaluate(()=>guide.setLanguage('zh'));
 check('language updates in place preserving page and control focus',await page.evaluate(()=>document.querySelector('dialog').dataset.step==='1'&&document.querySelector('dialog').lang==='zh-CN'&&document.activeElement===document.querySelector('.tda-guide-next')&&document.querySelector('.tda-guide-next').textContent==='下一步'));
 check('language change updates glossary and direct consequences',(await page.locator('.tda-guide-glossary').innerText()).includes('并列')&&(await page.locator('.tda-guide-results').innerText()).includes('包含并列最高'));
 await page.keyboard.press('ArrowLeft');check('keyboard back returns to first page',await page.locator('dialog').getAttribute('data-step')==='0');
 check('Chinese first page has requested exact title and flow',await page.locator('h1').innerText()==='三龙牌'&&(await page.locator('.tda-guide-description').innerText()).startsWith('和多名玩家一起打牌。')&&(await page.locator('.tda-guide-flow li').allTextContents()).join('>')==='暗置放牌>同时翻出>结算效果>轮流出牌>循环直到轮次结束');
 await page.locator('.tda-guide-progress button').nth(2).click();check('progress navigation selects intended page',await page.locator('dialog').getAttribute('data-step')==='2');
 await page.keyboard.press('Escape');check('Escape closes once and restores launch focus',await page.evaluate(()=>calls.close===1&&!document.querySelector('dialog')&&document.activeElement.id==='open'));
 await page.evaluate(()=>makeGuide('en'));for(let i=0;i<18;i++){await page.keyboard.press('Tab');check('native focus trap '+i,await page.evaluate(()=>!!document.activeElement?.closest('dialog')));}
 await page.locator('.tda-guide-skip').click();check('Take a seat closes with no practice or rules action',await page.evaluate(()=>calls.close===2&&calls.practice===1&&!document.querySelector('dialog')));
 await page.evaluate(()=>makeGuide('zh','offscreen'));check('offscreen anchor is not shown as a real target',await page.locator('.tda-guide-table-anchor').isHidden());
 await page.evaluate(()=>guide.destroy());await page.evaluate(()=>{guide.destroy();guide.setLanguage('en')});
 const atDestroy=await page.evaluate(()=>({...calls}));await page.setViewportSize({width:1360,height:880});await page.waitForTimeout(50);
 check('destroy is idempotent with no callbacks or retained resize anchor calls',JSON.stringify(atDestroy)===JSON.stringify(await page.evaluate(()=>({...calls})))&&await page.locator('dialog').count()===0);
 await page.evaluate(()=>makeGuide('en','throw'));check('anchor failure keeps introduction usable',await page.locator('dialog').isVisible()&&await page.locator('.tda-guide-table-anchor').isHidden());
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));check('pagehide removes UI without business callback',await page.evaluate(()=>!document.querySelector('dialog')&&calls.close===2&&calls.practice===1));
 for(const [width,height,lang]of[[390,844,'zh'],[390,844,'en'],[740,390,'en']]){
  await page.setViewportSize({width,height});await page.evaluate(lang=>makeGuide(lang),lang);
  for(let i=0;i<4;i++){
   await page.locator('.tda-guide-progress button').nth(i).click();
   const metrics=await page.evaluate(()=>{const d=document.querySelector('dialog'),r=d.getBoundingClientRect(),n=document.querySelector('.tda-guide-next').getBoundingClientRect(),c=document.querySelector('.tda-guide-close').getBoundingClientRect();return{width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,nextBottom:n.bottom,nextRight:n.right,closeTop:c.top,scroll:d.scrollWidth,client:d.clientWidth};});
   check(lang+' '+width+' page '+i+' dialog and exit/actions stay in viewport',metrics.left>=0&&metrics.right<=width+1&&metrics.top>=0&&metrics.bottom<=height+1&&metrics.nextBottom<=height&&metrics.nextRight<=width&&metrics.closeTop>=0&&metrics.scroll<=metrics.client+1);
   const beforeGlossary=await page.locator('.tda-guide-glossary').boundingBox();await page.locator('.tda-guide-body').evaluate(e=>e.scrollTop=e.scrollHeight);
   const afterGlossary=await page.locator('.tda-guide-glossary').boundingBox();
   const brand=await page.locator('.tda-guide-brand').boundingBox();
   check(lang+' '+width+' page '+i+' glossary stays at top right while body scrolls',!!brand&&!!beforeGlossary&&!!afterGlossary&&beforeGlossary.y===afterGlossary.y&&afterGlossary.x>=brand.x+brand.width&&afterGlossary.y+afterGlossary.height<=height&&await page.locator('.tda-guide-glossary').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
   check(lang+' '+width+' page '+i+' complete rule text is scroll reachable',await page.locator('.tda-guide-tip').evaluate(e=>{const r=e.getBoundingClientRect(),b=document.querySelector('.tda-guide-body').getBoundingClientRect();return r.bottom<=b.bottom+1&&r.top>=b.top-1;}));
   await page.locator('.tda-guide-body').evaluate(e=>e.scrollTop=0);
   await page.screenshot({path:join(shots,lang+'-'+(i+1)+'-'+width+'.png')});
  }
  await page.evaluate(()=>guide.destroy());
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>makeGuide('en'));
 await page.locator('.tda-guide-art').dispatchEvent('pointerdown',{pointerId:9,pointerType:'touch',isPrimary:true,clientX:250,clientY:180});
 await page.locator('.tda-guide-art').dispatchEvent('pointerup',{pointerId:9,pointerType:'touch',isPrimary:true,clientX:120,clientY:190});
 check('touch horizontal swipe moves one page',await page.locator('dialog').getAttribute('data-step')==='1');
 await page.locator('.tda-guide-art').dispatchEvent('pointerdown',{pointerId:10,pointerType:'touch',isPrimary:true,clientX:250,clientY:180});
 await page.locator('.tda-guide-art').dispatchEvent('pointercancel',{pointerId:10});
 await page.locator('.tda-guide-art').dispatchEvent('pointerup',{pointerId:10,pointerType:'touch',isPrimary:true,clientX:100,clientY:185});
 check('cancelled touch cannot advance',await page.locator('dialog').getAttribute('data-step')==='1');
 await page.locator('.tda-guide-art').dispatchEvent('pointerdown',{pointerId:11,pointerType:'touch',isPrimary:true,clientX:250,clientY:150});
 await page.locator('.tda-guide-art').dispatchEvent('pointerup',{pointerId:11,pointerType:'touch',isPrimary:true,clientX:190,clientY:260});
 check('vertical reading gesture does not change pages',await page.locator('dialog').getAttribute('data-step')==='1');
 await page.emulateMedia({reducedMotion:'reduce'});check('reduced motion disables decorative animation',await page.locator('.tda-guide-hover-card').evaluate(e=>getComputedStyle(e).animationName==='none'));
 await page.locator('.tda-guide-close').click();check('visible close remains usable on touch-sized viewport',await page.locator('dialog').count()===0);
 check('no external request',requests.every(url=>url.startsWith('http://127.0.0.1:')));
 check('no runtime error',errors.length===0);assert.deepEqual(pins(),initialPins);
 writeFileSync(join(shots,'result.json'),JSON.stringify({scope:'Actual component DOM/CSS in Edge; no room, network actions, storage or gameplay simulation',sourcePins:initialPins,passed:checks.length,checks,errors,requests},null,2)+'\n');
 console.log(JSON.stringify({passed:checks.length,errors,shots}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
