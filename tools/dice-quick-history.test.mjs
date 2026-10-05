import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash,webcrypto} from 'node:crypto';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {build} from 'rolldown';

// No browser or socket: execute the real facade, the actual quick-page script,
// host dice3dRpc, history policy and shared send queue. Only browser/SDK/physics
// boundaries are fixtures. Virtual queue times are not browser latency claims.
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.DND_DICE_EVIDENCE||'.cache/dice-quick-history');
const baselineCommit='8e2cd6fd0fe969d36694338457e9e4d3428c1c00';
const facadePath=resolve(root,'src/workbench/dice-sdk.ts'),candidateSource=readFileSync(facadePath,'utf8');
const baselineSource=execFileSync('git',['show',baselineCommit+':src/workbench/dice-sdk.ts'],{cwd:root,encoding:'utf8'});
const quickHtml=readFileSync(resolve(root,'dice-quick-popup.html'),'utf8');
const quickScript=quickHtml.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import OBR from "@owlbear-rodeo\/sdk";/,'const OBR=DiceFacade;');
const fullPanel=readFileSync(resolve(root,'src/modules/dice/panel-page.ts'),'utf8');
assert(fullPanel.includes('OBR.broadcast.onMessage(BROADCAST_DICE_ROLL,'),'full panel consumes dice history');
assert(!quickScript.includes('broadcast.onMessage'),'real quick composer has no history consumer');
const sha=value=>createHash('sha256').update(value).digest('hex');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function bundle(input,plugins=[],name='Fixture'){
 const result=await build({input,write:false,platform:'browser',plugins,output:{format:'iife',name}});
 return result.output.find(item=>item.type==='chunk').code;
}
const facadeCode={};
for(const [mode,source] of [['baseline',baselineSource],['candidate',candidateSource]])facadeCode[mode]=await bundle(facadePath,[{name:'exact-facade-revision',load(id){if(id===facadePath)return source;}}],'DiceFacade');
const hostCode=await bundle('\0host-entry',[{name:'host-boundaries',resolveId(id){
 if(id==='\0host-entry')return id;
 if(id==='@owlbear-rodeo/sdk')return '\0sdk';
 if(id==='./observation')return '\0observation';
 if(id.endsWith('/src/controller'))return '\0controller';
},load(id){
 if(id==='\0host-entry')return `export * from ${JSON.stringify(resolve(root,'src/workbench/dice3d.ts'))};export {sendDiceMessage} from ${JSON.stringify(resolve(root,'src/workbench/dice-broadcast.ts'))};`;
 if(id==='\0sdk')return 'export default globalThis.fixtureSDK;';
 if(id==='\0observation')return 'export const workbenchObservation=()=>globalThis.fixtureObservation;';
 if(id==='\0controller')return 'export class Controller {async init(){}dispose(){}setProfile(){return Promise.resolve();}}';
}}],'Host');

