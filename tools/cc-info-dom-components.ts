const w=window as unknown as Record<string,any>,m=w.ccMock;
export const getLocalLang=()=>m.lang;
export const onLangChange=(fn:any)=>{m.languageCallbacks.add(fn);return ()=>m.languageCallbacks.delete(fn);};
export const setLanguage=(value:string)=>{m.lang=value;for(const fn of m.languageCallbacks)fn(value);};
w.ccLang=setLanguage;
export const installDebugOverlay=()=>{};
export const ICONS={swords:"⚔"};
export const resolveClickRollTarget=async()=>null;
export const bindRollableContextMenu=()=>{};
export const bindRollableClickPopup=(_root:any,target:any)=>{m.rollTarget=target;};
export const subscribeToSfx=()=>{};
export const bindPanelDrag=()=>()=>{m.dragUnbind++;};
export const PANEL_IDS={ccInfo:"cc-info"};
export const installPanelZoom=()=>()=>{m.zoomUnbind++;};
export const BUBBLES_META_KEY="com.obr-suite/bubbles/data",EXTERNAL_BUBBLES_META_KEY="com.owlbear-rodeo-bubbles-extension/metadata";
export function mountStatBanner(options:any){m.statMounts++;const id=options.getItemId();options.container.innerHTML=`<input class="stat-input" data-field="health" value="${options.initialLive.health??0}">${options.isGM?'<button class="stat-lock">lock</button>':""}`;m.statOptions=options;m.statBound=id;return {refresh:async()=>{},unmount:()=>{m.statUnmounts++;options.container.replaceChildren();}};}
export function mountResourcePanel(options:any){m.resourceMounts++;options.container.innerHTML='<input class="resource-draft" value="4">';m.resourceOptions=options;return {refresh:async()=>{},unmount:()=>{m.resourceUnmounts++;options.container.replaceChildren();}};}
