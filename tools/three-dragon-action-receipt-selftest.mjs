#!/usr/bin/env node
import { build } from "rolldown";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const directory = mkdtempSync(join(tmpdir(), "three-dragon-action-receipt-"));
const sources = ["extensions/three-dragon-ante/src/game/protocol.ts", "extensions/three-dragon-ante/src/game/controller.ts", "extensions/three-dragon-ante/src/game/local-view.ts", "tools/fixtures/three-dragon-controller-room.ts", "tools/three-dragon-action-receipt-selftest.entry.ts", "tools/three-dragon-action-receipt-selftest.mjs"];
const pins = () => Object.fromEntries(sources.map(p => [p, createHash("sha256").update(readFileSync(p)).digest("hex")]));
const before = pins();
const file = join(directory, "selftest.mjs");
await build({ input: resolve("tools/three-dragon-action-receipt-selftest.entry.ts"), platform: "node", output: { file, format: "esm", codeSplitting: false } });
let output;
try { output = execFileSync(process.execPath, [file], { encoding: "utf8", timeout: 45000 }); }
catch (error) { writeFileSync(join(directory, "failed.txt"), `${error.stdout ?? ""}\n${error.stderr ?? ""}`); console.error(directory); throw error; }
const mutations = [
  { name: "wrong-request-accepted", before: "receipt.requestId !== this.pending.request.requestId || ", after: "", assertion: "Unmatched requestId cannot acknowledge an outstanding action" },
  { name: "snapshot-acks-before-validation", before: "    if (table.revision < this.summary.revision || table.revision < this.gameTableRevision) return;", after: "    if (record(payload.receipt)) this.acceptReceipt(payload.receipt as unknown as Receipt);\n    if (table.revision < this.summary.revision || table.revision < this.gameTableRevision) return;", assertion: "Invalid private snapshot cannot produce an early receipt" },
  { name: "ack-inherits-later-revision", before: "revision: action.revision + (receipt.ok ? 1 : 0)", after: "revision: receipt.ok ? this.game.revision : action.revision", assertion: "Late ACK uses original applied revision, not latest snapshot revision" },
];
const mutantResults = [];
for (const mutation of mutations) {
  const mutant = join(directory, `${mutation.name}.mjs`);
  let changed = false;
  // Compilation must succeed; only the named behavioral assertion counts.
  await build({ input: resolve("tools/three-dragon-action-receipt-selftest.entry.ts"), platform: "node",
    plugins: [{ name: mutation.name, load(id) {
      if (id.replaceAll("\\", "/").endsWith("/game/controller.ts")) {
        const original = readFileSync(id, "utf8");
        if (original.split(mutation.before).length !== 2) throw Error(`Mutation anchor is not unique: ${mutation.name}`);
        changed = true; return original.replace(mutation.before, mutation.after);
      }
    } }], output: { file: mutant, format: "esm", codeSplitting: false } });
  if (!changed) throw Error(`Mutation did not load: ${mutation.name}`);
  let failure;
  try { execFileSync(process.execPath, [mutant], { encoding: "utf8", timeout: 45000, stdio: "pipe" }); }
  catch (error) { failure = error; }
  const stderr = String(failure?.stderr ?? ""), stdout = String(failure?.stdout ?? "");
  writeFileSync(join(directory, `${mutation.name}.txt`), `${stdout}\n${stderr}`);
  if (!failure || !stderr.includes("AssertionError") || !stderr.includes(mutation.assertion)) throw Error(`Mutant did not fail its specified assertion: ${mutation.name}`);
  mutantResults.push({ name: mutation.name, compiled: true, rejectedBy: mutation.assertion });
}
const after = pins();
if (JSON.stringify(before) !== JSON.stringify(after)) throw Error("Source changed during action-receipt verification");
writeFileSync(join(directory, "result.txt"), output);
writeFileSync(join(directory, "source-pins.json"), JSON.stringify(after, null, 2));
writeFileSync(join(directory, "mutations.json"), JSON.stringify(mutantResults, null, 2));
console.log(output); console.log(`${mutantResults.length} compiled mutations rejected by their specific behavioral assertions.`); console.log(`Action receipt evidence: ${directory}`);
