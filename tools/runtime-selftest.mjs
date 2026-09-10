#!/usr/bin/env node
// Bundle a focused TypeScript regression test with the installed build tools.
// node tools/runtime-selftest.mjs tools/module-lifecycle-selftest.entry.ts
import { build } from "rolldown";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const entry = process.argv[2];
if (!entry) throw new Error("Supply a test entry file");
const out = mkdtempSync(join(tmpdir(), "suite-runtime-test-"));
try {
  const bundle = join(out, "test.mjs");
  await build({
    input: resolve(entry),
    platform: "node",
    plugins: process.argv.includes("--sdk-mock") ? [{
      name: "test-sdk",
      resolveId(id) {
        if (id === "@owlbear-rodeo/sdk") return resolve("tools/fixtures/state-sdk.ts");
      },
    }] : [],
    output: { file: bundle, format: "esm" },
  });
  execFileSync(process.execPath, [bundle], { stdio: "inherit" });
} finally {
  // Only this freshly created OS temporary directory is removed.
  rmSync(out, { recursive: true, force: true });
}
