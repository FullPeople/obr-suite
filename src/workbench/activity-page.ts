import OBR from '@owlbear-rodeo/sdk';
import {sfxResourceToast,subscribeToSfx} from '../modules/dice/sfx-broadcast';
import {OPEN_WIKI_CHANNEL,noticeEntry,sharedEntry,type SharedEntry} from './shared-entry';
import type {WorkbenchNotice} from './notices';

const PREFIX='com.obr-suite/resources/toast-';
type Active={data:WorkbenchNotice;expires:number};
function plain(text:string):string{
 for(let i=0;i<8&&text.includes('{@');i++)text=text.replace(/\{@(\w+) ([^{}]*)\}/g,(_,tag:string,body:string)=>{const parts=body.split('|');return ['b','i','bold','italic','dice','damage','scaledice','scaledamage','dc','hit','h','recharge'].includes(tag)?parts[0]:parts[2]||parts[0];});
 return text;
}
/** Render upstream rule nodes with textContent; shared entries cannot inject markup. */
export function entryText(value:unknown,depth=0):string{
 if(depth>18||value==null)return '';
 if(typeof value==='string')return plain(value);
 if(typeof value==='number')return String(value);
 if(Array.isArray(value))return value.map(v=>entryText(v,depth+1)).filter(Boolean).join('\n');
 if(typeof value!=='object')return '';
 const node=value as Record<string,unknown>;
 return [typeof node.name==='string'?plain(node.name):'',entryText(node.entry,depth+1),entryText(node.entries,depth+1),entryText(node.items,depth+1),entryText(node.colLabels,depth+1),entryText(node.rows,depth+1)].filter(Boolean).join('\n');
}
export function setupActivityPage(){
 const rows=document.querySelector<HTMLElement>('#rows');if(!rows)return;
 const flow=document.createElement('div');flow.className='activity-flow';rows.before(flow);
 const notices=document.createElement('div');notices.id='activity-notices';flow.append(rows,notices);
 document.documentElement.classList.add('unified-activity');
 const style=document.createElement('style');style.textContent=`
 .unified-activity{--bg-card:rgba(53,55,63,.96);--border:#737580;--fg:#f5f5f6}
 .activity-flow{flex:1;min-height:0;overflow:auto;scrollbar-width:none;display:flex;flex-direction:column;padding:6px;gap:4px}
 .activity-flow>#rows{flex:0 0 auto;overflow:visible;padding:0;margin-top:auto}
 #activity-notices{display:flex;flex-direction:column;gap:4px;flex-shrink:0}
 .activity-notice{position:relative;flex-shrink:0;padding:7px 9px 9px;background:var(--bg-card);color:var(--fg);border:1px solid var(--border);border-radius:7px;cursor:pointer;overflow:hidden;outline-offset:-2px}
 .activity-notice:hover,.activity-notice:focus-visible{border-color:#d8c68e;background:#50525b}
 .activity-line{display:flex;align-items:baseline;gap:5px;line-height:1.35;flex-wrap:wrap}
 .activity-line strong{font-size:12.5px}.activity-who{font-size:11px;color:#d0d0d4}
 .activity-value{margin-left:auto;font-variant-numeric:tabular-nums;white-space:nowrap}.activity-delta{font-weight:700;color:#e6c995}
 .activity-entry{margin:4px 0 0;white-space:pre-wrap;font-size:12px;line-height:1.4;max-height:min(45vh,320px);overflow:auto;scrollbar-width:thin}
 .activity-facts{display:block;margin-top:3px;font-size:11px;line-height:1.4;color:#c9cbd2;overflow-wrap:anywhere}
 .unified-activity .dismiss-btn{background:#50525b;border-color:#97999f;color:#fff}
 .activity-countdown{position:absolute;bottom:0;left:0;height:2px;width:100%;background:#e0cd90;transform-origin:left;pointer-events:none}
 `;document.head.append(style);
 let connection='',instance='',role='PLAYER',player='',identityChanged=false,timer:ReturnType<typeof setTimeout>|undefined;
 const seenKey=PREFIX+'seen:'+OBR.room.id,activeKey=PREFIX+'active:'+OBR.room.id;
 const active=new Map<string,Active>(),seen=new Map<string,number>();
 try{for(const [id,at] of JSON.parse(sessionStorage.getItem(seenKey)||'[]'))if(typeof id==='string'&&Date.now()-at<120000)seen.set(id,at);
 for(const row of JSON.parse(sessionStorage.getItem(activeKey)||'[]'))if(row?.expires>Date.now()&&row.data?.noticeId&&row.data?.resource){active.set(row.data.noticeId,row);seen.set(row.data.noticeId,Date.now());}}catch{}
 const persist=()=>{try{sessionStorage.setItem(seenKey,JSON.stringify([...seen]));sessionStorage.setItem(activeKey,JSON.stringify([...active.values()]));}catch{}};
 function allowed(data:WorkbenchNotice){return !data.privateFor||role==='GM'||data.privateFor.includes(player);}
 function display(data:WorkbenchNotice):WorkbenchNotice{
  return allowed(data)?data:{noticeId:data.noticeId,tokenId:'',summary:data.privateSummary||'有人调整了资源',resource:{id:'private',name:data.privateSummary||'有人调整了资源',current:0,max:0,type:'number',icon:'gem'},delta:0,prevValue:0};
 }
 const newest=()=>{flow.scrollTop=flow.scrollHeight;requestAnimationFrame(()=>{flow.scrollTop=flow.scrollHeight;});};
 document.addEventListener('suite-dice-content',newest);
 function render(followNew=false){
  const atBottom=flow.scrollHeight-flow.clientHeight-flow.scrollTop<12;
  clearTimeout(timer);const now=Date.now();for(const [id,row] of active)if(row.expires<=now)active.delete(id);
  notices.replaceChildren();
  for(const [id,row] of active){
   const data=display(row.data),r=data.resource,el=document.createElement('article');el.className='activity-notice';el.dataset.noticeId=id;el.tabIndex=0;el.setAttribute('role','button');
   const line=document.createElement('div');line.className='activity-line';el.append(line);
   const title=document.createElement('strong');title.textContent=data.summary||r.name;line.append(title);
   if(!data.summary){const who=document.createElement('span');who.className='activity-who';who.textContent=data.tokenName||'';line.append(who);const value=document.createElement('span');value.className='activity-value';value.textContent=`${data.prevValue} → ${r.current}${r.max>0?` / ${r.max}`:''} `;const delta=document.createElement('span');delta.className='activity-delta';delta.textContent=`${data.delta>0?'+':''}${data.delta}`;value.append(delta);line.append(value);}
   if(data.shared&&data.entry){
    const facts=document.createElement('small');facts.className='activity-facts';facts.textContent=[data.entry.source,typeof data.entry.raw.level==='number'?`${data.entry.raw.level}环`:'',typeof data.entry.raw.value==='number'?`${data.entry.raw.value/100} GP`:'',typeof data.entry.raw.weight==='number'?`${data.entry.raw.weight} 磅`:''].filter(Boolean).join(' · ');el.append(facts);
    const body=document.createElement('div');body.className='activity-entry';body.textContent=entryText(data.entry.entries);el.append(body);
   }
   const open=()=>{let entry:SharedEntry;try{entry=noticeEntry(data);}catch{return;}void OBR.broadcast.sendMessage(OPEN_WIKI_CHANNEL,{entry},{destination:'LOCAL'}).catch(()=>{});};
   el.addEventListener('click',()=>{if(!getSelection()?.toString())open();});el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
   const bar=document.createElement('span');bar.className='activity-countdown';bar.setAttribute('aria-hidden','true');el.append(bar);notices.append(el);
   const total=data.shared?20000:8000;bar.animate([{transform:`scaleX(${Math.min(1,(row.expires-now)/total)})`},{transform:'scaleX(0)'}],{duration:row.expires-now,fill:'forwards'});
  }
  if(followNew||atBottom)newest();
  persist();if(active.size)timer=setTimeout(()=>render(),Math.max(1,Math.min(...[...active.values()].map(v=>v.expires))-Date.now()));
 }
 const announce=()=>{if(instance)void OBR.broadcast.sendMessage(PREFIX+'ready',{instance},{destination:'LOCAL'}).catch(()=>{});};
 // Subscribe before SDK identity reads: fast repeated edits must not wait for audio or paint.
 OBR.broadcast.onMessage(PREFIX+'probe',event=>{if(event.connectionId!==connection)return;const value=(event.data as any)?.instance;if(typeof value!=='string'||value.length>100)return;instance=value;announce();});
 OBR.broadcast.onMessage(PREFIX+'deliver',event=>{
  const {id,instance:own,data}=(event.data as any)||{};
  if(event.connectionId!==connection||!instance||own!==instance||typeof id!=='string'||!data?.resource||!Number.isFinite(data.delta))return;
  if(!seen.has(id)){
   if(data.entry)try{data.entry=sharedEntry(data.entry);}catch{delete data.entry;}
   seen.set(id,Date.now());if(seen.size>256)seen.delete(seen.keys().next().value!);
   active.set(id,{data:{...data,noticeId:id},expires:Date.now()+(data.shared?20000:8000)});while(active.size>50)active.delete(active.keys().next().value!);render(true);
   setTimeout(()=>{try{sfxResourceToast();}catch{}},0);
  }
  void OBR.broadcast.sendMessage(PREFIX+'ack',{id,instance},{destination:'LOCAL'}).catch(()=>{});
 });
 OBR.scene.onReadyChange(value=>{if(!value){active.clear();render();}});
 OBR.player.onChange(value=>{identityChanged=true;role=value.role;player=value.id;render();});
 void Promise.all([OBR.player.getConnectionId(),OBR.player.getRole(),OBR.player.getId()]).then(([id,r,p])=>{connection=id;if(!identityChanged){role=r;player=p;}render();void OBR.broadcast.sendMessage(PREFIX+'mounted',{}, {destination:'LOCAL'}).catch(()=>{});announce();}).catch(()=>{});
 subscribeToSfx();render(true);
}
