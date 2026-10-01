// Real DOM, BroadcastChannel and Suite label/history code; synthetic SDK and
// renderer boundaries. No physics claim and no actual Owlbear room connection.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,extname,dirname} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {build} from 'rolldown';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.SUITE_REPAIR_OUT||join(root,'.local-evidence/host-browser'));mkdirSync(out,{recursive:true});
const requireBrowser=createRequire(process.env.PLAYWRIGHT_PACKAGE||'/tmp/suite-browser-deps/package.json'),{chromium}=requireBrowser('@playwright/test');
const entry=join(out,'entry.ts'),styles=[];
writeFileSync(entry,`
import {setupWorkbenchDice,teardownWorkbenchDice,rolls} from '${root}/src/workbench/dice';
import {setTokenResults,clearTokenResults} from '${root}/src/workbench/token-results';
import {mountOverlay} from '${root}/extensions/workbench-dice3d/src/overlay';
const g=window as any,handlers=new Map(),observers=new Set<Function>();let pending:Function|undefined;
const observed={ready:true,role:'GM',player:{id:'owner',connectionId:'local',role:'GM',name:'Synthetic',color:'#ffffff',metadata:{}},party:[],items:[{id:'unit',visible:true,position:{x:innerWidth/2,y:280},metadata:{}}]};
g.hostSDK={room:{id:'synthetic'},broadcast:{onMessage:(name,fn)=>{handlers.set(name,fn);return()=>handlers.delete(name)},sendMessage:async()=>{}},modal:{open:async()=>{},close:async()=>{}},notification:{show:async()=>{}},action:{open:async()=>{}},player:{setMetadata:async()=>{}},viewport:{getPosition:()=>g.slowPosition?new Promise(resolve=>pending=resolve):Promise.resolve({x:0,y:0}),getScale:async()=>1},scene:{grid:{getDpi:async()=>150}}};
g.hostObservation={read:async()=>observed,peek:()=>observed,sceneEpoch:()=>1,onChange:fn=>{observers.add(fn);return()=>observers.delete(fn)}};
const single={rollId:'single',ts:1,itemId:'unit',total:16,label:'单次结果',dice:[],expression:'1d20',rollerColor:'#ffffff'},second={...single,rollId:'second',ts:2,total:20,label:'另一个结果'},group={...single,rollId:'member',ts:3,collectiveId:'group-synthetic',total:14,label:'群体结果'};
rolls.push(single as any,second as any,group as any);
g.hostProbe={click(cid,action='toggle',remote=false){handlers.get('com.obr-suite/dice-replay')({connectionId:remote?'foreign':'local',data:{cid,action}})},group(){setTokenResults('group-synthetic',[group] as any,true)},role(role){observed.role=role;observed.player.role=role;for(const fn of observers)fn()},pending(){g.slowPosition=true;setTokenResults('pending',[single] as any)},cancel(){clearTokenResults('pending');g.slowPosition=false;pending?.({x:0,y:0})},dispose:teardownWorkbenchDice};
await setupWorkbenchDice();await mountOverlay(document.body,'local');g.hostReady=true;
`);
await build({input:entry,plugins:[{name:'only-sdk-renderer-boundaries',transform(code){return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/'));},resolveId(id,importer){
 if(id==='@owlbear-rodeo/sdk')return '\0sdk';
 if(id.endsWith('.css'))return '\0css:'+resolve(dirname(importer),id)+'.js';
 if(importer?.includes('/src/workbench/')&&id==='./observation')return '\0observation';
 if(importer?.endsWith('/src/workbench/dice.ts')&&id==='../modules/dice')return '\0dice';
 if(id.endsWith('/fixed-roll'))return '\0fixed';
 if(id==='./activity-panel')return '\0activity';
 if(id.endsWith('/src/controller'))return '\0controller';
 if(importer?.endsWith('/src/overlay.ts')&&['./renderer','./audio-host','./asset-loading','./asset-catalog'].includes(id))return '\0'+id.slice(2);
 },load(id){
 if(id.startsWith('\0css:')){styles.push(readFileSync(id.slice(5,-3),'utf8'));return '';}
 if(id==='\0sdk')return 'export default new Proxy({}, {get:(_,key)=>window.hostSDK[key]});';
 if(id==='\0observation')return 'export const workbenchObservation=()=>window.hostObservation;';
 if(id==='\0dice')return "export const BROADCAST_DICE_ROLL='roll';export const normalizePayload=x=>x,isGlobalDarkRollEnabled=()=>false,handleQuickRoll=async()=>{},showDiceEffect=()=>{},openReplay=()=>{},closeReplay=()=>{};";
 if(id==='\0fixed')return 'export const readFixedRoll=()=>false;';
 if(id==='\0activity')return 'export const setupActivityPanel=()=>{},ensureActivityPanel=async()=>{};';
 if(id==='\0controller')return 'export class Controller {async init(){} dispose(){} setProfile(){return Promise.resolve();}}';
 if(id==='\0renderer')return "export class DiceRenderer{constructor(container,catalog,notify){this.notify=notify;}async init(){this.notify('renderer-ready',{});}clear(){}}";
 if(id==='\0audio-host')return 'export const mountAudioHost=()=>({warmup:async()=>{}});';
 if(id==='\0asset-loading')return "export class DiceAssets{plan(){}stage(){}async bytes(path){return (await fetch('/font.ttf')).arrayBuffer();}}";
 if(id==='\0asset-catalog')return 'export const diceCatalog=()=>({themes:{},dice:{}});';
 }}],output:{dir:out,entryFileNames:'host.js',format:'esm',codeSplitting:false}});
