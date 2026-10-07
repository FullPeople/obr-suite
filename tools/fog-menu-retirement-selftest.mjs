import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.env.FOG_MENU_ROOT||'.'),out=resolve(process.env.FOG_MENU_EVIDENCE||'.cache/fog-menu-retirement');mkdirSync(out,{recursive:true});
const calls=[],callbacks=[];let failRemove=false;
const SDK={contextMenu:{async remove(id){calls.push(['remove',id]);if(failRemove)throw Error('authored cleanup rejection');}},modal:{async close(id){calls.push(['close',id]);}}};
globalThis.__fogRetirement={SDK,getState:()=>({enabled:{dynamicFog:true},dynamicFog:{}}),onStateChange:callback=>{callbacks.push(callback);return ()=>{}},calls};
await build({input:join(root,'src/modules/fullFog/index.ts'),platform:'node',external:[/^node:/],plugins:[{name:'fog-retirement-sdk-contract',resolveId(source){
 if(source==='@owlbear-rodeo/sdk')return '\0sdk';
 if(source==='../../state')return '\0state';
 if(source==='../../feature-flags')return '\0flags';
 if(source==='./dynfog')return '\0dynfog';
},load(id){
 if(id==='\0sdk')return 'export default globalThis.__fogRetirement.SDK';
 if(id==='\0state')return 'export const getState=globalThis.__fogRetirement.getState,onStateChange=globalThis.__fogRetirement.onStateChange';
 if(id==='\0flags')return 'export const STABLE_HIDES=false';
 if(id==='\0dynfog')return `export const applyDynfogSettings=(...a)=>globalThis.__fogRetirement.calls.push(['settings',...a]),setupDynfog=(...a)=>globalThis.__fogRetirement.calls.push(['engineSetup',...a]),teardownDynfog=(...a)=>globalThis.__fogRetirement.calls.push(['engineTeardown',...a]);`;
}}],output:{file:join(out,'module.mjs'),format:'esm',codeSplitting:false}});
const api=await import(pathToFileURL(join(out,'module.mjs')).href),results=[];
async function check(name,action){try{await action();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:String(error)});}finally{calls.length=0;}}
await check('setup removes an old map menu using its persistent id without registering an editor',async()=>{
 await api.setupFogEditor();assert.equal(calls.length,1);assert.equal(calls[0][0],'remove');assert.equal(calls[0][1],'com.obr-suite/fullFog/ctx-edit');
});
await check('cleanup works on repeated setup and when no editor was registered in this document',async()=>{
 await api.setupFogEditor();await api.setupFogEditor();assert.equal(calls.filter(c=>c[0]==='remove').length,2);
});
await check('teardown removes the menu and closes only the old editor modal',async()=>{
 await api.teardownFogEditor();assert.deepEqual(calls.map(c=>c[0]),['remove','close']);
});
await check('cleanup rejection is explicitly reported without blocking dynamic fog',async()=>{
 const warnings=[],original=console.warn;console.warn=(...args)=>warnings.push(args);failRemove=true;
 try{await api.setupFogEditor();assert.equal(warnings.length,1);assert.match(String(warnings[0][0]),/cleanup failed/);}finally{failRemove=false;console.warn=original;}
});
await check('setup needs no player-role subscription and has no scene-data or modal-open API',async()=>{
 await api.setupFogEditor();assert.deepEqual(calls.map(c=>c[0]),['remove']);assert.equal(callbacks.length,0);
});
await check('dynamic engine lifecycle exports remain available',async()=>{
 assert.equal(typeof api.setupDynamicFog,'function');assert.equal(typeof api.teardownDynamicFog,'function');
});
await check('startup always cleans up independently of saved editor flags',async()=>{
 const background=readFileSync(join(root,'src/background.ts'),'utf8');
 assert.match(background,/OBR\.onReady\(async \(\) => \{\s*\/\/[^\n]*\n\s*void setupFogEditor\(\);/);
});
const report={sourceRoot:root,syntheticSdk:true,sceneDataWrites:0,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
