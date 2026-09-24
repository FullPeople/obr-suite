import {WORKBENCH_DEV} from './workbench/channel';
import './workbench/tone';
// Resource toast — bottom-center fullscreen overlay that pops a
// card every time someone in the room changes a resource value.
//
// Hosted in a fullScreen + disablePointerEvents OBR.modal opened by
// the workbench background (prewarmed for the active scene). Stable builds
// listen for `BC_RESOURCE_CHANGED`; dev uses a READY/ACK delivery lane.
// Renders ONE toast per change. Multiple concurrent
// toasts arrange horizontally at the bottom-center.
//
// 2026-05-12 — toast now renders the SAME WIDGET as the panel row
// (count pills / draggable bar / number bar) instead of just a
// number summary. User explicitly asked for "完全照搬" parity.
// Hold time also bumped 2.5s → 5s and the bottom offset 24 → 96 px
// (raised) so OBR's native bottom toolbar isn't covered.

import OBR from "@owlbear-rodeo/sdk";
import { ICON_LIBRARY } from "./modules/resourceTracker/icons";
import type { Resource, IconId } from "./modules/resourceTracker/types";
import { sfxResourceToast, subscribeToSfx } from "./modules/dice/sfx-broadcast";

const BC_RESOURCE_CHANGED = "com.obr-suite/resources/changed";
const TOAST_HOLD_MS = 5000;     // 2.5 → 5 s per user spec
const TOAST_FADE_MS = 280;
const MAX_VISIBLE = 6;

interface ResourceToastPayload {
  privateFor?:string[];privateSummary?:string;redacted?:boolean;summary?:string;
  tokenId: string;
  tokenName?: string;
  resource: Resource;
  delta: number;
  prevValue: number;
}

const stackEl = document.getElementById("stack") as HTMLDivElement;
if(WORKBENCH_DEV){const style=document.createElement('style');style.textContent='.toast{background:color-mix(in srgb,var(--suite-tone,#50525B) 94%,transparent);border-color:#ffffff50;color:#fff}.toast .head,.toast .name,.toast .who{color:#fff}.toast .rt-num-widget{background:#ffffff12}';document.head.append(style);}


function escapeHtml(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}

function classifyDelta(delta: number): "delta-up" | "delta-down" | "delta-zero" {
  if (delta > 0) return "delta-up";
  if (delta < 0) return "delta-down";
  return "delta-zero";
}

