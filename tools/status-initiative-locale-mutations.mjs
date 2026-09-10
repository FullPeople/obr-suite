import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const out = mkdtempSync(join(tmpdir(), "status-initiative-mutants-")), results = [];
for (const [runner, variable, mutant, expected] of [
  ["status-initiative-locale-selftest.mjs", "STATUS_INITIATIVE_LOCALE_MUTANT", "custom-signature", "hide customization"],
  ["status-initiative-locale-selftest.mjs", "STATUS_INITIATIVE_LOCALE_MUTANT", "mutable-signature", "hide customization"],
  ["status-initiative-locale-selftest.mjs", "STATUS_INITIATIVE_LOCALE_MUTANT", "language-closes-draft", "palette language switch retains"],
  ["status-initiative-locale-selftest.mjs", "STATUS_INITIATIVE_LOCALE_MUTANT", "duplicate-commit", "exactly once"],
  ["initiative-edit-selftest.mjs", "INITIATIVE_EDIT_MUTANT", "draft-ownership", "SDK draft rejects ownership"],
  ["initiative-edit-selftest.mjs", "INITIATIVE_EDIT_MUTANT", "scene-lifetime", "scene unload/reopen"],
]) {
  const result = spawnSync(process.execPath, [`tools/${runner}`], { env: { ...process.env, [variable]: mutant }, encoding: "utf8", timeout: 45000 });
  const output = `${result.stdout}\n${result.stderr}`; writeFileSync(join(out, `${mutant}.log`), output);
  assert.ok(result.status !== 0 && output.includes("AssertionError") && output.includes(expected), `${mutant} did not fail at its intended contract:\n${output}`);
  results.push({ mutant, killed: true, expected }); console.log(`PASS: ${mutant} rejected by its regression`);
}
writeFileSync(join(out, "result.json"), JSON.stringify(results, null, 2)); console.log(`Mutation evidence: ${out}`);
