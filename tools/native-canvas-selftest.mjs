import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {build} from 'rolldown';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {nativeCanvasPlugin,NATIVE_CANVAS_BOOT} from './native-canvas-plugin.mjs';
import {NATIVE_CANVAS_PAGES,nativeCanvasPath} from '../src/native-canvas.ts';
const root=process.cwd(),out=resolve('.local-evidence/native-canvas');mkdirSync(out,{recursive:true});
for(const name of NATIVE_CANVAS_PAGES){
 const expected=name.replace(/\.html$/,'-native.html');
 assert.equal(nativeCanvasPath(name),expected);assert.equal(nativeCanvasPath(name+'?window=one#payload'),expected+'?window=one#payload');
 const emitted=[];nativeCanvasPlugin().generateBundle.handler.call({emitFile:file=>emitted.push(file)},null,{[name]:{type:'asset',source:'exact application graph'}});
 assert.deepEqual(emitted,[{type:'asset',fileName:expected,source:'exact application graph'}]);
 for(const [path,scheme]of [[name,'light dark'],[expected,'normal']]){
  const properties={};runInNewContext(NATIVE_CANVAS_BOOT,{location:{pathname:'/suite-dev/'+path},document:{documentElement:{style:{setProperty:(key,value,priority)=>{assert.equal(priority,'important');properties[key]=value;}}}}});
  assert.equal(properties['color-scheme'],scheme);assert.equal(properties.background,'transparent');
 }
}
for(const name of ['settings.html','text-effect-control.html','icon.svg','assets/texture.png'])assert.equal(nativeCanvasPath(name),name);
await build({input:resolve('src/asset-base.ts'),plugins:[{name:'base',transform(code){return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/'));}}],output:{file:out+'/asset-base.mjs',format:'esm'}});
globalThis.location={origin:'https://obr.dnd.center'};const {assetUrl}=await import(pathToFileURL(out+'/asset-base.mjs'));
assert.equal(assetUrl('boss-bar.html')+'?session=one','https://obr.dnd.center/suite-dev/boss-bar-native.html?session=one');
assert.equal(assetUrl('text-effect-display.html')+'#payload','https://obr.dnd.center/suite-dev/text-effect-display-native.html#payload');
assert.equal(assetUrl('icon.svg'),'https://obr.dnd.center/suite-dev/icon.svg');
assert(readFileSync('vite.config.ts','utf8').includes('nativeCanvasPlugin()'));
console.log(JSON.stringify({passed:true,nativePages:NATIVE_CANVAS_PAGES.length,normalAndExplicitDarkContracts:true,sharedApplicationGraph:true,realRoomVerified:false}));
