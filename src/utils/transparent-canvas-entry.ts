import OBR from '@owlbear-rodeo/sdk';
import {bindTransparentCanvas} from './transparent-canvas';
// Boss configuration is an opaque form; only the map overlays use this canvas contract.
if(document.documentElement.dataset.suiteCanvas==='transparent'&&new URLSearchParams(location.search).get('mode')!=='config'&&OBR.isAvailable){
 OBR.onReady(()=>{
  const stop=bindTransparentCanvas(OBR.theme);
  window.addEventListener('pagehide',stop,{once:true});
 });
}
