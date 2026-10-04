import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,copyFileSync,unlinkSync} from 'node:fs';
import {resolve,join,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.WORKBENCH_PANEL_OUT||join(root,'dist-workbench-dev/workbench-panels'));mkdirSync(out,{recursive:true});
const pairedVersion=JSON.parse(readFileSync(join(root,'public/manifest-dev.json'),'utf8')).version;
const sdkRoot=join(root,'node_modules/@owlbear-rodeo/sdk/lib');
const sdkIndex=readFileSync(join(sdkRoot,'index.js'),'utf8');
const pureBuilders=[...sdkIndex.matchAll(/import (\{[^}]*Builder[^}]*\}) from "\.\/builders\/([^"]+)";/g)].map(match=>`import ${match[1]} from ${JSON.stringify(join(sdkRoot,'builders',match[2]).replaceAll('\\','/'))};`).join('\n')+`\nimport api from ${JSON.stringify(join(root,'src/workbench/panel-sdk.ts').replaceAll('\\','/'))};\nexport * from ${JSON.stringify(join(sdkRoot,'types/index.js').replaceAll('\\','/'))};\nexport * from ${JSON.stringify(join(sdkRoot,'math/index.js').replaceAll('\\','/'))};\n`+sdkIndex.slice(sdkIndex.indexOf('function buildBillboard'),sdkIndex.indexOf('export default OBR')).replaceAll('playerApi','api.player');
const plugins=[{name:'workbench-panels',resolveId(id,importer){if(id.endsWith('.css'))return '\0css:'+resolve(dirname(importer),id)+'.js';if(id==='@owlbear-rodeo/sdk')return join(root,'src/workbench/panel-sdk.ts');if(id==='@workbench/sdk-builders')return '\0pure-builders';},load(id){if(id==='\0pure-builders')return pureBuilders;if(id.startsWith('\0css:'))return `const style=document.createElement('style');style.textContent=${JSON.stringify(readFileSync(id.slice(5,-3),'utf8'))};document.head.append(style);`;},transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/music-board-page.ts'))code=code.replace(/import \{ bindPanelDrag \} from [^;]+;/,'const bindPanelDrag=(..._args:any[])=>()=>{};');if(id.replaceAll('\\','/').endsWith('/game/ui.ts'))code=code.replace('el("close").textContent=t("backToMap")','el("close").textContent=lang==="zh"?"返回工作区":"Back to workspace"');return code.replace(/declare const __TDA_BUILD__: string;/g,'').replaceAll('__TDA_BUILD__',JSON.stringify('Full Suite · '+pairedVersion)).replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');}}];
// Historical rendering remains testable only in an explicit, non-public fixture.
const historical=process.env.WORKBENCH_PANEL_ONLY==='historical-table';
const fixturePath=path=>resolve(path).split(sep).includes('.local-evidence')||resolve(path).startsWith(resolve(tmpdir())+sep);
if(historical&&(!fixturePath(out)||!fixturePath(dirname(out))))throw Error('Historical table fixtures must stay outside public build outputs');
for(const [name,file,entry] of [...(historical?[['historical-table','tools/fixtures/three-dragon-historical.html','extensions/three-dragon-ante/src/game/page.ts']]:[]),['settings','settings.html','src/settings.ts'],['music','music-board.html','src/music-board-page.ts'],['permissions','dm-announcement.html','src/workbench/player-permission-page.ts']]){
 if(process.env.WORKBENCH_PANEL_ONLY&&name!==process.env.WORKBENCH_PANEL_ONLY)continue;
 const temp=join(out,name+'.entry.ts');writeFileSync(temp,(name==='settings'?`import ${JSON.stringify(join(root,'src/workbench/settings-adapt.ts').replaceAll('\\','/'))};\n`:'')+`import ${JSON.stringify(join(root,entry).replaceAll('\\','/'))};\nimport ${JSON.stringify(join(root,name==='permissions'?'src/workbench/permission-theme.css':name==='historical-table'?'src/workbench/table-theme.css':'src/workbench/panel-theme.css').replaceAll('\\','/'))};`);
 const bundle=await build({transform:{target:['chrome109','edge109','firefox102','safari15.4']},input:temp,plugins,output:{dir:out,entryFileNames:name+'-[hash].js',chunkFileNames:name+'-[name]-[hash].js',format:'esm'}});
 const main=bundle.output.find(chunk=>chunk.type==='chunk'&&chunk.isEntry).fileName;
 // Deliver the embedded theme in HTML before first paint. The old popover's
 // dark defaults must never appear while the settings bundle/bridge loads.
 const themeFile=name==='permissions'?'src/workbench/permission-theme.css':name==='historical-table'?'src/workbench/table-theme.css':'src/workbench/panel-theme.css';
 const bootTheme=`<style data-workbench-theme>${readFileSync(join(root,themeFile),'utf8')}</style><script>try{var t=localStorage.getItem('full-suite/ui-tone');if(/^#[0-9a-f]{6}$/i.test(t||''))document.documentElement.style.setProperty('--suite-tone',t);document.documentElement.dataset.suiteNight=localStorage.getItem('full-suite/ui-night')==='1'?'true':'false';}catch(e){}</script>`;
 const html=readFileSync(join(root,file),'utf8').replace(/<script type="module" src="[^"]+"><\/script>/,`<script type="module" src="./${main}"></script>`).replace('</head>',bootTheme+'</head>');
 writeFileSync(join(out,name+'.html'),html);unlinkSync(temp);
}
if(!process.env.WORKBENCH_PANEL_ONLY||process.env.WORKBENCH_PANEL_ONLY==='table'){
 const html=readFileSync(join(root,'tools/three-dragon-website-entry.html'),'utf8');
 if(!html.includes('href="https://obr.dnd.center/three-dragon-ante/"')||/<iframe|<script[^>]*src=|owlbear-rodeo|\/three-dragon-api\//i.test(html))throw Error('Public table entry must be the reviewed website link');
 writeFileSync(join(out,'table.html'),html);
}
if(historical){const art=join(root,'extensions/three-dragon-ante/src/game/art');copyTree(art,join(out,'art'));copyTree(art,join(dirname(out),'art'));}
console.log('Workbench panels and website link built');
if(process.env.WORKBENCH_PANEL_ONLY)process.exit(0);

function copyTree(source,destination){mkdirSync(destination,{recursive:true});for(const item of readdirSync(source,{withFileTypes:true})){const from=join(source,item.name),to=join(destination,item.name);if(item.isDirectory())copyTree(from,to);else if(item.isFile())copyFileSync(from,to);}}
copyTree(join(root,'extensions/three-dragon-ante/src/game/art'),join(out,'art'));
copyTree(join(root,'extensions/three-dragon-ante/src/game/art'),join(root,'dist-workbench-dev/art'));
const studio=join(out,'studio');copyTree(join(root,'tools/music-studio'),studio);
const source=readFileSync(join(root,'tools/music-studio/app.js'),'utf8').replace('if (_peerConn && _peerConn.open) {\n    e.preventDefault();','if (!document.body.classList.contains("workbench-studio") && _peerConn && _peerConn.open) {\n    e.preventDefault();');
const embed=readFileSync(join(root,'src/workbench/studio-embed.js'),'utf8').replace("'./panel-sdk.ts'","'../studio-sdk.js'");
writeFileSync(join(studio,'app.js'),source+'\n'+embed);
await build({transform:{target:['chrome109','edge109','firefox102','safari15.4']},input:join(root,'src/workbench/panel-sdk.ts'),plugins,output:{dir:out,entryFileNames:'studio-sdk.js',format:'esm'}});
const theme=`:root{--bg:#f4f5f8;--bg-1:#f8f9fc;--bg-2:#edf0f7;--bg-3:#e1e7f3;--bg-4:#cdd7ea;--text:#29364f;--text-2:#53617c;--text-3:#6b7891;--text-4:#8792a9;--line:#d5dce9;--line-2:#bfcbe1;--accent-2:#7791cc;--bgm-color:#6380bf;--sfx-color:#8970b1;--radius:3px;--radius-lg:4px;--shadow:0 2px 7px #2f42651a;--shadow-lg:0 4px 14px #2f426533;--text-dim:#69758d;--accent:#607dbe;--border:#c8cedb;color-scheme:light}body{background:#f4f5f8;color:#29364f}.studio-tabs,.pair-widget,.local-mute-banner{display:none!important}.topbar{background:#e6eaf4;border-color:#c8cedb}.brand-name{color:#29364f}.turntable,.panel,.modal,.library{background:#f6f7fa;color:#29364f}.btn{border-radius:2px}body[data-can-control=false] .transport,body[data-can-control=false] .fader{pointer-events:none;opacity:.55}`;
writeFileSync(join(studio,'workbench.css'),theme+`:root{--accent:var(--suite-tone,#50525B);--bg:color-mix(in srgb,var(--accent) 3%,white);--bg-1:color-mix(in srgb,var(--accent) 2%,white);--bg-2:color-mix(in srgb,var(--accent) 6%,white);--bg-3:color-mix(in srgb,var(--accent) 12%,white);--line:color-mix(in srgb,var(--accent) 25%,#ddd)}body,.turntable,.panel,.modal,.library{background:var(--bg);color:var(--text)}.topbar{background:var(--suite-tone,#50525B);color:white}.topbar .brand-name,.topbar .btn{color:white}:root{--text:#292a30;--text-2:#505159;--text-3:#686970;--text-4:#83848c;--line-2:#c3c3c9;--accent-2:var(--suite-tone,#50525B);--bgm-color:#62656f;--sfx-color:#806983;--text-dim:#696a72;--border:var(--line)} `);
writeFileSync(join(studio,'workbench-night.css'),`:root[data-suite-night=true]{color-scheme:dark;--bg:#202125;--bg-1:#22242a;--bg-2:#2b2e36;--bg-3:#363b48;--bg-4:#464e60;--text:#ededf1;--text-2:#c7cad5;--text-3:#abb0c0;--text-4:#939aab;--line:#4a4f5b;--line-2:#697183;--text-dim:#b4b9c6;--accent-2:#c0cce5;--border:#4a4f5b}`);
writeFileSync(join(studio,'index.html'),readFileSync(join(studio,'index.html'),'utf8').replace('</head>',`<link rel="stylesheet" href="./workbench.css"><link rel="stylesheet" href="./workbench-night.css"><script>try{document.documentElement.dataset.suiteNight=localStorage.getItem('full-suite/ui-night')==='1'?'true':'false';}catch(e){}</script></head>`));
console.log('Embedded table and Music Studio built');

await build({transform:{target:['chrome109','edge109','firefox102','safari15.4']},input:join(root,'src/workbench/sound.ts'),plugins,output:{dir:out,entryFileNames:'sound.js',format:'esm'}});

await build({transform:{target:['chrome109','edge109','firefox102','safari15.4']},input:join(root,'src/supporter-overlay-page.ts'),plugins:[{name:'supporter-sdk',resolveId(id){if(id==='@owlbear-rodeo/sdk')return join(root,'src/workbench/supporter-sdk.ts');},transform(code,id){return code.replace('function getHoleRect(): { x: number; y: number; w: number; h: number } {','function getHoleRect(): { x: number; y: number; w: number; h: number } { if((window as any).supporterHole)return (window as any).supporterHole;');}},...plugins],output:{dir:out,entryFileNames:'supporters.js',format:'esm'}});
writeFileSync(join(out,'supporters.html'),readFileSync(join(root,'supporter-overlay.html'),'utf8').replace('/src/supporter-overlay-page.ts','./supporters.js'));
