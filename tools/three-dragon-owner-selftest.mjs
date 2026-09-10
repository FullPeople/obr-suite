#!/usr/bin/env node
import assert from 'node:assert/strict';
import { build } from 'rolldown';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..'), output = mkdtempSync(join(tmpdir(), 'tda-owner-'));
const source = 'extensions/three-dragon-ante/src/game/';
const files = ['controller.ts', 'controller-platform.ts', 'protocol.ts', 'private-channel.ts', 'wire.ts', 'rules/engine.ts', 'rules/projection.ts'];
const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(root, source, file))).digest('hex')]));
const pins = hashes(), mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
const mutations = {
  role: { anchor: 'private async create(): Promise<void> {', replacement: 'private async create(): Promise<void> { if ((this.self as any).role !== "GM") { this.fail("notHost"); return; }', assertion: 'ordinary PLAYER creates the authoritative lobby with its own player and connection identity' },
  owner: { anchor: 'if (member.id !== table.hostPlayerId) { await reject("notHost"); return; }', replacement: 'if (false) { await reject("notHost"); return; }', assertion: 'non-creator PLAYER cannot start the lobby' },
  connection: { anchor: 'if (member.id !== table.hostPlayerId) { await reject("notHost"); return; }', replacement: 'if (member.id !== table.hostPlayerId || connection !== this.self.connectionId) { await reject("notHost"); return; }', assertion: 'same-player second live connection can request start from the active owner connection' },
};
if (mutant) assert.ok(Object.hasOwn(mutations, mutant), 'known owner test mutant');
let applied = false;
await build({ input: join(root, 'tools/three-dragon-owner-selftest.entry.ts'), platform: 'node', plugins: [{
  name: 'owner-sdk-boundary-and-explicit-mutants',
  resolveId(id) { if (id === '@owlbear-rodeo/sdk') return '\0owner-sdk'; },
  load(id) { if (id === '\0owner-sdk') return 'export default globalThis.__ownerTestSDK;'; },
  transform(raw, id) {
    if (!mutant || !id.replaceAll('\\', '/').endsWith('/game/controller.ts')) return;
    const code = raw.replaceAll('\r\n', '\n'), change = mutations[mutant];
    assert.equal(code.split(change.anchor).length - 1, 1, 'exactly one owner mutation anchor'); applied = true;
    return code.replace(change.anchor, change.replacement);
  },
  buildEnd(error) { if (!error && mutant) assert.ok(applied, 'owner mutation actually applied'); },
}], output: { file: join(output, 'test.mjs'), format: 'esm', codeSplitting: false }, logLevel: 'silent' });
writeFileSync(join(output, 'pins.json'), JSON.stringify({ pins, mutant: mutant ?? null, mutationApplied: applied }, null, 2));
let failure;
try { execFileSync(process.execPath, [join(output, 'test.mjs')], { stdio: 'inherit', env: { ...process.env, OWNER_TEST_OUTPUT: output } }); } catch (error) { failure = error; }
assert.deepEqual(hashes(), pins, 'owner test source stayed fixed during the run');
if (mutant) {
  assert.ok(failure, 'mutant must fail its designated behavioral assertion');
  assert.ok(existsSync(join(output, 'failure.json')), 'mutant needs a runtime assertion record, not a build/process failure');
  const result = JSON.parse(readFileSync(join(output, 'failure.json'), 'utf8'));
  assert.equal(result.assertion, mutations[mutant].assertion, 'specific owner authorization behavior killed the mutation');
  writeFileSync(join(output, 'mutation-result.json'), JSON.stringify({ mutant, applied, assertion: result.assertion, killed: true }, null, 2));
  console.log(`KILL ${mutant}: ${output}`);
} else if (failure) throw new Error(`Owner test failed: ${output}`, { cause: failure });
else console.log(`OWNER PASS: ${output}`);
