export function errorText(error:unknown):string{
 if(error instanceof Error)return `${error.name}: ${error.message}`;
 if(error&&typeof error==='object'){
  // SDK RPCs reject with plain objects, not necessarily Error instances.
  const data=error as Record<string,unknown>,message=typeof data.message==='string'?data.message:typeof data.error==='string'?data.error:'';
  const code=typeof data.code==='string'||typeof data.code==='number'?String(data.code):'';
  if(message)return `${message}${code?` (${code})`:''}`;
  try{return JSON.stringify(error).slice(0,1000);}catch{return '无法读取错误详情';}
 }
 return String(error);
}
