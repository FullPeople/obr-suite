// Build the public compatibility entry, then inspect emitted bytes and run its
// only inline return handler in a bounded VM. Historical game tests are separate.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'..'),out=join(root,'.local-evidence/three-dragon-website-entry'),website='https://obr.dnd.center/three-dragon-ante/';mkdirSync(out,{recursive:true});
const template=readFileSync(join(root,'tools/three-dragon-website-entry.html'),'utf8').replaceAll('\r\n','\n');
const checks=[];function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
function inspect(html){
 assert.ok(html.includes('<title>三龙牌 · 线上网站</title>'),'public website title');
 assert.doesNotMatch(html,/<iframe\b|<script\b[^>]*\bsrc\s*=|type=["']module["']|WebSocket|\bfetch\s*\(|owlbear-rodeo|OBR_|panel-sdk|server-session|table-app|\/three-dragon-api\//i,'public entry cannot load the retired game, SDK or API');
 const links=[...html.matchAll(/<a\b([^>]*)>/gi)];assert.equal(links.length,2);
 for(const [,attrs] of links){assert.ok(attrs.includes(`href="${website}"`));assert.ok(attrs.includes('target="_blank"'));assert.ok(attrs.includes('rel="noopener noreferrer"'));}
 const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);assert.equal(scripts.length,1,'one local close handler only');
 for(const embedded of [false,true]){const sent=[],button={hidden:true,addEventListener(type,fn){assert.equal(type,'click');this.click=fn;}},window={},parent=embedded?{postMessage:(...args)=>sent.push(args)}:window;
  Object.assign(window,{parent});const context=vm.createContext({window,parent,location:{origin:'https://fixture.invalid',pathname:embedded?'/suite-dev/workbench-panels/table.html':'/suite/three-dragon-ante.html'},document:{getElementById:id=>{assert.equal(id,'return');return button;}}});
  vm.runInContext(scripts[0],context,{timeout:1000});assert.equal(button.hidden,!embedded);if(embedded){button.click();assert.deepEqual(JSON.parse(JSON.stringify(sent)),[[{channel:'workbench-panel-frame/v1',close:true},'https://fixture.invalid']]);}else assert.equal(sent.length,0);
 }
}
check('approved website template is link-only and preserves same-origin return behavior',()=>inspect(template));
const tmp=mkdtempSync(join(tmpdir(),'suite-website-entry-'));
const built=spawnSync(process.execPath,[join(root,'tools/build-workbench-panels.mjs')],{cwd:root,env:{...process.env,WORKBENCH_PANEL_ONLY:'table',WORKBENCH_PANEL_OUT:tmp},encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});writeFileSync(join(out,'panel-build.log'),(built.stdout||'')+(built.stderr||''));assert.equal(built.status,0,'actual table-only panel builder completes');
check('actual panel builder emits a link-only table page',()=>inspect(readFileSync(join(tmp,'table.html'),'utf8')));
check('root public compatibility entry matches the approved static template',()=>assert.equal(readFileSync(join(root,'three-dragon-ante.html'),'utf8').replaceAll('\r\n','\n'),template));
for(const [name,html] of [['old game module',template.replace('</body>','<script type="module" src="./table-old.js"></script></body>')],['embedded old game',template.replace('</body>','<iframe src="./legacy.html"></iframe></body>')],['wrong destination',template.replaceAll(website,'https://example.invalid/legacy')],['game transport',template.replace('<script>','<script>new WebSocket("wss://example.invalid");')]])check('negative control rejects '+name,()=>assert.throws(()=>inspect(html)));
if(process.env.WEBSITE_ENTRY_NEGATIVE_DIR)for(const name of ['root.html','table.html'])check('original baseline '+name+' is rejected by the same product inspector',()=>assert.throws(()=>inspect(readFileSync(join(resolve(process.env.WEBSITE_ENTRY_NEGATIVE_DIR),name),'utf8'))));
if(process.argv.includes('--built'))for(const [name,file] of [['stable public entry',join(root,'dist/three-dragon-ante.html')],['dev public entry',join(root,'dist-workbench-dev/three-dragon-ante.html')],['final dev panel entry',join(root,'dist-workbench-dev/workbench-panels/table.html')]])check(name+' is link-only after the complete standard build',()=>inspect(readFileSync(file,'utf8')));
writeFileSync(join(out,'results.json'),JSON.stringify({passed:true,actualPanelBuild:true,builtHostEntries:process.argv.includes('--built'),browser:false,liveWebsite:false,historicalGameplay:false,checks},null,2)+'\n');
console.log(`${checks.length} website entry checks passed`);
