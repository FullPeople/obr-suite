import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';

// Actual Action/history components and production adapter, with only the host
// SDK transport replaced. This does not connect to or alter an Owlbear room.
const root=resolve(process.env.DND_SUITE_SOURCE||fileURLToPath(new URL('..',import.meta.url))).replaceAll('\\','/');
const out=process.env.DND_DICE_EVIDENCE;
const deps=process.env.DND_SUITE_DEPS_ROOT;
const web=process.env.DND_WEB_ROOT;
if(!out||!deps||!web)throw Error('Set DND_DICE_EVIDENCE, DND_SUITE_DEPS_ROOT and DND_WEB_ROOT');
mkdirSync(out,{recursive:true});
const requireDeps=createRequire(deps+'/package.json');
const {build}=await import(pathToFileURL(requireDeps.resolve('rolldown')).href);
const {chromium}=createRequire(web+'/package.json')('@playwright/test');
await build({input:root+'/tools/workbench-dice3d-vite.ts',platform:'node',external:['vite'],output:{file:out+'/dice-plugin.mjs',format:'esm'},logLevel:'warn'});
const {workbenchDice3dPlugin}=await import(pathToFileURL(out+'/dice-plugin.mjs'));
const adaptation=workbenchDice3dPlugin(true);
const plugins=[{
  name:'isolated-sdk',
  resolveId(id,importer){
    if(id.startsWith('probe:'))return id;
    if(id==='../modules/dice'&&importer?.endsWith('activity-panel.ts'))return 'probe:close';
    if(['./state','../state','../../state'].includes(id))return root+'/tools/fixtures/workbench-modules.ts';
    if(id.endsWith('?raw'))return this.resolve(id.slice(0,-4),importer,{skipSelf:true}).then(r=>r&&'raw:'+r.id);
    if(!id.startsWith('.')&&!id.includes(':')&&!id.startsWith('/')&&!id.startsWith('\0'))return this.resolve(id,deps+'/resolver.js',{skipSelf:true});
  },
  load(id){
    if(id==='probe:host')return `import OBR from '@owlbear-rodeo/sdk';import {setupActivityPanel,ensureActivityPanel} from '${root}/src/workbench/activity-panel';OBR.onReady(()=>{setupActivityPanel();window.showHistory=ensureActivityPanel;window.parent.postMessage({probeHost:true},location.origin)});window.parent.postMessage({probeLoaded:true},location.origin);`;
    if(id==='probe:action')return `import {mountActionHistory} from '${root}/src/workbench/action-history';mountActionHistory();window.parent.postMessage({probeLoaded:true},location.origin);`;
    if(id==='probe:legacy')return `import '${root}/src/modules/dice/history-page';window.parent.postMessage({probeLoaded:true},location.origin);`;
    if(id==='probe:close')return `import OBR from '@owlbear-rodeo/sdk';export const closeHistory=()=>OBR.popover.close('dice-history');`;
    if(id.startsWith('raw:'))return 'export default '+JSON.stringify(readFileSync(id.slice(4),'utf8'));
  },
  transform(code,id){
    code=code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');
    return adaptation.transform(code,id.replaceAll('\\','/'))||code;
  },
}];
for(const name of ['host','action','legacy'])await build({input:'probe:'+name,plugins,output:{file:out+'/'+name+'.js',format:'esm',codeSplitting:false},logLevel:'warn'});

