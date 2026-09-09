import {spawnSync} from 'node:child_process';
const targets={'expired-phase':'new gambit rejects old unconfirmed draft','private-preview':'spectator transition clears private hand preview'};
for(const [name,assertion] of Object.entries(targets)){
 const result=spawnSync(process.execPath,['tools/three-dragon-immersive-selftest.mjs'],{env:{...process.env,THREE_DRAGON_IMMERSIVE_MUTANT:name},encoding:'utf8',timeout:60000});
 if(result.status!==1||!result.stdout.includes(`MUTATION_BUNDLED ${name}`)||!`${result.stdout}${result.stderr}`.includes(`Error: ASSERTION: ${assertion}`))throw Error(`Mutation ${name} did not compile and fail at expected runtime boundary: ${result.stdout}${result.stderr}`);
 console.log(`KILLED ${name}: ${assertion}`);
}
