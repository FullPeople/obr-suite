import AssetsApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/AssetsApi";
import { ImageBuilder } from "../../node_modules/@owlbear-rodeo/sdk/lib/builders/ImageBuilder";
import { LineBuilder } from "../../node_modules/@owlbear-rodeo/sdk/lib/builders/LineBuilder";
import { EffectBuilder } from "../../node_modules/@owlbear-rodeo/sdk/lib/builders/EffectBuilder";
const handlers=new Map<string,Set<(v:any)=>void>>();
const listen=(key:string,fn:(v:any)=>void)=>{if(!handlers.has(key))handlers.set(key,new Set());handlers.get(key)!.add(fn);return()=>{handlers.get(key)?.delete(fn);};};
const seed=(globalThis as any).portalDefaultSeed??{};
export const m={
  role:seed.role??"GM",id:"gm",ready:true,roomId:"room",roomMeta:seed.roomMeta??{},item:seed.item,holdRoom:seed.holdRoom??false,
  roomReads:[] as Array<(value:any)=>void>,roomWrites:[] as any[],itemWrites:[] as any[],adds:[] as any[],popovers:[] as any[],
  picker:[] as Array<(value:any)=>void>,native:[] as any[], failWrite:false, holdAdd:false, pendingAdds:[] as Array<()=>void>,
  roomReadCount:0,holdRole:false,roles:[] as Array<(value:any)=>void>,
  holdViewport:false,viewports:[] as Array<()=>void>,holdOpen:false,pendingOpens:[] as Array<()=>void>,holdClose:false,pendingCloses:[] as Array<()=>void>,closed:[] as string[],popoverRequests:[] as any[],
  notices:[] as any[],failClose:false,
  async emit(key:string,data:any){for(const fn of handlers.get(key)??[])fn(data);for(let n=0;n<60;n++)await Promise.resolve();},
  async player(role:string,id=this.id){this.role=role;this.id=id;await this.emit("player",{role,id});},
  async scene(ready:boolean){this.ready=ready;await this.emit("scene",ready);},
  count(){return [...handlers.values()].reduce((n,s)=>n+s.size,0);},
};
const player={id:"gm",color:"#fff"};
export const buildImage=(image:any,grid:any)=>new ImageBuilder(player as any,image,grid);
export const buildLine=()=>new LineBuilder(player as any);
export const buildEffect=()=>new EffectBuilder(player as any);
export const getLocalLang=()=>"en";
export const assetUrl=(path:string)=>location.origin+"/suite/"+path;
export const PANEL_IDS={portalEdit:"portal-edit"};
export const getPanelOffset=()=>({dx:0,dy:0});export const getPanelSize=()=>undefined;
export const registerPanelBbox=()=>{};export const BC_PANEL_DRAG_END="drag",BC_PANEL_RESET="reset";
export const onLangChange=()=>()=>{};
const sdk={
  room:{get id(){return m.roomId;},getMetadata:async()=>{m.roomReadCount++;return m.holdRoom?new Promise(resolve=>m.roomReads.push(resolve)):structuredClone(m.roomMeta);},setMetadata:async(patch:any)=>{if(m.failWrite)throw Error("room write failed");m.roomWrites.push(patch);Object.assign(m.roomMeta,structuredClone(patch));}},
  player:{getRole:async()=>m.holdRole?new Promise(resolve=>m.roles.push(resolve)):m.role,getConnectionId:async()=>"gm-connection",onChange:(fn:any)=>listen("player",fn)},
  notification:{show:async(...args:any[])=>{m.notices.push(args);return "notice";}},
  assets:new AssetsApi({async sendAsync(channel:string,data:any,timeout:any){m.native.push({channel,data,timeout});return new Promise(resolve=>m.picker.push(resolve));}} as any),
  viewport:{getWidth:async()=>{if(m.holdViewport)await new Promise<void>(resolve=>m.viewports.push(resolve));return 1280;}},
  scene:{isReady:async()=>m.ready,onReadyChange:(fn:any)=>listen("scene",fn),grid:{getDpi:async()=>150},
    local:{deleteItems:async()=>{}},items:{
      getItems:async(filter:any)=>m.item&&(!filter||typeof filter==="function"?filter?.(m.item)??true:filter.includes(m.item.id))?[structuredClone(m.item)]:[],
      onChange:(fn:any)=>listen("items",fn),
      updateItems:async(_ids:string[],fn:any)=>{const value=m.item?[structuredClone(m.item)]:[];fn(value);if(value[0]){m.item=value[0];m.itemWrites.push(structuredClone(value[0]));await m.emit("items",value);}},
      addItems:async(items:any[])=>{if(m.holdAdd)await new Promise<void>(resolve=>m.pendingAdds.push(resolve));m.adds.push(structuredClone(items));},
    }},
  popover:{open:async(options:any)=>{m.popoverRequests.push({kind:"open",options});if(m.holdOpen)await new Promise<void>(resolve=>m.pendingOpens.push(resolve));m.popovers.push(options);},close:async(id:string)=>{m.popoverRequests.push({kind:"close",id});if(m.holdClose)await new Promise<void>(resolve=>m.pendingCloses.push(resolve));if(m.failClose)throw Error("close refused");m.closed.push(id);}},modal:{close:async()=>{}},
};
(globalThis as any).portalDefaultMock=m;
export default sdk;
