import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classSummary} from '../src/workbench/class-summary.ts';
test('class list summaries preserve identity and rule declarations without private character content',()=>{
 const entry={id:'test-class',kind:'class',name:'测试职业',english:'Fixture',source:'PHB',edition:'2014',packId:'fixture',revision:'1',entries:['正文不随列表传输'],raw:{hd:{faces:8},classFeatures:['Ability|Fixture|PHB|1'],_custom:true,entries:['正文'],fluff:{images:['private-image']}},effects:[]};
 const doc={dnd_card_web:{name:'private-name',notes:'private-notes',portrait:{data:'private-portrait'},selections:[{id:'c',entry,level:3},{id:'i',entry:{kind:'item'}}]}};
 const summary=classSummary(doc);assert.equal(summary.length,1);assert.equal(summary[0].entry.id,entry.id);assert.deepEqual(summary[0].entry.raw,{hd:{faces:8},classFeatures:['Ability|Fixture|PHB|1'],_custom:true});assert(!JSON.stringify(summary).includes('private'));assert.deepEqual(classSummary({classes:[{name:'传统职业',level:2}]})[0].entry.source,'IMPORTED');
});
