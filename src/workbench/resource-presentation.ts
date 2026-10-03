/** Presentation never owns resource values or grants access to additional resources. */
export const RESOURCE_WIDGET_STYLES = ['ring','pips','pool','half','orbit','square','segments','reservoir','matrix','fraction','counter','poolchips','poolbars','poolpips','ready','diamond','bar','icon'] as const;
export const RESOURCE_WIDGET_ICONS = ['spark','diamond','shield','flame','leaf','bottle'] as const;
export type ResourceAppearance = {style:typeof RESOURCE_WIDGET_STYLES[number];color?:string;icon?:typeof RESOURCE_WIDGET_ICONS[number]};
export type ResourceWidgetPresentation = ResourceAppearance & {x:number;y:number;w:number;h:number;page:number;resourceArea?:boolean;contentScale?:number;split?:number;background?:string;borderWidth?:number;borderRadius?:number;padding?:number;gap?:number;members?:string[];label?:string};
const object = (value:unknown):value is Record<string,any> => !!value && typeof value==='object' && !Array.isArray(value);
const style = (value:unknown):value is ResourceAppearance['style'] => RESOURCE_WIDGET_STYLES.includes(value as ResourceAppearance['style']);
const color = (value:unknown):value is string => typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value);
const frameKeys=['borderWidth','borderRadius','padding','gap'] as const;
const validFrame=(value:Record<string,any>)=>(value.background===undefined||value.background==='transparent'||color(value.background))&&frameKeys.every(key=>value[key]===undefined||Number.isInteger(value[key])&&value[key]>=0&&value[key]<=(key==='borderWidth'?8:key==='borderRadius'?32:16));
const frame=(value:Record<string,any>)=>({...((value.background==='transparent'||color(value.background))?{background:value.background}:{}),...Object.fromEntries(frameKeys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]))});
const icon = (value:unknown):value is ResourceAppearance['icon'] => RESOURCE_WIDGET_ICONS.includes(value as typeof RESOURCE_WIDGET_ICONS[number]);

/** Public inventory has appearance only; grid placement belongs to the character dashboard. */
export function validResourceAppearance(value:unknown):value is ResourceAppearance {
 return object(value) && Object.keys(value).every(key=>['style','color','icon'].includes(key)) && style(value.style)
  && (value.color===undefined || color(value.color)) && (value.icon===undefined || icon(value.icon));
}

function widget(value:unknown):ResourceWidgetPresentation|undefined {
 if(!object(value)||!style(value.style))return;
 const {x,y,w,h,page}=value;
 if(![x,y,w,h,page].every(Number.isSafeInteger)||x<0||y<0||w<1||h<1||x+w>12||y+h>6||page<0||page>2999||!validFrame(value))return;
 return {style:value.style,x,y,w,h,page,...(color(value.color)?{color:value.color}:{}),...(icon(value.icon)?{icon:value.icon}:{}),...(typeof value.resourceArea==='boolean'?{resourceArea:value.resourceArea}:{}),...(Number.isFinite(value.contentScale)&&value.contentScale>=.25&&value.contentScale<=2?{contentScale:value.contentScale}:{}),...(Number.isFinite(value.split)&&value.split>=.2&&value.split<=.55?{split:value.split}:{}),...frame(value)};
}

/** Restricted to resource IDs already authorized for this recipient, including group members. */
export function resourceWidgetPresentation(document:any,resources:readonly {id?:string}[]):Record<string,ResourceWidgetPresentation> {
 const saved=document?.dnd_card_web!==undefined?document?.dnd_card_web?.quickbarLayout?.widgets:document?.web_resource_widgets;
 const result:Record<string,ResourceWidgetPresentation>=Object.create(null);
 if(!object(saved))return result;
 const allowed=new Set(resources.map(resource=>resource.id));
 for(const resource of resources){
  const id=resource.id;if(typeof id!=='string'||!Object.hasOwn(saved,id))continue;
  const value=saved[id],picked=widget(value);if(!picked)continue;
  const members=Array.isArray(value.members)?value.members.filter((key:unknown)=>typeof key==='string'&&allowed.has(key)):[];
  if(members.length>=2&&members.length<=12&&new Set(members).size===members.length&&members.includes(id)){
   picked.members=members;
   if(typeof value.label==='string'&&value.label.length<=100)picked.label=value.label;
  }
  Object.defineProperty(result,id,{value:picked,enumerable:true,writable:true,configurable:true});
 }
 return result;
}

