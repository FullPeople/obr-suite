/** Full formula details stay encrypted until explicit reveal. Compress the reveal to respect
 * Owlbear's 16 KiB per-message limit; decompression is bounded before JSON parsing. */
export async function packReveal(value:unknown):Promise<string>{
 const raw=new TextEncoder().encode(JSON.stringify(value));if(raw.byteLength>128000)throw Error('暗骰公开记录超过 128 KB');
 const data=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
 const encoded=btoa(Array.from(data,c=>String.fromCharCode(c)).join(''));if(encoded.length>14000)throw Error('暗骰公开压缩包超过消息预算');return encoded;
}
export async function unpackReveal(value:unknown):Promise<any>{
 if(typeof value!=='string'||value.length>14000)throw Error('无效暗骰公开包');
 const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0)),reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader(),parts:Uint8Array[]=[];let length=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>128000)throw Error('暗骰公开解压超限');parts.push(value);}}finally{await reader.cancel();}
 const raw=new Uint8Array(length);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder().decode(raw));
}
