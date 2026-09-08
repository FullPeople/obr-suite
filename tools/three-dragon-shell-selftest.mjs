#!/usr/bin/env node
// Actual background shell; only SDK, viewport events and game controller are ports.
import { build } from 'rolldown';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve(tmpdir()), out = mkdtempSync(join(root,'three-dragon-shell-'));
const listeners = new Map(), metadataListeners = new Set(), resizeListeners = new Set();
let metadata = {}, pendingOpen, viewport = [1000,850];
const calls = { imports:0, start:0, stop:0, commands:[], open:[], close:[], widths:[], heights:[], sent:[] };
const channel = suffix => `com.obr-suite/three-dragon-ante/${suffix}`;
const fixture = globalThis.__tableShell = { calls, resizeListeners, sdk: {
  player:{getId:async()=> 'alice',getConnectionId:async()=> 'alice-connection'},
  room:{getMetadata:async()=>metadata,onMetadataChange(callback){metadataListeners.add(callback);return()=>metadataListeners.delete(callback);}},
  viewport:{getWidth:async()=>viewport[0],getHeight:async()=>viewport[1]},
  modal:{async open(value){calls.open.push({...value,mode:'full'});if(pendingOpen)await pendingOpen;},async close(id){calls.close.push(id);}},
  popover:{async open(value){calls.open.push({...value,mode:'compact'});if(pendingOpen)await pendingOpen;},async close(id){calls.close.push(id);},async setWidth(id,value){calls.widths.push(value);},async setHeight(id,value){calls.heights.push(value);}},
  notification:{show:async()=>{}},
  broadcast:{onMessage(name,callback){const callbacks=listeners.get(name)??new Set();callbacks.add(callback);listeners.set(name,callbacks);return()=>callbacks.delete(callback);},async sendMessage(name,data,options){calls.sent.push({name,data,options});}},
}};
const until = async predicate => {const end=Date.now()+3000;while(!predicate()){if(Date.now()>end)throw Error('Timed out');await new Promise(done=>setTimeout(done,5));}};
let pageClient='page-one';
const send=(suffix,data={},connectionId='alice-connection')=>{
  const instance=new URL(calls.open.at(-1)?.url??'/','https://test.local').searchParams.get('instance')??'';
  if(suffix==='ready')data={instance,clientId:pageClient,...data};
  if(suffix==='command'&&data.type)data={instance,clientId:pageClient,command:data};
  for(const callback of listeners.get(channel(suffix))??[])callback({data,connectionId});
};
let shell;
try {
  await build({input:resolve('src/modules/threeDragonAnte/index.ts'),platform:'node',plugins:[{
    name:'shell-ports',resolveId(id){
      if(id==='@owlbear-rodeo/sdk')return '\0sdk';
      if(id==='./controller')return '\0controller';
      if(id==='../../state')return '\0state';
      if(id==='../../asset-base')return '\0asset';
      if(id==='../../utils/viewportAnchor')return '\0viewport';
    },load(id){
      if(id==='\0sdk')return 'export default globalThis.__tableShell.sdk;';
      if(id==='\0state')return 'export const getLocalLang=()=>"en";';
      if(id==='\0asset')return 'export const assetUrl=value=>"/suite/"+value;';
      if(id==='\0viewport')return 'export const onViewportResize=fn=>{globalThis.__tableShell.resizeListeners.add(fn);return()=>globalThis.__tableShell.resizeListeners.delete(fn);};';
      if(id==='\0controller')return `const f=globalThis.__tableShell;f.calls.imports++;export class TableController {
        constructor(changed){this.changed=changed;}get view(){return f.view??{table:null,selfPlayerId:'alice',isHost:false,connected:true,pending:false,game:null};}
        async start(){f.calls.start++;this.changed(this.view);}async stop(){f.calls.stop++;}async command(command){f.calls.commands.push(command);this.changed(this.view);}
      }`;
    },
  }],output:{dir:out,entryFileNames:'shell.mjs',chunkFileNames:'[name].mjs',format:'esm'}});
  shell=await import(pathToFileURL(join(out,'shell.mjs')).href);
  await shell.setupThreeDragonAnte();
  assert.equal(calls.imports,0,'Idle background must not load game code');
  send('open',{},'remote-connection');send('command',{type:'create'},'remote-connection');
  await new Promise(done=>setTimeout(done,30));assert.equal(calls.start,0);assert.equal(calls.open.length,0);
  send('open');await until(()=>calls.start===1&&calls.open.length===1);send('ready');await until(()=>calls.sent.some(item=>item.data.payload));
  assert.equal(calls.imports,1);assert.match(calls.open[0].url,/^\/suite\/three-dragon-ante.html\?instance=/);
  send('command',{type:'create'});await until(()=>calls.commands.length===1);
  send('command',{type:'close'});await until(()=>calls.close.length===1);assert.equal(calls.stop,0,'Closing keeps dealer and seat alive');
  send('open');await until(()=>calls.open.length===2);pageClient='page-two';send('ready');assert.equal(calls.start,1);
  send('command',{instance:new URL(calls.open[0].url,'https://test.local').searchParams.get('instance'),clientId:'page-one',command:{type:'close'}});
  await new Promise(done=>setTimeout(done,20));assert.equal(calls.close.length,1,'Old iframe cannot close the reopened table');
  assert.equal(calls.open[1].fullScreen,true,'Default table uses Owlbear native fullscreen');
  send('command',{type:'display',mode:'compact'});await until(()=>calls.open.length===3);pageClient='page-three';send('ready');assert.equal(calls.commands.length,1,'Display changes never reach dealer');assert.equal(calls.stop,0);
  viewport=[390,720];for(const callback of resizeListeners)callback();await until(()=>calls.heights.length>0);
  assert.equal(calls.widths.at(-1),358);assert.equal(calls.heights.at(-1),656);assert.equal(calls.open.length,3,'Resize preserves the existing iframe');
  calls.sent.length=0;send('ready',{},'remote-connection');await new Promise(done=>setTimeout(done,20));assert.equal(calls.sent.length,0);
  send('ready');await until(()=>calls.sent.length===1);assert.equal(calls.sent[0].options.destination,'LOCAL');

  fixture.view={table:{id:'table'},game:{id:'game',seats:[],ante:[],discard:[],revealed:[]},selfPlayerId:'alice',isHost:true,connected:true,pending:false};
  const uiDraft={tableId:'table',gameId:'game',selectionKey:'game:1:1:ante:',selected:['blue-1'],boardScroll:72,handScroll:34,open:['log']};
  send('command',{type:'display',mode:'full',draft:uiDraft});await until(()=>calls.open.length===4);pageClient='page-four';send('ready');await until(()=>calls.sent.some(message=>message.name===channel('ui-restore')));
  assert.equal(calls.open.at(-1).fullScreen,true);assert.deepEqual(calls.sent.find(message=>message.name===channel('ui-restore')).data.draft,uiDraft);assert.equal(calls.commands.length,1,'Local draft never reaches rules controller');
  calls.sent.length=0;send('ready');await new Promise(done=>setTimeout(done,20));assert.ok(!calls.sent.some(message=>message.name===channel('ui-restore')),'Ready retry does not replay stale local selection');
  send('command',{type:'remember',draft:{...uiDraft,selected:Array.from({length:100},(_,index)=>'很'.repeat(96)+index)}});
  send('open');await until(()=>calls.open.length===5);pageClient='page-five';send('ready');await until(()=>calls.sent.some(message=>message.name===channel('ui-restore')));
  assert.deepEqual(calls.sent.find(message=>message.name===channel('ui-restore')).data.draft,uiDraft,'Oversized LOCAL draft is rejected, previous valid draft retained');
  assert.equal(calls.start,1,'Reopening a natively dismissed modal retains controller');
  await shell.teardownThreeDragonAnte();assert.equal(calls.stop,1);assert.equal(resizeListeners.size,0);
  fixture.view=undefined;

  assert.equal([...listeners.values()].reduce((n,set)=>n+set.size,0),0);assert.equal(metadataListeners.size,0);
  metadata={[channel('table')]:{hostPlayerId:'bob'}};await shell.setupThreeDragonAnte();assert.equal(calls.start,1);await shell.teardownThreeDragonAnte();
  metadata={[channel('table')]:{hostPlayerId:'alice'}};await shell.setupThreeDragonAnte();await until(()=>calls.start===2);assert.equal(calls.open.length,5,'Host recovery stays in background');await shell.teardownThreeDragonAnte();
  metadata={};await shell.setupThreeDragonAnte();let finishOpen;pendingOpen=new Promise(done=>finishOpen=done);send('open');await until(()=>calls.open.length===6);
  const stopping=shell.teardownThreeDragonAnte();finishOpen();await stopping;pendingOpen=undefined;
  assert.equal(calls.close.length,6,'All opened panels, including the late SDK open, must close');
  assert.equal(resizeListeners.size,0);assert.equal(calls.stop,calls.start,'Every controller that started was stopped');assert.equal(calls.commands.length,1);
  console.log('Three-dragon shell: idle lazy loading, sender isolation, close/reopen, resize, host recovery and late-open teardown passed');
} finally {await shell?.teardownThreeDragonAnte();if(dirname(out)!==root)throw Error('Unsafe temporary output');rmSync(out,{recursive:true,force:true});delete globalThis.__tableShell;}
