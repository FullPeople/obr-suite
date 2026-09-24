import {createHash} from 'node:crypto';
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),output=process.env.WORKBENCH_DICE_OUT||join(root,'dist-workbench-dev/workbench-dice');mkdirSync(output,{recursive:true});
const plugins=[{name:'workbench-sdk',resolveId(id){if(id==='@owlbear-rodeo/sdk')return join(root,'src/workbench/dice-sdk.ts');},transform(code,id){if(id.replaceAll('\\','/').endsWith('/modules/dice/panel-page.ts'))code=code.replaceAll('if (!opts.hidden && targetTokens.length === 0)', 'if (false && !opts.hidden && targetTokens.length === 0)').replaceAll('if (opts.hidden && targetTokens.length === 0)', 'if (targetTokens.length === 0)').replaceAll('if (!hidden && targetTokens.length === 0)', 'if (false && !hidden && targetTokens.length === 0)').replaceAll('if (hidden && targetTokens.length === 0)', 'if (targetTokens.length === 0)');return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');}}];
for(const [source,name] of [['dice-panel.html','index'],['dice-quick-popup.html','quick']]){
 let html=readFileSync(join(root,source),'utf8');const script=html.match(/<script type="module"(?: src="([^"]+)")?>([\s\S]*?)<\/script>/);
 const temp=join(output,`${name}.entry.ts`);writeFileSync(temp,script[2]);
 await build({input:script[1]?join(root,script[1]):temp,plugins,output:{file:join(output,`${name}.js`),format:'esm'}});
 const digest=createHash('sha256').update(readFileSync(join(output,`${name}.js`))).digest('hex').slice(0,12);
 html=html.replace(script[0],`<script type="module" src="./${name}.js?v=${digest}"></script>`).replaceAll('src="/d','src="/suite-dev/d');
 // Adapt target-less rolls to the viewport; keep all original UI and expression parsing.
 // The workbench provides its own backdrop and close handling.
 if(name==='quick')html=html.replace(/<button[^>]*id="closeBtn"[^>]*>[\s\S]*?<\/button>/,'').replace('</style>','html,body{background:transparent}.popup{box-shadow:none}</style>');
 html=html.replace('</head>',`<style>${readFileSync(join(root,'src/workbench/dice-theme.css'),'utf8')}</style></head>`);
 writeFileSync(join(output,`${name}.html`),html);unlinkSync(temp);
}
