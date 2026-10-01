import assert from 'node:assert/strict';
import {resourceWidgetPresentation as pick,updateResourceWidgetPresentation as update} from '../src/workbench/resource-presentation.ts';
const valid={style:'ring',x:0,y:0,w:4,h:2,page:0};const widgets={visible:{...valid,privateNote:'not transport'},hidden:{...valid},invalid:{...valid,x:11},badStyle:{...valid,style:'script'}};
const doc={dnd_card_web:{name:'not transport',quickbarLayout:{widgets}}},before=JSON.stringify(doc);
assert.deepEqual(JSON.parse(JSON.stringify(pick(doc,[{id:'visible'},{id:'invalid'},{id:'missing'},{id:'badStyle'}]))),{visible:valid});assert.equal(JSON.stringify(doc),before);
assert.deepEqual(Object.keys(pick(doc,[])),[]);assert.deepEqual(Object.keys(pick({},[{id:'visible'}])),[]);
Object.defineProperty(widgets,'__proto__',{value:valid,enumerable:true});assert.equal(Object.getPrototypeOf(pick(doc,[{id:'__proto__'}])),null);assert.deepEqual(Object.keys(pick(doc,[{id:'__proto__'}])),['__proto__']);
console.log('resource presentation: authorized IDs, whitelist, invalid geometry/style, no mutation, empty, prototype-safe passed');

const native={dnd_card_web:{quickbarLayout:{order:['keep'],hidden:[],widgets:{visible:{...valid,x:5}}}},web_resource_widgets:{visible:{...valid,style:'icon'}}};
update(native,'visible',{style:'square'});assert.equal(native.dnd_card_web.quickbarLayout.widgets.visible.x,5);assert.equal(native.dnd_card_web.quickbarLayout.widgets.visible.style,'square');assert.equal(native.web_resource_widgets,undefined);assert.deepEqual(native.dnd_card_web.quickbarLayout.order,['keep']);
const legacy={web_resources:{visible:{current:2,max:7}}};update(legacy,'visible',{style:'icon'});assert.equal(legacy.dnd_card_web,undefined);assert.equal(pick(legacy,[{id:'visible'}]).visible.style,'icon');assert.equal(legacy.web_resources.visible.current,2);
const old=JSON.stringify(legacy);assert.throws(()=>update(legacy,'visible',{style:'script'}));assert.throws(()=>update(legacy,'visible',{style:'bar',x:12}));assert.equal(JSON.stringify(legacy),old);
update(legacy,'visible',null);assert.deepEqual(Object.keys(pick(legacy,[{id:'visible'}])),[]);update(legacy,'visible',valid);assert.deepEqual(pick(legacy,[{id:'visible'}]).visible,valid);
assert.deepEqual(Object.keys(pick({dnd_card_web:{},web_resource_widgets:{visible:valid}},[{id:'visible'}])),[]);
console.log('resource presentation writes: native geometry, legacy fallback, native precedence, deletion/restoration, invalid atomicity passed');
