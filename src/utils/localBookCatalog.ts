import {sha256Hex} from './sha256';

type Row=Record<string,any>;
export const LOCAL_BOOK_CATEGORIES={book:18,adventure:13} as const;
export type LocalBookKind=keyof typeof LOCAL_BOOK_CATEGORIES;
type Edition='2014'|'2024'|'unknown';
export interface LocalBookReference{fileId:string;kind:LocalBookKind;digest:string;edition:Edition}
type Notice='missing-body'|'ambiguous-body'|'missing-metadata'|'ambiguous-metadata'|'invalid-body'|'empty-body';
interface BookRow{ref:LocalBookReference;record:Row;body?:Row;name:string;english:string;source:string;notices:Notice[]}
export const isLocalBookKind=(kind:string):kind is LocalBookKind=>Object.hasOwn(LOCAL_BOOK_CATEGORIES,kind);
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
const key=(value:unknown)=>text(value).toLowerCase();
const values=(body:Row,field:string):Row[]=>Array.isArray(body[field])?body[field].filter((row:unknown)=>row&&typeof row==='object'&&!Array.isArray(row)):[];
const explicitEdition=(row:Row|undefined):Edition|undefined=>['one','2024'].includes(key(row?.edition))?'2024':['classic','2014'].includes(key(row?.edition))?'2014':undefined;
function canonical(value:unknown):string{
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,item])=>JSON.stringify(name)+':'+canonical(item)).join(',')}}`;
 return JSON.stringify(value)??'null';
}
const cache=new WeakMap<object,{fileId:string;rows:BookRow[]}>();

/** Pair only an unambiguous in-file document ID, source and declared edition.
 * A book title never resolves a body. Ambiguous bodies remain separate records. */
export function localBookRows(fileId:string,body:Row):BookRow[]{
 const cached=cache.get(body);if(cached?.fileId===fileId)return cached.rows;
 const rows:BookRow[]=[];
 for(const kind of Object.keys(LOCAL_BOOK_CATEGORIES) as LocalBookKind[]){
  const metadata=values(body,kind).filter(row=>text(row.name)||text(row.ENG_name)||text(row.id));
  const documents=values(body,kind+'Data').filter(row=>text(row.id));
  const matches=(meta:Row,document:Row)=>!!text(meta.id)&&key(meta.id)===key(document.id)&&
   (!text(meta.source)||!text(document.source)||key(meta.source)===key(document.source))&&
   (!explicitEdition(meta)||!explicitEdition(document)||explicitEdition(meta)===explicitEdition(document));
  const candidates=new Map(metadata.map(meta=>[meta,documents.filter(document=>matches(meta,document))]));
  const owners=new Map(documents.map(document=>[document,metadata.filter(meta=>matches(meta,document))]));
  const paired=new Set<Row>();
  const add=(meta:Row|undefined,document:Row|undefined,notices:Notice[])=>{
   const record=meta||document!,edition=explicitEdition(meta)||explicitEdition(document)||explicitEdition(body._meta)||'unknown';
   if(document&&!Array.isArray(document.data))notices.push('invalid-body');
   else if(document&&!document.data.length)notices.push('empty-body');
   const name=text(meta?.name)||text(meta?.ENG_name)||text(document?.name)||text(document?.ENG_name)||text(record.id);
   const source=text(meta?.source)||text(document?.source)||'HOMEBREW';
   rows.push({ref:{fileId,kind,edition,digest:sha256Hex(canonical([kind,edition,meta||null,document||null,notices]))},record,body:document,name,english:text(meta?.ENG_name)||text(document?.ENG_name)||name,source,notices});
  };
  for(const meta of metadata){
   const found=candidates.get(meta)!;
   if(found.length===1&&owners.get(found[0])!.length===1){paired.add(found[0]);add(meta,found[0],[]);}
   else add(meta,undefined,[found.length?'ambiguous-body':'missing-body']);
  }
  for(const document of documents)if(!paired.has(document)&&(Array.isArray(document.data)||owners.get(document)!.length))
   add(undefined,document,[owners.get(document)!.length?'ambiguous-metadata':'missing-metadata']);
 }
 const distinct=rows.filter((row,index)=>rows.findIndex(other=>other.ref.kind===row.ref.kind&&other.ref.digest===row.ref.digest)===index);
 cache.set(body,{fileId,rows:distinct});return distinct;
}

/** Read-only projections keep the complete selected source structure available.
 * Missing or changed definitions never borrow a namesake from another file. */
export function localBookDetails(ref:LocalBookReference,body:Row,language:'zh'|'en'):Row|null{
 if(!ref||!isLocalBookKind(ref.kind))return null;
 const row=localBookRows(ref.fileId,body).find(row=>row.ref.kind===ref.kind&&row.ref.digest===ref.digest&&row.ref.edition===ref.edition);
 if(!row)return null;
 const messages:Record<Notice,[string,string]>={
  'missing-body':['此书目未提供可匹配的章节正文，当前只有书目信息。','The document body is missing; only book metadata is available.'],
  'ambiguous-body':['此书目对应多个正文或归属不明确，未任意选取；各正文单独保留。','The document body is ambiguous; every body is retained separately without first-match substitution.'],
  'missing-metadata':['本包没有对应书目信息，按原正文标识保留内容。','Book metadata is missing; the original document ID identifies this body.'],
  'ambiguous-metadata':['书目归属不唯一，按独立正文保留，版本和来源以本条声明为准。','Book metadata is ambiguous; this body keeps its own declared edition and source.'],
  'invalid-body':['章节正文的结构尚未支持，请展开原文结构核对。','The document body structure is unsupported; review the original structure.'],
  'empty-body':['本条声明的章节正文为空。','The declared document body is empty.'],
 };
 const metadata=row.record===row.body?undefined:row.record;
 return {...structuredClone(row.record),name:row.name,ENG_name:row.english,source:row.source,
  _localBook:{kind:ref.kind,edition:ref.edition,data:structuredClone(Array.isArray(row.body?.data)?row.body.data:[]),
   notices:row.notices.map(notice=>messages[notice][language==='en'?1:0]),original:structuredClone({metadata,body:row.body})}};
}
