import { readFileSync } from 'node:fs';
import { inflateRawSync, deflateRawSync } from 'node:zlib';

// Independent ZIP fixture writer; original public workbooks are read only.
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i=0;i<8;i++) n=(n&1)?0xedb88320^(n>>>1):n>>>1; return n>>>0; });
function crc(bytes) { let value=0xffffffff; for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8); return (value^0xffffffff)>>>0; }
export function unpack(bytes) {
  let end=bytes.length-22; while(bytes.readUInt32LE(end)!==0x06054b50)end--;
  const entries=new Map(); let offset=bytes.readUInt32LE(end+16);
  for(let i=0;i<bytes.readUInt16LE(end+10);i++) {
    const method=bytes.readUInt16LE(offset+10),size=bytes.readUInt32LE(offset+20),local=bytes.readUInt32LE(offset+42);
    const name=bytes.subarray(offset+46,offset+46+bytes.readUInt16LE(offset+28)).toString();
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),body=bytes.subarray(start,start+size);
    entries.set(name,method===8?inflateRawSync(body):body);
    offset+=46+bytes.readUInt16LE(offset+28)+bytes.readUInt16LE(offset+30)+bytes.readUInt16LE(offset+32);
  }
  return entries;
}
const compressedCache = new WeakMap();
export function pack(entries) {
  const local=[],central=[]; let offset=0;
  for(const [name,value] of entries) {
    let cached=compressedCache.get(value);if(!cached){const bytes=Buffer.from(value);cached={body:deflateRawSync(bytes),sum:crc(bytes),size:bytes.length};compressedCache.set(value,cached);}
    const {body,sum,size}=cached,filename=Buffer.from(name);
    const a=Buffer.alloc(30),b=Buffer.alloc(46);a.writeUInt32LE(0x04034b50);a.writeUInt16LE(20,4);a.writeUInt16LE(8,8);a.writeUInt32LE(sum,14);a.writeUInt32LE(body.length,18);a.writeUInt32LE(size,22);a.writeUInt16LE(filename.length,26);
    b.writeUInt32LE(0x02014b50);b.writeUInt16LE(20,4);b.writeUInt16LE(20,6);b.writeUInt16LE(8,10);b.writeUInt32LE(sum,16);b.writeUInt32LE(body.length,20);b.writeUInt32LE(size,24);b.writeUInt16LE(filename.length,28);b.writeUInt32LE(offset,42);
    local.push(a,filename,body);central.push(b,filename);offset+=a.length+filename.length+body.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.size,8);end.writeUInt16LE(entries.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
export const SHEET='xl/worksheets/sheet2.xml', WORKBOOK='xl/workbook.xml', RELS='xl/_rels/workbook.xml.rels';
export function change(entries, path, transform) { entries.set(path,Buffer.from(transform(entries.get(path).toString()))); }
export function cell(entries, ref, body, attributes='t="inlineStr"') {
  change(entries,SHEET,xml=>{let found=false;const next=xml.replace(new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`),()=>{found=true;return `<c ${attributes} r="${ref}">${body}</c>`;});if(!found)throw Error(`No fixture cell ${ref}`);return next;});
}
export const textCell=(entries,ref,text)=>cell(entries,ref,`<is><t>${text}</t></is>`);
export function originals() { return ['E','R'].map(kind=>readFileSync(`public/DND5${kind}人物卡_悲灵_弗人_枭熊适配版.xlsx`)); }
export function english(entries) { change(entries,WORKBOOK,xml=>xml.replace('name="主要"','name="Main"'));for(const [ref,text]of [['AL39','Shield'],['AS39','Equipped'],['B3','Character Name']])textCell(entries,ref,text); }
export function moved(entries) {
  entries.set('xl/worksheets/actual-main.xml',entries.get(SHEET));entries.delete(SHEET);
  change(entries,RELS,xml=>xml.replace('Target="worksheets/sheet2.xml"','Target="worksheets/actual-main.xml"'));
  change(entries,WORKBOOK,xml=>xml.replace(/(<sheet\b[^>]*name="(?:主要|Main)"[^>]*\/>)\s*/,(sheet)=>'').replace('</sheets>',`${entries.get(WORKBOOK).toString().match(/<sheet\b[^>]*name="(?:主要|Main)"[^>]*\/>/)[0]}</sheets>`));
}
