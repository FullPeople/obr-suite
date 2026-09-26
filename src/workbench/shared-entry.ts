export const OPEN_WIKI_CHANNEL='com.obr-suite/workbench/open-wiki';
const kinds=new Set(['class','subclass','race','background','feat','spell','item','feature','condition','rule','monster']);
export interface SharedEntry {id:string;kind:string;name:string;english:string;source:string;edition:string;packId:string;revision:string;page?:number;entries:unknown[];raw:Record<string,unknown>}
/** A rule snapshot only. No character metadata, pictures or executable HTML. */
export function sharedEntry(value:any):SharedEntry{
 if(!value||typeof value.id!=='string'||!value.id||value.id.length>700||typeof value.name!=='string'||!value.name.trim()||value.name.length>300||!kinds.has(value.kind)||!Array.isArray(value.entries))throw Error('展示的词条格式无效');
 const text=(key:string)=>typeof value[key]==='string'?value[key].slice(0,300):'';
 const entry:SharedEntry={id:value.id,kind:value.kind,name:value.name,english:text('english'),source:text('source'),edition:['2014','2024'].includes(value.edition)?value.edition:'both',packId:text('packId'),revision:text('revision'),entries:value.entries,raw:{}};
 if(Number.isFinite(value.page))entry.page=value.page;
 for(const key of ['level','school','time','range','components','duration','value','weight','rarity','type','weaponCategory','property','dmg1','dmg2','dmgType','ac','strength','stealth','attunement','reqAttune','cost','entriesHigherLevel','ability','skillProficiencies','weaponProficiencies','armorProficiencies','savingThrowProficiencies','startingProficiencies','startingEquipment','_category','_custom'])if(value.raw&&key in value.raw)entry.raw[key]=value.raw[key];
 if(JSON.stringify(entry).length>100_000)throw Error('该词条内容过长，无法一次展示');
 return JSON.parse(JSON.stringify(entry));
}
export function noticeEntry(data:{entry?:SharedEntry;resource:{id?:string;name:string;current:number;max:number};delta:number;prevValue:number}):SharedEntry{
 if(data.entry)return sharedEntry(data.entry);
 const r=data.resource;
 return {id:'resource:'+String(r.id||r.name),kind:'feature',name:r.name,english:'',source:'CUSTOM',edition:'both',packId:'custom',revision:'1',entries:[`${data.prevValue} → ${r.current}${r.max>0?` / ${r.max}`:''}`],raw:{_custom:true}};
}
