// Lossless PNG evidence from the exact observed unpremultiplied RGBA bytes.
// Do not redraw these bytes through another Canvas2D: that roundtrip can round
// translucent RGB and hide the very one-byte difference being investigated.
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let i=0;i<8;i++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const value of bytes)crc=crcTable[(crc^value)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length,0);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);return out;}
export function encodeRgbaPng({width,height,rgba}){
 assert(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0,'Invalid PNG dimensions');const bytes=Buffer.from(rgba);assert.equal(bytes.length,width*height*4,'Invalid PNG RGBA length');
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const stride=width*4,scanlines=Buffer.alloc((stride+1)*height);for(let y=0;y<height;y++)bytes.copy(scanlines,y*(stride+1)+1,y*stride,(y+1)*stride);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scanlines)),chunk('IEND',Buffer.alloc(0))]);
}
