import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {identifyBuiltDiceProfile} from './dice-diagnostic-profile.mjs';
const entries=['index','quick','effect2d','overlay2d'];
function temporary(t){const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'dice-profile-'));t.after(()=>{assert.equal(dirname(realpathSync(root)),parent);assert(basename(root).startsWith('dice-profile-'));rmSync(root,{recursive:true,force:true});});return root;}
function fixture(t){const root=temporary(t);mkdirSync(join(root,'workbench-dice'));for(const entry of entries){const text=`// Authored ${entry} source.`,hash=createHash('sha256').update(text).digest('hex').slice(0,12);writeFileSync(join(root,`workbench-dice/${entry}.js`),text);writeFileSync(join(root,`workbench-dice/${entry}.html`),`<script type="module" src="./${entry}.js?v=${hash}"></script>`);}return root;}
test('complete authored light files select the light validator contract',t=>{const result=identifyBuiltDiceProfile(fixture(t));assert.equal(result.mode,'light');assert.equal(Object.keys(result.files).length,8);});
test('an unknown empty build never defaults to light',t=>assert.throws(()=>identifyBuiltDiceProfile(temporary(t)),/ENOENT/));
for(const entry of entries){
 test(`missing ${entry} program rejects a partial light build`,t=>{const root=fixture(t);rmSync(join(root,`workbench-dice/${entry}.js`));assert.throws(()=>identifyBuiltDiceProfile(root),/ENOENT/);});
 test(`changed ${entry} program rejects a stale HTML identity`,t=>{const root=fixture(t);writeFileSync(join(root,`workbench-dice/${entry}.js`),'Authored changed bytes.');assert.throws(()=>identifyBuiltDiceProfile(root),/Stale or unexpected/);});
}
test('an extra module cannot hide behind a recognized light entry',t=>{const root=fixture(t),file=join(root,'workbench-dice/index.html');writeFileSync(file,readFileSync(file,'utf8')+'<script type="module" src="./extra.js"></script>');assert.throws(()=>identifyBuiltDiceProfile(root),/Unexpected module/);});
test('unmarked physical files never fall back to a valid light package',t=>{const root=fixture(t);mkdirSync(join(root,'dice3d'));writeFileSync(join(root,'dice3d/overlay.html'),'Authored unmarked physical entry.');assert.throws(()=>identifyBuiltDiceProfile(root),/Unidentified physical/);});
test('an invalid physical marker invokes the complete original production guard',t=>{const root=fixture(t);mkdirSync(join(root,'dice3d'));writeFileSync(join(root,'dice3d/production-build.json'),'{}');assert.throws(()=>identifyBuiltDiceProfile(root),/ENOENT|Missing production/);});
