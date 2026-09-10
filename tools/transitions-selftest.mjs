#!/usr/bin/env node
import { build } from "rolldown";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
const outputRoot = resolve(tmpdir());
const out = mkdtempSync(join(outputRoot, "suite-transitions-test-"));
const mutations = [
  { name: "trust a player as GM", file: "protocol.ts", from: ' && peer.role === "GM"', to: "" },
  { name: "replay duplicate events", file: "protocol.ts", from: "|| seen.has(event.id)", to: "" },
  { name: "accept a different scene", file: "protocol.ts", from: "event.sceneKey !== context.sceneKey", to: "false" },
  { name: "replay pre-join events", file: "protocol.ts", from: "event.issuedAt < context.readyAt", to: "false" },
  { name: "let players broadcast to everyone", file: "index.ts", from: ' || role !== "GM"', to: "" },
  { name: "capture pointers with the screen effect", file: "screen-effect.ts", from: ".disableHit(true)", to: ".disableHit(false)" },
  { name: "leave effects behind after cleanup", file: "screen-effect.ts", from: "void OBR.scene.local.deleteItems([effect.id]).catch(() => {});", to: "void Promise.resolve();" },
  { name: "close a newer modal after an old open resolves", file: "index.ts", from: "await closeNative(popoverId);", to: "await closeNative(`${DISPLAY_ID}/${displayId}`);" },
  { name: "rest closure cancels a newer portal effect", file: "index.ts", from: "await stopScreenTransition(closingId);", to: "await stopScreenTransition();" },
  { name: "ignore a role revocation while reading role", file: "index.ts", from: "revision !== roleRevision", to: "false" },
];
const runs = process.argv.includes("--mutations") ? mutations : [null];
try {
 for (const [index, mutation] of runs.entries()) {
  const file = join(out, `${index}.mjs`);
  let changed = false;
  await build({ input: resolve("tools/transitions-selftest.entry.ts"), platform: "node",
    plugins: [{ name: "transition-fixtures",
      resolveId(id, importer) {
        if (id === "@owlbear-rodeo/sdk") return resolve("tools/fixtures/transitions-sdk.ts");
        if (id === "../../state" && importer?.replaceAll("\\", "/").includes("/modules/transitions/")) return resolve("tools/fixtures/transitions-state.ts");
      },
      transform(code, id) {
        const path = id.replaceAll("\\", "/");
        if (path.endsWith("/src/asset-base.ts")) return code.replaceAll("import.meta.env.BASE_URL", '"/suite/"');
        if (mutation && path.endsWith(`/src/modules/transitions/${mutation.file}`)) {
          if (!code.includes(mutation.from)) throw Error(`Mutation no longer matches: ${mutation.name}`);
          changed = true;
          return code.replaceAll(mutation.from, mutation.to);
        }
      },
    }], output: { file, format: "esm", banner: `
globalThis.location = { origin: "http://localhost" };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
` } });
  if (mutation && !changed) throw Error(`No source mutated: ${mutation.name}`);
  if (!mutation) execFileSync(process.execPath, [file], { stdio: "inherit", timeout: 10_000 });
  else {
    try {
      execFileSync(process.execPath, [file], { stdio: "pipe", timeout: 10_000 });
      throw Error(`SURVIVED: ${mutation.name}`);
    } catch (error) {
      if (error.message?.startsWith("SURVIVED:") || !String(error.stderr ?? "").includes("ERR_ASSERTION")) throw error;
      console.log(`REJECTED: ${mutation.name}`);
    }
  }
 }
 if (process.argv.includes("--mutations")) console.log(`TRANSITIONS_MUTATIONS ${mutations.length}/${mutations.length}`);
} finally {
  if (dirname(resolve(out)) !== outputRoot) throw Error("Unexpected temporary output path");
  rmSync(out, { recursive: true, force: true });
}
