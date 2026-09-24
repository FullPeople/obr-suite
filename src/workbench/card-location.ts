export type CardLocation={room:string;card:string;url:string};
const safe=(value:string)=>/^[a-zA-Z0-9_-]+$/.test(value);
/** A moved legacy card keeps its upload-room URL. Both reads and CAS writes
 * must address that document; its current scene inventory is a separate scope. */
export function cardLocation(origin:string,room:string,card:string,legacyUrl?:string):CardLocation {
 let documentRoom=room.replace(/[^a-zA-Z0-9_-]/g,'_'),documentCard=card;
 if(legacyUrl)try{const url=new URL(legacyUrl,origin),match=/^\/characters\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)(?:\/|$)/.exec(url.pathname);if(url.origin===origin&&match){documentRoom=match[1];documentCard=match[2];}}catch{}
 if(!safe(documentRoom)||!safe(documentCard))throw Error('无效角色资料地址');
 return {room:documentRoom,card:documentCard,url:`${origin}/characters/${encodeURIComponent(documentRoom)}/${encodeURIComponent(documentCard)}/data.json`};
}
