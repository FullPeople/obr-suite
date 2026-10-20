import {sha256Hex} from "./sha256";

// 1001/1002 are local-only search categories, independent of upstream IDs.
export const LOCAL_RECORD_CATEGORIES = {baseitem:4, charoption:47, facility:1001, magicvariant:57, object:1002} as const;
export type LocalRecordKind = keyof typeof LOCAL_RECORD_CATEGORIES;
type Row = Record<string, any>;
export interface LocalRecordReference {fileId:string; kind:LocalRecordKind; digest:string; edition:"2014"|"2024"|"unknown"}
export interface LocalRecordRow {ref:LocalRecordReference; record:Row; name:string; english:string; source:string; ordinal?:number}
export const isLocalRecordKind = (kind:string):kind is LocalRecordKind => Object.hasOwn(LOCAL_RECORD_CATEGORIES,kind);
const text=(value:unknown)=>typeof value==="string"?value.trim():"";
const same=(a:unknown,b:unknown)=>text(a).toLowerCase()===text(b).toLowerCase();
const values=(body:Row,kind:string):Row[]=>Array.isArray(body[kind])?body[kind].filter((row:unknown)=>row&&typeof row==="object"&&!Array.isArray(row)):[];
function canonical(value:unknown):string{
 if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
 if(value&&typeof value==="object")return `{${Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
 return JSON.stringify(value)??"null";
}
function edition(row:Row,body:Row):LocalRecordReference["edition"]{
 const value=String(row.edition??row.inherits?.edition??body._meta?.edition??"").toLowerCase();
 return ["2014","classic"].includes(value)?"2014":["2024","one"].includes(value)?"2024":"unknown";
}
const source=(row:Row)=>text(row.source)||text(row.inherits?.source)||text(row._copy?.source)||"HOMEBREW";
const name=(row:Row)=>text(row.name)||text(row.ENG_name)||text(row._copy?.name);
const cache=new WeakMap<object,{fileId:string;rows:LocalRecordRow[]}>();
export function localRecordRows(fileId:string,body:Row):LocalRecordRow[]{
 const old=cache.get(body);if(old?.fileId===fileId)return old.rows;
 const rows:LocalRecordRow[]=[];
 for(const kind of Object.keys(LOCAL_RECORD_CATEGORIES) as LocalRecordKind[])for(const record of values(body,kind)){
  const title=name(record);if(!title)continue;
  rows.push({ref:{fileId,kind,edition:edition(record,body),digest:sha256Hex(canonical([kind,edition(record,body),record]))},record,name:title,english:text(record.ENG_name)||title,source:source(record)});
 }
 const groups=new Map<string,LocalRecordRow[]>();
 for(const row of rows){const key=canonical([row.ref.kind,row.ref.edition,row.name,row.english,row.source]);const group=groups.get(key)||[];group.push(row);groups.set(key,group);}
 for(const group of groups.values()){const keys=[...new Set(group.map(row=>row.ref.digest))].sort();if(keys.length>1)for(const row of group)row.ordinal=keys.indexOf(row.ref.digest)+1;}
 cache.set(body,{fileId,rows});return rows;
}

/** Read only the selected saved pack. Never turn a template into equipment or
 * execute a copy modifier. Missing/ambiguous inheritance remains explicit. */
export function localRecordDetails(ref:LocalRecordReference,body:Row,language:"zh"|"en"):Row|null{
 if(!ref||!isLocalRecordKind(ref.kind))return null;
 const selected=localRecordRows(ref.fileId,body).find(row=>row.ref.kind===ref.kind&&row.ref.digest===ref.digest&&row.ref.edition===ref.edition);
 if(!selected)return null;
 const tr=(zh:string,en:string)=>language==="en"?en:zh;
 const notices:Row[]=[];
 const notice=(message:string)=>notices.push({type:"entries",name:tr("来源待核对","Source needs review"),entries:[message],_localRecordNotice:true});
 function resolveCopy(row:Row,seen=new Set<Row>()):Row{
  if(!row._copy)return row;
  const copy=row._copy;
  if(seen.has(row)||seen.size>=24||Object.keys(copy._mod||{}).length){notice(tr("继承包含循环或尚未支持的修改，未自动展开；请核对原始继承说明。","Inheritance is cyclic or contains unsupported modifiers; review the original copy declaration."));return row;}
  seen.add(row);
  const parents=values(body,ref.kind).filter(parent=>parent!==row&&edition(parent,body)===ref.edition&&
   [parent.name,parent.ENG_name].some(value=>same(value,copy.name)||copy.ENG_name&&same(value,copy.ENG_name))&&same(source(parent),copy.source||source(row)));
  if(parents.length!==1){notice(tr("继承来源未在本资料包中唯一找到，未借用其他包的同名记录。","The inherited source is not unique in this saved pack; no namesake from another pack was substituted."));return row;}
  return {...resolveCopy(parents[0],seen),...row};
 }
 const resolved=resolveCopy(selected.record),own=Array.isArray(resolved.entries)?resolved.entries:[];
 const blocks:Row[]=[];
 const labels:Record<string,[string,string]>={weapon:["武器","Weapon"],armor:["护甲","Armor"],type:["类型","Type"],property:["属性","Properties"],level:["等级","Level"],amount:["数量","Amount"],count:["数量","Count"],exact:["固定数量","Fixed count"],bonusWeapon:["武器加值","Weapon bonus"],bonusAc:["防御等级加值","Armor class bonus"],namePrefix:["名称前缀","Name prefix"],nameSuffix:["名称后缀","Name suffix"],rarity:["稀有度","Rarity"],reqAttune:["同调","Attunement"],source:["来源","Source"],name:["名称","Name"],ENG_name:["英文名","English name"],page:["页码","Page"],edition:["版本","Edition"],formula:["公式","Formula"],average:["平均值","Average"],special:["特殊说明","Special"],_mod:["未展开的修改","Unexpanded modifiers"]};
 const display=(value:unknown):string=>{
  if(Array.isArray(value))return value.map(item=>typeof item==="object"&&item!==null?`(${display(item)})`:display(item)).join(tr("；","; "));
  if(value&&typeof value==="object")return Object.entries(value).map(([key,item])=>`${labels[key]?tr(...labels[key]):key}${tr("：",": ")}${display(item)}`).join(tr("，",", "));
  return typeof value==="boolean"?value?tr("是","Yes"):tr("否","No"):String(value??"");
 };
 const block=(zh:string,en:string,value:unknown)=>{if(value!==undefined&&value!==null&&value!=="")blocks.push({type:"entries",name:tr(zh,en),entries:[display(value)]});};
 const fields:Record<LocalRecordKind,[string,string,string][]>={
  baseitem:[["customProperties","附加属性","Additional properties"],["mastery","武器精通","Weapon mastery"],["reload","装填","Reload"],["bonusWeaponDamage","额外武器伤害","Additional weapon damage"],["bonusAc","额外防御等级","Additional armor class"]],
  charoption:[["optionType","选项类型","Option type"],["prerequisite","先决条件","Prerequisites"]],
  facility:[["facilityType","设施类型","Facility type"],["level","等级","Level"],["prerequisite","先决条件","Prerequisites"],["space","占地","Space"],["hirelings","雇员","Hirelings"],["orders","命令","Orders"]],
  magicvariant:[["requires","适用条件","Requirements"],["excludes","排除条件","Exclusions"]],
  object:[["size","体型","Size"],["objectType","物件类型","Object type"],["ac","防御等级","Armor class"],["hp","生命值","Hit points"],["immune","免疫","Immunities"]]
 };
 for(const [field,zh,en] of fields[ref.kind])block(zh,en,resolved[field]);
 let inherited:unknown[]=[];
 if(ref.kind==="magicvariant"){
  block("魔法物品模板","Magic item template",tr("模板仅供查阅，未生成或自动应用到装备。","This template is for reference; it has not generated or modified equipment."));
  const attributes=Object.fromEntries(Object.entries(resolved.inherits||{}).filter(([key])=>key!=="entries"));
  if(Object.keys(attributes).length)block("模板属性","Template attributes",attributes);
  inherited=Array.isArray(resolved.inherits?.entries)?resolved.inherits.entries:[];
 }
 if(selected.record._copy)block("继承说明","Copy declaration",selected.record._copy);
 if(!own.length&&!inherited.length&&ref.kind!=="baseitem"&&!notices.length)notice(tr("来源未提供正文，请核对资料字段。","No body text was supplied; review the source fields."));
 return {...structuredClone(resolved),name:selected.name,source:selected.source,_contentLanguage:"auto",entries:structuredClone([...notices,...blocks,...own,...inherited])};
}