writeFileSync(join(out,'style.css'),styles.join('\n'));
const mime={'.js':'text/javascript','.css':'text/css','.md':'text/plain; charset=utf-8','.html':'text/html; charset=utf-8','.json':'application/json','.ttf':'font/ttf'};
const parent=`<meta charset="utf-8"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe src="TARGET"></iframe><script>window.addEventListener('message',e=>{const m=e.data;if(!m?.id)return;if(m.id==='OBR_CONNECT'){e.source.postMessage({id:'OBR_READY',data:{ref:'synthetic',userId:'owner'}},e.origin);return;}let data={};if(m.id==='OBR_PLAYER_GET_ROLE')data={role:'GM'};if(m.id==='OBR_MODAL_CLOSE')window.closedModal=m.data.id;e.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data},e.origin);});</script>`;
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),p=url.pathname;let file;
 if(p==='/host'){res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#393b40}</style><script type="module" src="/host.js"></script><link rel="stylesheet" href="/style.css">');return;}
 if(p==='/notice'){const channel=url.searchParams.get('channel');const target='/'+channel+'/dm-announcement.html?obrref='+Buffer.from(origin+' synthetic').toString('base64');res.setHeader('Content-Type','text/html');res.end(parent.replace('TARGET',target));return;}
 if(p==='/host.js'||p==='/style.css')file=join(out,p.slice(1));
 else if(p==='/font.ttf')file=join(root,'extensions/workbench-dice3d/public/assets/fonts/Cinzel-Variable.ttf');
 else if(p.startsWith('/suite-dev/'))file=join(root,'.local-evidence/dist-dev',p.slice('/suite-dev/'.length));
 else if(p.startsWith('/suite/'))file=join(root,'.local-evidence/dist-stable',p.slice('/suite/'.length));
 if(!file||!existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'/usr/bin/chromium',headless:true}),checks=[],errors=[],requests=[];
