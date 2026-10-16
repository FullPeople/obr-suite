// All enabled assets stay under the ignored test directory. Source stays paused.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
export async function prepareQQWebFixture(web,out){
 const flag=join(web,'src/cloud/availability.ts'),css=join(web,'src/cloud/suspended.css'),original=readFileSync(flag,'utf8'),cssOriginal=readFileSync(css,'utf8'),needle='export const cloudFeaturesEnabled:boolean=false;',hidden='.suite-website-link[href^="https://dnd.center/library/"]{display:none!important}';
 assert.equal(original.split(needle).length,2);assert.equal(cssOriginal.split(hidden).length,2);
 const root=resolve(out,'enabled-web');mkdirSync(root,{recursive:true});const previous=process.cwd(),vite=await import(pathToFileURL(createRequire(join(web,'package.json')).resolve('vite')).href),builds=[];
 try{process.chdir(web);
 for(const [configFile,mode,name]of [['vite.config.ts','production','viewer'],['vite.config.ts','standalone','cloud/card'],['vite.library.config.ts','cloud-library','cloud/library']]){
  let toggles=0;const profile={name:'test-only-qq-enabled',enforce:'pre',transform(code,id){const path=id.replaceAll('\\','/').split('?')[0];if(path===flag.replaceAll('\\','/')){assert.equal(code.split(needle).length,2);toggles++;return code.replace(needle,'export const cloudFeaturesEnabled:boolean=true;');}if(path===css.replaceAll('\\','/')){assert.equal(code.split(hidden).length,2);return code.replace(hidden,'');}}};
  const {config}=await vite.loadConfigFromFile({command:'build',mode},join(web,configFile));
  await vite.build({...config,root:web,configFile:false,mode,plugins:[...(config.plugins||[]),profile],build:{...config.build,outDir:join(root,name),emptyOutDir:true}});assert(toggles>0);builds.push({name,toggles});
 }
 }finally{process.chdir(previous);assert.equal(readFileSync(flag,'utf8'),original);assert.equal(readFileSync(css,'utf8'),cssOriginal);}
 writeFileSync(join(root,'fixture-profile.json'),JSON.stringify({testOnly:true,productionCloudEnabled:false,sourceSha256:createHash('sha256').update(original).digest('hex'),builds},null,2));
 return {viewerRoot:join(root,'viewer'),cloudRoot:join(root,'cloud')};
}
