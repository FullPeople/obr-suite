import type {Texture} from 'three';
import type {DiceAssets} from './asset-loading';

/** One renderer/preview owns this cache. Callers must finish their common sampler
 * configuration inside decode; materials only borrow the resulting texture.
 * Every path still passes through DiceAssets integrity checks before aliasing. */
export function createVerifiedTextureLoader(assets:Pick<DiceAssets,'bytes'|'locks'>,decode:(bytes:ArrayBuffer)=>Promise<Texture>){
  const textures=new Map<string,Promise<Texture>>();
  return async(path:string):Promise<Texture>=>{
    const expected=assets.locks[path],bytes=await assets.bytes(path);
    const key=expected&&/^[0-9a-f]{64}$/i.test(expected)&&assets.locks[path]===expected?'sha256:'+expected.toLowerCase():'path:'+path;
    let task=textures.get(key);
    if(!task){
      task=Promise.resolve().then(()=>decode(bytes));textures.set(key,task);
      void task.catch(()=>{if(textures.get(key)===task)textures.delete(key);});
    }
    return task;
  };
}
