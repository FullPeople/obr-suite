export type CardLocation={room:string;card:string;url:string};
const safe=(value:string)=>/^[a-zA-Z0-9_-]+$/.test(value);
/** A moved legacy card keeps its upload-room URL. Both reads and CAS writes
 * must address that document; its current scene inventory is a separate scope. */
export function cardLocation(origin:string,room:string,card:string,legacyUrl?:string):CardLocation {
 let documentRoom=room.replace(/[^a-zA-Z0-9_-]/g,'_'),documentCard=card;
 if(legacyUrl){
  let parsed:URL;try{parsed=new URL(legacyUrl,origin);}catch{throw Object.assign(Error('角色资料地址无效；请刷新目录后核对'),{status:400,diagnostic:{code:'INVALID_CARD_LOCATION'}});}
  const match=/^\/characters\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)(?:\/(?:data\.json|index\.html)?)?$/.exec(parsed.pathname);
  if(parsed.origin!==origin||parsed.username||parsed.password||!match)throw Object.assign(Error('角色资料地址不受支持；请刷新目录后核对'),{status:400,diagnostic:{code:'INVALID_CARD_LOCATION'}});
  documentRoom=match[1];documentCard=match[2];
 }
 if(!safe(documentRoom)||!safe(documentCard))throw Error('无效角色资料地址');
 return {room:documentRoom,card:documentCard,url:`${origin}/characters/${encodeURIComponent(documentRoom)}/${encodeURIComponent(documentCard)}/data.json`};
}
