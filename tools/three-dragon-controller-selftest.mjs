#!/usr/bin/env node
import { build } from "rolldown";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "three-dragon-controller-"));
const file = join(directory, "selftest.mjs");
await build({ input: resolve("tools/three-dragon-controller-selftest.entry.ts"), platform: "node", output: { file, format: "esm", codeSplitting: false } });
execFileSync(process.execPath, [file], { stdio: "inherit" });
console.log(`Independent runnable controller evidence: ${file}`);
