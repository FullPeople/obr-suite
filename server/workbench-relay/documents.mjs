import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';

function storageFailure(error,phase){if(error&&typeof error==='object')error.storagePhase??=phase;return error;}
async function replaceDocument(temp,target){
 // Windows readers/security scanners may briefly hold a handle without
 // FILE_SHARE_DELETE. Retry only this uncommitted atomic rename, keeping the
 // same bytes, CAS lock and revision. Never replay the document operation.
 const delays=process.platform==='win32'?[25,50,100,150,200,250]:[];
 for(let attempt=0;;attempt++){
  try{await rename(temp,target);return;}
  catch(error){
   if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=delays.length){error.renameAttempts=attempt+1;throw storageFailure(error,'rename');}
   await new Promise(resolve=>setTimeout(resolve,delays[attempt]));
  }
 }
}

/** Serialized, durable CAS documents. No player identity or UI permissions live here. */
export function documentStore(root) {
 const directory=resolve(root),locks=new Map();
 async function read(key){
  try{return JSON.parse(await readFile(join(directory,key+'.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT')return {revision:0,data:null};throw storageFailure(error,error instanceof SyntaxError?'parse':'read');}
 }
 return async function request(message){
  const {key,operation}=message||{};
  if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(key)||!['read','write'].includes(operation))throw Object.assign(Error('无效的共享文档'),{status:400});
  if(operation==='read')return read(key);
  if(!Number.isSafeInteger(message.expected)||message.expected<0||!message.data||typeof message.data!=='object'||Array.isArray(message.data))throw Object.assign(Error('无效的共享配置'),{status:400});
  const operationPromise=(locks.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
   const previous=await read(key);
   if(previous.revision!==message.expected)throw Object.assign(Error('共享配置已被其他客户端修改，请重试'),{status:409});
   const next={revision:previous.revision+1,data:message.data},temp=join(directory,key+'.'+randomUUID()+'.tmp');
   try{await mkdir(directory,{recursive:true});}catch(error){throw storageFailure(error,'mkdir');}
   try{
    try{await writeFile(temp,JSON.stringify(next),{encoding:'utf8',flag:'wx'});}catch(error){throw storageFailure(error,'write');}
    await replaceDocument(temp,join(directory,key+'.json'));
   }catch(error){
    // Rename success consumed the temporary file. Cleanup only failures so a
    // cleanup error can never turn an already committed write into a 500.
    await unlink(temp).catch(cleanup=>{if(cleanup.code!=='ENOENT')error.cleanupCode=cleanup.code;});
    throw error;
   }
   return next;
  });
  locks.set(key,operationPromise);
  try{return await operationPromise;}finally{if(locks.get(key)===operationPromise)locks.delete(key);}
 };
}
