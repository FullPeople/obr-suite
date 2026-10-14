import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),deps=resolve(process.env.SUITE_BUILD_DEPS||root);
const {build}=createRequire(join(deps,'package.json'))('rolldown');
const out=resolve(process.argv[2]||join(root,'.local-evidence/transparent-canvas'));
mkdirSync(join(out,'assets'),{recursive:true});
const bundle=await build({input:join(root,'src/utils/transparent-canvas-entry.ts'),plugins:[{name:'canvas-sdk',resolveId(id){if(id==='@owlbear-rodeo/sdk')return join(deps,'node_modules/@owlbear-rodeo/sdk/lib/index.js');}}],output:{format:'esm'}});
const entry=bundle.output.find(f=>f.type==='chunk'&&f.isEntry);if(!entry||bundle.output.length!==1)throw Error('Unexpected canvas bundle');
const hash=createHash('sha256').update(entry.code).digest('hex').slice(0,12),name=`assets/transparent-canvas-${hash}.js`;
writeFileSync(join(out,name),entry.code);
writeFileSync(join(out,'canvas-module.json'),JSON.stringify({file:name,bytes:Buffer.byteLength(entry.code)},null,2)+'\n');
console.log(JSON.stringify({file:name,bytes:Buffer.byteLength(entry.code)}));
if(process.argv.includes('--fixture')){
 const {suiteUiHead}=await import('./suite-ui.mjs');
 for(const [page,css]of [['boss-bar.html','src/modules/bossBar/style.css'],['initiative-panel.html','src/modules/initiative/styles/initiative.css']]){
  let html=readFileSync(join(root,page),'utf8').replace(/<script type="module"[^>]*><\/script>/g,'');
  html=html.replace('</head>',`${suiteUiHead()}<style>${readFileSync(join(root,css),'utf8')}</style><script type="module" src="/suite-dev/${name}"></script></head>`);
  writeFileSync(join(out,page),html);
 }
}
