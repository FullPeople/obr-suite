import assert from 'node:assert/strict';import vm from 'node:vm';import ts from 'typescript';import {readFileSync} from 'node:fs';
const source=readFileSync('src/workbench/panel-rpc.ts','utf8').replace(/^import .*;\r?\n/gm,'').replace('export function panelBridge','function panelBridge');
const values=new Map(),events=[],writes=[];
const context=vm.createContext({setupServerAdmission(){},tableWorkbench:()=>async()=>{},getState:()=>({enabled:{}}),StorageEvent:class{constructor(type,options){Object.assign(this,{type},options);}},window:{dispatchEvent:event=>events.push(event)},localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},OBR:{room:{id:'room',getMetadata:async()=>({}),setMetadata:async v=>writes.push(v)},player:{getId:async()=>'player',getRole:async()=>'PLAYER',setMetadata:async v=>writes.push(v)},scene:{isReady:async()=>true,getMetadata:async()=>({})}}});
vm.runInContext(ts.transpileModule(source+'\nglobalThis.bridge=panelBridge(()=>{});',{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText,context);
const key='obr-suite/dice/view-mode',request=(panel,method,args)=>context.bridge(panel,'mode-window',method,args);let count=0;
for(const mode of ['2d','3d']){await request('settings','preferences.write',[key,mode]);assert.equal(values.get(key),mode);const initial=await request('settings','init',[]);assert.equal(initial.preferences[key],mode);count+=2;}
for(const value of ['invalid','2D',2,{},'3d;extra']){await assert.rejects(()=>request('settings','preferences.write',[key,value]),/无效偏好/);assert.equal(values.get(key),'3d');count++;}
await assert.rejects(()=>request('music','preferences.write',[key,'2d']),/无效偏好/);count++;
await request('settings','preferences.write',[key,null]);assert(!values.has(key));count++;
assert.equal(writes.length,0);assert.equal(events.length,3);count++;
console.log(JSON.stringify({passed:count,hostStoragePersistence:true,roomOrPlayerMetadataWrites:0,realRoomVerified:false}));
