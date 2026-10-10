import assert from 'node:assert/strict';
import {rolldown} from 'rolldown';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const out=mkdtempSync(join(tmpdir(),'music-transport-')),listeners=new Map(),sent=[],received=[];
globalThis.__MUSIC_SDK__={broadcast:{sendMessage:async(channel,data)=>{assert.ok(new TextEncoder().encode(JSON.stringify(data)).length<16384);sent.push({channel,data});},onMessage:(channel,fn)=>{listeners.set(channel,fn);return()=>listeners.delete(channel);}}};
const build=await rolldown({input:resolve('src/modules/musicBoard/transport.ts'),platform:'node',plugins:[{name:'fixture-sdk',resolveId:id=>id==='@owlbear-rodeo/sdk'?'fixture:sdk':undefined,load:id=>id==='fixture:sdk'?'export default globalThis.__MUSIC_SDK__;':undefined}]});const file=join(out,'transport.mjs');await build.write({file,format:'esm'});await build.close();
const{sendMusicMessage,onMusicMessage}=await import(pathToFileURL(file).href);const off=onMusicMessage('music',event=>received.push(event));
const deliver=(packet,sender='gm')=>listeners.get(packet.channel)?.({data:structuredClone(packet.data),connectionId:sender});
try{
 await sendMusicMessage('music',{tracks:'林间雨声'.repeat(2500)});assert.ok(sent.length>1);const packets=sent.splice(0);
 for(const packet of packets.slice(1).reverse())deliver(packet);assert.equal(received.length,0,'missing first fragment cannot publish partial state');
 deliver(packets[1]);assert.equal(received.length,0,'duplicate fragment does not finish early');deliver(packets[0]);assert.equal(received.length,1);assert.equal(received[0].data.tracks,'林间雨声'.repeat(2500));assert.equal(received[0].connectionId,'gm');
 await sendMusicMessage('music',{text:'x'.repeat(20000)});const other=sent.splice(0);
 for(const packet of other.slice(0,-1))deliver(packet,'one');deliver(other.at(-1),'two');assert.equal(received.length,1,'senders cannot complete each other\'s batch');deliver(other.at(-1),'one');assert.equal(received.length,2);
 await assert.rejects(()=>sendMusicMessage('music',{text:'x'.repeat(64001)}),/libraryFull/);assert.equal(sent.length,0,'oversized transfer sends nothing');
 deliver({channel:'music:part',data:{...other[0].data,id:'malformed',count:10000}});assert.equal(received.length,2);
 await sendMusicMessage('music',{value:42});assert.equal(sent.length,1);assert.equal(sent[0].channel,'music');deliver(sent[0]);assert.equal(received.at(-1).data.value,42);
 console.log('Music transport PASS: bounded real SDK messages, missing/out-of-order/duplicate fragments, authenticated sender separation, oversized rejection and small-message compatibility');
}finally{off();assert.equal(listeners.size,0);}
