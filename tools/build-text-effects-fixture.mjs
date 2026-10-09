import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=join(root,'.local-evidence/text-effects/renderer');mkdirSync(out,{recursive:true});
await build({input:join(root,'tools/text-effects-renderer-fixture.entry.ts'),plugins:[{name:'fixture-css',resolveId(id,importer){if(id.endsWith('.css'))return '\0css:'+resolve(dirname(importer),id)+'.js';},load(id){if(id.startsWith('\0css:'))return `const style=document.createElement('style');style.textContent=${JSON.stringify(readFileSync(id.slice(5,-3),'utf8'))};document.head.append(style);`;}}],output:{dir:out,entryFileNames:'fixture.js',format:'esm'}});
writeFileSync(join(out,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><title>Production renderer fixture</title><style>body{margin:0;background:#272d39}#presentation{width:640px;height:360px;position:relative}</style></head><body><div id="presentation"></div><script type="module" src="./fixture.js"></script></body></html>');
console.log('Production text renderer fixture ready (not included in public output)');