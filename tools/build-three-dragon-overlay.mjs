// Build website links for existing Suite entries. This never builds an Owlbear table.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';

const suiteRoot=resolve(import.meta.dirname,'..');
if(!process.env.TDA_SOURCE_ROOT)throw Error('Set TDA_SOURCE_ROOT to the reviewed independent repository.');
const tdaRoot=resolve(process.env.TDA_SOURCE_ROOT);
const out=resolve(process.env.TDA_OVERLAY_OUT||join(suiteRoot,'.local-evidence/three-dragon-link-overlay'));
if(existsSync(out))throw Error('Use a new overlay output directory; existing evidence is preserved.');
const targets=(process.env.TDA_OVERLAY_TARGETS||'suite-dev,suite').split(',');
if(new Set(targets).size!==targets.length||targets.some(value=>!['suite-dev','suite'].includes(value)))throw Error('Unsupported or duplicate Suite targets.');
const website='https://dnd.center/3-dragon/';
const html=readFileSync(join(suiteRoot,'tools/three-dragon-website-entry.html'),'utf8');
if(!html.includes(`href="${website}"`)||/<iframe|websocket|owlbear-rodeo|\/three-dragon-api\//i.test(html))throw Error('Website entry may only link to the public website.');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
mkdirSync(out,{recursive:true});
const outputs=[];
for(const target of targets){
 const path=target==='suite-dev'?'suite-dev/workbench-panels/table.html':'suite/three-dragon-ante.html';
 const file=join(out,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,html);
 outputs.push({path,sha256:sha(file)});
}
// Optional exact, reviewed parent assets are supplied by the host-specific build.
// Every path is declared explicitly; no blanket full-host replacement is allowed.
let hostOverlay;
if(process.env.TDA_HOST_OVERLAY_MANIFEST){
 const manifestFile=resolve(process.env.TDA_HOST_OVERLAY_MANIFEST);
 hostOverlay=JSON.parse(readFileSync(manifestFile,'utf8'));
 if(hostOverlay.mode!=='website-link-only'||hostOverlay.website!==website)throw Error('Unsupported host overlay.');
 for(const item of hostOverlay.outputs){
  if(!/^suite(?:-dev)?\/(?:assets\/[A-Za-z0-9_.-]+|settings\.html|three-dragon-link-source-[a-f0-9]+\.zip|workbench\/(?:index\.html|sw\.js|assets\/[A-Za-z0-9_.-]+|three-dragon-link-source-[a-f0-9]+\.zip)|workbench-panels\/(?:settings\.html|settings-[A-Za-z0-9_.-]+\.js))$/.test(item.path)||outputs.some(old=>old.path===item.path))throw Error('Unexpected parent output: '+item.path);
  const source=resolve(dirname(manifestFile),item.path);
  if(sha(source)!==item.sha256)throw Error('Parent overlay changed: '+item.path);
  const destination=join(out,item.path);mkdirSync(dirname(destination),{recursive:true});copyFileSync(source,destination);outputs.push({path:item.path,sha256:item.sha256});
 }
}
const result={mode:'website-link-only',website,suiteSource:git(suiteRoot,'rev-parse','HEAD'),tdaSource:git(tdaRoot,'rev-parse','HEAD'),tdaVersion:JSON.parse(readFileSync(join(tdaRoot,'package.json'),'utf8')).version,api:'/three-dragon-api/v1',targets,outputs,hostOverlay,
 preservation:'Website links only; preserve parent toolbar, existing Suite runtime/manifests, historical assets, other features and player data.'};
writeFileSync(join(out,'overlay-manifest.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({out,mode:result.mode,targets,files:outputs.length,source:result.tdaSource},null,2));
