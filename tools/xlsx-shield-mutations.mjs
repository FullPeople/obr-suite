import { execFileSync } from 'node:child_process';
for(const mutation of ['fixed-sheet','ambiguous-main','ignore-template','zero-ac','wrong-worn','invalid-cells-become-blank','bad-index-becomes-blank','illegal-type-accepted']) {
  let failed=false;
  try {execFileSync(process.execPath,['tools/xlsx-shield-selftest.mjs'],{env:{...process.env,XLSX_SHIELD_MUTANT:mutation},stdio:'pipe'});}
  catch(error) {if(!(String(error.stdout)+String(error.stderr)).includes('ASSERTION:'))throw error;failed=true;}
  if(!failed)throw Error(`Mutation survived: ${mutation}`);
  console.log(`Mutation rejected: ${mutation}`);
}
