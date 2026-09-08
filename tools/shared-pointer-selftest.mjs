import { build } from "rolldown";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
const directory = mkdtempSync(join(tmpdir(), "shared-pointer-")), file = join(directory, "selftest.mjs");
const sourcePath = resolve("src/modules/sharedPointer/index.ts"), source = readFileSync(sourcePath, "utf8");
async function bundle(file, replacement) { await build({ input: resolve("tools/shared-pointer-selftest.entry.ts"), platform: "node", plugins: [{ name: "shared-pointer-host", resolveId(id) {
  if (id === "@owlbear-rodeo/sdk" || id === "../../state") return resolve("tools/fixtures/shared-pointer-sdk.ts");
}, load(id) { if (replacement && resolve(id) === sourcePath) return replacement; } }], output: { file, format: "esm" } }); }
await bundle(file);
execFileSync(process.execPath, [file, join(directory, "result.json")], { stdio: "inherit", timeout: 30000 });
if (process.argv.includes("--mutations")) {
  const mutations = [
    ["replayed-sequence", "if (packet.n <= lease.sequence) return;", "", "7777"],
    ["packet-supplied-identity", "...identity(peer)", "...identity({ ...peer, name: (value as any).name || peer.name })", "forged"],
    ["late-add-lifetime", "if (!valid()) { this.drawAgain = true; return; }", "", "late old-scene UUIDs"],
    ["false-cleanup-success", "if (this.pendingDeletes.size) throw failure ?? new Error(\"Shared pointer cleanup incomplete\");", "", "persistent cleanup failure"],
  ];
  const results = [];
  for (const [name, before, after, expected] of mutations) {
    if (!source.includes(before)) throw Error(`Mutation anchor missing: ${name}`);
    const mutant = join(directory, `${name}.mjs`); await bundle(mutant, source.replace(before, after));
    const result = spawnSync(process.execPath, [mutant, join(directory, `${name}.json`)], { encoding: "utf8", timeout: 30000 });
    const output = `${result.stdout}\n${result.stderr}`; writeFileSync(join(directory, `${name}.log`), output);
    if (result.status === 0 || !output.includes("AssertionError") || !output.includes(expected)) throw Error(`Mutation did not fail at expected contract: ${name}\n${output}`);
    results.push({ name, killed: true, expected }); console.log(`PASS: regression rejects ${name} mutation`);
  }
  writeFileSync(join(directory, "mutations.json"), JSON.stringify(results, null, 2));
}
console.log(`Shared pointer evidence: ${directory}`);
