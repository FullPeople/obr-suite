#!/usr/bin/env node
import { build } from "rolldown";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "cc-entry-")), file = join(directory, "selftest.mjs");
await build({ input: resolve("tools/cc-entry-selftest.entry.ts"), platform: "node", plugins: [{ name: "cc-entry-ports", resolveId(id) {
  if (["@owlbear-rodeo/sdk", "../../state", "../../asset-base", "../../utils/viewportAnchor", "../../utils/panelLayout"].includes(id)) return resolve("tools/fixtures/cc-entry-sdk.ts");
} }], output: { file, format: "esm" } });
execFileSync(process.execPath, [file], { stdio: "inherit" });
console.log(`Runnable entry evidence: ${file}`);
if (process.argv.includes("--mutants")) {
  const mutations = [
    ["owner-assignment", 'const owns = owners.length ? owners.includes(ccMyId) : item.createdUserId === ccMyId;', 'const owns = item.createdUserId === ccMyId;'],
    ["pinned-permission", 'function revokeInvalidInfo(): void {', 'function revokeInvalidInfo(): void { if (isCcInfoPinned()) return;'],
    ["selection-generation", 'const valid = () => current(run, scene) && selectionGeneration === request;', 'const valid = () => current(run, scene);'],
    ["iframe-url-stability", 'openedInfoUrl ||=', 'openedInfoUrl ='],
    ["foreign-ready", 'if (alive() && localEvent(event.connectionId)) void sendInfoTarget();', 'if (alive()) void sendInfoTarget();'],
    ["binding-at-write", 'if (!valid() || d.metadata[BIND_META] !== cardId) continue;', 'if (!valid()) continue;'],
    ["legacy-bubbles-fields", 'd.metadata[EXTERNAL_BUBBLES_META_KEY] = { ...ext, ...next };', 'd.metadata[EXTERNAL_BUBBLES_META_KEY] = next;'],
  ];
  for (const [name, before, after] of mutations) {
    let applied = false;
    const mutant = join(directory, `${name}.mjs`);
    await build({ input: resolve("tools/cc-entry-selftest.entry.ts"), platform: "node", plugins: [{ name: "cc-entry-mutant", resolveId(id) {
      if (["@owlbear-rodeo/sdk", "../../state", "../../asset-base", "../../utils/viewportAnchor", "../../utils/panelLayout"].includes(id)) return resolve("tools/fixtures/cc-entry-sdk.ts");
    }, transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/src/modules/characterCards/index.ts")) return;
      if (code.split(before).length !== 2) throw Error(`Mutation ${name} no longer matches exactly once`);
      applied = true; return code.replace(before, after);
    } }], output: { file: mutant, format: "esm" } });
    if (!applied) throw Error(`Mutation ${name} was not applied`);
    const result = spawnSync(process.execPath, [mutant], { encoding: "utf8", timeout: 10000 });
    writeFileSync(join(directory, `${name}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    if (result.error || result.signal || result.status === 0 || !/AssertionError|Error: (?:pin cannot|owner removal|C read wins)/.test(result.stderr)) throw Error(`Mutation ${name} did not fail with the intended runtime assertions: ${result.stderr}`);
    console.log(`KILLED: ${name}`);
  }
}
