/** Compress only the transport envelope; card and inventory schemas stay unchanged. */
export async function wireBody(value:unknown):Promise<{body:string|Uint8Array;headers:Record<string,string>}>{
 const text=JSON.stringify(value),headers:Record<string,string>={'Content-Type':'application/json'};
 if(text.length<4096||typeof CompressionStream==='undefined')return {body:text,headers};
 const stream=new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
 const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
 headers['Content-Encoding']='gzip';return {body:bytes,headers};
}
