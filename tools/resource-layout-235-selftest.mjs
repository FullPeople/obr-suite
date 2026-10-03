import assert from 'node:assert/strict';
import {resourceWidgetPresentation as pick,quickbarAttackPresentation as attacks,hiddenResourcePresentation as hidden,updateResourceWidgetPresentation as update} from '../src/workbench/resource-presentation.ts';
const shape={x:2,y:1,w:4,h:3,page:1,style:'ring',resourceArea:true,contentScale:1.35};
const doc={dnd_card_web:{runtime:{resources:{focus:{current:2,max:5}}},quickbarLayout:{widgets:{focus:shape},attacks:{...shape,x:0,y:0,w:4,h:6,page:0,split:.42},hidden:['resource:focus','resource:private','pin:private','resource:focus']}}};
const before=JSON.stringify(doc);
assert.deepEqual(pick(doc,[{id:'focus'}]).focus,shape);assert.equal(attacks(doc).split,.42);assert.equal(attacks(doc).resourceArea,true);assert.deepEqual(hidden(doc,[{id:'focus'}]),['resource:focus']);assert.deepEqual(hidden(doc,[]),[]);assert.equal(JSON.stringify(doc),before);
update(doc,'focus',{style:'ring',contentScale:1.6,resourceArea:true});assert.equal(pick(doc,[{id:'focus'}]).focus.contentScale,1.6);assert.equal(doc.dnd_card_web.runtime.resources.focus.current,2);
for(const invalid of [{contentScale:3},{resourceArea:'true'},{split:.9}]){const before=JSON.stringify(doc);assert.throws(()=>update(doc,'focus',{style:'ring',...invalid}));assert.equal(JSON.stringify(doc),before);}
console.log('PASS 235: geometry version, internal scale, split, authorized hidden IDs, update preservation and invalid atomicity');
// 237: the same bounded appearance/footprint passes the authorized projection.
const compact={...shape,x:0,y:0,w:1,h:1,contentScale:.25,background:'#dce8f2',borderWidth:0,borderRadius:6,padding:0,gap:0};
update(doc,'focus',compact);assert.deepEqual(pick(doc,[{id:'focus'}]).focus,compact);assert.equal(doc.dnd_card_web.runtime.resources.focus.current,2);
for(const invalid of [{background:'red'},{background:'url(https://example.com)'},{borderWidth:-1},{borderWidth:9},{borderRadius:33},{padding:17},{gap:.5},{gap:NaN},{w:0},{contentScale:.2}]){const before=JSON.stringify(doc);assert.throws(()=>update(doc,'focus',{...compact,...invalid}));assert.equal(JSON.stringify(doc),before);}
const legacy={web_resources:{focus:{current:1,max:3}},web_resource_widgets:{focus:{...compact,background:'transparent'}}};
assert.deepEqual(pick(legacy,[{id:'focus'}]).focus,{...compact,background:'transparent'});assert.deepEqual(Object.keys(pick(legacy,[])),[]);update(legacy,'focus',{style:'ring',borderWidth:3});assert.equal(pick(legacy,[{id:'focus'}]).focus.borderWidth,3);assert.equal(legacy.web_resources.focus.current,1);
console.log('PASS 237: compact one-cell projection, frame zeros/color/radius/gap, legacy roundtrip, resource preservation and invalid atomicity');
