// Harness construction only. This does not execute a browser or validate product pixels.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('tools/dice-latency-browser.mjs','utf8'),old=readFileSync('tools/workbench-dice3d-sdk-probe.mjs','utf8');
let template=old.slice(old.indexOf('res.end(`')+9,old.indexOf('`);});'));
assert(template.includes('${JSON.stringify(base)}'));
template=template.replace('${JSON.stringify(base)}',JSON.stringify('http://127.0.0.1:5236/suite-dev/')).replace("frame('sdk-verify.html','background')","frame('extensions/workbench-dice3d/sdk-verify.html','background')");
for(const theme of ['stage6_calibration','brushed_metal','godot_blue_cat_eye','royal_ember_resin','ink_sketch']){
 const result=template.replace('metadata:{},ids:[]','metadata:{"com.obr-suite/dice/3d-theme":'+JSON.stringify(theme)+'},ids:[]');
 assert(result.includes('"com.obr-suite/dice/3d-theme":"'+theme+'"'));
 new vm.Script(result.match(/<script>([\s\S]*?)<\/script>/)[1]);
}
assert(source.includes('for(const count of [1,2,5,9,10])'));
assert(source.includes("fault==='late-chunks'?'10d6+2'"));
assert(source.includes("'fault actually injected: '+fault"));
assert(source.includes('mobileDevice:false'));
assert(source.includes('CPU return from WebGL render; GPU presentation not measured'));
assert(source.includes('firstSubmittedFrameMs'));
assert(!source.includes('firstPresentedFrameMs'));
console.log(JSON.stringify({success:true,checks:12,boundary:'Harness syntax, matrix controls and explicit CPU-vs-presented distinction only; no browser run.'}));