const check=(name,passed,detail={})=>{checks.push({name,passed,...detail});assert(passed,name);};
try{for(const width of [360,1280]){
 const page=await browser.newPage({viewport:{width,height:800}});page.on('pageerror',e=>errors.push(String(e)));await page.goto(origin+'/host');await page.waitForFunction(()=>window.hostReady);const labels=page.locator('.token-result');
 await page.evaluate(()=>window.hostProbe.click('single'));await labels.waitFor();check(width+' single label visible',await labels.count()===1);
 await page.screenshot({path:join(out,width+'-single.png')});await page.evaluate(()=>window.hostProbe.click('single'));await labels.waitFor({state:'detached'});check(width+' second click removes DOM',await labels.count()===0);
 await page.evaluate(()=>{window.hostProbe.click('single');window.hostProbe.click('second');window.hostProbe.click('single','close');});await page.waitForFunction(()=>document.querySelector('.token-result strong')?.textContent==='20');check(width+' replace and late close',await labels.count()===1);
 await page.evaluate(()=>window.hostProbe.click('second'));await labels.waitFor({state:'detached'});
 await page.evaluate(()=>{window.hostProbe.group();window.hostProbe.click('group-synthetic');});await labels.waitFor();check(width+' group history no duplicate',await labels.count()===1);await page.screenshot({path:join(out,width+'-group.png')});
 await page.evaluate(()=>{window.hostProbe.click('group-synthetic');window.hostProbe.group();});await labels.waitFor({state:'detached'});check(width+' group cancellation and late result removes DOM',await labels.count()===0);await page.screenshot({path:join(out,width+'-cleared.png')});
 await page.evaluate(()=>window.hostProbe.click('single'));await labels.waitFor();await page.evaluate(()=>window.hostProbe.role('PLAYER'));await labels.waitFor({state:'detached'});check(width+' permission change clears DOM',await labels.count()===0);
 await page.evaluate(()=>window.hostProbe.pending());await page.waitForTimeout(30);await page.evaluate(()=>window.hostProbe.cancel());await page.waitForTimeout(150);check(width+' pending coordinates cancel',await labels.count()===0);
 await page.evaluate(()=>window.hostProbe.click('single','toggle',true));await page.waitForTimeout(150);check(width+' remote clicks rejected',await labels.count()===0);await page.evaluate(()=>window.hostProbe.dispose());await page.close();
 for(const channel of ['suite-dev','suite']){
  const notice=await browser.newPage({viewport:{width,height:800}});notice.on('pageerror',e=>errors.push(String(e)));notice.on('request',r=>requests.push({channel,width,url:r.url()}));await notice.goto(origin+'/notice?channel='+channel);const frame=notice.frames().find(f=>f.url().includes('dm-announcement.html'));await notice.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({id:'OBR_READY',data:{ref:'synthetic',userId:'owner'}},location.origin));await frame.waitForFunction(()=>document.querySelector('#body')?.textContent.includes('gmail.com'));const text=await frame.locator('#body').innerText();check(width+' '+channel+' feedback Gmail retained',text.includes('1763086701psw@gmail.com'));
  check(width+' '+channel+' body routed',requests.some(r=>r.channel===channel&&r.width===width&&r.url.endsWith(channel==='suite-dev'?'/announcement-dev.md':'/announcement.md')));
  if(channel==='suite-dev')check(width+' new notice uses paired Web history',text.includes('减少首次打开时需要下载的程序内容')&&await frame.locator('.release-history').count()>1);
  check(width+' '+channel+' Gmail is clickable',await frame.locator('a[href="mailto:1763086701psw@gmail.com"]').count()>=1);
  if(channel==='suite-dev')check(width+' dev suffix preserved',/\d+\.\d+\.\d+-dev/.test(await frame.locator('.cl-version').innerText()));
  check(width+' '+channel+' notice fits width',await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check(width+' '+channel+' version stays on own channel',!requests.some(r=>r.channel===channel&&r.width===width&&r.url.endsWith(channel==='suite-dev'?'/manifest.json':'/manifest-dev.json')));
  await notice.screenshot({path:join(out,width+'-'+channel+'-notice.png')});await frame.waitForFunction(()=>!document.querySelector('#btn-close').disabled);await frame.locator('#btn-close').click();await notice.waitForFunction(()=>!!window.closedModal);check(width+' '+channel+' close targets own modal',await notice.evaluate(()=>window.closedModal)===(channel==='suite-dev'?'com.obr-suite/workbench-announcement':'com.obr-suite/dm-announcement'));await notice.close();
 }
}check('no browser script errors',errors.length===0,{errors});
}finally{writeFileSync(join(out,'results.json'),JSON.stringify({browser:await browser.version(),realRoomVerified:false,physicsVerified:false,checks,errors,requests},null,2));await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,out}));
