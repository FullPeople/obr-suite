import type OBR from '@owlbear-rodeo/sdk';
/** Local viewport only. Recheck the scene and readable binding after all awaits. */
export async function locateSceneItem(api:typeof OBR,itemId:string,assertReadable:()=>Promise<void>){
 await assertReadable();
 const [bounds,width,height,scale]=await Promise.all([api.scene.items.getItemBounds([itemId]),api.viewport.getWidth(),api.viewport.getHeight(),api.viewport.getScale()]);
 await assertReadable();
 if(!bounds||![bounds.min.x,bounds.min.y,bounds.max.x,bounds.max.y,width,height,scale].every(Number.isFinite)||scale<=0)throw Error('角色位置暂时不可用');
 const x=(bounds.min.x+bounds.max.x)/2,y=(bounds.min.y+bounds.max.y)/2;
 await api.viewport.animateTo({position:{x:-x*scale+width/2,y:-y*scale+height/2},scale});
}
