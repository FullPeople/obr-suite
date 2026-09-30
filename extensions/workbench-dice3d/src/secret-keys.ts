import type {CipherText,SecretDetails,SecretPack,Visibility} from './hidden-roll';
import {packReveal,unpackReveal} from './suite-reveal';
const text=new TextEncoder(),string=new TextDecoder();
const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const b64=(b:Uint8Array)=>btoa(Array.from(b,x=>String.fromCharCode(x)).join(''));
export async function secretCommitment(d:SecretDetails){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',text.encode(JSON.stringify(d)))),v=>v.toString(16).padStart(2,'0')).join('');}
const aad=(owner:string,id:string)=>text.encode('com.fullpeople.dice-lab.v1:hidden:1:'+owner+':'+id);
async function encrypt(key:CryptoKey,value:Uint8Array,additionalData:Uint8Array):Promise<CipherText>{const iv=crypto.getRandomValues(new Uint8Array(12));return{iv:b64(iv),data:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:additionalData as BufferSource,tagLength:128},key,value as BufferSource)))}}
async function decrypt(key:CryptoKey,box:CipherText,additionalData:Uint8Array){
  if(!box||typeof box.data!=='string'||box.data.length>50000||typeof box.iv!=='string'||bytes(box.iv).length!==12)throw Error('暗骰密文格式错误');
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(box.iv),additionalData:additionalData as BufferSource,tagLength:128},key,bytes(box.data)));
}
/** Fresh connection-bound ECDH keys; the OBR event connectionId authenticates the hello sender.
 * HKDF separates our pairwise wrapping keys from any other use; random per-roll AES-GCM key.
 * This is peer privacy, NOT server anti-cheat or protection against a compromised viewer. */
export class SecretKeys{
  private pair!:CryptoKeyPair;publicKey!:JsonWebKey;
  private peers=new Map<string,{fingerprint:string;key:CryptoKey}>();
  readonly ready:Promise<void>;
  constructor(readonly id:string){this.ready=this.init()}
  private async init(){
    this.pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
    this.publicKey=await crypto.subtle.exportKey('jwk',this.pair.publicKey);
  }
  async remember(id:string,jwk:JsonWebKey,authenticatedNewSession=false){
    await this.ready;if(!jwk||jwk.kty!=='EC'||jwk.crv!=='P-256'||jwk.d||typeof jwk.x!=='string'||typeof jwk.y!=='string')throw Error('暗骰公钥格式错误');
    const fingerprint=JSON.stringify([jwk.x,jwk.y]),old=this.peers.get(id);if(old){if(old.fingerprint===fingerprint)return;if(!authenticatedNewSession)throw Error('同一会话更换了暗骰公钥，请重新连接');}
    if(!old&&this.peers.size>=64)throw Error('暗骰连接超过 64 个上限');
    const pub=await crypto.subtle.importKey('jwk',jwk,{name:'ECDH',namedCurve:'P-256'},false,[]);
    const raw=await crypto.subtle.deriveBits({name:'ECDH',public:pub},this.pair.privateKey,256),base=await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(32),info:text.encode('dice-lab:hidden-wrap:1:'+JSON.stringify([id,this.id].sort()))},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    this.peers.set(id,{fingerprint,key});
  }
  forget(id:string){this.peers.delete(id)}
  async seal(d:SecretDetails,scope:Exclude<Visibility,'all'>,audience:string[]):Promise<SecretPack>{
    const content=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']),raw=new Uint8Array(await crypto.subtle.exportKey('raw',content)),context=aad(d.owner,d.id);
    const keys=[];for(const to of audience)if(to!==this.id){const peer=this.peers.get(to);if(!peer)throw Error('暗骰接收者尚未完成密钥交换: '+to);keys.push({to,box:await encrypt(peer.key,raw,context)})}
    return{scope,audience,commitment:await secretCommitment(d),data:await encrypt(content,text.encode(await packReveal(d)),context),keys};
  }
  async open(pack:SecretPack,owner:string,id:string):Promise<SecretDetails|null>{
    if(!pack.audience.includes(this.id))return null;
    const entry=pack.keys.find(k=>k.to===this.id),peer=this.peers.get(owner);if(!entry||!peer)throw Error('暗骰授权密钥缺失');
    const context=aad(owner,id),raw=await decrypt(peer.key,entry.box,context),key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);
    const details=await unpackReveal(string.decode(await decrypt(key,pack.data,context))) as SecretDetails;
    if(await secretCommitment(details)!==pack.commitment)throw Error('暗骰承诺校验失败');return details;
  }
}
