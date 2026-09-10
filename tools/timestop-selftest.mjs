#!/usr/bin/env node
// Real module and installed SDK context-menu/modal boundaries. All host I/O is fake.
import { build } from "rolldown";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
const root=resolve(tmpdir()), out=mkdtempSync(join(root,"suite-timestop-"));
const mutations=[
 {name:"accept CHARACTER images",from:'item.layer === "CHARACTER" || ',to:''},
 {name:"trust remote window callbacks",from:'event.connectionId !== own.connection',to:'false'},
 {name:"overwrite newer metadata with stale read",from:'own.readRevision !== revision',to:'false'},
 {name:"unlock originally locked selections",from:'if (!item.locked)',to:'if (true)'},
 {name:"hide cleanup failures",from:'if (errors.length) throw new AggregateError',to:'if (false) throw new AggregateError'},
 {name:"stale item fetch survives permission loss",from:'own.roleRevision === roleRevision && own.role === "GM"',to:'true'},
];
try {
 for(const [i,mutation] of (process.argv.includes("--mutations")?mutations:[null]).entries()){
  const file=join(out,i+".mjs"); let changed=false;
  await build({input:resolve("tools/timestop-selftest.entry.ts"),platform:"node",plugins:[{name:"timestop-fixture",resolveId(id,importer){
    if(id==="@owlbear-rodeo/sdk" || id==="../state" && importer?.replaceAll("\\","/").endsWith("/modules/timeStop.ts")) return resolve("tools/fixtures/timestop-sdk.ts");
  },transform(code,id){
    const path=id.replaceAll("\\","/");
    if(path.endsWith("/asset-base.ts")) return code.replaceAll("import.meta.env.BASE_URL",'"/suite/"');
    if(mutation && path.endsWith("/src/modules/timeStop.ts")){
      if(code.split(mutation.from).length!==2) throw Error("Mutation must match exactly once: "+mutation.name);
      changed=true; return code.replace(mutation.from,mutation.to);
    }
  }}],output:{file,format:"esm",banner:'globalThis.location={origin:"http://localhost",href:"http://localhost/test"}; globalThis.window={location:globalThis.location}; globalThis.localStorage={getItem(){return null;}};'}});
  if(mutation&&!changed) throw Error("Mutation not applied");
  if(!mutation) execFileSync(process.execPath,[file],{stdio:"inherit",timeout:15000});
  else {try {execFileSync(process.execPath,[file],{stdio:"pipe",timeout:15000}); throw Error("SURVIVED: "+mutation.name);}
   catch(error){if(!String(error.stderr??"").includes("ERR_ASSERTION")) throw error; console.log("REJECTED: "+mutation.name);}}
 }
 if(process.argv.includes("--mutations")) console.log("TIMESTOP_MUTATIONS "+mutations.length+"/"+mutations.length);
}finally{if(dirname(out)!==root)throw Error("Unexpected test path");rmSync(out,{recursive:true,force:true});}
