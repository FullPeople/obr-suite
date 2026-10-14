import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {chromium} from '@playwright/test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const out = resolve('workbench-test-output/runtime-browser');
await mkdir(out, {recursive: true});
const backgroundPath = resolve('src/workbench/background.ts');
const source = await readFile(backgroundPath, 'utf8');
const hook = "Object.assign(window,{probe:{observation,hydrate,activate(){child=window.parent;},request(m:any){return receive({...m,protocol,session});}}});";
const profiled = source.replace('setInterval(()=>{changed();scheduleInventoryRepair();},4000);', hook);
assert.notEqual(profiled, source, 'production fixture hook must match');
const file = resolve(out, 'fixture.js');
await build({input: 'virtual:fixture', plugins: [{
  name: 'runtime-browser-fixture',
  resolveId(id) {
    if (id === 'virtual:fixture') return id;
    if (['./state','../state','../../state','../modules/bestiary/data'].includes(id))
      return resolve('tools/fixtures/workbench-modules.ts');
  },
  load(id) {
    if (id === 'virtual:fixture') return [
      "import OBR from '@owlbear-rodeo/sdk';",
      "import {setupWorkbench} from " + JSON.stringify(backgroundPath) + ";",
      "import {setupBubbles} from " + JSON.stringify(resolve('src/modules/bubbles/index.ts')) + ";",
      "window.wbMock={metadata:{},settings:{},emit(){}};",
      "window.fixtureModuleReady=true;window.startWorkbench=setupWorkbench;OBR.onReady(async()=>{try{await setupBubbles();window.fixtureReady=true;}catch(e){window.fixtureError=String(e);}});",
    ].join('\n');
  },
  transform(code, id) {
    if (id.replaceAll('\\','/').endsWith('/src/workbench/background.ts')) code = profiled;
    return code.replaceAll('import.meta.env.BASE_URL', JSON.stringify('/suite-dev/'))
      .replaceAll('import.meta.env.DEV','false');
  },
}], output: {file, format: 'esm', codeSplitting: false}});

const runtime = {stats: {health: 20, 'max health': 30, 'temporary health': 0, 'armor class': 15},
  resources: {}, conditions: []};
const metadata = {'com.character-cards/boundCardId': 'hero', 'com.obr-suite/bubbles/data': runtime.stats,
  'com.obr-suite/resources/data': [], 'com.obr-suite/workbench/runtime-baseline':
    {version: 1, cardId: 'hero', revision: 1, value: runtime}};
const card = {id: 'hero', name: 'Synthetic hero', owner_ids: ['me'], visibility: 'public', locked: false};
const item = {id: 'one', name: 'Synthetic hero', type: 'IMAGE', layer: 'CHARACTER', createdUserId: 'me',
  visible: true, locked: false, position: {x: 300, y: 300}, rotation: 0, scale: {x: 1,y: 1},
  image: {url: 'https://example.test/token.png', width: 150, height: 150, mime: 'image/png'},
  grid: {dpi: 150, offset: {x: 75,y: 75}}, text: {plainText: ''}, metadata};
const scene = {'com.character-cards/list': [card],
  'com.obr-suite/bubbles/settings': {autoScaleText: false}};
const room = {'com.obr-suite/workbench/cards': [card],
  'com.obr-suite/workbench/owner-roles': {me: 'GM'}};
