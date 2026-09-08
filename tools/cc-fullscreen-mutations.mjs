import { spawnSync } from "node:child_process";
const targets = { 'raw-draft': 'HP raw draft and focus survive language change', 'stale-read': 'out-of-order reads cannot overwrite latest server data', 'weapon-terms': 'weapon terms and parentheses are translated' };
for (const [name, assertion] of Object.entries(targets)) {
  const result = spawnSync(process.execPath, ['tools/cc-fullscreen-dom-selftest.mjs'], { env: { ...process.env, CC_FULLSCREEN_MUTANT: name }, encoding: 'utf8', timeout: 60_000 });
  if (result.status === 0 || !`${result.stdout}${result.stderr}`.includes(`ASSERTION: ${assertion}`)) throw Error(`Mutation ${name} did not fail at expected regression: ${result.stdout}${result.stderr}`);
  console.log(`KILLED ${name}: ${assertion}`);
}
