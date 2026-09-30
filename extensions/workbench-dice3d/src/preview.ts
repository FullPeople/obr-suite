import {Controller} from './controller';
import {mountPanel} from './panel';
import {mountOverlay} from './overlay';
import {CHANNEL} from './types';
import {normalizePlayerColor} from './player-color.mjs';
const query=new URLSearchParams(location.search),id=crypto.randomUUID(),name=query.get('name')||'预览玩家';
const channel=new BroadcastChannel(`${CHANNEL}:preview:${query.get('group')||'default'}`);
const color=query.has('color')?normalizePlayerColor(query.get('color')):undefined;
const role=query.get('role')==='GM'?'GM':'PLAYER'; // Preview fixture only; real OBR uses its SDK roster.
const controller=new Controller({id,name,color,role,mode:'预览 / 标签页测试',send:async data=>channel.postMessage(data),listen:fn=>{channel.onmessage=e=>fn(e.data,e.data.from);return()=>channel.close()}});
mountPanel(document.getElementById('panel')!,id,true);
(window as any).__diceLab={controller,id};
try{await controller.init();(window as any).__diceLab.renderer=await mountOverlay(document.getElementById('stage')!,id)}catch(error){controller.fail('startup',error)}
