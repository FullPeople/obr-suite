#!/usr/bin/env node
// Actual stat/resource DOM and SDK draft callbacks, with delayed mock transport.
import {build} from 'rolldown';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE??'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const outputRoot=resolve(tmpdir()),out=mkdtempSync(join(outputRoot,'suite-resource-ui-'));
const shots=resolve('../_audit/2026-09-08/resource-ui');mkdirSync(shots,{recursive:true});
const mutations=[
  {name:'HP callback ignores unmount',file:'/utils/statEdit.ts',from:'if (shouldApply && !shouldApply(d)) continue;',to:'/* unguarded HP write */'},
  {name:'resource callback ignores target invalidation',file:'/modules/resourceTracker/storage.ts',from:'if (!d || (shouldApply && !shouldApply(d))) return;',to:'if (!d) return;'},
  {name:'shared numeric draft ignores role revision',file:'/modules/resourceTracker/interaction.ts',from:'revision === own && ',to:''},
  {name:'resource value change drops legacy markers',file:'/modules/resourceTracker/storage.ts',from:'arr[i] = { ...arr[i], ...upd };',to:'arr[i] = upd;'},
  {name:'language switch destroys HP draft',file:'/utils/statBanner.ts',from:'const langUnsub = onLangChange(localize);',to:'const langUnsub = onLangChange(() => render(live));'},
  {name:'resource echo destroys expression draft',file:'/modules/resourceTracker/panel.ts',from:'if (val && !val.querySelector("input"))',to:'if (val)'},
  {name:'late resource read paints old token',file:'/modules/resourceTracker/panel.ts',from:'if (!target.current() || own !== readRevision) return;',to:'/* accepts stale resource read */'},
  {name:'editor allows remote commands',file:'/modules/resourceTracker/index.ts',from:'message.connectionId === connectionId',to:'true'},
  {name:'editor accepts messages from an obsolete form',file:'/modules/resourceTracker/index.ts',from:'data.session !== target.session || ',to:''},
  {name:'closed iframe permits delayed editor write',file:'/modules/resourceTracker/index.ts',from:'editSessionOpen(value.session)',to:'true'},
  {name:'numeric controls assume ready before first scene read',file:'/modules/resourceTracker/interaction.ts',from:'sceneRevision = 0, ready = false',to:'sceneRevision = 0, ready = true'},
  {name:'role event discards unrelated scene readiness read',file:'/modules/resourceTracker/interaction.ts',from:'initialScene !== sceneRevision',to:'initialScene !== revision'},
  {name:'room tabs share a single resource editor lifetime',file:'/modules/resourceTracker/session.ts',from:'`${EDIT_SESSION_KEY}:${session}`',to:'EDIT_SESSION_KEY'},
];
let browser,server;
try {
  server=createServer((request,response)=>{
    const url=new URL(request.url,'http://localhost');
    if(url.pathname.endsWith('.js')){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(readFileSync(join(out,url.pathname.slice(1))));}
    else if(url.pathname==='/editor'){response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});response.end(readFileSync('resource-edit.html','utf8').replace('/src/modules/resourceTracker/edit-page.ts','/editor.js'));}
    else {response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});response.end(`<html><body style="margin:12px;background:#17233d;color:#eee;font-family:Arial"><div id="stats"></div><div id="resources"></div><script type="module" src="/${url.searchParams.get('bundle')}.js"></script></body></html>`);}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,channel:'msedge'});
  function plugin(mutation){let changed=!mutation;return {
    name:'resource-ui-boundaries',
    resolveId(id){if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/resource-ui-sdk.ts');if(/^(\.\.\/)+state$/.test(id))return resolve('tools/fixtures/search-locale-state.ts');},
    transform(code,id){const path=id.replaceAll('\\','/');if(path.endsWith('/asset-base.ts'))code=code.replaceAll('import.meta.env.BASE_URL','"/"');if(mutation&&path.endsWith(mutation.file)){assert.ok(code.includes(mutation.from),`Mutation missing: ${mutation.name}`);code=code.replaceAll(mutation.from,mutation.to);changed=true;}return code;},
    buildEnd(){assert.ok(changed);},
  };}
  await build({input:resolve('src/modules/resourceTracker/edit-page.ts'),platform:'browser',plugins:[plugin(null)],output:{dir:out,entryFileNames:'editor.js',format:'esm'}});
  const resource={id:'slots',name:'自制法术槽',type:'number',current:2,max:6,icon:'gem',legacyId:'auto-',extra:'keep'};
  const item=(id,hp=10,rs=[resource])=>({id,name:id,createdUserId:'another',metadata:{'com.obr-suite/bubbles/data':{health:hp,'max health':40,'temporary health':0,'armor class':15,locked:true},'com.owlbear-rodeo-bubbles-extension/metadata':{health:hp,'max health':40,'name plate':true,name:'Custom'},'com.obr-suite/resources/data':rs}});
  for(const [index,mutation] of [null,...(process.argv.includes('--mutations')?mutations:[])].entries()){
    const name=`resources-${index}`;
    await build({input:resolve('tools/resource-ui-selftest.entry.ts'),platform:'browser',plugins:[plugin(mutation)],output:{dir:out,entryFileNames:`${name}.js`,format:'esm'}});
    const context=await browser.newContext({viewport:{width:420,height:570}});const page=await context.newPage(),errors=[];page.on('pageerror',error=>{errors.push(error.message);if(!mutation)console.error('BROWSER',error.message);});
    await page.goto(`${base}/?bundle=${name}`);await page.waitForFunction(()=>window.__resources&&window.__searchState);
    let passed=0,failed;
    const test=async(title,fn)=>{try{await fn();passed++;if(!mutation)console.log(`PASS ${title}`);}catch(error){error.testTitle=title;throw error;}};
    const setup=async(options={})=>{
      await page.evaluate(async options=>{
        window.__stat?.unmount();window.__panel?.unmount();await window.__resources.teardownResourceTracker();
        window.__resourceSdk.items=new Map(options.items.map(item=>[item.id,item]));window.__resourceSdk.writes=0;window.__resourceSdk.callbacks=0;window.__resourceSdk.reads={};window.__resourceSdk.writeDelay=0;window.__resourceSdk.failWrite=false;window.__resourceSdk.notifications=[];
        window.__resourceSdk.readyReadDelay=options.readyReadDelay??0;
        await window.__resourceFixture.scene(options.ready??true);await window.__resourceFixture.changeRole(options.role??'GM');
        window.__searchState.setLanguage(options.lang??'en');window.__resourceFixture.opened=[];window.__resourceFixture.closed=[];window.__resourceFixture.sent=[];window.__resourceFixture.open=null;localStorage.clear();window.__target='one';
        window.__stat=window.__resources.mountStatBanner({container:document.getElementById('stats'),getItemId:()=>window.__target,isGM:true,initialLive:options.items[0].metadata['com.obr-suite/bubbles/data']});
        window.__panel=window.__resources.mountResourcePanel({container:document.getElementById('resources'),getItemId:()=>window.__target});
        await new Promise(done=>setTimeout(done,10));await Promise.all([window.__stat.refresh(),window.__panel.refresh()]);
      },{items:[item('one'),item('two',31,[{...resource,current:5,name:'Second resource'}])],...options});
    };
    const hp=()=>page.locator('input[data-field="health"]');
    const writes=()=>page.evaluate(()=>window.__resourceSdk.writes);
    const value=(id='one')=>page.evaluate(id=>window.__resourceSdk.items.get(id),id);
    const editHp=async text=>{await hp().focus();await page.waitForTimeout(25);await hp().fill(text);await hp().blur();};
    const beginEditor=async()=>page.evaluate(async()=>{
      await window.__resources.setupResourceTracker();await window.__resourceFixture.emit('com.obr-suite/resources/edit-open',{itemId:'one',resource:window.__resourceSdk.items.get('one').metadata['com.obr-suite/resources/data'][0]});
      await new Promise(done=>setTimeout(done,20));const opened=window.__resourceFixture.opened.findLast(modal=>modal.id==='com.obr-suite/resources/edit-modal');
      const payload=JSON.parse(decodeURIComponent(new URL(opened.url).hash.slice(1)));window.__editor=payload;window.__resources.markEditSession(payload.session);return payload;
    });
    try{
      await test('HP language updates labels in place and retains focused draft',async()=>{
        await setup();await hp().focus();await page.waitForTimeout(25);await hp().fill('+7');await page.evaluate(()=>{window.__savedInput=document.querySelector('input[data-field="health"]');window.__searchState.setLanguage('zh');});
        assert.equal(await hp().inputValue(),'+7');assert.equal(await hp().getAttribute('aria-label'),'生命值');assert.equal(await page.evaluate(()=>window.__savedInput===document.activeElement),true);await hp().blur();await page.waitForTimeout(20);assert.equal((await value()).metadata['com.obr-suite/bubbles/data'].health,17);
      });
      await test('HP writes preserve clamp and both metadata namespaces',async()=>{
        await setup();await editHp('99');await page.waitForTimeout(20);let result=await value();assert.equal(result.metadata['com.obr-suite/bubbles/data'].health,40);assert.equal(result.metadata['com.owlbear-rodeo-bubbles-extension/metadata']['name plate'],true);
        await page.locator('input[data-field="max health"]').focus();await page.waitForTimeout(25);await page.locator('input[data-field="max health"]').fill('12');await page.locator('input[data-field="max health"]').blur();await page.waitForTimeout(20);result=await value();assert.equal(result.metadata['com.obr-suite/bubbles/data'].health,12);assert.equal(result.metadata['com.owlbear-rodeo-bubbles-extension/metadata'].health,12);
      });
      await test('unmount cancels HP inside delayed SDK draft callback',async()=>{
        await setup();await page.evaluate(()=>window.__resourceSdk.writeDelay=100);await editHp('18');await page.evaluate(()=>window.__stat.unmount());await page.waitForTimeout(130);assert.equal(await writes(),0);assert.equal((await value()).metadata['com.obr-suite/bubbles/data'].health,10);
      });
      await test('target change between focus and blur never redirects HP',async()=>{
        await setup();await hp().focus();await page.waitForTimeout(25);await hp().fill('22');await page.evaluate(()=>window.__target='two');await hp().blur();await page.waitForTimeout(20);assert.equal(await writes(),0);
      });
      await test('role revocation cancels pending lock without tightening numeric player access',async()=>{
        await setup();await page.evaluate(()=>window.__resourceSdk.writeDelay=100);await page.locator('.stat-lock').click();await page.evaluate(()=>window.__resourceFixture.changeRole('PLAYER'));await page.waitForTimeout(130);assert.equal(await writes(),0);assert.equal(await page.locator('.stat-lock').isVisible(),false);await page.evaluate(()=>window.__resourceSdk.writeDelay=0);await editHp('14');await page.waitForTimeout(20);assert.equal((await value()).metadata['com.obr-suite/bubbles/data'].health,14);
      });
      await test('numeric HP write started before role change is cancelled inside its draft',async()=>{
        await setup();await page.evaluate(()=>window.__resourceSdk.writeDelay=100);await editHp('19');await page.evaluate(()=>window.__resourceFixture.changeRole('PLAYER'));await page.waitForTimeout(130);assert.equal(await writes(),0);
      });
      await test('numeric inputs wait for scene readiness independently of role changes',async()=>{
        await setup({ready:false,readyReadDelay:130});
        assert.equal(await hp().isDisabled(),true);
        await page.evaluate(()=>window.__resourceFixture.changeRole('PLAYER'));
        await page.waitForTimeout(150);assert.equal(await hp().isDisabled(),true);assert.equal(await writes(),0);
        await page.evaluate(()=>window.__resourceFixture.scene(true));
        await page.waitForTimeout(25);assert.equal(await hp().isEnabled(),true);
        await editHp('13');await page.waitForTimeout(25);assert.equal((await value()).metadata['com.obr-suite/bubbles/data'].health,13);
        await setup({ready:true,readyReadDelay:130});
        await page.evaluate(()=>window.__resourceFixture.changeRole('PLAYER'));
        await page.waitForTimeout(150);assert.equal(await hp().isEnabled(),true);
      });
      await test('resource language and external echo preserve inline expression draft',async()=>{
        await setup();await page.locator('[data-num-val]').click();await page.locator('.rt-value-input').fill('max/2');await page.evaluate(()=>{window.__resourceDraft=document.querySelector('.rt-value-input');window.__searchState.setLanguage('zh');window.__resourceSdk.items.get('one').metadata['com.obr-suite/resources/data'][0].current=4;window.__resourceSdk.emitItems();});await page.waitForTimeout(20);
        assert.equal(await page.evaluate(()=>document.querySelector('.rt-value-input')?.value??null),'max/2');assert.equal(await page.evaluate(()=>window.__resourceDraft===document.activeElement),true);assert.equal(await page.locator('.rt-add').innerText(),'＋ 新增资源');await page.locator('.rt-value-input').press('Enter');await page.waitForTimeout(20);assert.equal((await value()).metadata['com.obr-suite/resources/data'][0].current,3);
      });
      await test('resource numeric edits retain legacy markers and concurrent fields',async()=>{
        await setup();await page.evaluate(()=>window.__resourceSdk.writeDelay=80);await page.locator('.rt-num-plus').click();await page.evaluate(()=>window.__resourceSdk.items.get('one').metadata['com.obr-suite/resources/data'][0].max=8);await page.waitForTimeout(110);const result=(await value()).metadata['com.obr-suite/resources/data'][0];assert.equal(result.current,3);assert.equal(result.max,8);assert.equal(result.legacyId,'auto-');assert.equal(result.extra,'keep');
      });
      await test('resource callback cancels after target switch and sends no false toast',async()=>{
        await setup();await page.evaluate(()=>window.__resourceSdk.writeDelay=100);await page.locator('.rt-num-plus').click();await page.evaluate(()=>window.__target='two');await page.waitForTimeout(130);assert.equal(await writes(),0);assert.equal(await page.evaluate(()=>window.__resourceFixture.sent.filter(message=>message.channel.endsWith('/changed')).length),0);
      });
      await test('resource callback cancels on unmount and failed writes announce nothing',async()=>{
        await setup();await page.evaluate(()=>window.__resourceSdk.writeDelay=100);await page.locator('.rt-num-plus').click();await page.evaluate(()=>window.__panel.unmount());await page.waitForTimeout(130);assert.equal(await writes(),0);
        await setup();await page.evaluate(()=>window.__resourceSdk.failWrite=true);await page.locator('.rt-num-plus').click();await page.waitForTimeout(30);assert.equal(await writes(),0);assert.equal(await page.locator('[data-num-val]').innerText(),'2');assert.equal(await page.evaluate(()=>window.__resourceFixture.sent.filter(message=>message.channel.endsWith('/changed')).length),0);
      });
      await test('old resource response cannot repaint newer token and callbacks bind the new id',async()=>{
        await setup();await page.evaluate(()=>{window.__resourceSdk.reads.one=100;void window.__panel.refresh();window.__target='two';void window.__panel.refresh();});await page.waitForTimeout(140);assert.equal(await page.locator('.rt-row-name').innerText(),'Second resource');await page.locator('.rt-num-minus').click();await page.waitForTimeout(20);assert.equal((await value('two')).metadata['com.obr-suite/resources/data'][0].current,4);assert.equal((await value()).metadata['com.obr-suite/resources/data'][0].current,2);
      });
      await test('reorder preserves concurrently edited values and new resources',async()=>{
        await setup({items:[item('one',10,[resource,{...resource,id:'b',name:'Second',current:4}]),item('two')]});const result=await page.evaluate(async()=>{window.__resourceSdk.writeDelay=50;const operation=window.__resources.reorderResources('one',['b','slots'],()=>true);window.__resourceSdk.items.get('one').metadata['com.obr-suite/resources/data'][0].current=1;window.__resourceSdk.items.get('one').metadata['com.obr-suite/resources/data'].push({id:'new',name:'Added',type:'number',current:9,max:9,icon:'starFive'});await operation;return window.__resourceSdk.items.get('one').metadata['com.obr-suite/resources/data'];});assert.deepEqual(result.map(resource=>resource.id),['b','slots','new']);assert.equal(result[1].current,1);assert.equal(result[1].legacyId,'auto-');
      });
      await test('count pips retain position-aware consume and right-click refill',async()=>{
        await setup({items:[item('one',10,[{...resource,type:'count',current:6}]),item('two')]});const pip=page.locator('[data-pos="5"]');await pip.click();await page.waitForTimeout(10);assert.equal((await value()).metadata['com.obr-suite/resources/data'][0].current,5);await pip.click();await page.waitForTimeout(10);assert.equal((await value()).metadata['com.obr-suite/resources/data'][0].current,4);await pip.click({button:'right'});await page.waitForTimeout(10);assert.equal((await value()).metadata['com.obr-suite/resources/data'][0].current,6);
      });
      await test('bar drag persists once on release and pointer cancellation persists nothing',async()=>{
        await setup({items:[item('one',10,[{...resource,type:'bar',current:2,max:10}]),item('two')]});let bounds=await page.locator('.rt-bar').boundingBox();await page.mouse.move(bounds.x+2,bounds.y+10);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.8,bounds.y+10,{steps:4});assert.equal(await writes(),0);await page.mouse.up();await page.waitForTimeout(20);assert.equal(await writes(),1);assert.equal((await value()).metadata['com.obr-suite/resources/data'][0].current,8);
        await setup({items:[item('one',10,[{...resource,type:'bar',current:2,max:10}]),item('two')]});bounds=await page.locator('.rt-bar').boundingBox();await page.mouse.move(bounds.x+bounds.width*.8,bounds.y+10);await page.mouse.down();await page.locator('.rt-bar').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();await page.waitForTimeout(20);assert.equal(await writes(),0);assert.equal(await page.locator('[data-bar-num]').innerText(),'2 / 10');
      });
      await test('remote messages cannot open or save a local resource editor',async()=>{
        await setup();await page.evaluate(async()=>{await window.__resources.setupResourceTracker();await window.__resourceFixture.emit('com.obr-suite/resources/edit-open',{itemId:'one'},'remote-client');});await page.waitForTimeout(20);assert.equal(await page.evaluate(()=>window.__resourceFixture.opened.filter(modal=>modal.id.endsWith('/edit-modal')).length),0);
        const editor=await beginEditor();await page.evaluate(async editor=>window.__resourceFixture.emit('com.obr-suite/resources/edit-save',{...editor,resource:{...editor.resource,current:5}},'remote-client'),editor);await page.waitForTimeout(20);assert.equal(await writes(),0);
      });
      await test('stale editor session cannot update current form on the same token',async()=>{
        await setup();const editor=await beginEditor();await page.evaluate(async editor=>window.__resourceFixture.emit('com.obr-suite/resources/edit-save',{...editor,session:'obsolete',resource:{...editor.resource,current:5}}),editor);await page.waitForTimeout(20);assert.equal(await writes(),0);
      });
      await test('resource editors in different room tabs retain independent lifetimes',async()=>{
        await setup();const editor=await beginEditor();
        const other=await context.newPage();
        await other.goto(`${base}/editor#${encodeURIComponent(JSON.stringify({...editor,session:'another-room-session'}))}`);
        await other.waitForSelector('.icon-pick');
        assert.equal(await page.evaluate(session=>window.__resources.editSessionOpen(session),editor.session),true);
        await other.close();
        assert.equal(await page.evaluate(session=>window.__resources.editSessionOpen(session),editor.session),true);
        await page.evaluate(async editor=>window.__resourceFixture.emit('com.obr-suite/resources/edit-save',{...editor,resource:{...editor.resource,current:4}}),editor);
        await page.waitForTimeout(20);assert.equal(await writes(),1);
      });
      await test('iframe close clears lease before a delayed editor write callback',async()=>{
        await setup();const editor=await beginEditor();const form=await page.context().newPage();await form.goto(`${base}/editor#${encodeURIComponent(JSON.stringify(editor))}`);await form.waitForSelector('.icon-pick');await page.evaluate(async editor=>{window.__resourceSdk.writeDelay=140;void window.__resourceFixture.emit('com.obr-suite/resources/edit-save',{...editor,resource:{...editor.resource,current:5}});await new Promise(done=>setTimeout(done,10));},editor);await form.close();await page.waitForTimeout(170);assert.equal(await writes(),0);
      });
      await test('duplicate save is atomic and deleted resource is never resurrected',async()=>{
        await setup();const editor=await beginEditor();await page.evaluate(async editor=>{window.__resourceSdk.writeDelay=70;const payload={...editor,resource:{...editor.resource,current:5}};void window.__resourceFixture.emit('com.obr-suite/resources/edit-save',payload);void window.__resourceFixture.emit('com.obr-suite/resources/edit-save',payload);},editor);await page.waitForTimeout(110);assert.equal(await writes(),1);
        await setup();const second=await beginEditor();await page.evaluate(async editor=>{window.__resourceSdk.items.get('one').metadata['com.obr-suite/resources/data']=[];await window.__resourceFixture.emit('com.obr-suite/resources/edit-save',{...editor,resource:{...editor.resource,current:5}});},second);await page.waitForTimeout(20);assert.deepEqual((await value()).metadata['com.obr-suite/resources/data'],[]);assert.equal(await writes(),0);
      });
      await test('scene close and role change cancel pending editor writes',async()=>{
        for(const mode of ['scene','role']){await setup();const editor=await beginEditor();await page.evaluate(async({editor,mode})=>{window.__resourceSdk.writeDelay=100;void window.__resourceFixture.emit('com.obr-suite/resources/edit-save',{...editor,resource:{...editor.resource,current:5}});await new Promise(done=>setTimeout(done,10));if(mode==='scene')await window.__resourceFixture.scene(false);else await window.__resourceFixture.changeRole('PLAYER');},{editor,mode});await page.waitForTimeout(130);assert.equal(await writes(),0);}
      });
      await test('teardown closes delayed modal opens and retires all module tools',async()=>{
        await setup();const result=await page.evaluate(async()=>{window.__resourceFixture.open=async()=>new Promise(done=>setTimeout(done,70));const start=window.__resources.setupResourceTracker();await new Promise(done=>setTimeout(done,10));const stop=window.__resources.teardownResourceTracker();await Promise.all([start,stop]);return {modals:[...window.__resourceSdk.modals.keys()],tools:[...window.__resourceSdk.tools.keys()]};});assert.deepEqual(result,{modals:[],tools:[]});
      });
      if(!mutation){
        await setup();await page.screenshot({path:join(shots,'english-stats-resources.png')});await page.evaluate(()=>window.__searchState.setLanguage('zh'));await page.screenshot({path:join(shots,'chinese-stats-resources.png')});
        await test('actual editor translates every icon and keeps name/value drafts on language change',async()=>{
          const editor=await browser.newPage({viewport:{width:420,height:720}});await editor.goto(`${base}/editor#${encodeURIComponent(JSON.stringify({itemId:'one',session:'editor-test',resource}))}`);await editor.waitForSelector('.icon-pick');await editor.locator('#name').fill('我的资源 draft');await editor.locator('#current').fill('4');await editor.locator('#name').focus();await editor.evaluate(()=>{window.__nameInput=document.getElementById('name');window.__searchState.setLanguage('en');});assert.equal(await editor.locator('#name').inputValue(),'我的资源 draft');assert.equal(await editor.locator('#current').inputValue(),'4');assert.equal(await editor.locator('[data-icon-id="gem"]').getAttribute('title'),'Gem');assert.equal(await editor.locator('[data-icon-id="spellbook"]').getAttribute('title'),'Spellbook');assert.equal(await editor.evaluate(()=>window.__nameInput===document.activeElement),true);await editor.screenshot({path:join(shots,'english-resource-editor.png')});await editor.evaluate(()=>window.__searchState.setLanguage('zh'));assert.equal(await editor.locator('[data-icon-id="gem"]').getAttribute('title'),'宝石');await editor.screenshot({path:join(shots,'chinese-resource-editor.png')});await editor.close();
        });
      }
      assert.deepEqual(errors,[]);
    }catch(error){failed=error;}
    await context.close();
    if(!mutation){if(failed)throw failed;console.log(`RESOURCE_UI ${passed}/${passed}`);}else{if(!failed)throw Error(`SURVIVED ${mutation.name}`);if(failed.code!=='ERR_ASSERTION')throw failed;console.log(`KILLED ${mutation.name} by ${failed.testTitle}`);}
  }
}finally{await browser?.close();await new Promise(done=>server?server.close(done):done());if(dirname(out)!==outputRoot)throw Error('Unsafe temp path');rmSync(out,{recursive:true,force:true});}
