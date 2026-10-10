import assert from 'node:assert/strict';
import {rolldown} from 'rolldown';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=mkdtempSync(join(tmpdir(),'music-library-'));
const bundle=await rolldown({input:resolve('src/modules/musicBoard/model.ts'),platform:'node'});
const file=join(out,'model.mjs');await bundle.write({file,format:'esm'});await bundle.close();
const {emptySession,reduceMusic,normaliseSession,decodeTracks,encodeLibrary,MAX_TRACKS,MAX_QUEUE}=await import(pathToFileURL(file).href);
let checks=0,serial=0;const test=(name,fn)=>{fn();console.log('PASS',++checks,name);};
const track=(id,bus='bgm')=>({id,url:`https://audio.example/${id}.ogg`,name:id,bus,loop:bus==='bgm',duration:30});
const change=(state,op)=>reduceMusic(state,op,`command-${++serial}`,10000+serial);
const seed=()=>change(emptySession(),{type:'add',tracks:[track('a'),track('b'),track('c','sfx')]});
test('legacy share codes retain bus, loop, duration and gain',()=>{
 const code='obrm1:'+Buffer.from(JSON.stringify({v:1,n:'Rain',u:'https://audio.example/rain.ogg',b:'sfx',l:false,vol:.3,d:7})).toString('base64url');
 const [rain]=decodeTracks(code);assert.equal(rain.name,'Rain');assert.equal(rain.bus,'sfx');assert.equal(rain.loop,false);assert.equal(rain.volume,.3);assert.equal(rain.duration,7);
});
test('external URL imports default BGM loops and SFX one-shots',()=>{
 assert.equal(decodeTracks('Rain\thttps://audio.example/rain.ogg')[0].name,'Rain');assert.equal(decodeTracks('https://audio.example/rain.ogg','sfx')[0].loop,false);
 assert.equal(decodeTracks('https://audio.example/rain.ogg')[0].loop,true);
 for(const text of ['https://audio.example/good.ogg\nfile:///local.ogg','javascript:alert(1)','https://user:pass@audio.example/private.ogg',JSON.stringify({tracks:[{blob:{},name:'local'}]})])assert.throws(()=>decodeTracks(text));
});
test('portable export retains URL, favorites, tags, group, color and volume',()=>{
 const original=decodeTracks(JSON.stringify({tracks:[{...track('a'),favorite:true,tags:['rain','forest'],group:'weather',color:'#58796a',volume:.45}]}));
 assert.deepEqual(decodeTracks(encodeLibrary(original)),original);assert.throws(()=>decodeTracks(JSON.stringify({format:'obr-music-library',version:2,tracks:original})));
 assert.deepEqual(decodeTracks(encodeLibrary([])),[]);assert.throws(()=>decodeTracks(''));
});
test('bad entries and over-capacity merges reject the whole update',()=>{
 const state=seed(),before=structuredClone(state);assert.throws(()=>change(state,{type:'add',tracks:[track('new'),{url:'file:///no'}]}));assert.deepEqual(state,before);
 const full=change(emptySession(),{type:'add',tracks:Array.from({length:MAX_TRACKS},(_,i)=>track('n'+i))});assert.equal(full.tracks.length,128);
 assert.throws(()=>change(full,{type:'add',tracks:[track('overflow')]}),/libraryFull/);assert.equal(full.tracks.length,128);
 assert.equal(change(state,{type:'add',tracks:[{...track('duplicate'),url:state.tracks[0].url}]}).tracks.length,3);
});
test('stale library edits and restoration cannot overwrite a newer collection',()=>{
 const first=seed(),newer=change(first,{type:'update',id:'a',track:{...track('a'),favorite:true},expectedLibraryRevision:first.libraryRevision});
 assert.throws(()=>change(newer,{type:'replace',tracks:[],expectedLibraryRevision:first.libraryRevision}),/staleLibrary/);
 assert.throws(()=>change(newer,{type:'remove',id:'a',expectedLibraryRevision:first.libraryRevision}),/staleLibrary/);assert.equal(newer.tracks[0].favorite,true);
});
test('library changes preserve the playing snapshot and prune missing queue IDs',()=>{
 let state=change(seed(),{type:'play',id:'a'});state=change(state,{type:'queue-many',ids:['a','b']});const voice=structuredClone(state.bgm);
 state=change(state,{type:'update',id:'a',track:{...track('a'),url:'https://audio.example/replaced.ogg'}});assert.deepEqual(state.bgm,voice);
 state=change(state,{type:'replace',tracks:[track('b')]});assert.deepEqual(state.bgm,voice);assert.deepEqual(state.queue,['b']);
 state=change(state,{type:'replace',tracks:[]});assert.equal(state.tracks.length,0);assert.equal(state.bgm.track.id,'a');
});
test('queue bulk-add, reordering and clear are atomic with a separate capacity',()=>{
 let state=change(seed(),{type:'queue-many',ids:['a','b','a']});const old=[...state.queue];
 state=change(state,{type:'queue-move',position:2,target:0,expectedQueue:old});assert.deepEqual(state.queue,['a','a','b']);
 assert.throws(()=>change(state,{type:'queue-remove',position:0,expectedQueue:old}),/staleQueue/);
 assert.throws(()=>change(state,{type:'queue-many',ids:['a','c']}),/invalidTrack/);assert.deepEqual(state.queue,['a','a','b']);
 state=change(state,{type:'queue-clear'});state=change(state,{type:'queue-many',ids:Array(MAX_QUEUE).fill('a')});assert.equal(state.queue.length,32);assert.throws(()=>change(state,{type:'queue',id:'b'}),/queueFull/);
});
test('previous playback uses bounded history and ignores unrelated volume revisions',()=>{
 let state=change(seed(),{type:'play',id:'a'});state=change(state,{type:'play',id:'b'});const revision=state.libraryRevision;
 state=change(state,{type:'volume',bus:'bgm',volume:.2});assert.equal(state.libraryRevision,revision);state=change(state,{type:'previous'});assert.equal(state.bgm.track.id,'a');assert.equal(state.history.length,0);
 assert.deepEqual(normaliseSession(state).tracks,state.tracks);assert.deepEqual(normaliseSession(state).history,state.history);
});
console.log(`Music library PASS: ${checks} transition/import/persistence groups`);