const parent = `
window.items=${JSON.stringify([item])};window.scene=${JSON.stringify(scene)};window.room=${JSON.stringify(room)};
window.localItems=[];window.results=[];window.rpc=[];window.draws=[];window.heldDraws=[];window.heldReplies=[];
window.holdDraw=false;window.holdReply=false;window.failMetadata=false;window.dropNextItemsEvent=false;
window.emitItems=()=>{if(dropNextItemsEvent){dropNextItemsEvent=false;return;}document.querySelector('iframe').contentWindow.postMessage({id:'OBR_SCENE_ITEMS_EVENT_CHANGE',data:{items}},location.origin);};
window.addEventListener('message',event=>{
 const m=event.data;
 if(m.protocol==='full-suite-workbench/v1'){results.push({...m,at:performance.now()});return;}
 if(!m.id||!m.nonce)return;
 rpc.push({id:m.id,at:performance.now()});const d=m.data;let value={};
 const respond=()=>event.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:value},event.origin);
 switch(m.id){
 case 'OBR_PLAYER_GET_ID':value={id:'me'};break;
 case 'OBR_PLAYER_GET_CONNECTION_ID':value={connectionId:'local'};break;
 case 'OBR_PLAYER_GET_ROLE':value={role:'GM'};break;
 case 'OBR_PLAYER_GET_NAME':value={name:'Synthetic DM'};break;
 case 'OBR_PLAYER_GET_COLOR':value={color:'#50525B'};break;
 case 'OBR_PLAYER_GET_SELECTION':value={selection:['one']};break;
 case 'OBR_PLAYER_GET_METADATA':value={metadata:{}};break;
 case 'OBR_PARTY_GET_PLAYERS':value={players:[]};break;
 case 'OBR_SCENE_IS_READY':value={ready:true};break;
 case 'OBR_SCENE_GET_METADATA':value={metadata:scene};break;
 case 'OBR_ROOM_GET_METADATA':value={metadata:room};break;
 case 'OBR_SCENE_GRID_GET_DPI':value={dpi:150};break;
 case 'OBR_SCENE_ITEMS_GET_ALL_ITEMS':value={items};break;
 case 'OBR_SCENE_ITEMS_GET_ITEMS':value={items:items.filter(i=>d.ids.includes(i.id))};break;
 case 'OBR_SCENE_LOCAL_GET_ALL_ITEMS':value={items:localItems};break;
 case 'OBR_SCENE_LOCAL_GET_ITEMS':value={items:localItems.filter(i=>d.ids.includes(i.id))};break;
 case 'OBR_SCENE_ITEMS_UPDATE_ITEMS':{
   if(failMetadata){event.source.postMessage({id:m.id+'_ERROR'+m.nonce,data:{message:'fixture SDK rejection'}},event.origin);return;}
   for(const u of d.updates)Object.assign(items.find(i=>i.id===u.id),u);emitItems();
   if(holdReply){heldReplies.push(respond);return;}break;
 }
 case 'OBR_SCENE_LOCAL_ADD_ITEMS':{
   const apply=()=>{localItems.push(...d.items);draws.push({at:performance.now(),items:d.items});respond();};
   if(holdDraw){holdDraw=false;heldDraws.push(apply);return;}apply();return;
 }
 case 'OBR_SCENE_LOCAL_DELETE_ITEMS':localItems=localItems.filter(i=>!d.ids.includes(i.id));break;
 case 'OBR_SCENE_LOCAL_UPDATE_ITEMS':for(const u of d.updates)Object.assign(localItems.find(i=>i.id===u.id),u);break;
 case 'OBR_SCENE_SET_METADATA':Object.assign(scene,d.update);event.source.postMessage({id:'OBR_SCENE_METADATA_EVENT_CHANGE',data:{metadata:scene}},event.origin);break;
 case 'OBR_ROOM_SET_METADATA':Object.assign(room,d.update);event.source.postMessage({id:'OBR_ROOM_METADATA_EVENT_CHANGE',data:{metadata:room}},event.origin);break;
 case 'OBR_VIEWPORT_GET_WIDTH':value={width:1200};break;
 case 'OBR_VIEWPORT_GET_HEIGHT':value={height:900};break;
 case 'OBR_BROADCAST_SEND_MESSAGE':
   event.source.postMessage({id:'OBR_BROADCAST_MESSAGE_'+d.channel,data:{connectionId:'local',data:d.data}},event.origin);break;
 }respond();
});
`;
let doc = {schema_version: '0.3', _suiteRevision: 1, identity: {character_name: 'Synthetic hero'},
  abilities: Object.fromEntries(['str','dex','con','int','wis','cha'].map(key=>[key,{total:10,modifier:0,save:{bonus:0}}])),
  core_stats: {hp: {current:20,max:30,temp:0}, ac:15}, inventory:{}, features:{}, background:{}, classes:[]};