function deltaText(delta: number): string {
  if (delta === 0) return "";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

// === Widget renderers — visual parity with panel.ts ====================
//
// These produce read-only HTML that mirrors what the user just clicked
// in the resource panel. The toast doesn't bind any event listeners;
// CSS `pointer-events:none` on `.widget` neutralises hover effects so
// the cards read as static notifications.

function renderCountWidget(r: Resource): string {
  const max = Math.min(40, Math.max(0, Math.floor(r.max)));
  const cur = Math.max(0, Math.min(max, Math.floor(r.current)));
  const cells: string[] = [];
  for (let i = 1; i <= max; i++) {
    const filled = i <= cur;
    cells.push(`
      <span class="rt-pill-icon ${filled ? "full" : "spent"}">
        ${ICON_LIBRARY[r.icon as IconId] ?? ICON_LIBRARY.gem}
      </span>
    `);
  }
  return `<div class="rt-pills">${cells.join("")}</div>`;
}

function renderBarWidget(r: Resource): string {
  const max = Math.max(1, r.max);
  const cur = Math.max(0, Math.min(max, r.current));
  const ratio = (cur / max) * 100;
  return `
    <div class="rt-bar-row">
      <div class="rt-bar-num">${cur} / ${max}</div>
      <div class="rt-bar">
        <div class="rt-bar-fill" style="width:${ratio.toFixed(1)}%"></div>
        <span class="rt-bar-thumb" style="left:${ratio.toFixed(2)}%">
          ${ICON_LIBRARY[r.icon as IconId] ?? ICON_LIBRARY.gem}
        </span>
      </div>
    </div>
  `;
}

function renderNumberWidget(r: Resource): string {
  const min = 0;
  const max = Math.max(0, r.max);
  const cur = r.current;
  return `
    <div class="rt-num-bar">
      <span class="rt-num-end">${min}</span>
      <span class="rt-num-step">−</span>
      <span class="rt-num-orb">
        <span class="rt-num-orb-icon">${ICON_LIBRARY[r.icon as IconId] ?? ICON_LIBRARY.gem}</span>
        <span class="rt-num-orb-val">${cur}</span>
      </span>
      <span class="rt-num-step">+</span>
      <span class="rt-num-end">${max}</span>
    </div>
  `;
}

function renderWidget(r: Resource): string {
  if (r.type === "count")  return renderCountWidget(r);
  if (r.type === "bar")    return renderBarWidget(r);
  if (r.type === "number") return renderNumberWidget(r);
  return "";
}

function showToast(p: ResourceToastPayload): void {
  const cls = classifyDelta(p.delta);
  const r = p.resource;
  const el = document.createElement("div");
  el.className = `toast ${cls}`;
  if(p.summary){
    el.innerHTML=`<div class="head"><span class="name">${escapeHtml(p.summary)}</span></div>`;
  }else{
  el.innerHTML = `
    <div class="head">
      <span class="name">${escapeHtml(r.name || "(未命名)")}</span>
      ${p.tokenName ? `<span class="who">· ${escapeHtml(p.tokenName)}</span>` : ""}
      <span class="delta">${escapeHtml(deltaText(p.delta))}</span>
    </div>
    ${p.redacted?'':`<div class="widget">${renderWidget(r)}</div>`}
  `;
  }

  // Cap the on-screen count.
  while (stackEl.children.length >= MAX_VISIBLE) {
    const oldest = stackEl.firstElementChild;
    if (!oldest) break;
    oldest.remove();
  }
  stackEl.appendChild(el);
  // Force a reflow so the .is-in transition runs.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  el.offsetWidth;
  el.classList.add("is-in");

  setTimeout(() => {
    el.classList.remove("is-in");
    el.classList.add("is-out");
    setTimeout(() => { try { el.remove(); } catch {} }, TOAST_FADE_MS);
  }, TOAST_HOLD_MS);
}

OBR.onReady(async () => {
  let role='PLAYER',roleObserved=false;
  OBR.player.onChange(player=>{roleObserved=true;role=player.role;});
  const [playerId,initialRole]=await Promise.all([OBR.player.getId().catch(()=>OBR.player.id),OBR.player.getRole().catch(()=>'PLAYER')]);
  if(!roleObserved)role=initialRole;
  // 2026-05-15 — also subscribe to BC_SFX so the toast iframe's own
  // audio context (if it ever wakes up) can play sounds. The toast
  // iframe runs with disablePointerEvents:true, so its AudioContext
  // is usually suspended — the actual playback happens in any
  // user-gestured iframe (cluster, cc-info, dice-panel, etc.) which
  // also subscribes to BC_SFX and receives the LOCAL broadcast.
  subscribeToSfx();

  const seenKey=`com.obr-suite/resources/toast-seen:${OBR.room.id}`;
  // A replaced iframe must not replay already displayed notices when its last
  // acknowledgement was lost. Store identities only, never private contents.
  const seen=new Map<string,number>();
  if(WORKBENCH_DEV)try{for(const [id,at] of JSON.parse(sessionStorage.getItem(seenKey)||'[]'))if(typeof id==='string'&&typeof at==='number'&&Date.now()-at<120000)seen.set(id,at);}catch{}
  const receive=(data:ResourceToastPayload|undefined)=>{
    if (!data || !data.resource || !Number.isFinite(data.delta)) return false;
    if(data.privateFor&&role!=='GM'&&!data.privateFor.includes(playerId))showToast({...data,summary:undefined,redacted:true,tokenName:'',delta:0,resource:{...data.resource,name:data.privateSummary||'有人调整了资源'}});else showToast(data);
    // 2026-05-15 — quick chime for all participants. BC_RESOURCE_CHANGED
    // arrives on LOCAL+REMOTE, so this fires once per client. Inside,
    // sfxResourceToast() broadcasts BC_SFX LOCAL — any user-gestured
    // iframe on the same client (typically the cluster) plays the
    // synth chime. Net effect: one soft "blip" per resource change,
    // heard by everyone in the room.
    const sound=()=>{try{sfxResourceToast();}catch{}};
    // Creating the first AudioContext can occupy the main thread for hundreds
    // of milliseconds. Paint and acknowledge the notification before that
    // optional work; background tabs still dispatch sound without waiting rAF.
    if(WORKBENCH_DEV){
      if(document.visibilityState==='visible')requestAnimationFrame(()=>setTimeout(sound,0));
      else setTimeout(sound,0);
    }else sound();
    return true;
  };
  if(WORKBENCH_DEV){
    const instance=new URLSearchParams(location.search).get('noticeInstance')||'';
    const announceReady=()=>OBR.broadcast.sendMessage('com.obr-suite/resources/toast-ready',{instance}, {destination:'LOCAL'}).catch(()=>{});
    OBR.broadcast.onMessage('com.obr-suite/resources/toast-deliver',event=>{
      const {id,data,instance:deliveryInstance}=(event.data as any)||{};
      if(typeof id!=='string'||instance&&deliveryInstance!==instance)return;
      if(!seen.has(id)){
        if(!receive(data))return;
        seen.set(id,Date.now());
        if(seen.size>256)seen.delete(seen.keys().next().value!);
        try{sessionStorage.setItem(seenKey,JSON.stringify([...seen]));}catch{}
      }
      // Acknowledge accepted DOM work, not the next animation frame. An
      // inactive browser tab may throttle rAF without delaying this receipt.
      void OBR.broadcast.sendMessage('com.obr-suite/resources/toast-ack',{id,instance:instance||deliveryInstance},{destination:'LOCAL'}).catch(()=>{});
    });
    OBR.broadcast.onMessage('com.obr-suite/resources/toast-probe',event=>{
      if((event.data as {instance?:string})?.instance===instance)void announceReady();
    });
    await announceReady();
  }else OBR.broadcast.onMessage(BC_RESOURCE_CHANGED,event=>receive(event.data as ResourceToastPayload));
});