class Clock {
 now=0;nextId=0;timers=new Map();
 setTimeout=(fn,ms=0)=>{const id=++this.nextId;this.timers.set(id,{fn,at:this.now+ms});return id;};
 clearTimeout=id=>this.timers.delete(id);
 async until(done){
  const limit=this.now+180000;
  for(let count=0;count<20000;count++){
   await flush();if(done())return;
   const next=[...this.timers].sort((a,b)=>a[1].at-b[1].at)[0];
   assert(next,'unsettled operation has a scheduled task');
   assert(next[1].at<=limit,'virtual scenario has a bounded finish');
   this.now=next[1].at;this.timers.delete(next[0]);next[1].fn();
  }
  assert.fail('virtual task did not settle');
 }
 date(){const clock=this;return class extends Date {static now(){return clock.now;}};}
}
class Element {
 children=[];dataset={};style={setProperty(){}};attributes=new Map();listeners=new Map();hidden=false;inert=false;value='';textContent='';
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.classList={add(){},contains:()=>false};}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(key,value){this.attributes.set(key,String(value));}
 removeAttribute(key){this.attributes.delete(key);}
 getAttribute(key){return this.attributes.get(key)??null;}
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
 dispatchEvent(event){event.target??=this;for(const fn of this.listeners.get(event.type)||[])fn(event);return true;}
 querySelector(){return null;}
 querySelectorAll(){return [];}
 contains(node){return node===this||this.children.some(child=>child.contains?.(node));}
 setSelectionRange(){}
}
function documentFixture(){
 const body=new Element('body'),head=new Element('head'),documentElement=new Element('html');body.isConnected=true;
 const ids=new Map(),actions=[];
 for(const id of ['exprInput','labelInput','btnModInc','btnModDec','darkActions','closeBtn']){const el=new Element('input');el.id=id;ids.set(id,el);body.append(el);}
 for(const act of ['roll','adv','dis','crit','dark-roll','dark-adv','dark-dis','dark-crit']){const el=new Element('button');el.dataset.act=act;actions.push(el);body.append(el);}
 return {body,head,documentElement,ids,actions,createElement:tag=>new Element(tag),getElementById:id=>ids.get(id)||null,
  querySelector:()=>null,querySelectorAll:selector=>selector==='[data-act]'?actions:[],addEventListener(){}};
}
function record(index,visibility='all'){
 return {id:'saved-'+index,source:'other-connection',name:'Saved roll',color:'#ffffff',at:index,results:[3],total:3,kinds:['d6'],complete:true,secret:visibility!=='all',revealed:false,visibility,
  formulaData:{expression:'1d6',context:{rollerId:'other-player',itemId:null,label:'Saved '+index,ts:index},rows:[{operation:'sum',total:3,dice:[{id:'die-'+index,kind:'d6',value:3,raw:3,kept:true,sign:1,flags:[]}]}]}};
}
async function hostFixture(clock,records=Array.from({length:100},(_,i)=>record(i))){
 const sent=[],channels=[],listeners=new Map(),frames=[];
 const observed={role:'GM',player:{id:'owner',connectionId:'local',role:'GM',name:'Synthetic',color:'#ffffff',metadata:{}},party:[],items:[]};
 const context=vm.createContext({console,Promise,Date:clock.date(),setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,crypto:webcrypto,
  localStorage:{getItem:()=>null,setItem(){}},
  BroadcastChannel:class{constructor(name){this.name=name;channels.push(this);}postMessage(){}close(){}},
  fixtureObservation:{read:async()=>observed,peek:()=>observed,onChange:()=>()=>{}},
  fixtureSDK:{room:{id:'synthetic'},player:{setMetadata:async()=>{}},notification:{show:async()=>{}},modal:{open:async()=>{},close:async()=>{}},broadcast:{
   onMessage:(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name);},
   sendMessage:async(name,data,options)=>{sent.push({name,data,options,at:clock.now});for(const frame of frames)frame.receive({event:name,data:{connectionId:'local',data}});}
  }}
 });
 vm.runInContext(hostCode,context);const api=context.Host;await api.setupDice3d();
 const channel=channels.find(c=>c.name.includes(':local:'));
 channel.onmessage({data:{type:'state',state:{ready:true,physics:true,overlay:true}}});
 channel.onmessage({data:{type:'history',records}});
 // Let the production initial-publication lane finish before measuring opens.
 await clock.until(()=>sent.length===records.filter(r=>r.visibility!=='self'&&r.visibility!=='players').length*2);
 clock.now+=100; // Start each opening after the last seed packet's pacing slot.
 sent.length=0;
 return {api,sent,frames,observed,channel};
}
function mountFrame(mode,kind,clock,host,{unsubscribe=false}={}){
 const document=documentFixture(),messages=[],handlers=new Map(),received=[],storage=new Map(),timers=new Set();
 let ready=false,id=0;
 const origin='https://synthetic.test',location={origin,search:'?expr=1d6&label=Quick',href:origin+'/quick.html'};
 const parent={postMessage(message){
  messages.push(message);if(message.ready){ready=true;return;}if(!message.id)return;
  const respond=result=>receive({id:message.id,result});
  if(message.method==='init')respond({roomId:'synthetic',diceLoading:{ready:true},reads:{'player.getRole':host.observed.role,'player.getId':host.observed.player.id,'player.getConnectionId':'local','player.getMetadata':{},'player.getName':'Synthetic','player.getColor':'#ffffff'}});
  else if(message.method==='dice3d.history')void host.api.dice3dRpc('history',[]).then(respond,error=>receive({id:message.id,error:String(error)}));
  else if(message.method==='dice3d.status')respond({ready:true});
  else respond({ok:true});
 }};
 const receive=message=>{for(const fn of handlers.get('message')||[])fn({source:parent,origin,data:{channel:'workbench-dice-frame/v1',...message}});};
 const context=vm.createContext({console,Promise,Date:clock.date(),URLSearchParams,structuredClone,crypto:{randomUUID:()=>kind+'-'+(++id)},HTMLElement:Element,
  document,parent,location,Event:class{constructor(type){this.type=type;}},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  setTimeout:(fn,ms)=>{const id=clock.setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;},clearTimeout:id=>{timers.delete(id);clock.clearTimeout(id);},
  addEventListener:(type,fn)=>{if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);},fixtureReceived:received,fixtureUnsubscribe:unsubscribe
 });context.window=context;
 vm.runInContext(facadeCode[mode],context);
 if(kind==='quick')vm.runInContext(quickScript,context);
 else vm.runInContext(`DiceFacade.onReady(async()=>{await DiceFacade.player.getRole();const stop=DiceFacade.broadcast.onMessage('com.obr-suite/dice-roll',event=>fixtureReceived.push(event.data));if(fixtureUnsubscribe)stop();});`,context);
 const frame={context,document,messages,received,receive,isReady:()=>ready,dispose(){document.body.isConnected=false;for(const id of timers)clock.clearTimeout(id);host.frames.splice(host.frames.indexOf(frame),1);}};
 host.frames.push(frame);return frame;
}
async function criticalPackets(host,clock){
 const started=clock.now,packets=[{type:'offer',id:'fresh-roll'},...Array.from({length:3},(_,index)=>({type:'chunk',id:'fresh-roll',index,data:'x'.repeat(4096)})),{type:'chunks-done',id:'fresh-roll'}];
 for(const packet of packets)await host.api.sendDiceMessage('com.obr-suite/workbench-dice3d.v1',packet,{destination:'REMOTE'});
 return {spanMs:clock.now-started,packetsSha:sha(JSON.stringify(packets))};
}
async function compareQuick(mode){
 const clock=new Clock(),host=await hostFixture(clock),frames=Array.from({length:3},()=>mountFrame(mode,'quick',clock,host));
 await flush();let critical;void criticalPackets(host,clock).then(result=>critical=result);
 await clock.until(()=>!!critical&&(mode==='candidate'?frames.every(f=>f.isReady()):host.sent.filter(p=>p.options.destination==='LOCAL').length===600));
 const historyMessages=host.sent.filter(p=>p.options.destination==='LOCAL'),historyRpc=frames.reduce((n,f)=>n+f.messages.filter(m=>m.method==='dice3d.history').length,0);
 assert.equal(historyRpc,mode==='candidate'?0:3);
 assert.equal(historyMessages.length,mode==='candidate'?0:600);
 const bootstrapErrors=frames.filter(f=>f.document.body.dataset.bridgeError).length;
 assert.equal(bootstrapErrors,mode==='candidate'?0:3,'unused overlapping history RPCs hit the facade timeout only before the fix');
 if(mode==='candidate')for(const frame of frames){
  frame.document.actions.find(el=>el.dataset.act==='roll').dispatchEvent({type:'click'});await flush();
  const submitted=frame.messages.find(m=>m.method==='broadcast.sendMessage');
  assert.equal(submitted.args[0],'com.obr-suite/dice-quick-roll');assert.equal(submitted.args[1].expression,'1d6');
  assert(frame.messages.some(m=>m.close),'actual quick action still receives its receipt and closes');
 }
 for(const frame of frames){assert.equal(frame.document.body.dataset.diceLoading,'false');frame.dispose();}
 host.api.teardownDice3d(false);
 return {mode,historyRpc,historyMessages:historyMessages.length,bootstrapErrors,...critical};
}
const baseline=await compareQuick('baseline'),candidate=await compareQuick('candidate');
assert.equal(candidate.packetsSha,baseline.packetsSha,'identical critical packet bytes for red/green comparison');
assert(candidate.spanMs<baseline.spanMs,'removing unused history frees the existing paced lane');

