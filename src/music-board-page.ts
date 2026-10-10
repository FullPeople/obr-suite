import {sendMusicMessage,onMusicMessage} from './modules/musicBoard/transport';
// Audio and durable room writes stay in the background when this view closes.
import OBR from "@owlbear-rodeo/sdk";
import { bindPanelDrag } from "./utils/panelDrag";
import { getLocalLang, onLangChange } from "./state";
import { MUSIC_ACK, MUSIC_COMMAND, MUSIC_LOCAL, MUSIC_READY, MUSIC_VIEW, MUSIC_BACKUP, MAX_TRACKS, MAX_QUEUE, decodeTracks, encodeLibrary, trackFrom, type MusicSession, type MusicOp, type Track } from "./modules/musicBoard/model";
import type { LocalVolume, SoundStatus } from "./modules/musicBoard/audio";
import { mt, musicError, type MusicTextKey } from "./modules/musicBoard/text";
import "./modules/musicBoard/style.css";

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
interface View { state: MusicSession; canControl: boolean; gm: boolean; writer: string; sound: SoundStatus; roomId: string;
  localVolume: LocalVolume; progress: {position:number; duration:number}; backup?: {available:boolean; count:number; at:number; failed:boolean} }
interface Pending { timer:ReturnType<typeof setTimeout>; resolve:(value:boolean)=>void }
let current: View | null = null, connectionId = "", alive = true, librarySignature = "", queueSignature = "";
let catalog: Track[] = [], catalogLoading = false, editing: Track | null = null, editingRevision = 0, formBus:"bgm"|"sfx" = "bgm", formLoop = true, formColor = "#50525b";
let importTracks: Track[] | null = null, importBus:"bgm"|"sfx" = "bgm", importMode:"merge"|"replace" = "merge", importRevision = 0, backupRequest = "";
let backupTimer:ReturnType<typeof setTimeout> | undefined;
const filters = {bus:"all" as "all"|"bgm"|"sfx", favorite:false, group:"", tag:""};
const pending = new Map<string,Pending>(), unsubs:Array<()=>void> = [];
const palette: Array<[string,MusicTextKey]> = [["#50525b","gray"],["#58796a","green"],["#627caa","blue"],["#8b709e","purple"],["#ae8550","amber"],["#ac687c","rose"]];
const mini = new URLSearchParams(location.search).get("mini") === "1";
document.body.classList.toggle("mini", mini);
try { document.documentElement.dataset.suiteNight = localStorage.getItem("full-suite/ui-night") === "1" ? "true" : "false"; const tone = localStorage.getItem("full-suite/ui-tone"); if (tone && /^#[0-9a-f]{6}$/i.test(tone)) document.documentElement.style.setProperty("--suite-tone",tone); } catch {}

function feedback(value:string):void { el("feedback").textContent = value; }
function local(type:string, extra:object = {}):void { void OBR.broadcast.sendMessage(MUSIC_LOCAL,{type,...extra},{destination:"LOCAL"}).catch(error=>feedback(musicError(error))); }
function command(op:MusicOp):Promise<boolean> {
  if (!current?.canControl || pending.size >= (op.type === "sfx" ? 4 : 1)) return Promise.resolve(false);
  if (["pause","resume","seek","loop","stop"].includes(op.type)) op = {...op, expectedPlaybackId:current.state.bgm?.playbackId || ""};
  const requestId = crypto.randomUUID();
  return new Promise(resolve=>{
    const timer = setTimeout(()=>finish(false,mt("noWriter")),7500);
    const finish = (ok:boolean,message:string) => { const entry=pending.get(requestId); if (!entry) return; clearTimeout(entry.timer); pending.delete(requestId); feedback(message); render(); entry.resolve(ok); };
    pending.set(requestId,{timer,resolve}); feedback(mt("saving")); render();
    void sendMusicMessage(MUSIC_COMMAND,{requestId,op},{destination:"ALL"}).catch(error=>finish(false,musicError(error)));
  });
}
function fmt(seconds:number):string { return !Number.isFinite(seconds)||seconds<0 ? "--:--" : Math.floor(seconds/60)+":"+String(Math.floor(seconds%60)).padStart(2,"0"); }
function label(track:Track):string { return track.name || new URL(track.url).pathname.split("/").pop() || new URL(track.url).hostname; }
function button(text:string, action:()=>void, shared=true):HTMLButtonElement { const node=document.createElement("button"); node.type="button"; node.textContent=text; node.addEventListener("click",action); if (shared) node.dataset.shared=""; return node; }
function choose(id:string, key:string, value:string):void { for(const node of el(id).querySelectorAll<HTMLElement>("button")) if(node.dataset[key]!==undefined) node.setAttribute("aria-pressed",String(node.dataset[key]===value)); }
function visibleTracks():Track[] { const query=el<HTMLInputElement>("search").value.trim().toLocaleLowerCase(); return (current?.state.tracks || []).filter(track=>(filters.bus==="all"||track.bus===filters.bus)&&(!filters.favorite||track.favorite)&&(!filters.group||track.group===filters.group)&&(!filters.tag||track.tags?.includes(filters.tag))&&(!query||[label(track),track.group,...track.tags||[]].some(value=>value?.toLocaleLowerCase().includes(query)))); }
function filterChips(id:string, values:string[], key:"group"|"tag"):void {
  const container=el(id); container.replaceChildren();
  for(const value of values) { const chip=button(value,()=>{filters[key]=filters[key]===value?"":value; librarySignature=""; render();},false); chip.setAttribute("aria-pressed",String(filters[key]===value)); container.append(chip); }
}
function renderLibrary():void {
  if (!current) return;
  const state=current.state, signature=JSON.stringify([state.tracks,state.bgm?.track.id,state.sfx.map(sound=>sound.track.id),filters,el<HTMLInputElement>("search").value,getLocalLang()]);
  if(signature===librarySignature) return; librarySignature=signature;
  const focus=(document.activeElement as HTMLElement)?.dataset.focus, container=el("library"); container.replaceChildren();
  const tracks=visibleTracks(); el("libraryCount").textContent=`${tracks.length} / ${state.tracks.length}`;
  filterChips("groupFilter",[...new Set(state.tracks.map(track=>track.group).filter((group):group is string=>!!group))],"group");
  filterChips("tagFilter",[...new Set(state.tracks.flatMap(track=>track.tags||[]))],"tag");
  for(const track of tracks) {
    const active=track.bus==="bgm"?state.bgm?.track.id===track.id:state.sfx.some(sound=>sound.track.id===track.id);
    const card=document.createElement("article"); card.className="track-card"+(active?" is-playing":""); card.dataset.track=track.id; card.style.setProperty("--track-color",track.color||"#50525b");
    const play=button("",()=>{
      const sound=track.loop&&track.bus==="sfx"?current?.state.sfx.find(sound=>sound.track.id===track.id):null;
      void command(sound?{type:"sfx-stop",id:sound.id}:{type:track.bus==="sfx"?"sfx":"play",id:track.id});
    }); play.className="track-main"; play.setAttribute("aria-label",`${active&&track.loop&&track.bus==="sfx"?mt("stop"):mt("play")} ${label(track)}`); play.dataset.focus="play:"+track.id;
    if(track.bus==="sfx"&&!track.loop) play.dataset.retrigger="true";
    const title=document.createElement("strong"), meta=document.createElement("small"); title.textContent=label(track); meta.textContent=[mt(track.bus==="sfx"?"busSfx":"busBgm"),mt(track.loop?"loop":"once"),track.duration?fmt(track.duration):"",active?mt("playing"):""].filter(Boolean).join(" · "); play.append(title,meta); card.append(play);
    const tags=document.createElement("div"); tags.className="track-tags"; for(const tag of [track.group,...track.tags||[]].filter(Boolean)) { const chip=document.createElement("span"); chip.textContent=tag!; tags.append(chip); } card.append(tags);
    const actions=document.createElement("div"); actions.className="track-actions";
    if(track.bus==="bgm") { const queue=button(mt("enqueue"),()=>void command({type:"queue",id:track.id})); queue.dataset.focus="queue:"+track.id; actions.append(queue); }
    const edit=button(mt("edit"),()=>openTrack(track)); edit.dataset.focus="edit:"+track.id; actions.append(edit);
    const favorite=button(track.favorite?"★":"☆",()=>void command({type:"update",id:track.id,track:{...track,favorite:!track.favorite},expectedLibraryRevision:current!.state.libraryRevision})); favorite.className="favorite-button"; favorite.dataset.focus="favorite:"+track.id; favorite.setAttribute("aria-label",`${mt(track.favorite?"unfavorite":"favorite")} ${label(track)}`); favorite.setAttribute("aria-pressed",String(!!track.favorite)); actions.append(favorite); card.append(actions); container.append(card);
  }
  if(!tracks.length) { const empty=document.createElement("div"); empty.className="empty"; empty.textContent=mt(state.tracks.length?"noMatches":"noTracks"); container.append(empty); }
  if(focus) for(const node of container.querySelectorAll<HTMLElement>("[data-focus]")) if(node.dataset.focus===focus) node.focus({preventScroll:true});
}
function renderQueue():void {
  if(!current) return; const state=current.state, signature=JSON.stringify([state.queue,state.tracks,state.sfx,getLocalLang()]); if(signature===queueSignature) return; queueSignature=signature;
  el("queueCount").textContent=`${state.queue.length} / ${MAX_QUEUE}`; el("queue").replaceChildren();
  state.queue.forEach((id,index)=>{
    const track=state.tracks.find(track=>track.id===id); if(!track) return;
    const row=document.createElement("div"); row.className="queue-row"; const number=document.createElement("span"), name=document.createElement("span"); number.className="queue-number"; number.textContent=String(index+1); name.className="queue-name"; name.textContent=label(track); row.append(number,name);
    const actions=document.createElement("div"); actions.className="queue-actions";
    for(const [text,target] of [[mt("moveUp"),index-1],[mt("moveDown"),index+1]] as const) { const move=button(text,()=>void command({type:"queue-move",position:index,target,expectedQueue:current!.state.queue})); move.dataset.unavailable=String(target<0||target>=state.queue.length); actions.append(move); }
    actions.append(button(mt("remove"),()=>void command({type:"queue-remove",position:index,expectedQueue:current!.state.queue}))); row.append(actions); el("queue").append(row);
  });
  if(!state.queue.length) { const hint=document.createElement("p"); hint.className="hint"; hint.textContent=mt("noQueue"); el("queue").append(hint); }
  el("sfxSection").hidden=!state.sfx.length; el("sfxCount").textContent=`${state.sfx.length} / 4`; el("sfx").replaceChildren();
  for(const sound of state.sfx) { const row=document.createElement("div"); row.className="sfx-row"; const name=document.createElement("span"); name.textContent=label(sound.track); row.append(name,button(mt("stop"),()=>void command({type:"sfx-stop",id:sound.id}))); el("sfx").append(row); }
}
function render():void {
  const state=current?.state,bgm=state?.bgm;
  el("name").textContent=bgm?label(bgm.track):mt("noTrack"); el("status").textContent=!current?mt("loading"):bgm?mt(bgm.paused?"paused":"playing"):mt("title");
  el("time").textContent=current&&bgm?`${fmt(current.progress.position)} / ${fmt(current.progress.duration)}`:"";
  el("play").textContent=mt(bgm&&!bgm.paused?"pause":"play"); el("loop").setAttribute("aria-pressed",String(bgm?.track.loop||false));
  el("soundNotice").hidden=current?.sound==="ready"; el("soundMessage").textContent=current?.sound==="blocked"?mt("blocked"):current?.sound==="error"?mt("audioError"):"";
  el("readOnly").hidden=!current||current.canControl; el("permission").hidden=!current?.gm; el<HTMLInputElement>("allowPlayers").checked=state?.allowPlayers!==false;
  el("saved").textContent=!current?mt("loading"):pending.size?mt("saving"):current.backup?.failed?mt("backupFailed"):mt("saved");
  if(current) {
    for(const [id,value] of [["bgmVolume",current.localVolume.bgm],["sfxVolume",current.localVolume.sfx],["roomBgmVolume",state!.bus.bgm],["roomSfxVolume",state!.bus.sfx]] as const) { const input=el<HTMLInputElement>(id); if(document.activeElement!==input) input.value=String(Math.round(value*100)); el(id+"Value").textContent=input.value; }
    el("mute").setAttribute("aria-pressed",String(current.localVolume.mute));
    const seek=el<HTMLInputElement>("seek"); if(document.activeElement!==seek) { seek.max=String(current.progress.duration||100); seek.value=String(current.progress.position||0); }
    renderLibrary(); renderQueue();
  }
  for(const input of document.querySelectorAll<HTMLInputElement|HTMLButtonElement>("[data-shared]")) input.disabled=!current?.canControl||pending.size>=(input.dataset.retrigger?4:1)||input.dataset.unavailable==="true";
  el<HTMLButtonElement>("previous").disabled ||= !state?.history?.length;
  el<HTMLButtonElement>("play").disabled ||= !bgm&&!state?.queue.length;
  el<HTMLButtonElement>("next").disabled ||= !state?.queue.length;
  el<HTMLButtonElement>("stop").disabled ||= !bgm;
  el<HTMLButtonElement>("loop").disabled ||= !bgm;
  el<HTMLInputElement>("seek").disabled ||= !bgm||!current?.progress.duration;
  el<HTMLInputElement>("allowPlayers").disabled=!current?.gm||pending.size>0;
  el<HTMLButtonElement>("clearQueue").disabled ||= !state?.queue.length;
  el<HTMLButtonElement>("enqueueVisible").disabled ||= !visibleTracks().some(track=>track.bus==="bgm");
  el<HTMLButtonElement>("applyImport").disabled ||= !importTracks || (importMode==="merge"&&!importTracks.length);
}
function translate():void {
  document.documentElement.lang=getLocalLang()==="en"?"en":"zh-CN"; document.title=mt("title");
  for(const node of document.querySelectorAll<HTMLElement>("[data-mt]")) {node.textContent=mt(node.dataset.mt as MusicTextKey);if(node.tagName==="BUTTON")node.title=node.textContent;}
  for(const node of document.querySelectorAll<HTMLInputElement>("[data-mt-placeholder]")) node.placeholder=mt(node.dataset.mtPlaceholder as MusicTextKey);
  for(const [id,key] of [["close","close"],["mini",mini?"expand":"minimize"],["drag","drag"]] as const) { el(id).title=mt(key); el(id).setAttribute("aria-label",mt(key)); }
  librarySignature=queueSignature=""; render(); renderCatalog();
}
function showDialog(id:string):void { const dialog=el<HTMLDialogElement>(id); if(!dialog.open) dialog.showModal(); }
function renderFormChoices():void { choose("trackBus","bus",formBus); choose("trackLoop","loop",String(formLoop)); choose("trackColor","color",formColor); }
function draftKey():string { return `obr-music-board:draft:${current?.roomId||"local"}`; }
function formTrack():Track|null { return trackFrom({...editing, id:editing?.id, name:el<HTMLInputElement>("trackName").value, url:el<HTMLInputElement>("trackUrl").value, bus:formBus, loop:formLoop, group:el<HTMLInputElement>("trackGroup").value, tags:el<HTMLInputElement>("trackTags").value.split(/[,，、\n]/), color:formColor, volume:Number(el<HTMLInputElement>("trackVolume").value)/100}); }
function saveDraft():void { if(editing) return; try { localStorage.setItem(draftKey(),JSON.stringify({name:el<HTMLInputElement>("trackName").value,url:el<HTMLInputElement>("trackUrl").value,group:el<HTMLInputElement>("trackGroup").value,tags:el<HTMLInputElement>("trackTags").value,bus:formBus,loop:formLoop,color:formColor,volume:el<HTMLInputElement>("trackVolume").value})); } catch { el("trackError").textContent=mt("draftFailed"); } }
function openTrack(track:Track|null=null):void {
  if(!current?.canControl) return; editing=track?structuredClone(track):null; editingRevision=current.state.libraryRevision??current.state.revision;
  let draft:Record<string,unknown>={}; if(!track) try { const saved=JSON.parse(localStorage.getItem(draftKey())||"{}"); if(saved&&typeof saved==="object"&&!Array.isArray(saved))draft=saved; } catch {}
  const value=track||draft; el("trackDialogTitle").textContent=mt(track?"edit":"addTrack");
  for(const [id,key] of [["trackName","name"],["trackUrl","url"],["trackGroup","group"]] as const) el<HTMLInputElement>(id).value=typeof value[key]==="string"?String(value[key]):"";
  el<HTMLInputElement>("trackTags").value=Array.isArray(value.tags)?value.tags.join(", "):typeof value.tags==="string"?value.tags:"";
  formBus=value.bus==="sfx"?"sfx":value.bus==="bgm"?"bgm":filters.bus==="sfx"?"sfx":"bgm"; formLoop=typeof value.loop==="boolean"?value.loop:formBus==="bgm";
  formColor=typeof value.color==="string"&&/^#[0-9a-f]{6}$/i.test(value.color)?value.color:"#50525b";
  const volume=track?Math.round((track.volume??1)*100):Number(value.volume??100); el<HTMLInputElement>("trackVolume").value=String(Number.isFinite(volume)?Math.max(0,Math.min(100,volume)):100); el("trackVolumeValue").textContent=el<HTMLInputElement>("trackVolume").value;
  el("deleteTrack").hidden=!track; el("trackError").textContent=""; renderFormChoices(); render(); showDialog("trackDialog");
}
function previewTracks(tracks:Track[]):void {
  const unique=new Map(tracks.map(track=>[track.url,track])); importTracks=[...unique.values()]; importRevision=current?.state.libraryRevision??current?.state.revision??0;
  const existing=new Set(current?.state.tracks.map(track=>track.url)||[]), duplicates=tracks.length-importTracks.length+importTracks.filter(track=>existing.has(track.url)).length;
  el("importSummary").textContent=mt("importCount").replace("{count}",String(tracks.length)).replace("{new}",String(importTracks.filter(track=>!existing.has(track.url)).length)).replace("{duplicate}",String(duplicates));
  el("importList").replaceChildren(); for(const track of importTracks) { const item=document.createElement("li"); item.textContent=`${label(track)} · ${mt(track.bus==="sfx"?"busSfx":"busBgm")}`; el("importList").append(item); }
  el("importPreview").hidden=false; el("importError").textContent=""; render();
}
function openImport():void { importTracks=null; importMode="merge"; choose("importMode","mode",importMode); el("replaceHint").hidden=true; el("importPreview").hidden=true; el("importError").textContent=""; render(); showDialog("importDialog"); }
function previewImport():void { try { previewTracks(decodeTracks(el<HTMLTextAreaElement>("importText").value,importBus)); } catch(error) { importTracks=null; el("importPreview").hidden=true; el("importError").textContent=error instanceof Error&&error.message==="invalidTrack"?musicError(error):mt("invalidImport"); render(); } }
function renderCatalog():void {
  el("catalogTracks").replaceChildren(); const search=el<HTMLInputElement>("catalogSearch").value.trim().toLocaleLowerCase();
  for(const track of catalog.filter(track=>!search||label(track).toLocaleLowerCase().includes(search)).slice(0,100)) { const row=document.createElement("div"); row.className="catalog-row"; const name=document.createElement("span"); name.textContent=label(track); const add=button(mt("add"),()=>void command({type:"add",tracks:[track]})); if(current?.state.tracks.some(item=>item.url===track.url)) add.dataset.unavailable="true"; row.append(name,add); el("catalogTracks").append(row); } render();
}

for(const [color,key] of palette) { const swatch=button("",()=>{formColor=color;renderFormChoices();saveDraft();},false); swatch.dataset.color=color; swatch.style.setProperty("--swatch",color); swatch.setAttribute("aria-label",mt(key)); el("trackColor").append(swatch); }
el("mini").textContent=mini?"↗":"−";
el("enable").addEventListener("click",()=>local("enable")); el("close").addEventListener("click",()=>local("close"));
el("mini").addEventListener("click",()=>void OBR.broadcast.sendMessage("com.obr-suite/music-board:resize",{mini:!mini},{destination:"LOCAL"}));
el("play").addEventListener("click",()=>void command({type:!current?.state.bgm?"next":current.state.bgm.paused?"resume":"pause"}));
for(const type of ["previous","next","stop"] as const) el(type).addEventListener("click",()=>void command({type}));
el("loop").addEventListener("click",()=>void command({type:"loop",value:!current?.state.bgm?.track.loop}));
el<HTMLInputElement>("seek").addEventListener("change",()=>void command({type:"seek",position:Number(el<HTMLInputElement>("seek").value)}));
el("mute").addEventListener("click",()=>local("volume",{value:{mute:!current?.localVolume.mute}}));
for(const [id,bus,shared] of [["bgmVolume","bgm",false],["sfxVolume","sfx",false],["roomBgmVolume","bgm",true],["roomSfxVolume","sfx",true]] as const) {
  el(id).addEventListener("input",()=>{el(id+"Value").textContent=el<HTMLInputElement>(id).value;if(!shared)local("volume",{value:{[bus]:Number(el<HTMLInputElement>(id).value)/100}});});
  if(shared) el(id).addEventListener("change",()=>void command({type:"volume",bus,volume:Number(el<HTMLInputElement>(id).value)/100}));
}
el<HTMLInputElement>("allowPlayers").addEventListener("change",()=>void command({type:"allowPlayers",value:el<HTMLInputElement>("allowPlayers").checked}));
el("clearSfx").addEventListener("click",()=>void command({type:"sfx-clear"})); el("clearQueue").addEventListener("click",()=>void command({type:"queue-clear",expectedQueue:current!.state.queue}));
el("enqueueVisible").addEventListener("click",()=>void command({type:"queue-many",ids:visibleTracks().filter(track=>track.bus==="bgm").map(track=>track.id)}));
el("search").addEventListener("input",render);
for(const node of el("busFilter").querySelectorAll<HTMLElement>("[data-bus]")) node.addEventListener("click",()=>{filters.bus=node.dataset.bus as typeof filters.bus;choose("busFilter","bus",filters.bus);render();});
el("favorites").addEventListener("click",()=>{filters.favorite=!filters.favorite;el("favorites").setAttribute("aria-pressed",String(filters.favorite));render();});
for(const node of document.querySelectorAll<HTMLElement>(".workspace-switch [data-view]")) node.addEventListener("click",()=>{el("library").closest<HTMLElement>(".music-workspace")!.dataset.view=node.dataset.view;for(const item of document.querySelectorAll<HTMLElement>(".workspace-switch [data-view]"))item.setAttribute("aria-pressed",String(item===node));});
for(const node of document.querySelectorAll<HTMLElement>("[data-close]")) node.addEventListener("click",()=>el<HTMLDialogElement>(node.dataset.close!).close());
el("addTrack").addEventListener("click",()=>openTrack());
el("trackForm").addEventListener("input",saveDraft);
el("trackVolume").addEventListener("input",()=>el("trackVolumeValue").textContent=el<HTMLInputElement>("trackVolume").value);
for(const node of el("trackBus").querySelectorAll<HTMLElement>("[data-bus]")) node.addEventListener("click",()=>{formBus=node.dataset.bus as typeof formBus;formLoop=formBus==="bgm";renderFormChoices();saveDraft();});
for(const node of el("trackLoop").querySelectorAll<HTMLElement>("[data-loop]")) node.addEventListener("click",()=>{formLoop=node.dataset.loop==="true";renderFormChoices();saveDraft();});
el<HTMLFormElement>("trackForm").addEventListener("submit",async event=>{
  event.preventDefault(); const track=formTrack(); if(!track) { el("trackError").textContent=mt("invalidTrack"); return; }
  if(!track.name) track.name=label(track);
  const ok=await command(editing?{type:"update",id:editing.id,track,expectedLibraryRevision:editingRevision}:{type:"add",tracks:[track]});
  if(!alive)return; if(ok) { if(!editing) try{localStorage.removeItem(draftKey());}catch{} el<HTMLDialogElement>("trackDialog").close(); } else el("trackError").textContent=el("feedback").textContent;
});
el("deleteTrack").addEventListener("click",async()=>{if(!editing)return;const ok=await command({type:"remove",id:editing.id,expectedLibraryRevision:editingRevision});if(alive&&ok)el<HTMLDialogElement>("trackDialog").close();else if(alive)el("trackError").textContent=el("feedback").textContent;});
el("openImport").addEventListener("click",openImport); el("previewImport").addEventListener("click",previewImport);
el("importText").addEventListener("input",()=>{importTracks=null;el("importPreview").hidden=true;render();});
for(const node of el("importBus").querySelectorAll<HTMLElement>("[data-bus]"))node.addEventListener("click",()=>{importBus=node.dataset.bus as typeof importBus;choose("importBus","bus",importBus);importTracks=null;el("importPreview").hidden=true;render();});
for(const node of el("importMode").querySelectorAll<HTMLElement>("[data-mode]"))node.addEventListener("click",()=>{importMode=node.dataset.mode as typeof importMode;choose("importMode","mode",importMode);el("replaceHint").hidden=importMode!=="replace";render();});
el("readFile").addEventListener("click",()=>el<HTMLInputElement>("importFile").click());
el<HTMLInputElement>("importFile").addEventListener("change",async()=>{const input=el<HTMLInputElement>("importFile"),file=input.files?.[0];input.value="";if(!file)return;if(file.size>262144){el("importError").textContent=mt("fileTooLarge");return;}try{const text=await file.text();if(!alive)return;el<HTMLTextAreaElement>("importText").value=text;previewImport();}catch{el("importError").textContent=mt("invalidImport");}});
el("applyImport").addEventListener("click",async()=>{if(!importTracks)return;const ok=await command({type:importMode==="replace"?"replace":"add",tracks:importTracks,...(importMode==="replace"?{expectedLibraryRevision:importRevision}:{})});if(alive&&ok)el<HTMLDialogElement>("importDialog").close();else if(alive)el("importError").textContent=el("feedback").textContent;});
el("export").addEventListener("click",()=>{if(!current)return;const url=URL.createObjectURL(new Blob([encodeLibrary(current.state.tracks)],{type:"application/json;charset=utf-8"})),link=document.createElement("a");link.href=url;link.download="枭熊音乐板-"+new Date().toISOString().slice(0,10)+".json";link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);});
el("backup").addEventListener("click",()=>{if(!current?.backup?.available){feedback(mt("backupUnavailable"));return;}clearTimeout(backupTimer);backupRequest=crypto.randomUUID();backupTimer=setTimeout(()=>{backupRequest="";feedback(mt("backupUnavailable"));},7500);local("backup-read",{requestId:backupRequest});});
el("catalogSearch").addEventListener("input",renderCatalog);
el("defaults").addEventListener("click",()=>{
  showDialog("catalogDialog"); if(catalog.length){renderCatalog();return;}if(catalogLoading)return;catalogLoading=true;el("catalogError").textContent=mt("loading");
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);unsubs.push(()=>abort.abort());
  void fetch("https://obr.dnd.center/music/manifest.json",{signal:abort.signal}).then(response=>{if(!response.ok)throw Error("failed");return response.json();}).then(value=>{if(!alive)return;catalog=(Array.isArray(value.tracks)?value.tracks:[]).map(trackFrom).filter((track:Track|null):track is Track=>!!track);el("catalogError").textContent="";renderCatalog();}).catch(()=>{if(alive)el("catalogError").textContent=mt("failed");}).finally(()=>{clearTimeout(timer);catalogLoading=false;});
});
unsubs.push(onLangChange(translate)); translate(); bindPanelDrag(el("drag"),"music-board");
window.addEventListener("pagehide",()=>{alive=false;clearTimeout(backupTimer);for(const off of unsubs)off();for(const entry of pending.values()){clearTimeout(entry.timer);entry.resolve(false);}pending.clear();});
OBR.onReady(async()=>{
  try {
    connectionId=await OBR.player.getConnectionId();if(!alive)return;
    unsubs.push(onMusicMessage(MUSIC_VIEW,event=>{if(event.connectionId!==connectionId||!alive)return;const update=event.data as View;if(!update.state&&!current)return;current={...update,state:update.state||current!.state};render();}),
      OBR.broadcast.onMessage(MUSIC_ACK,event=>{const result=event.data as {requestId:string;receiver:string;ok:boolean;error?:string};if(!current||event.connectionId!==current.writer||result.receiver!==connectionId)return;const entry=pending.get(result.requestId);if(!entry)return;clearTimeout(entry.timer);pending.delete(result.requestId);feedback(result.ok?mt("completed"):musicError(result.error));render();entry.resolve(result.ok);}),
      onMusicMessage(MUSIC_BACKUP,event=>{const result=event.data as {requestId:string;backup?:{tracks:unknown[]}};if(event.connectionId!==connectionId||result.requestId!==backupRequest||!alive)return;clearTimeout(backupTimer);backupRequest="";if(!result.backup){feedback(mt("backupUnavailable"));return;}openImport();el<HTMLTextAreaElement>("importText").value=JSON.stringify({format:"obr-music-library",version:1,tracks:result.backup.tracks});previewImport();}));
    await OBR.broadcast.sendMessage(MUSIC_READY,{workbench:true},{destination:"LOCAL"});
  } catch(error) { feedback(musicError(error)); }
});
