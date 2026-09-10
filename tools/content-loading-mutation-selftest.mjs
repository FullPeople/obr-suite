#!/usr/bin/env node
// Mutate isolated test bundles only; the shared product source stays intact.
import { build } from "rolldown";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";

const banner = `
globalThis.window = {
  location: { search: "", origin: "http://localhost", href: "http://localhost/" },
  addEventListener() {}, removeEventListener() {}, postMessage() {},
  parent: { postMessage() {} }, setTimeout, clearTimeout,
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
  documentElement: { style: {} },
};
globalThis.self = globalThis;
`;
const mutations = [
  { name: "unbounded JSON concurrency", file: "utils/contentRequests.ts", from: "active < limit", to: "true" },
  { name: "stalled request never times out", file: "utils/contentRequests.ts", from: "}, timeoutMs);", to: "}, timeoutMs * 1000);", timeout: true },
  { name: "queued cancellation still sends the request", file: "utils/contentRequests.ts", from: "if (index >= 0) queue.splice(index, 1);", to: "settled = false;" },
  { name: "late preview may replace current selection", file: "utils/contentRequests.ts", from: "own === generation", to: "true" },
  { name: "source deadline ignores progress", file: "utils/contentRequests.ts", from: "if (timer !== undefined) clearTimeout(timer);", to: "/* no deadline renewal */" },
  { name: "file merge follows response order", file: "utils/contentRequests.ts", from: "result[index] = await fn(items[index], index);", to: "result.push(await fn(items[index], index));" },
  { name: "preview leaks unresolved copies", file: "modules/bestiary/data.ts", from: ".filter((m: any) => m && !m._copy)", to: ".filter((m: any) => !!m)" },
  { name: "missing copy parent becomes zero-stat unit", file: "modules/bestiary/data.ts", from: "if (!complete)", to: "if (false)" },
  { name: "healthy library cut off at fixed source deadline", file: "modules/bestiary/data.ts", from: "sourceDeadline.progress();", to: "/* fixed total deadline */" },
  { name: "result cap removed", file: "modules/bestiary/data.ts", from: ".slice(0, 200)", to: ".slice(0)" },
];
const outputRoot = resolve(tmpdir());
const out = mkdtempSync(join(outputRoot, "suite-content-mutations-"));
try {
  for (const [index, mutation] of mutations.entries()) {
    let changed = false;
    const bundle = join(out, `${index}.mjs`);
    await build({ input: resolve("tools/content-loading-selftest.entry.ts"), platform: "node", plugins: [{
      name: "content-regression-mutation",
      transform(code, id) {
        if (!id.replaceAll("\\", "/").endsWith(`/src/${mutation.file}`)) return;
        if (!code.includes(mutation.from)) throw Error(`Mutation no longer matches: ${mutation.name}`);
        changed = true;
        return code.replaceAll(mutation.from, mutation.to);
      },
    }], output: { file: bundle, format: "esm", banner } });
    if (!changed) throw Error(`No source mutated: ${mutation.name}`);
    try {
      execFileSync(process.execPath, [bundle], { stdio: "pipe", timeout: 2500 });
      throw Error(`SURVIVED: ${mutation.name}`);
    } catch (error) {
      if (error.message?.startsWith("SURVIVED:")) throw error;
      if (!(mutation.timeout && error.code === "ETIMEDOUT") && !String(error.stderr ?? "").includes("ERR_ASSERTION")) throw error;
      console.log(`REJECTED: ${mutation.name}`);
    }
  }
  console.log(`CONTENT_LOADING_MUTATIONS ${mutations.length}/${mutations.length}`);
} finally {
  if (dirname(resolve(out)) !== outputRoot) throw Error("Unexpected temporary output path");
  rmSync(out, { recursive: true, force: true });
}
