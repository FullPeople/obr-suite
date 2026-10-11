// Minimal RFC 6455 server side: handshake, unmasking, text/ping/pong/close.
// The relay keeps its HTTP long-poll path; a socket only replaces the receive
// side, so no dependency is added to the loopback service.
import {createHash} from 'node:crypto';
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const SUBPROTOCOL='full-suite-relay';
/** Returns the bearer token carried in the Sec-WebSocket-Protocol list, or null. */
export function socketToken(req){
 const offered=String(req.headers['sec-websocket-protocol']||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!offered.includes(SUBPROTOCOL))return null;
 const token=offered.find(s=>s.startsWith('token.'));
 return token?token.slice(6):null;
}
export function isUpgradeRequest(req){
 return req.method==='GET'&&/\bwebsocket\b/i.test(String(req.headers.upgrade||''))&&/\bupgrade\b/i.test(String(req.headers.connection||''))&&typeof req.headers['sec-websocket-key']==='string'&&req.headers['sec-websocket-version']==='13';
}
export function refuseUpgrade(socket,status,text){
 try{socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);}catch{}
 socket.destroy();
}
function encodeFrame(opcode,payload){
 const length=payload.length;let header;
 if(length<126){header=Buffer.alloc(2);header[1]=length;}
 else if(length<65536){header=Buffer.alloc(4);header[1]=126;header.writeUInt16BE(length,2);}
 else{header=Buffer.alloc(10);header[1]=127;header.writeBigUInt64BE(BigInt(length),2);}
 header[0]=0x80|opcode;
 return Buffer.concat([header,payload]);
}
/**
 * Completes the handshake and returns a tiny connection object:
 *  send(text)  — text frame; false when the socket is gone
 *  ping()      — control frame; the pong resets `alive`
 *  close(code) — close frame then end
 *  on('message'|'close'|'pong', fn)
 */
export function acceptUpgrade(req,socket,head){
 const accept=createHash('sha1').update(req.headers['sec-websocket-key']+GUID).digest('base64');
 socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: ${SUBPROTOCOL}\r\n\r\n`);
 socket.setNoDelay(true);
 const listeners={message:[],close:[],pong:[]};
 const emit=(name,value)=>{for(const fn of listeners[name])try{fn(value);}catch{}};
 let open=true,buffer=head&&head.length?Buffer.from(head):Buffer.alloc(0),fragments=[],fragmentOpcode=0;
 const connection={
  get open(){return open;},
  on(name,fn){listeners[name].push(fn);return connection;},
  send(text){if(!open)return false;try{socket.write(encodeFrame(0x1,Buffer.from(text,'utf8')));return true;}catch{finish();return false;}},
  ping(){if(!open)return;try{socket.write(encodeFrame(0x9,Buffer.alloc(0)));}catch{finish();}},
  close(code=1000){if(!open)return;try{const body=Buffer.alloc(2);body.writeUInt16BE(code,0);socket.write(encodeFrame(0x8,body));}catch{}finish();},
 };
 function finish(){if(!open)return;open=false;try{socket.end();}catch{}emit('close');}
 function parse(){
  for(;;){
   if(buffer.length<2)return;
   const fin=(buffer[0]&0x80)!==0,opcode=buffer[0]&0x0f,masked=(buffer[1]&0x80)!==0;let length=buffer[1]&0x7f,offset=2;
   if(length===126){if(buffer.length<4)return;length=buffer.readUInt16BE(2);offset=4;}
   else if(length===127){if(buffer.length<10)return;const big=buffer.readBigUInt64BE(2);if(big>BigInt(16*1024*1024)){connection.close(1009);return;}length=Number(big);offset=10;}
   if(!masked){connection.close(1002);return;}
   if(buffer.length<offset+4+length)return;
   const mask=buffer.subarray(offset,offset+4),payload=Buffer.from(buffer.subarray(offset+4,offset+4+length));
   for(let i=0;i<payload.length;i++)payload[i]^=mask[i&3];
   buffer=buffer.subarray(offset+4+length);
   if(opcode===0x8){connection.close(1000);return;}
   if(opcode===0x9){try{socket.write(encodeFrame(0xA,payload));}catch{finish();return;}continue;}
   if(opcode===0xA){emit('pong');continue;}
   if(opcode===0x1||opcode===0x2||opcode===0x0){
    if(opcode!==0x0)fragmentOpcode=opcode;
    fragments.push(payload);
    if(fragments.reduce((n,p)=>n+p.length,0)>16*1024*1024){connection.close(1009);return;}
    if(fin){const whole=Buffer.concat(fragments);fragments=[];if(fragmentOpcode===0x1)emit('message',whole.toString('utf8'));}
    continue;
   }
   connection.close(1002);return;
  }
 }
 socket.on('data',chunk=>{buffer=buffer.length?Buffer.concat([buffer,chunk]):chunk;try{parse();}catch{connection.close(1002);}});
 socket.on('error',finish);socket.on('close',finish);socket.on('end',finish);
 if(buffer.length)try{parse();}catch{connection.close(1002);}
 return connection;
}
