import OBR from '@owlbear-rodeo/sdk';
import { DEFAULT_CONFIG, PRESETS, parseConfig, duration, entryTime, narrationTime, hasContent, type TextEffectConfig } from './model';
import { STYLE_PRESETS } from './catalog';
import { editorHTML, factor } from './editor-view';
import { REQUEST, STATUS, identifier } from './protocol';
import { renderEffect } from './renderer';
import './control.css';
const STORAGE='com.obr-suite/text-effects/editor/v1';
const root=document.getElementById('app')!;root.innerHTML=editorHTML();
const form=document.getElementById('settings') as HTMLFormElement,preview=document.getElementById('preview')!;
const status=document.getElementById('status')!,error=document.getElementById('error')!;
const button=(id:string)=>document.getElementById(id) as HTMLButtonElement;
const reduced=document.getElementById('reduced') as HTMLInputElement,presetName=document.getElementById('preset-name') as HTMLInputElement;
let config=structuredClone(DEFAULT_CONFIG),saved:{name:string;config:TextEffectConfig}[]=[];
let connected=false,sceneReady=false,role='',busy=false,connection='',selected='',phase='entry';
let deleted:{preset:{name:string;config:TextEffectConfig};index:number}|undefined;
let presentation:ReturnType<typeof renderEffect>|undefined,stopTarget:{id:string;preview:boolean;expiresAt:number}|undefined;
const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
function showError(message=''){error.textContent=message;error.hidden=!message;}
try{const stored=JSON.parse(localStorage.getItem(STORAGE)||'null');config=stored?.draft?.title==='战斗开始'&&stored?.draft?.subtitle==='命运已掷下骰子'&&stored?.draft?.decoration==='rays'?structuredClone(DEFAULT_CONFIG):parseConfig(stored?.draft)||config;if(Array.isArray(stored?.presets))for(const preset of stored.presets.slice(0,20)){const parsed=parseConfig(preset?.config);if(parsed&&typeof preset.name==='string'&&preset.name.trim()&&preset.name.length<=48)saved.push({name:preset.name,config:parsed});}}catch{showError('已保存的预设未能读取，本次配置仍可使用。');}
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify({draft:config,presets:saved}));return true;}catch{showError('浏览器未能保存配置；本次预览和播放仍可使用。');return false;}}
function listPresets(next=selected){
 selected=next;
 for(const[list,id,prefix]of[[PRESETS,'presets','builtin'],[saved,'saved-presets','saved']]as const){const container=document.getElementById(id)!;container.replaceChildren();for(const[i,preset]of list.entries()){const item=document.createElement('button');item.type='button';item.textContent=preset.name;item.dataset.preset=`${prefix}:${i}`;item.setAttribute('aria-pressed',String(item.dataset.preset===selected));container.append(item);}container.hidden=!list.length;}
 button('delete-preset').hidden=!selected.startsWith('saved:');button('undo-delete').hidden=!deleted;
}
const directions=(effect:string)=>effect==='shutter'||effect==='flip'?['horizontal','vertical']:effect==='wipe'?['left','right','up','down','center']:['left','right','up','down'];
function controls(skip?:Element){
 for(const input of form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[name]')){if(input===skip)continue;const key=input.name as keyof TextEffectConfig;if(input instanceof HTMLInputElement&&input.type==='checkbox')input.checked=Boolean(config[key]);else input.value=String(typeof config[key]==='number'?Number(config[key])/factor(key):config[key]);}
 for(const input of form.querySelectorAll<HTMLInputElement>('[data-slider]'))input.value=String(Number(config[input.dataset.slider as keyof TextEffectConfig])/factor(input.dataset.slider!));
 for(const item of form.querySelectorAll<HTMLButtonElement>('[data-key]')){const active=String(config[item.dataset.key as keyof TextEffectConfig])===item.dataset.option;item.setAttribute('aria-pressed',String(active));item.tabIndex=active?0:-1;}
 for(const item of root.querySelectorAll<HTMLButtonElement>('[data-palette]')){const p=STYLE_PRESETS[Number(item.dataset.palette)];item.setAttribute('aria-pressed',String(config.color===p.color&&config.color2===p.color2&&config.fill===p.fill));}
 const conditions:Record<string,boolean>={body:!!config.body,subtitle:!!config.subtitle,gradient:config.fill==='gradient',third:config.fill==='gradient'&&config.thirdColor,shadow:config.shadow,'char-solo':['char','solo'].includes(config.flow),char:config.flow==='char',solo:config.flow==='solo',spread:config.flow==='spread','line-sweep':['line','sweep'].includes(config.flow),sweep:config.flow==='sweep',scroll:config.flow==='scroll','entry-direction':['slide','wipe','shutter','flip'].includes(config.entry),'exit-direction':['slide','wipe','shutter'].includes(config.leave),idle:config.idle!=='none',leave:config.leave!=='none',glitch:[config.entry,config.leave,config.idle].includes('glitch'),decoration:config.decoration!=='none',structural:!['none','rays','mist','sparks','rings'].includes(config.decoration),tape:config.decoration==='tape','deco-fill':['band','box','frame'].includes(config.decoration),'deco-line':['box','frame','lines','underline','sides','bar','corners'].includes(config.decoration),'deco-line-color':['box','frame','lines','underline','sides','bar','corners','tape'].includes(config.decoration),ambient:['rays','mist','sparks','rings'].includes(config.decoration),extend:['frame','lines','underline','sides'].includes(config.decoration),box:config.decoration==='box',band:config.decoration==='band','entry-power':!['fade','typewriter','wipe'].includes(config.entry),'exit-power':!['none','fade','erase','wipe'].includes(config.leave),background:config.background!=='transparent'};
 for(const [key,effect]of [['entryDirection',config.entry],['exitDirection',config.leave]])for(const item of form.querySelectorAll<HTMLButtonElement>(`[data-key="${key}"]`))item.hidden=!directions(effect).includes(item.dataset.option!);
 for(const node of form.querySelectorAll<HTMLElement>('[data-condition]'))node.hidden=!conditions[node.dataset.condition!];
 for(const name of ['title','subtitle','body']as const)root.querySelector(`[data-count="${name}"]`)!.textContent=`${config[name].length} / ${name==='title'?160:name==='subtitle'?240:1800}`;
 document.getElementById('duration')!.textContent=`${(duration(config)/1000).toFixed(1)} 秒`;
}
function draw(playing=false,part?:string){
 presentation?.dispose();let offset=0;if(part==='leave')offset=duration(config)-config.exit-config.endDelay;else if(part==='idle')offset=config.startDelay+entryTime(config)+narrationTime(config);
 presentation=renderEffect(preview,config,{startsAt:playing?Date.now()-offset:undefined,reduced:reduced.checked,onComplete:()=>draw()});
 const pages=Number(preview.dataset.pages||1);document.getElementById('duration')!.textContent=`${(duration(config)/1000).toFixed(1)} 秒${pages>1?` · ${pages} 页`:''}`;button('preview-stop').disabled=!playing;
}
function availability(){button('owlbear-preview').disabled=busy||!connected||!sceneReady;button('room-play').disabled=busy||!connected||!sceneReady||role!=='GM';button('room-stop').disabled=busy||!connected||!sceneReady||!stopTarget||stopTarget.expiresAt<=Date.now()||!stopTarget.preview&&role!=='GM';}
function update(key:string,value:unknown,skip?:Element){const next={...config,[key]:value};if(key==='entry'||key==='leave'){const directionKey=key==='entry'?'entryDirection':'exitDirection',allowed=directions(String(value));if(!allowed.includes(next[directionKey]))next[directionKey]=allowed[0];}const parsed=parseConfig(next);if(!parsed||!form.checkValidity()){showError('请检查输入的数值和文字长度。');return;}config=parsed;showError();selected='';listPresets();controls(skip);persist();draw(['entry','leave','idle'].includes(key),key);}
form.addEventListener('submit',event=>event.preventDefault());
form.addEventListener('input',event=>{const input=event.target as HTMLInputElement,key=input.name||input.dataset.slider;if(!key)return;const value=input.type==='checkbox'?input.checked:typeof DEFAULT_CONFIG[key as keyof TextEffectConfig]==='number'?Number(input.value)*factor(key):input.value;update(key,value,input);});
root.addEventListener('click',event=>{
 const item=(event.target as Element).closest<HTMLButtonElement>('button');if(!item)return;
 if(item.dataset.key){const key=item.dataset.key,value=typeof DEFAULT_CONFIG[key as keyof TextEffectConfig]==='number'?Number(item.dataset.option):item.dataset.option;update(key,value);}
 if(item.dataset.preset){const[kind,index]=item.dataset.preset.split(':'),preset=(kind==='saved'?saved:PRESETS)[Number(index)];if(!preset)return;config=structuredClone(preset.config);presetName.value=kind==='saved'?preset.name:'';listPresets(item.dataset.preset);controls();draw();persist();showError();status.textContent=`已应用“${preset.name}”。`;}
 if(item.dataset.palette){const p=STYLE_PRESETS[Number(item.dataset.palette)];config=parseConfig({...config,...p,glowColor:p.accent,subtitleColor:p.accent,decorationLineColor:p.accent})!;selected='';listPresets();controls();draw();persist();}
 if(item.dataset.tab){for(const tab of root.querySelectorAll<HTMLButtonElement>('[data-tab]')){const active=tab===item;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}for(const panel of form.querySelectorAll<HTMLElement>('[role=tabpanel]'))panel.hidden=panel.id!==`pane-${item.dataset.tab}`;form.scrollTop=0;}
 if(item.dataset.phase){phase=item.dataset.phase;for(const tab of root.querySelectorAll<HTMLButtonElement>('[data-phase]')){const active=tab===item;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}for(const panel of root.querySelectorAll<HTMLElement>('[data-phase-panel]'))panel.hidden=panel.dataset.phasePanel!==phase;}
 if(item.dataset.backdrop){preview.dataset.backdrop=item.dataset.backdrop;for(const choice of root.querySelectorAll('[data-backdrop]'))choice.setAttribute('aria-pressed',String(choice===item));}
});
root.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;const target=(event.target as Element).closest<HTMLButtonElement>('button');if(!target||!target.matches('[data-key],[data-tab],[data-phase]'))return;const group=target.parentElement!,items=Array.from(group.querySelectorAll<HTMLButtonElement>(':scope > button')).filter(item=>!item.hidden);let i=items.indexOf(target);i=event.key==='Home'?0:event.key==='End'?items.length-1:(i+(['ArrowRight','ArrowDown'].includes(event.key)?1:items.length-1))%items.length;event.preventDefault();items[i].focus();items[i].click();});
button('preview-play').onclick=()=>{if(!form.checkValidity()||!hasContent(config)){showError('请检查配置，并填写文字或选择视觉效果。');return;}showError();draw(true);};button('preview-stop').onclick=()=>draw();reduced.onchange=()=>draw();
button('save-preset').onclick=()=>{document.getElementById('preset-entry')!.hidden=false;presetName.focus();};button('cancel-save').onclick=()=>{document.getElementById('preset-entry')!.hidden=true;};
button('confirm-save').onclick=()=>{if(!form.checkValidity())return;const name=presetName.value.trim();if(!name){showError('请填写预设名称。');presetName.focus();return;}const index=saved.findIndex(p=>p.name===name);if(index<0&&saved.length>=20){showError('最多保存 20 个预设，请先删除一个。');return;}const next={name,config:structuredClone(config)};if(index>=0)saved[index]=next;else saved.push(next);showError();if(persist())status.textContent=`已保存“${name}”。`;listPresets(`saved:${index>=0?index:saved.length-1}`);document.getElementById('preset-entry')!.hidden=true;};
presetName.onkeydown=event=>{if(event.key==='Enter')button('confirm-save').click();if(event.key==='Escape')button('cancel-save').click();};
button('delete-preset').onclick=()=>{if(!selected.startsWith('saved:'))return;const index=Number(selected.split(':')[1]);if(!saved[index])return;deleted={preset:saved[index],index};saved.splice(index,1);listPresets('');persist();status.textContent='预设已删除，可以撤销。';};button('undo-delete').onclick=()=>{if(!deleted)return;if(saved.length>=20){showError('预设已满，无法撤销删除。');return;}saved.splice(deleted.index,0,deleted.preset);const index=deleted.index;deleted=undefined;listPresets(`saved:${index}`);persist();status.textContent='预设已恢复。';};
function receive(value: any) {
  const waiting = pending.get(value?.requestId); if (!waiting) return;
  clearTimeout(waiting.timer); pending.delete(value.requestId);
  value.ok === true && identifier(value.id) ? waiting.resolve(value) : waiting.reject(Error(typeof value.message === 'string' ? value.message : '文字演出未能播放'));
}
async function submit(action: 'play' | 'stop', previewOnly: boolean) {
  if (busy || !connected || !sceneReady || !previewOnly && role !== 'GM') return;
  if (action === 'play' && (!form.checkValidity() || !hasContent(config))) { showError('请检查配置，并填写文字或选择视觉效果。'); return; }
  if (action === 'stop' && !stopTarget) return;
  busy = true; availability(); showError();
  const requestId = crypto.randomUUID(), data = { requestId, action, preview: previewOnly, ...(action === 'play' ? { config: structuredClone(config) } : { id: stopTarget!.id }) };
  try {
    const result = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error('播放结果尚未确认，请检查枭熊画面。')); }, 12000);
      pending.set(requestId, { resolve, reject, timer });
      void OBR.broadcast.sendMessage(REQUEST, data, { destination: 'LOCAL' }).then(reply => { const answer = reply as unknown; if (answer) receive(answer); }).catch(reject);
    });
    if (action === 'play') { stopTarget = { id: result.id, preview: result.preview, expiresAt: result.expiresAt }; status.textContent = previewOnly ? '正在自己的枭熊画面中预览。' : '已向当前房间播放文字演出。'; }
    else { stopTarget = undefined; status.textContent = '已停止本次演出。'; }
  } catch (e) { const waiting = pending.get(requestId); if (waiting) { clearTimeout(waiting.timer); pending.delete(requestId); } showError(e instanceof Error ? e.message : '文字演出未能播放'); }
  finally { busy = false; availability(); }
}
button('owlbear-preview').onclick = () => void submit('play', true);
button('room-play').onclick = () => void submit('play', false);
button('room-stop').onclick = () => void submit('stop', stopTarget?.preview ?? true);
button('close').onclick = () => { void OBR.popover.close('com.obr-suite/text-effects/control').catch(() => {}); };
listPresets(); controls(); draw();
OBR.onReady(async () => {
  try {
    [connection, role, sceneReady] = await Promise.all([OBR.player.getConnectionId(), OBR.player.getRole(), OBR.scene.isReady()]);
    connected = true;
    OBR.broadcast.onMessage(STATUS, event => { if (event.connectionId === connection) receive(event.data); });
    OBR.player.onChange(player => { role = player.role; availability(); });
    OBR.scene.onReadyChange(next => { sceneReady = next; stopTarget = undefined; availability(); status.textContent = next ? role === 'GM' ? '已连接枭熊，可以预览或向房间播放。' : '已连接枭熊，可以在自己的画面中预览。' : '场景已关闭，配置和本地预览仍可使用。'; });
    status.textContent = sceneReady ? role === 'GM' ? '已连接枭熊，可以预览或向房间播放。' : '已连接枭熊，可以在自己的画面中预览。' : '请打开枭熊场景；配置和本地预览仍可使用。';
    availability();
  } catch { showError('枭熊连接未能建立，配置和本地预览仍可使用。'); }
});
const expiryTimer = setInterval(availability, 1000);
window.addEventListener('pagehide', () => { clearInterval(expiryTimer); presentation?.dispose(); for (const value of pending.values()) { clearTimeout(value.timer); value.reject(Error('配置面板已关闭')); } pending.clear(); }, { once: true });