const hostScript=`
window.rpc=[];window.messages=[];window.opens=0;window.connection='fixture-action-hotfix';
window.emit=(channel,data)=>{for(const f of document.querySelectorAll('iframe'))f.contentWindow.postMessage({id:'OBR_BROADCAST_MESSAGE_'+channel,data:{connectionId:connection,data}},location.origin);};
window.resetEvents=()=>{rpc.length=0;messages.length=0;};
addEventListener('message',e=>{
 const m=e.data;
 if(m.probeLoaded){e.source.postMessage({id:'OBR_READY',data:{ref:'fixture',userId:'gm'}},location.origin);return;}
 if(m.probeHost){window.hostReady=true;return;}
 if(!m.id||!m.nonce)return;
 rpc.push(m.id);let value={};
 switch(m.id){
  case 'OBR_PLAYER_GET_ID':value={id:'gm'};break;
  case 'OBR_PLAYER_GET_CONNECTION_ID':value={connectionId:connection};break;
  case 'OBR_PLAYER_GET_ROLE':value={role:'GM'};break;
  case 'OBR_PLAYER_GET_NAME':value={name:'Synthetic GM'};break;
  case 'OBR_PLAYER_GET_COLOR':value={color:'#50525b'};break;
  case 'OBR_PLAYER_GET_METADATA':value={metadata:{}};break;
  case 'OBR_PLAYER_GET_SELECTION':value={selection:[]};break;
  case 'OBR_SCENE_IS_READY':value={ready:true};break;
  case 'OBR_SCENE_GET_METADATA':case 'OBR_ROOM_GET_METADATA':value={metadata:{}};break;
  case 'OBR_PARTY_GET_PLAYERS':value={players:[]};break;
  case 'OBR_VIEWPORT_GET_WIDTH':value={width:1000};break;
  case 'OBR_VIEWPORT_GET_HEIGHT':value={height:760};break;
  case 'OBR_ACTION_OPEN':{
   opens++;let f=document.querySelector('#action');
   if(!f){f=document.createElement('iframe');f.id='action';f.src='/action?obrref='+btoa(location.origin+' action-hotfix');f.style='width:420px;height:540px;border:0';document.body.append(f);}break;
  }
  case 'OBR_ACTION_CLOSE':document.querySelector('#action')?.remove();break;
  case 'OBR_BROADCAST_SEND_MESSAGE':messages.push(m.data);emit(m.data.channel,m.data.data);break;
 }
 e.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:value},e.origin);
});`;
const server=createServer((req,res)=>{
 const u=new URL(req.url,'http://local');res.setHeader('Content-Type','text/html;charset=utf-8');
 if(u.pathname==='/'){res.end('<!doctype html><script>'+hostScript+'</script><iframe id="host" hidden src="/host?obrref='+Buffer.from('http://'+req.headers.host+' action-hotfix').toString('base64')+'"></iframe>');return;}
 if(u.pathname==='/host'){res.end('<script type="module" src="/host.js"></script>');return;}
 if(u.pathname==='/action'){res.end('<nav id="action-tabs"><button data-action-tab="home" role="tab">角色卡 · 规则资料</button><button data-action-tab="history" role="tab">历史</button></nav><section id="action-home"><a id="open">打开角色卡与规则资料</a></section><section id="action-history" hidden></section><script type="module" src="/action.js"></script>');return;}
 if(u.pathname==='/legacy'){res.end(readFileSync(root+'/dice-history.html','utf8').replace(/<script type="module"[\s\S]*?<\/script>/,'<script type="module" src="/legacy.js"></script>'));return;}
 if(/^\/(?:host|action|legacy)\.js$/.test(u.pathname)){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(out+u.pathname));return;}
 res.statusCode=404;res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1000,height:760}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const result={realOwlbear:false,productionAdapter:true,sourceRoot:root,cases:[]};