let saves = 0;
const shared = new Map();
const server = createServer(async (req,res) => {
 try {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Type','application/json');
  if(url.pathname==='/') {
    res.setHeader('Content-Type','text/html');
    const host='http://127.0.0.1:'+server.address().port;
    res.end('<script>'+parent+'</script><iframe src="/child?obrref='+Buffer.from(host+' synthetic-room').toString('base64')+'"></iframe>');return;
  }
  if(url.pathname==='/child'){res.setHeader('Content-Type','text/html');res.end('<script type="module" src="/fixture.js"></script>');return;}
  if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(file));return;}
  if(url.pathname.startsWith('/characters/')){res.end(JSON.stringify(doc));return;}
  if(url.pathname==='/suite-dev/relay'){
    if(req.method==='GET'){res.end('[]');return;}
    const parts=[];for await(const part of req)parts.push(part);let bytes=Buffer.concat(parts);
    if(req.headers['content-encoding']==='gzip')bytes=(await import('node:zlib')).gunzipSync(bytes);
    const body=JSON.parse(bytes);
    if(body.saveCard){
      const request=body.saveCard;
      if(createHash('sha256').update(JSON.stringify(doc)).digest('hex')!==request.expected){res.writeHead(409);res.end('{"error":"conflict"}');return;}
      for(const change of request.changes){let target=doc;for(const key of change.path.slice(0,-1))target=target[key]??={};const key=change.path.at(-1);if(change.remove)delete target[key];else target[key]=change.after;}
      saves++;
    }
    if(body.sharedDocument){const m=body.sharedDocument,old=shared.get(m.key)||{revision:0,data:null};if(m.operation==='write')shared.set(m.key,{revision:old.revision+1,data:m.data});res.end(JSON.stringify(shared.get(m.key)||old));return;}
    res.end('{}');return;
  }
  res.writeHead(404);res.end('{}');
 } catch(error) {res.writeHead(500);res.end(JSON.stringify({error:String(error)}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const executablePath=process.env.WORKBENCH_BROWSER_PATH||(process.platform==='win32'?['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync):undefined);
const browser=await chromium.launch({executablePath,headless:true});
const page=await browser.newPage();
const errors=[];page.on('pageerror',error=>errors.push(String(error)));
const reports=[];
try {
 await page.goto('http://127.0.0.1:'+server.address().port);
 const frame=()=>page.frames().find(frame=>frame.url().includes('/child'));
 await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow?.fixtureModuleReady);
 await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({id:'OBR_READY',data:{ref:'fixture',userId:'me'}},location.origin));
 await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow?.fixtureReady);
 await page.waitForFunction(()=>localItems.some(item=>item.metadata?.['com.obr-suite/bubbles/role']==='hp-text'));
 // A callback-only update must redraw without a new items/grid/scene read.
 const counters=await page.evaluate(()=>rpc.length);
 await page.evaluate(()=>{items[0].metadata['com.obr-suite/bubbles/data'].health=19;emitItems();});
 await page.waitForFunction(()=>draws.some(draw=>JSON.stringify(draw.items).includes('19/30')));
 const readIds=['OBR_SCENE_ITEMS_GET_ALL_ITEMS','OBR_SCENE_ITEMS_GET_ITEMS','OBR_SCENE_GRID_GET_DPI','OBR_SCENE_GET_METADATA'];
 const extraReads=await page.evaluate(({counters,readIds})=>rpc.slice(counters).filter(m=>readIds.includes(m.id)),{counters,readIds});
 assert.deepEqual(extraReads,[]);
 reports.push('metadata change redraws the HP bar with zero additional scene/grid/metadata reads');
 // Restore the persisted value before starting the production workbench.
 await page.evaluate(()=>{items[0].metadata['com.obr-suite/bubbles/data'].health=20;emitItems();});
 await page.waitForTimeout(100);
 await frame().evaluate(async()=>{await window.startWorkbench();window.probe.activate();});
 const savedBefore=saves;
 await page.evaluate(()=>{holdDraw=true;});
 await frame().evaluate(()=>window.probe.request({requestId:'view-one',type:'stats',itemId:'card:hero',patch:{health:18},expected:{health:20}}));
 await page.waitForFunction(()=>heldDraws.length>0);
 assert.equal(doc.core_stats.hp.current,18);
 assert.equal(await page.evaluate(()=>results.some(m=>m.type==='ack'&&m.requestId==='view-one')),false);
 const released=await page.evaluate(()=>{const time=performance.now();heldDraws.splice(0).forEach(fn=>fn());return time;});
 await page.waitForFunction(()=>results.some(m=>m.type==='ack'&&m.requestId==='view-one'));
 const first=await page.evaluate(()=>results.find(m=>m.type==='ack'&&m.requestId==='view-one'));
 assert.equal(first.ok,true);assert.equal(first.result.snapshot.state.projectionPending,false);
 assert.ok(first.at>=released);assert.equal(saves,savedBefore+1);
 reports.push('saved data does not produce a complete receipt before the local HP renderer finishes');
 // Hold both SDK responses after their metadata events: later projections must still proceed.
 await page.evaluate(()=>{holdReply=true;});
 await frame().evaluate(()=>window.probe.request({requestId:'view-two',type:'stats',itemId:'card:hero',patch:{health:16},expected:{health:18}}));
 await page.waitForFunction(()=>results.some(m=>m.type==='ack'&&m.requestId==='view-two'));
 await frame().evaluate(()=>window.probe.request({requestId:'view-three',type:'stats',itemId:'card:hero',patch:{health:14},expected:{health:16}}));
 await page.waitForFunction(()=>results.some(m=>m.type==='ack'&&m.requestId==='view-three'));
 assert.equal(doc.core_stats.hp.current,14);
 assert.ok(await page.evaluate(()=>heldReplies.length>=2));
 assert.equal(await page.evaluate(()=>results.filter(m=>m.type==='ack'&&['view-two','view-three'].includes(m.requestId)).every(m=>m.ok&&!m.result.warning)),true);
 await page.evaluate(()=>{holdReply=false;heldReplies.splice(0).forEach(fn=>fn());});
 reports.push('metadata events release successive projection work even when SDK responses are delayed');
 // A failed scene projection must remain a successful durable save with a pending warning.
 const savesBeforeFailure=saves;
 await page.evaluate(()=>{failMetadata=true;});
 await frame().evaluate(()=>window.probe.request({requestId:'view-pending',type:'stats',itemId:'card:hero',patch:{health:12},expected:{health:14}}));
 await page.waitForFunction(()=>results.some(m=>m.type==='ack'&&m.requestId==='view-pending'));
 const pending=await page.evaluate(()=>results.find(m=>m.type==='ack'&&m.requestId==='view-pending'));
 assert.equal(pending.ok,true);assert.ok(pending.result.warning);assert.equal(pending.result.diagnostic.committed,true);
 assert.equal(pending.result.snapshot.state.projectionPending,true);assert.equal(doc.core_stats.hp.current,12);
 await page.evaluate(()=>{failMetadata=false;});
 await frame().evaluate(()=>window.probe.hydrate('hero'));
 await page.waitForFunction(()=>items[0].metadata['com.obr-suite/bubbles/data'].health===12&&draws.some(draw=>JSON.stringify(draw.items).includes('12/30')));
 assert.equal(saves,savesBeforeFailure+1);
 reports.push('a rejected SDK projection keeps the saved result pending and recovers without a second durable write');
 // A missed SDK change event can recover through the existing authoritative read cache.
 const savesBeforeRecovery=saves;
 await page.evaluate(()=>{dropNextItemsEvent=true;});
 await frame().evaluate(()=>window.probe.request({requestId:'view-missed-event',type:'stats',itemId:'card:hero',patch:{health:10},expected:{health:12}}));
 await page.waitForFunction(()=>items[0].metadata['com.obr-suite/bubbles/data'].health===10);
 await frame().evaluate(()=>window.probe.observation.refreshAuthority());
 await page.waitForFunction(()=>results.some(m=>m.type==='ack'&&m.requestId==='view-missed-event'));
 const recovered=await page.evaluate(()=>results.find(m=>m.type==='ack'&&m.requestId==='view-missed-event'));
 assert.equal(recovered.ok,true);assert.equal(recovered.result.snapshot.state.projectionPending,false);
 assert.equal(saves,savesBeforeRecovery+1);
 reports.push('an authoritative read repairs a missed metadata event and drives the renderer without replaying the save');
 // Native B edits retain their supported merge path, without a projection echo becoming another save.
 const savesBeforeNative=saves;
 await page.evaluate(()=>{items[0].metadata['com.obr-suite/bubbles/data'].health=9;emitItems();});
 await page.waitForFunction(()=>items[0].metadata['com.obr-suite/workbench/runtime-baseline'].value.stats.health===9);
 await page.waitForTimeout(100);
 assert.equal(doc.core_stats.hp.current,9);assert.equal(saves,savesBeforeNative+1);
 reports.push('a native token edit reaches the saved document once and its metadata projection does not echo-write');
 assert.deepEqual(errors,[]);
 await writeFile(resolve(out,'results.json'),JSON.stringify({realRoomVerified:false,reports,extraReads},null,2));
 for(const name of reports)console.log('PASS',name);
 console.log(JSON.stringify({realRoomVerified:false,passed:reports.length}));
} catch(error) { console.error(JSON.stringify({errors,debug:await page.evaluate(()=>({ready:document.querySelector('iframe')?.contentWindow?.fixtureReady,error:document.querySelector('iframe')?.contentWindow?.fixtureError,rpc:rpc.slice(-30),results:results.slice(-5)}))}));throw error;
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
