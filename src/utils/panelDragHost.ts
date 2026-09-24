import OBR from '@owlbear-rodeo/sdk';
import {assetUrl} from '../asset-base';
import {BC_PANEL_DRAG_START,BC_PANEL_DRAG_END,BC_PANEL_DRAG_CANCEL,BC_PANEL_DRAG_INPUT,BC_PANEL_DRAG_READY,computePanelBbox} from './panelLayout';

/** Shared by the actual room shell and browser regression harness. */
export function setupPanelDragHost(modalId:string){
 let open=false,generation=0,timer:ReturnType<typeof setTimeout>|undefined;
 let active:{panelId?:string;gestureId?:string}|undefined,lastInput:any;
 const close=async()=>{generation++;clearTimeout(timer);if(!open)return;open=false;await OBR.modal.close(modalId).catch(()=>{});};
 const subscriptions=[OBR.broadcast.onMessage(BC_PANEL_DRAG_START,async event=>{
  const data=event.data as {panelId?:string;gestureId?:string;startScreenX?:number;startScreenY?:number};
  if(typeof data?.panelId!=='string'||!Number.isFinite(data.startScreenX)||!Number.isFinite(data.startScreenY))return;
  const own=++generation;
  active=data;lastInput=undefined;
  try{
   const bbox=await computePanelBbox(data.panelId);if(own!==generation||!bbox)return;
   if(open){open=false;await OBR.modal.close(modalId);}if(own!==generation)return;
   await OBR.modal.open({id:modalId,url:`${assetUrl('drag-preview.html')}#${encodeURIComponent(JSON.stringify({...data,bbox}))}`,fullScreen:true,hidePaper:true});
   if(own!==generation){await OBR.modal.close(modalId);return;}
   open=true;clearTimeout(timer);timer=setTimeout(()=>{void close();},35000);
  }catch(error){console.warn('[obr-suite/drag-preview] open failed',error);}
 }),OBR.broadcast.onMessage(BC_PANEL_DRAG_INPUT,event=>{const data=event.data as any;if(data?.gestureId===active?.gestureId&&data?.panelId===active?.panelId)lastInput=data;}),
 OBR.broadcast.onMessage(BC_PANEL_DRAG_READY,event=>{const data=event.data as any;if(lastInput&&data?.gestureId===active?.gestureId&&data?.panelId===active?.panelId)void OBR.broadcast.sendMessage(BC_PANEL_DRAG_INPUT,lastInput,{destination:'LOCAL'});}),
 OBR.broadcast.onMessage(BC_PANEL_DRAG_END,event=>{const data=event.data as any;if(!data?.gestureId||data.gestureId===active?.gestureId)void close();}),OBR.broadcast.onMessage(BC_PANEL_DRAG_CANCEL,event=>{const data=event.data as any;if(!data?.gestureId||data.gestureId===active?.gestureId)void close();})];
 return()=>{subscriptions.forEach(stop=>stop());void close();};
}