try{
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForFunction(()=>window.hostReady);
 await page.evaluate(()=>document.querySelector('#host').contentWindow.showHistory());
 await page.waitForFunction(()=>document.querySelector('#action')?.contentDocument?.querySelector('#action-history')?.hidden===false);
 const action=page.frames().find(f=>new URL(f.url()).pathname==='/action');
 await action.waitForFunction(()=>document.querySelector('.activity-flow'));
 await page.evaluate(()=>{
  for(let i=0;i<3;i++){
   const payload={_3dConnection:connection,_3dRows:[{total:17+i,modifier:3}],rollId:'synthetic-'+i,rollerId:'gm',rollerName:'合成玩家',rollerColor:'#50525b',itemId:'synthetic-token-'+i,expression:'1d20+3',label:'合成先攻 '+i,total:17+i,modifier:3,winnerIdx:-1,dice:[{type:'d20',value:14+i}],ts:Date.now()+i};
   emit('com.obr-suite/dice-roll',payload);emit('com.obr-suite/dice-history-reveal',{rollId:payload.rollId});
  }
 });
 await action.locator('[data-cid="synthetic-2"]').waitFor();
 await page.evaluate(()=>resetEvents());
 await action.locator('[data-cid="synthetic-2"]').click();
 await page.waitForFunction(()=>messages.some(m=>m.channel==='com.obr-suite/dice-replay'));
 await page.waitForTimeout(150);
 result.firstClick=await page.evaluate(()=>({messages,rpc,actionAttached:!!document.querySelector('#action')}));
 assert.equal(await page.locator('#action').count(),1,'history replay must keep Action open');
 assert.equal(await action.locator('#action-history').isVisible(),true);
 assert.equal(result.firstClick.messages.filter(m=>m.channel==='com.obr-suite/dice-replay').at(-1).data.action,'open');
 await action.locator('[data-cid="synthetic-2"]').click();
 await page.waitForFunction(()=>messages.some(m=>m.channel==='com.obr-suite/dice-replay'&&m.data.action==='close'));
 assert.equal(await page.locator('#action').count(),1);
 await action.locator('[data-cid="synthetic-1"]').click();
 await page.waitForFunction(()=>messages.some(m=>m.channel==='com.obr-suite/dice-replay'&&m.data.cid==='synthetic-1'&&m.data.action==='open'));
 await action.getByRole('tab',{name:'角色卡 · 规则资料'}).click();
 assert.equal(await action.locator('#action-history').isVisible(),false);
 await action.getByRole('tab',{name:'历史',exact:true}).click();
 assert.equal(await action.locator('#action-history').isVisible(),true);
 const events=await page.evaluate(()=>({messages,rpc}));
 assert(!events.messages.some(m=>['com.obr-suite/dice-history-dismiss','com.obr-suite/dice-panel-toggle'].includes(m.channel)));
 assert(!events.rpc.includes('OBR_ACTION_CLOSE'));
 assert(result.firstClick.messages.filter(m=>m.channel==='com.obr-suite/dice-replay').every(m=>m.options.destination==='LOCAL'));
 result.cases.push('Action replay opens, toggles, switches and survives tab changes without closing Action');
 await page.locator('#action').screenshot({path:out+'/action-stays-open.png'});
 await page.evaluate(()=>resetEvents());
 await action.locator('#btnDismiss').click();
 await page.waitForFunction(()=>!document.querySelector('#action'));
 assert((await page.evaluate(()=>rpc)).includes('OBR_ACTION_CLOSE'));
 result.cases.push('Explicit Action dismiss still closes the Action surface');
 await page.evaluate(()=>{
  const f=document.createElement('iframe');f.id='legacy';f.src='/legacy?obrref='+btoa(location.origin+' action-hotfix');f.style='width:420px;height:340px';document.body.append(f);
 });
 await page.locator('#legacy').contentFrame().locator('[data-cid="synthetic-2"]').waitFor();
 await page.evaluate(()=>resetEvents());
 await page.locator('#legacy').contentFrame().locator('[data-cid="synthetic-2"]').click();
 await page.waitForFunction(()=>messages.some(m=>m.channel==='com.obr-suite/dice-history-dismiss'));
 const legacy=await page.evaluate(()=>messages);
 assert(legacy.some(m=>m.channel==='com.obr-suite/dice-panel-toggle'));
 assert(legacy.some(m=>m.channel==='com.obr-suite/dice-replay'&&m.options.destination==='REMOTE'));
 result.cases.push('Legacy floating history retains its panel-open and dismiss behavior');
 assert.deepEqual(errors,[]);result.success=true;
 console.log(JSON.stringify(result));
}finally{
 result.errors=errors;
 writeFileSync(out+'/action-history-hotfix.json',JSON.stringify(result,null,2));
 await browser.close();server.close();
}