/** Independent weapon-panel geometry, never represented as a synthetic resource. */
export function quickbarAttackPresentation(document:any):ResourceWidgetPresentation|undefined {
 const value=document?.dnd_card_web!==undefined?document?.dnd_card_web?.quickbarLayout?.attacks:document?.web_quickbar_attacks;
 return value?.members===undefined?widget(value):undefined;
}

/** Called inside the existing resource document transaction, never as a second write. */
export function updateResourceWidgetPresentation(document:any,id:string,presentation:unknown) {
 if(!id||['__proto__','prototype','constructor'].includes(id))throw Error('无效资源展示ID');
 const native=document.dnd_card_web;
 if(native!==undefined&&!object(native))throw Error('角色资料格式无效');
 const resources=native?.runtime?.resources||document.web_resources||{};
 if(presentation!==null){
  if(!object(presentation)||Object.keys(presentation).some(key=>!['style','color','icon','x','y','w','h','page','members','label','resourceArea','contentScale','split','background',...frameKeys].includes(key))||!style(presentation.style)||!validFrame(presentation)
   ||presentation.color!==undefined&&!color(presentation.color)||presentation.icon!==undefined&&!icon(presentation.icon))throw Error('无效资源展示样式');
  if(presentation.resourceArea!==undefined&&typeof presentation.resourceArea!=='boolean'||presentation.contentScale!==undefined&&(!Number.isFinite(presentation.contentScale)||presentation.contentScale<.25||presentation.contentScale>2)||presentation.split!==undefined&&(!Number.isFinite(presentation.split)||presentation.split<.2||presentation.split>.55))throw Error('无效资源展示比例');
  if(['x','y','w','h','page'].some(key=>key in presentation)&&!widget(presentation))throw Error('无效资源展示布局');
  if(presentation.members!==undefined&&(!Array.isArray(presentation.members)||presentation.members.length<2||presentation.members.length>12||new Set(presentation.members).size!==presentation.members.length||!presentation.members.includes(id)||presentation.members.some((key:unknown)=>typeof key!=='string'||key!==id&&!Object.hasOwn(resources,key))))throw Error('无效资源分组');
  if(presentation.label!==undefined&&(typeof presentation.label!=='string'||presentation.label.length>100))throw Error('无效资源分组名称');
 }
 const previous=resourceWidgetPresentation(document,[...new Set([id,...Object.keys(resources)])].map(id=>({id})))[id];
 const existingLayout=native?.quickbarLayout;
 if(existingLayout!==undefined&&!object(existingLayout)||existingLayout?.widgets!==undefined&&!object(existingLayout.widgets)||!native&&document.web_resource_widgets!==undefined&&!object(document.web_resource_widgets))throw Error('角色展示布局格式无效');
 const layout=native?(native.quickbarLayout||={order:[],hidden:[]}):undefined;
 const widgets=layout?(layout.widgets||={}):(document.web_resource_widgets||={});
 if(presentation===null){
  const old=widgets[id];delete widgets[id];
  for(const value of Object.values(widgets) as any[])if(Array.isArray(value?.members)){
   value.members=value.members.filter((key:string)=>key!==id);
   if(value.members.length<2){delete value.members;delete value.label;}
  }
  // Deleting a pool anchor keeps the remaining pool at the same place and appearance.
  if(Array.isArray(old?.members)){
   const members=old.members.filter((key:string)=>key!==id&&Object.hasOwn(resources,key));
   if(members.length){const replacement={...old,members};if(members.length<2){delete replacement.members;delete replacement.label;}Object.defineProperty(widgets,members[0],{value:replacement,writable:true,enumerable:true,configurable:true});}
  }
 }else Object.defineProperty(widgets,id,{value:{...(previous||{x:0,y:0,w:4,h:2,page:0}),...(presentation as object)},writable:true,enumerable:true,configurable:true});
 if(native)delete document.web_resource_widgets;
}

/** Visibility is a layout preference, restricted to already authorized pools. */
export function hiddenResourcePresentation(document:any,resources:readonly {id?:string}[]):string[]{
 const hidden=document?.dnd_card_web?.quickbarLayout?.hidden,allowed=new Set(resources.map(row=>`resource:${row.id}`));
 return Array.isArray(hidden)?[...new Set(hidden.filter((id:unknown):id is string=>typeof id==='string'&&allowed.has(id)))]:[];
}
