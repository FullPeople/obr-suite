/** Presentation metadata only, restricted to resource IDs already authorized for this recipient. */
export function resourceWidgetPresentation(document:any,resources:readonly {id?:string}[]):Record<string,{style:'bar'|'ring'|'square'|'icon';x:number;y:number;w:number;h:number;page:number}>{
 const saved=document?.dnd_card_web!==undefined?document?.dnd_card_web?.quickbarLayout?.widgets:document?.web_resource_widgets,result:ReturnType<typeof resourceWidgetPresentation>=Object.create(null);
 if(!saved||typeof saved!=='object'||Array.isArray(saved))return result;
 for(const resource of resources){const id=resource.id;if(typeof id!=='string'||!Object.hasOwn(saved,id))continue;const value=saved[id];if(!value||typeof value!=='object'||!['bar','ring','square','icon'].includes(value.style))continue;
  const {x,y,w,h,page}=value;if(![x,y,w,h,page].every(Number.isSafeInteger)||x<0||y<0||w<3||h<2||x+w>12||y+h>6||page<0||page>2999)continue;
  Object.defineProperty(result,id,{value:{style:value.style,x,y,w,h,page},enumerable:true,writable:true,configurable:true});
 }
 return result;
}

/** Called inside the existing resource document transaction, never as a second write. */
export function updateResourceWidgetPresentation(document:any,id:string,presentation:unknown){
 if(!id||['__proto__','prototype','constructor'].includes(id))throw Error('无效资源展示ID');
 const native=document.dnd_card_web;
 if(presentation!==null){
  if(!presentation||typeof presentation!=='object'||Array.isArray(presentation)||Object.keys(presentation).some(k=>!['style','x','y','w','h','page'].includes(k))||!['bar','ring','square','icon'].includes((presentation as any).style))throw Error('无效资源展示样式');
  const value=presentation as any,geometry=['x','y','w','h','page'];
  if(geometry.some(k=>k in value)&&!resourceWidgetPresentation({web_resource_widgets:{[id]:value}},[{id}])[id])throw Error('无效资源展示布局');
 }
 const previous=resourceWidgetPresentation(document,[{id}])[id];
 if(native!==undefined){if(!native||typeof native!=='object'||Array.isArray(native))throw Error('角色资料格式无效');const layout=native.quickbarLayout||={order:[],hidden:[]};layout.widgets||={};if(presentation===null)delete layout.widgets[id];else Object.defineProperty(layout.widgets,id,{value:{...(previous||{x:0,y:0,w:4,h:2,page:0}),...(presentation as any)},writable:true,enumerable:true,configurable:true});delete document.web_resource_widgets;}
 else {const widgets=document.web_resource_widgets||={};if(presentation===null)delete widgets[id];else Object.defineProperty(widgets,id,{value:{...(previous||{x:0,y:0,w:4,h:2,page:0}),...(presentation as any)},writable:true,enumerable:true,configurable:true});}
}
