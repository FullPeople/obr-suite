import { build } from 'rolldown';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const file = join(mkdtempSync(join(tmpdir(), 'three-dragon-stable-recovery-')), 'selftest.mjs');
await build({ input: resolve('tools/three-dragon-stable-recovery-selftest.entry.ts'), platform: 'node', output: { file, format: 'esm', codeSplitting: false } });
execFileSync(process.execPath, [file], { stdio: 'inherit' });