const clock=new Clock(),host=await hostFixture(clock),panel=mountFrame('candidate','panel',clock,host);
await clock.until(panel.isReady);
assert.equal(panel.messages.filter(m=>m.method==='dice3d.history').length,1);
assert.equal(panel.received.length,100,'subscribed panel still receives all saved results');
panel.receive({event:'com.obr-suite/dice-roll',data:{data:{rollId:'current-result'}}});
assert.equal(panel.received.at(-1).rollId,'current-result','current result subscription remains active');
panel.receive({event:'player',data:{role:'PLAYER',id:'changed-player'}});
assert.equal(await panel.context.DiceFacade.player.getRole(),'PLAYER');
panel.receive({event:'snapshot',data:{reads:{'player.getRole':'GM','player.getId':'reconnected-owner'}}});
assert.equal(await panel.context.DiceFacade.player.getId(),'reconnected-owner','reconnection snapshot still refreshes facade reads');
panel.dispose();host.sent.length=0;clock.now+=100;
const reopened=mountFrame('candidate','panel',clock,host);await clock.until(reopened.isReady);
assert.equal(reopened.received.length,100,'reopened full panel rehydrates history');reopened.dispose();
const unsubscribed=mountFrame('candidate','panel',clock,host,{unsubscribe:true});await clock.until(unsubscribed.isReady);
assert.equal(unsubscribed.messages.filter(m=>m.method==='dice3d.history').length,0,'empty subscription set is not a consumer');unsubscribed.dispose();
host.api.teardownDice3d(false);

