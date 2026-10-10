import {DiceAssets} from './asset-loading';
import {VENDOR_LOCK} from './asset-manifest';

/** A no-result function executes v128.const followed by drop. No engine allocation. */
export function supportsJoltSIMD():boolean{
  try{return WebAssembly.validate(new Uint8Array([
    0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,23,1,21,0,253,12,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,26,11,
  ]));}catch{return false;}
}

export type JoltBuild='scalar'|'simd';
export type JoltImporter=(path:string)=>Promise<{default:(options:any)=>Promise<any>}>;

/** Select a paired, hash-verified build before creating the persistent world. */
export async function initializeJolt(assets:DiceAssets,importModule:JoltImporter,simd=supportsJoltSIMD()){
  if(VENDOR_LOCK.version!=='1.1.0')throw Error('Jolt 版本不符合锁定合同: '+VENDOR_LOCK.version);
  const attempt=async(build:JoltBuild)=>{
    const pair=VENDOR_LOCK.builds[build];
    const paths=[pair.module,pair.binary];
    // Never execute glue or compile binary outside the immutable release lock.
    if(paths.some(path=>!assets.locks[path]))throw Error('Jolt 构建缺少资源校验: '+build);
    assets.plan(paths);
    const [,binary]=await Promise.all(paths.map(path=>assets.bytes(path)));
    const compiled=await WebAssembly.compile(binary);
    const module=await importModule(pair.module);
    assets.stage('初始化物理引擎');
    // The pinned glue does not support wasmBinary. Use verified bytes only.
    const engine=await module.default({instantiateWasm:(imports:WebAssembly.Imports,receive:(instance:WebAssembly.Instance)=>void)=>{
      const instance=new WebAssembly.Instance(compiled,imports);receive(instance);return instance.exports;
    }});
    return {engine,build,fallbackReason:null as string|null};
  };
  if(!simd)return attempt('scalar');
  try{return await attempt('simd');}
  catch(error){
    const reason=String(error);
    assets.stage('切换兼容物理引擎');
    try{return {...await attempt('scalar'),fallbackReason:reason};}
    catch(fallback){throw Error(`Jolt SIMD 初始化失败: ${reason}; 兼容引擎初始化失败: ${String(fallback)}`);}
  }
}
