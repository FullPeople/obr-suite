#!/usr/bin/env node
// Run the unchanged first-batch loader baseline before interpreting mutants.
import { build } from "rolldown";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
const outputRoot = resolve(tmpdir()), out = mkdtempSync(join(outputRoot, "suite-bestiary-loading-"));
try {
  const file = join(out, "baseline.mjs");
  await build({ input: resolve("tools/content-loading-selftest.entry.ts"), platform: "node", output: {file,format:"esm",banner:`
globalThis.window={location:{search:"",origin:"http://localhost",href:"http://localhost/"},addEventListener(){},removeEventListener(){},postMessage(){},parent:{postMessage(){}},setTimeout,clearTimeout};
globalThis.document={addEventListener(){},removeEventListener(){},createElement(){return {style:{},setAttribute(){},appendChild(){}}},documentElement:{style:{}}};globalThis.self=globalThis;
` } });
  process.stdout.write(execFileSync(process.execPath,[file],{encoding:"utf8",timeout:10000}));
} finally {
  if (dirname(out)!==outputRoot) throw Error("Unsafe temporary output path");
  rmSync(out,{recursive:true,force:true});
}