const permissionsClock=new Clock(),privateRows=Array.from({length:100},(_,i)=>record(i,['all','gm','self','players'][i%4]));
const permissionsHost=await hostFixture(permissionsClock,privateRows);permissionsHost.observed.role='PLAYER';permissionsHost.observed.player.role='PLAYER';
const playerPanel=mountFrame('candidate','panel',permissionsClock,permissionsHost);await permissionsClock.until(playerPanel.isReady);
assert.equal(playerPanel.received.length,50,'host still excludes GM-only and another player self-only history');
assert(playerPanel.received.every(row=>['all','players'].includes(row.visibility)));
playerPanel.dispose();permissionsHost.api.teardownDice3d(false);
const report={success:true,baselineCommit,source:{baselineFacadeSha:sha(baselineSource),candidateFacadeSha:sha(candidateSource),quickScriptSha:sha(quickScript),hostBundleSha:sha(hostCode)},baseline,candidate,
 checks:['actual quick-page script: three fresh facade mounts issue no history RPC','100 completed records: 600 baseline messages become zero with identical packet bytes','subscribed panel keeps 100 history records, live results and reopening','unsubscribed callback does not trigger history','player change and reconnect snapshot still update facade reads','real host history permission filter remains effective'],
 boundary:'Node VM with synthetic DOM/SDK/physics and deterministic timer; real facade, quick-page script, host dice3dRpc, history policy and paced queue. No browser, real room, GPU or physical display latency claim.'};
mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
