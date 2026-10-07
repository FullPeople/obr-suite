import {cpSync,mkdirSync,renameSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import assert from 'node:assert/strict';
import {verifyProductionDice} from './dice-production-package.mjs';

const root=resolve('dist-workbench-dev/dice3d'),out=resolve(process.env.DND_DICE_PACKAGE_EVIDENCE||'.local-evidence/production-dice/package');
mkdirSync(out,{recursive:true});
const verified=verifyProductionDice(root),copy=join(out,'negative-copy/dice3d');
cpSync(root,copy,{recursive:true,errorOnExist:true,force:false});
const manifest=JSON.parse(readFileSync(join(copy,'production-build.json'),'utf8'));
for(const name of Object.keys(manifest.hostFiles)){const path=join(copy,'..',name);mkdirSync(dirname(path),{recursive:true});cpSync(join(root,'..',name),path);}
const checks=['complete actual production tree accepted'];
renameSync(join(copy,'overlay.html'),join(copy,'overlay.html.withheld'));
assert.throws(()=>verifyProductionDice(copy),/ENOENT|Missing production/);
renameSync(join(copy,'overlay.html.withheld'),join(copy,'overlay.html'));
checks.push('missing overlay rejected');
const font=join(copy,'assets/fonts/Cinzel-Variable.ttf'),bytes=readFileSync(font);
writeFileSync(font,Buffer.concat([bytes,Buffer.from('authored negative control')]));
assert.throws(()=>verifyProductionDice(copy),/Incomplete or changed/);
writeFileSync(font,bytes);checks.push('changed native font bytes rejected');
const worker=Object.keys(manifest.hostFiles).find(name=>name.startsWith('assets/physics.worker-'));
const workerPath=join(copy,'..',worker);renameSync(workerPath,workerPath+'.withheld');
assert.throws(()=>verifyProductionDice(copy),/Incomplete or changed production host/);
renameSync(workerPath+'.withheld',workerPath);checks.push('missing host physics worker rejected');
manifest.sourceDirty=true;writeFileSync(join(copy,'production-build.json'),JSON.stringify(manifest));
assert.throws(()=>verifyProductionDice(copy),/dirty source/);checks.push('dirty-source artifact rejected');
writeFileSync(join(out,'result.json'),JSON.stringify({passed:checks.length,productionFiles:verified.files,pinnedAssets:verified.pinnedAssets,syntheticNegativeControlsOnly:true,checks},null,2)+'\n');
console.log(JSON.stringify({passed:checks.length,...verified}));
