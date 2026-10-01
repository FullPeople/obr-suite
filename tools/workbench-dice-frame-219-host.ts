import {setupDice3d,resultListeners} from '../src/workbench/dice3d';
import {CHANNEL} from '../extensions/workbench-dice3d/src/types';
import './workbench-dice-frame-219-sdk';
const id=new URLSearchParams(location.search).get('client')||'A',events:any[]=[],results:any[]=[];
const bus=new BroadcastChannel(`${CHANNEL}:local:${id}`);bus.onmessage=e=>{if(['state','log'].includes(e.data.type))events.push(e.data);};
resultListeners.add((result,revealed)=>results.push({result,revealed}));(window as any).probe={events,results};
const child=document.createElement('iframe');child.id='initiative';child.src=`/suite-dev/dice3d/frame219-child.html?client=${id}`;child.style.cssText='height:90px;width:100%;border:0';document.body.append(child);
await setupDice3d();
