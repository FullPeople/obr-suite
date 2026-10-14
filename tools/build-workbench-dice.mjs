import {createHash} from 'node:crypto';
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';

const root=resolve(import.meta.dirname,'..'),output=resolve(process.env.WORKBENCH_DICE_OUT||join(root,'dist-workbench-dev/workbench-dice'));mkdirSync(output,{recursive:true});
const lightPanelAdapter=`
async function performLightPanelRoll(expr,label,hidden,clearInput){
 const parsed=parseExpr(expr);if(exprIsEmpty(parsed)){shakeButtonWithReason(btnRoll,tt('diceShakeParse'));return;}
 if(isAnimating)return;setLocked(true);
 lastRolledExpression=expr;saveLastExpr(expr);btnLastRoll.disabled=false;
 if(clearInput){setExpression('');labelText='';labelInput.value='';}
 try{await OBR.dice2d.submit({expression:expr,label,hidden});}
 catch(error){if(clearInput&&!expression.trim())setExpression(expr);await OBR.notification.show(String(error),'ERROR');}
 finally{setLocked(false);}
}
`;
const plugins=[{name:'workbench-sdk',resolveId(id){if(id==='@owlbear-rodeo/sdk')return join(root,'src/workbench/dice-sdk.ts');},transform(code,id){
 if(id.replaceAll('\\','/').endsWith('/modules/dice/panel-page.ts')){
  code=code.replace('async function performRoll(opts: { hidden: boolean }): Promise<void> {','async function performRoll(opts: { hidden: boolean }): Promise<void> { return performLightPanelRoll(expression,labelText.trim(),opts.hidden,true);').replace('const hidden = opts.hidden ?? false;','const hidden = opts.hidden ?? false; return performLightPanelRoll(expr,label,hidden,false);');
  if(!code.includes('return performLightPanelRoll(expression')||!code.includes('return performLightPanelRoll(expr,label'))throw Error('Light composer adapter no longer matches');
  code+=lightPanelAdapter;
 }return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');}}];
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

// Reuse the approved legacy effect with a strictly local SDK facade. Remove
// skin parsing and rendering from this separate entry rather than reading metadata.
{
 let html=readFileSync(join(root,'dice-effect.html'),'utf8');
 const script=html.match(/<script type="module"(?: src="([^"]+)")?>([\s\S]*?)<\/script>/);
 const effectPlugins=[{name:'plain-2d-effect',resolveId(id){if(id==='@owlbear-rodeo/sdk')return join(root,'src/workbench/dice-effect2d-sdk.ts');},transform(code,id){
   if(id.replaceAll('\\','/').endsWith('/modules/dice/effect-page.ts')){
     code=code.replace('new URLSearchParams(location.search)','new URLSearchParams(location.hash.slice(1))');
     code=code.replace('const v = Math.max(1, Math.min(sides, parseInt(dvalues[i], 10) || 1));','const face = Number(dvalues[i]); const v = Number.isSafeInteger(face) ? face : 1;');
     code=code.replace(/^import .*from "\.\/dice-skins";\r?\n/m,'');
     const parseStart=code.indexOf('function parseSkins()'),parseEnd=code.indexOf('const skins = parseSkins();')+'const skins = parseSkins();'.length;
     const artStart=code.indexOf('  const skin = skins['),artBody=code.indexOf('    const url = assetUrl(',artStart),artEnd=code.indexOf('\n  const num = document.createElement',artBody);
     if(parseStart<0||parseEnd<parseStart||artStart<0||artBody<artStart||artEnd<artBody)throw Error('Legacy 2D effect adapter no longer matches');
     code=code.slice(0,artStart)+code.slice(artBody,artEnd).replace(/\n  }\s*$/,'\n')+code.slice(artEnd);
     code=code.slice(0,parseStart)+code.slice(parseEnd);
   }
   return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');
 }}];
 await build({input:join(root,script[1]),plugins:effectPlugins,output:{file:join(output,'effect2d.js'),format:'esm'}});
 const digest=createHash('sha256').update(readFileSync(join(output,'effect2d.js'))).digest('hex').slice(0,12);
 html=html.replace(script[0],`<script type="module" src="./effect2d.js?v=${digest}"></script>`);
 writeFileSync(join(output,'effect2d.html'),html);
}

await build({input:join(root,'src/workbench/dice-light-overlay.ts'),output:{file:join(output,'overlay2d.js'),format:'esm'}});
const overlayDigest=createHash('sha256').update(readFileSync(join(output,'overlay2d.js'))).digest('hex').slice(0,12);
writeFileSync(join(output,'overlay2d.html'),`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}</style></head><body><script type="module" src="./overlay2d.js?v=${overlayDigest}"></script></body></html>`);
