import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=resolve('workbench-test-output/sdk-rate289');mkdirSync(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const mock={
 sdk:'export default globalThis.__SDK_RATE_FIXTURE__.sdk;',
 audio:`export class MusicAudio {constructor(changed){globalThis.__SDK_RATE_FIXTURE__.audio=this;this.changed=changed;this.status={playing:false};this.volume={bgm:.8,sfx:1,mute:false};}progress(){return {duration:0,position:0};}apply(){}dispose(){}unlock(){}volumeChanged(){this.changed();}}`,
 room:`export class RoomMusic {constructor(changed){this.changed=changed;this.state={tracks:[],bgm:null,sfx:[],queue:[],revision:1,allowPlayers:false};this.connectionId='fixture-self';this.writer='fixture-self';this.canControl=true;this.isGM=true;globalThis.__SDK_RATE_FIXTURE__.room=this;}async start(){}async stop(){}async submit(){globalThis.__SDK_RATE_FIXTURE__.writes++;}}`,
 peer:`export class StudioPeer {status='disconnected';publish(){}disconnect(){}connect(){}adopt(){}} export const studioOperation=value=>value;`,
 obstacles:'export const setPanelOpen=()=>{};',
 layout:"export const PANEL_IDS={musicBoard:'music'};export const getPanelOffset=()=>({dx:0,dy:0});export const registerPanelBbox=()=>{};export const BC_PANEL_DRAG_END='drag';export const BC_PANEL_RESET='reset';",
 anchor:'export const onViewportResize=()=>()=>{};',
 assets:'export const assetUrl=value=>value;',
 text:'export const musicError=value=>String(value);'
};
async function fixtureBundle(entry,name,fullMusic=false){
 const file=join(out,name+'.mjs');
 await build({input:resolve(entry),platform:'node',plugins:[{name:'sdk-boundary',resolveId(id,importer){
  if(id==='@owlbear-rodeo/sdk')return '\0mock:sdk';
  if(fullMusic&&importer?.replaceAll('\\','/').endsWith('/modules/musicBoard/index.ts')){
   const names={'./audio':'audio','./room':'room','./peer':'peer','../../utils/panelObstacles':'obstacles','../../utils/panelLayout':'layout','../../utils/viewportAnchor':'anchor','../../asset-base':'assets','./text':'text'};
   if(names[id])return '\0mock:'+names[id];
  }
 },load(id){if(id.startsWith('\0mock:'))return mock[id.slice(6)];if(id.replaceAll('\\','/').endsWith('/workbench/channel.ts'))return readFileSync(id,'utf8').replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/'));}}],output:{file,format:'esm'}});
 return import(pathToFileURL(file).href);
}
function context(){
 const f={messages:[],attempts:0,failViews:0,writes:0,viewportCalls:0,peakReads:0,pendingReads:0,delay:0,viewportFail:false};
 const events=new Map();
 f.sdk={room:{id:'fixture-room'},broadcast:{onMessage(name,cb){if(!events.has(name))events.set(name,new Set());events.get(name).add(cb);return()=>events.get(name).delete(cb);},
  async sendMessage(name,body){if(name==='com.obr-suite/music-board:view'){f.attempts++;if(f.failViews-->0)throw {error:{name:'RateLimitHit',message:'Too many requests'}};}f.messages.push({name,body});}},
  viewport:{getWidth:()=>read(800),getHeight:()=>read(600)},popover:{async open(){},async close(){}},notification:{async show(){}}};
 async function read(value){f.viewportCalls++;f.pendingReads++;f.peakReads=Math.max(f.peakReads,f.pendingReads);try{if(f.delay)await pause(f.delay);if(f.viewportFail)throw {error:{name:'RateLimitHit',message:'Too many requests'}};return value;}finally{f.pendingReads--;}}
 f.emit=(name,data={})=>{for(const cb of events.get(name)||[])cb({connectionId:'fixture-self',data});};
 globalThis.__SDK_RATE_FIXTURE__=f;
 const stored=new Map();globalThis.localStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)};
 globalThis.window={addEventListener(){},removeEventListener(){}};
 return f;
}
test('actual music module suppresses hidden snapshots, coalesces bursts and backs off UI-only failures',{timeout:10000},async()=>{
 const f=context();const music=await fixtureBundle('src/modules/musicBoard/index.ts','music',true);
 await music.setupMusicBoard();
 for(let i=0;i<500;i++)f.room.changed(f.room.state);
 await pause(30);assert.equal(f.attempts,0,'closed music UI sends no forced status snapshots');
 f.emit('com.obr-suite/music-board:toggle');if(readFileSync('src/modules/musicBoard/index.ts','utf8').includes('if(WORKBENCH_DEV)'))f.emit('com.obr-suite/music-board:ready',{workbench:true});await pause(30);assert.equal(f.attempts,1,'first visible snapshot arrives without waiting for the interval');
 for(let i=0;i<500;i++)f.room.changed(f.room.state);
 f.room.canControl=false;f.room.changed(f.room.state);await pause(500);
 assert.ok(f.attempts<=3,'500 updates cannot flood the SDK');
 assert.equal(f.messages.filter(x=>x.name==='com.obr-suite/music-board:view').at(-1).body.canControl,false,'trailing snapshot uses current permission');
 f.failViews=1;f.room.changed(f.room.state);await pause(420);
 const failedAt=f.attempts;
 for(let i=0;i<500;i++)f.room.changed(f.room.state);
 await pause(200);assert.equal(f.attempts,failedAt,'RateLimitHit starts a cooldown rather than immediate replay');
 await pause(1100);assert.ok(f.attempts<=failedAt+2,'recovery remains bounded');
 const before=f.attempts;f.room.changed(f.room.state);await music.teardownMusicBoard();await pause(500);
 assert.equal(f.attempts,before,'teardown cancels delayed snapshots');assert.equal(f.writes,0,'UI recovery never replays music commands');
 console.log(JSON.stringify({hiddenSnapshots:0,burstUpdates:500,visibleAttempts:f.attempts,musicWrites:f.writes}));
});
test('actual viewport polling has one read pair in flight and stops cleanly',{timeout:5000},async()=>{
 const f=context();f.delay=1200;const {onViewportResize}=await fixtureBundle('src/utils/viewportAnchor.ts','viewport');
 let callbacks=0;const off=onViewportResize(()=>callbacks++);await pause(1550);
 assert.equal(f.viewportCalls,2,'slow reads are not started again every interval');assert.equal(f.peakReads,2);
 off();await pause(300);assert.equal(callbacks,0,'late reads after unsubscribe cannot dispatch resize');
 f.delay=0;f.viewportFail=true;const stop=onViewportResize(()=>callbacks++);const before=f.viewportCalls;
 await pause(1650);assert.equal(f.viewportCalls-before,2,'SDK failure backs off polling');stop();
 console.log(JSON.stringify({maxReadPair:2,callbacksAfterStop:callbacks,failedIntervalCalls:f.viewportCalls-before}));
});
