// Production LOCAL gates executed with a synthetic SDK boundary, not a live room.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'..');
function declaration(file,name){
 const source=ts.createSourceFile(file,readFileSync(resolve(root,file),'utf8'),ts.ScriptTarget.Latest,true);let found;
 const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node.getText(source);ts.forEachChild(node,visit);};visit(source);
 assert(found,name);return found;
}
let identity='first',pending;
const commands=[];
const context=vm.createContext({console,Promise,epoch:1,active:true,alive:true,panelInstance:'view',panelClient:'client',OBR:{player:{getConnectionId:async()=>pending?new Promise(resolve=>{pending=resolve;}):identity}},readUIDraft:()=>null,ensureController:async()=>{},requestView:()=>{},syncPanel:async()=>{},controller:{command:async command=>commands.push(command)}});
const source=declaration('src/modules/threeDragonAnte/index.ts','localSender')+'\n'+declaration('src/modules/threeDragonAnte/index.ts','localCommand')+'\n'+declaration('src/modules/threeDragonAnte/page.ts','localViewSender');
vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
const envelope={instance:'view',clientId:'client',command:{type:'join'}};
await context.localCommand(envelope,'first');assert.equal(commands.length,1);
identity='reconnected';
await context.localCommand(envelope,'first');assert.equal(commands.length,1);
await context.localCommand(envelope,'reconnected');assert.equal(commands.length,2);
assert.equal(await context.localViewSender('first'),false);assert.equal(await context.localViewSender('reconnected'),true);
pending=true;const delayed=context.localSender('reconnected');await Promise.resolve();context.epoch=2;pending('reconnected');pending=undefined;assert.equal(await delayed,false);
pending=true;const hidden=context.localViewSender('reconnected');await Promise.resolve();context.alive=false;pending('reconnected');pending=undefined;assert.equal(await hidden,false);
console.log('PASS actual LOCAL command/view guards accept new connection, reject old senders and discard delayed teardown replies');
