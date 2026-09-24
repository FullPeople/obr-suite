import type {Item} from '@owlbear-rodeo/sdk';

/** A live reference to the bound token image; never copy image bytes into a card. */
export function tokenPortrait(item:Item|undefined){
 if(item?.type!=='IMAGE')return undefined;
 const image=(item as Item & {image?:{url?:string;width?:number;height?:number}}).image;
 if(!image?.url)return undefined;
 try{if(!['https:','http:'].includes(new URL(image.url).protocol))return undefined;}catch{return undefined;}
 return {url:image.url,width:image.width,height:image.height};
}
