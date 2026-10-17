import type {DiceRollPayload} from '../modules/dice';
const channel='workbench-dice-2d/v1',client=new URLSearchParams(location.search).get('client');
if(!client)throw Error('缺少投骰客户端身份');
const bus=new BroadcastChannel(`com.obr-suite/workbench-dice3d.v1:local:${client}`);
const active=new Map<string,HTMLIFrameElement>(),seen=new Set<string>();
let anchors:Record<string,{x:number;y:number}>={},scale=1;
const sendAnchor=(frame:HTMLIFrameElement,p:DiceRollPayload)=>frame.contentWindow?.postMessage({channel,type:'anchor',data:{...(anchors[p.itemId||'']||{x:innerWidth/2,y:innerHeight/2}),scale:anchors[p.itemId||'']?scale:1}},location.origin);
const records=new Map<string,DiceRollPayload>();
let labelsTimer:ReturnType<typeof setTimeout>|undefined;
function pruneLabels(){clearTimeout(labelsTimer);let next=Infinity;for(const el of document.querySelectorAll<HTMLElement>('.dice-light-label')){const at=Number(el.dataset.expiresAt);if(!at)continue;if(at<=Date.now())el.remove();else next=Math.min(next,at);}if(Number.isFinite(next))labelsTimer=setTimeout(pruneLabels,Math.max(0,next-Date.now()));}
bus.onmessage=event=>{
 const m=event.data;
 if(m.type==='roll'){
  const p=m.payload as DiceRollPayload;if(!p||typeof p.rollId!=='string'||seen.has(p.rollId)||!Array.isArray(p.dice))return;
  seen.add(p.rollId);records.set(p.rollId,p);if(seen.size>1000){const oldest=seen.values().next().value!;seen.delete(oldest);records.delete(oldest);}
  const q=new URLSearchParams({dtypes:p.dice.map(d=>d.type).join(','),dvalues:p.dice.map(d=>d.value).join(','),dlosers:p.dice.map(d=>d.loser?'1':'0').join(','),doriginals:p.dice.map(d=>d.originalValue??'').join(','),dparents:p.dice.map(d=>d.burstParent??'').join(','),dsubtract:p.dice.map(d=>d.subtract?'1':'0').join(','),winner:String(p.winnerIdx),total:String(p.total),modifier:String(p.modifier),label:p.label,rollId:p.rollId,rollerId:p.rollerId,color:p.rollerColor,hidden:p.hidden?'1':'0',autoDismiss:p.autoDismiss?'1':'0',rowStarts:p.rowStarts?.join(',')||'',same:p.sameHighlight?'1':'0',itemId:p.itemId||'',wx:String(innerWidth/2),wy:String(innerHeight/2)});
  const frame=document.createElement('iframe');frame.title='2D 骰子动画';frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none';frame.src='./effect2d.html#'+q;active.set(p.rollId,frame);document.body.append(frame);
  bus.postMessage({type:'track-tokens',ids:[...active.keys()].map(id=>records.get(id)?.itemId).filter(Boolean)});
 }else if(m.type==='clear'){for(const frame of active.values())frame.contentWindow?.postMessage({channel,type:'clear'},location.origin);}
 else if(m.type==='token-results-remove'){for(const el of document.querySelectorAll<HTMLElement>('.dice-light-label'))if(m.ids?.includes(el.dataset.resultGroup))el.remove();pruneLabels();}
 else if(m.type==='token-results'){anchors=m.anchors||{};scale=m.scale||1;for(const [id,frame]of active)sendAnchor(frame,records.get(id)!);document.querySelectorAll('.dice-light-label').forEach(n=>n.remove());for(const group of m.groups||[])if(group.visible&&(!group.expiresAt||group.expiresAt>Date.now()))for(const row of group.rows){const a=anchors[row.itemId];if(!a)continue;const el=document.createElement('div');el.className='dice-light-label';el.dataset.resultGroup=group.id;el.dataset.expiresAt=String(group.expiresAt||'');el.style.cssText=`position:fixed;left:${a.x}px;top:${a.y}px;color:${row.color};font:bold 18px sans-serif;text-shadow:0 1px 3px #000;transform:translate(-50%,-100%)`;el.textContent=row.total+' · '+row.text;document.body.append(el);}pruneLabels();}
};
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.data?.channel!==channel)return;
 const found=[...active].find(([,frame])=>frame.contentWindow===event.source);if(!found)return;const [id,frame]=found,m=event.data;
 if(m.type==='ready')sendAnchor(frame,records.get(id)!);
 else if(m.type==='started')bus.postMessage({type:'started',rollId:id});
 else if(m.type==='result')bus.postMessage({type:'result',rollId:id});
 else if(m.type==='complete'){frame.remove();active.delete(id);bus.postMessage({type:'complete',rollId:id});bus.postMessage({type:'track-tokens',ids:[...active.keys()].map(key=>records.get(key)?.itemId).filter(Boolean)});}
 else if(m.type==='sfx')bus.postMessage({type:'sfx',data:m.data});
});
bus.postMessage({type:'overlay-ready'});
window.addEventListener('pagehide',()=>{clearTimeout(labelsTimer);bus.close();},{once:true});
