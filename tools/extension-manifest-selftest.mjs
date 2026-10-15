import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Observed in Owlbear's actual manifest validator: version is limited to 16 characters.
function checkVersion(version) {
  assert.equal(typeof version, 'string');
  assert.ok(version.length > 0 && version.length <= 16, 'Owlbear extension version must contain 1–16 characters');
}
assert.throws(() => checkVersion('1.0.297-dev.credits.1'));
checkVersion('1.0.297-dev.c1');
for (const file of ['../public/manifest.json', '../public/manifest-dev.json']) {
  const manifest = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
  checkVersion(manifest.version);
  assert.equal(manifest.manifest_version, 1);
}
console.log('Owlbear manifest versions satisfy the actual 16-character limit.');
