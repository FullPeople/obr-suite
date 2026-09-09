// Focused vision tests use real SDK builders with a controllable local-scene
// transport. Optional mutations affect only the temporary bundle.
import { build } from "rolldown";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const mutations = {
  "no-add-fold": ["reconcile/Patcher.ts", "for (const update of batch.updates.get(item.id) ?? []) update(item);", "/* omitted */"],
  "no-current-guard": ["reconcile/Patcher.ts", "this.guards.get(item.id)?.(item);", "/* omitted */"],
  "foreign-primary": ["reconcile/actors/LightActor.ts", 'this.lightType !== "SECONDARY" && !this.reveals ? "SECONDARY" : this.lightType', "this.lightType"],
  "share-always": ["runtime.ts", "return shareVision;", "return true;"],
  "private-card-blocks-vision": ["light/visionPolicy.ts", 'fromOwners(card.ownerIds, true)', 'fromOwners(card.ownerIds, card.visibility === "public")'],
  "creator-over-card": ["light/visionPolicy.ts", "if (bound) {", "if (false && bound) {"],
  "stale-read": ["reconcile/Reconciler.ts", "generation !== this.generation || revision !== this.readRevision", "false"],
  "old-ancestor": ["reconcile/Reconciler.ts", "this.currentItems.get(id) ?? null", "this.currentItems.get(id) ?? this.prevItems.get(id) ?? null"],
  "no-register-hook": ["reconcile/Reconciler.ts", "    this.refreshAccess();", "    void this.patcher.submitChanges();"],
  "ambient-bypass": ["light/occlusion.ts", "(actor.ambient && source.publicAmbient)", "actor.ambient"],
  "stale-batch": ["reconcile/Patcher.ts", "this.ready && batch.generation === this.generation", "this.ready"],
};
const chosen = process.argv.includes("--mutations") ? ["baseline", ...Object.keys(mutations)] : ["baseline"];
const banner = `
import.meta.env={BASE_URL:'/',DEV:false};
globalThis.window={location:{search:'',origin:'http://localhost',href:'http://localhost/'},addEventListener(){},removeEventListener(){},postMessage(){},parent:{postMessage(){}},setTimeout,clearTimeout};
globalThis.location=window.location;
globalThis.document={addEventListener(){},removeEventListener(){},createElement(){return {style:{},setAttribute(){},appendChild(){}};},documentElement:{style:{}}};
globalThis.localStorage={getItem(){return null;},setItem(){}};
globalThis.self=globalThis;
`;
const dir = mkdtempSync(join(tmpdir(), "suite-vision-test-"));
try {
  for (const name of chosen) {
    let applied = 0;
    const mutation = mutations[name];
    const file = join(dir, `${name}.mjs`);
    await build({input:resolve("tools/vision-selftest.entry.ts"), platform:"node", plugins: mutation ? [{
      name: "vision-mutation", transform(code,id) {
        if (!id.replaceAll("\\", "/").endsWith(mutation[0])) return;
        if (!code.includes(mutation[1])) throw Error(`Mutation target missing: ${name}`);
        applied++; return code.replaceAll(mutation[1], mutation[2]);
      },
    }] : [], output:{file,format:"esm",banner}});
    if (mutation && !applied) throw Error(`Mutation not applied: ${name}`);
    let failed = false;
    try { execFileSync(process.execPath,[file], {stdio: name === "baseline" ? "inherit" : "pipe"}); }
    catch(error) {
      failed = true;
      if (!mutation) throw error;
      const output = String(error.stdout) + String(error.stderr);
      if (!output.includes("ASSERTION:")) throw Error(`Mutation crashed instead of an assertion: ${name}\n${output}`);
    }
    if (mutation) { if (!failed) throw Error(`Mutation survived: ${name}`); console.log(`Mutation rejected: ${name}`); }
  }
} finally { rmSync(dir,{recursive:true,force:true}); }
