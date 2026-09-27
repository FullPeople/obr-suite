import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const out=resolve(process.env.TDA_SERVER_OUT||'D:/Temp/DND-card-release203-storage/server');mkdirSync(out,{recursive:true});
await build({input:resolve('server/three-dragon/main.mjs'),platform:'node',external:[/^node:/],output:{file:out+'/server.mjs',format:'esm',codeSplitting:false},logLevel:'warn'});
await build({input:resolve('server/three-dragon/service.mjs'),platform:'node',external:[/^node:/],output:{file:out+'/service.mjs',format:'esm',codeSplitting:false},logLevel:'warn'});
console.log(out);
