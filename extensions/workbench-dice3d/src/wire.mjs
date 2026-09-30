import {validBodyColor} from './player-color.mjs';
import {validModifier} from './modifier.mjs';
export const MAX_MESSAGE_BYTES=15000;
export const CHUNK_BYTES=7000;
export const MAX_ROLL_BYTES=24_000_000;
export const MAX_CHUNKS=Math.ceil(MAX_ROLL_BYTES/CHUNK_BYTES);
export const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
export const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=4096)s+=String.fromCharCode(...bytes.subarray(i,i+4096));return btoa(s)};
export const unb64=s=>{if(typeof s!=='string'||s.length>10000)throw Error('Invalid chunk encoding');return Uint8Array.from(atob(s),c=>c.charCodeAt(0))};
export const sizeOf=x=>new TextEncoder().encode(JSON.stringify(x)).length;
export function split(bytes) {
  if(bytes.length<1||bytes.length>MAX_ROLL_BYTES)throw Error('Trajectory exceeds experiment budget');
  const chunks=[];for(let i=0;i<bytes.length;i+=CHUNK_BYTES)chunks.push(b64(bytes.subarray(i,i+CHUNK_BYTES)));return chunks;
}
export class Assembly {
  constructor(total,bytes,sha) {
    if(!Number.isInteger(total)||total<1||total>MAX_CHUNKS||!Number.isInteger(bytes)||bytes<1||bytes>MAX_ROLL_BYTES||total!==Math.ceil(bytes/CHUNK_BYTES)||!/^[a-f0-9]{64}$/.test(sha))throw Error('Invalid trajectory manifest');
    this.total=total;this.bytes=bytes;this.sha=sha;this.parts=new Map();
  }
  add(index,data) {
    if(!Number.isInteger(index)||index<0||index>=this.total)throw Error('Invalid chunk index');
    const bytes=unb64(data), expected=index===this.total-1?this.bytes-CHUNK_BYTES*index:CHUNK_BYTES;
    if(bytes.length!==expected)throw Error('Invalid chunk length');
    if(this.parts.has(index)){if(b64(this.parts.get(index))!==data)throw Error('Conflicting duplicate chunk');return}
    this.parts.set(index,bytes);
  }
  missing(){return Array.from({length:this.total},(_,i)=>i).filter(i=>!this.parts.has(i))}
  async finish(){
    if(this.missing().length)throw Error('Incomplete trajectory');
    const bytes=new Uint8Array(this.bytes);for(const [index,part] of this.parts)bytes.set(part,index*CHUNK_BYTES);
    if(await hash(bytes)!==this.sha)throw Error('Trajectory SHA-256 mismatch');return bytes;
  }
}
/** One contact is ten float32 values: t, kind, a, b, seq, x, y, z, impact speed, normal impulse. */
export const CONTACT_FLOATS = 10;
export async function encodeRoll(meta,poses,contacts) {
  const header=new TextEncoder().encode(JSON.stringify(meta));
  const poseBytes=poses.byteLength,contactBytes=contacts.length*CONTACT_FLOATS*4;
  const plain=new Uint8Array(4+header.length+poseBytes+contactBytes);
  const view=new DataView(plain.buffer);
  view.setUint32(0,header.length,true);plain.set(header,4);
  plain.set(new Uint8Array(poses.buffer,poses.byteOffset,poses.byteLength),4+header.length);
  let offset=4+header.length+poseBytes;
  for(const c of contacts){
    view.setFloat32(offset,c.t,true);view.setFloat32(offset+4,c.kind,true);
    view.setFloat32(offset+8,c.a,true);view.setFloat32(offset+12,c.b,true);
    view.setFloat32(offset+16,c.seq,true);view.setFloat32(offset+20,c.x,true);
    view.setFloat32(offset+24,c.y,true);view.setFloat32(offset+28,c.z,true);
    view.setFloat32(offset+32,c.speed,true);view.setFloat32(offset+36,c.impulse,true);
    offset+=CONTACT_FLOATS*4;
  }
  return new Uint8Array(await new Response(new Blob([plain]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
export async function decodeRoll(bytes) {
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks=[];let count=0;for(;;){const r=await reader.read();if(r.done)break;count+=r.value.length;if(count>48_000_000){await reader.cancel();throw Error('Decoded trajectory exceeds budget')}chunks.push(r.value)}
  const plain=new Uint8Array(count);let offset=0;for(const c of chunks){plain.set(c,offset);offset+=c.length}
  if(plain.length<4)throw Error('Missing trajectory header');
  const n=new DataView(plain.buffer).getUint32(0,true);if(n<1||n>64000||n+4>plain.length)throw Error('Invalid header size');
  const meta=JSON.parse(new TextDecoder().decode(plain.subarray(4,n+4)));
  if(meta.version!==2||meta.fps!==120||!Array.isArray(meta.kinds)||meta.kinds.length<1||meta.kinds.length>100||!Number.isInteger(meta.frames)||meta.frames<2||meta.frames>14401||!Array.isArray(meta.results)||meta.results.length!==meta.kinds.length||!meta.request||meta.request.count!==meta.kinds.length)throw Error('Invalid roll header');
  const maximumDuration=120.001;
  if(meta.bounds){const b=meta.bounds;if(!['minX','maxX','minZ','maxZ'].every(k=>Number.isFinite(b[k])&&Math.abs(b[k])<=4)||b.minX>=b.maxX||b.minZ>=b.maxZ)throw Error('Invalid physics table bounds')}
  if(!Number.isFinite(meta.duration)||meta.duration<=0||meta.duration>maximumDuration||Math.abs(meta.duration-(meta.frames-1)/120)>.001||!meta.results.every(Number.isInteger))throw Error('Invalid roll duration/results');
  if(!Number.isInteger(meta.collisions)||meta.collisions<0||meta.collisions>200000)throw Error('Invalid contact count');
  if(['id','source','name','theme'].some(k=>typeof meta.request[k]!=='string'||meta.request[k].length<1||meta.request[k].length>100))throw Error('Invalid roll identity');
  if(!validBodyColor(meta.request.bodyColor))throw Error('Invalid roll body colour');
  if(!validModifier(meta.request.modifier))throw Error('Invalid roll modifier');
  if(meta.request.visibility!==undefined&&!['all','self','gm','players'].includes(meta.request.visibility))throw Error('Invalid roll visibility');
  if(meta.masked!==undefined&&typeof meta.masked!=='boolean')throw Error('Invalid mask flag');
  if(meta.masked&&(!['self','gm','players'].includes(meta.request.visibility)||meta.request.seed!==0||meta.request.modifier!==0||!meta.results.every(v=>v===0)||meta.diagnostics||meta.formulaData||meta.request.formula||meta.request.preset||!meta.secret))throw Error('Private roll was not redacted');
  const poseBytes=meta.frames*meta.kinds.length*7*4,contactBytes=meta.collisions*CONTACT_FLOATS*4;
  const body=plain.slice(n+4);if(body.length!==poseBytes+contactBytes)throw Error('Pose/contact count mismatch');
  const poses=new Float32Array(body.buffer.slice(0,poseBytes));if(poses.some(x=>!Number.isFinite(x)||Math.abs(x)>1000))throw Error('Invalid pose');
  const view=new DataView(body.buffer,poseBytes,contactBytes),contacts=[];
  for(let i=0;i<meta.collisions;i++){
    const o=i*CONTACT_FLOATS*4,at=(k)=>view.getFloat32(o+k*4,true);
    const contact={t:at(0),kind:at(1),a:at(2),b:at(3),seq:at(4),x:at(5),y:at(6),z:at(7),speed:at(8),impulse:at(9)};
    if(contact.kind!==0&&contact.kind!==1)throw Error('Invalid contact kind');
    if(contact.a<1||contact.a>meta.kinds.length||contact.b<0||contact.b>meta.kinds.length)throw Error('Invalid contact die id');
    if(!Number.isFinite(contact.t)||contact.t<0||contact.t>meta.duration+.001)throw Error('Invalid contact time');
    if(!Number.isFinite(contact.speed)||contact.speed<0||contact.speed>50)throw Error('Invalid contact speed');
    if(!Number.isFinite(contact.impulse)||contact.impulse<0||contact.impulse>10)throw Error('Invalid contact impulse');
    if(![contact.x,contact.y,contact.z].every(v=>Number.isFinite(v)&&Math.abs(v)<=1000))throw Error('Invalid contact position');
    contacts.push(contact);
  }
  return {...meta,poses,contacts};
}
