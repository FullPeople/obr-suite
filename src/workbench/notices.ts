import {setupActivityPanel,ensureActivityPanel,onActivityPanelChange} from './activity-panel';
import {sharedEntry,type SharedEntry} from './shared-entry';
import OBR from '@owlbear-rodeo/sdk';
import type { Resource } from '../modules/resourceTracker/types';

export const NOTICE_CHANNEL = 'com.obr-suite/resources/changed';
const TOAST = 'com.obr-suite/resources/toast-modal';
const DELIVER = 'com.obr-suite/resources/toast-deliver';
const ACK = 'com.obr-suite/resources/toast-ack';
const READY = 'com.obr-suite/resources/toast-ready';
const PROBE = 'com.obr-suite/resources/toast-probe';
const RETRY_MS = 500;
export interface WorkbenchNotice {
  noticeId: string;
  entry?: SharedEntry;
  shared?: boolean;
  tokenId: string;
  tokenName?: string;
  resource: Resource;
  delta: number;
  prevValue: number;
  privateFor?: string[];
  privateSummary?: string;
  /** A sentence-only notice, e.g. preparation; there is no resource widget. */
  summary?: string;
}

// Notices are workbench infrastructure, not the resource editor's lifecycle.
// An inventory/spell change remains visible when resourceTracker is disabled
// or an unrelated legacy module is still awaiting startup.
let started = false, ready = false, connection = '', player = '', role = 'PLAYER';
let revision = 0, overlayOpen = false, rendererReady = false, opening: Promise<void> | undefined;
let instance = '', modalWork: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined, attempts = 0;
const queue = new Map<string, WorkbenchNotice>();
const accepted = new Set<string>();
const recent = new Map<string,{at:number;data:WorkbenchNotice}>();

function remember(id: string) {
  accepted.add(id);
  if (accepted.size > 256) accepted.delete(accepted.values().next().value!);
}
function displayedIds() {
  // Host and toast are same-origin frames in the same room tab. If every ACK
  // was lost, the renderer's ID-only receipt still prevents a second native
  // fallback for a notification the user has already seen.
  try {
    const rows: unknown = JSON.parse(sessionStorage.getItem(`com.obr-suite/resources/toast-seen:${OBR.room.id}`) || '[]');
    if (Array.isArray(rows)) return new Set(rows.filter(row => Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'number' && Date.now() - row[1] < 120000).map(row => row[0] as string));
  } catch {}
  return new Set<string>();
}
function accept(data: WorkbenchNotice | undefined) {
  if (!data?.resource || !Number.isFinite(data.delta)) return;
  const id = data.noticeId || crypto.randomUUID();
  if (accepted.has(id)) return;
  remember(id); queue.set(id, { ...data, noticeId: id });
  recent.set(id,{at:performance.timeOrigin+performance.now(),data:{...data,noticeId:id}});
  while(recent.size>50)recent.delete(recent.keys().next().value!);
  while (queue.size > 50) queue.delete(queue.keys().next().value!);
  deliver();
}
function probeRenderer() {
  if (ready && instance) void OBR.broadcast.sendMessage(PROBE, { instance }, { destination: 'LOCAL' }).catch(() => {});
}
function openOverlay(replace = false) {
  if (!ready || !connection || opening || (overlayOpen && !replace)) return opening;
  const own = revision, ownInstance = crypto.randomUUID();
  instance = ownInstance; overlayOpen = false; rendererReady = false;
  // Scene close/reopen and recovery share one SDK mutation lane. A late close
  // for an old scene must never tear down its successor's already opened modal.
  const current = () => ready && own === revision && instance === ownInstance;
  const work = modalWork.then(async () => {
    if (!current()) return;
    await ensureActivityPanel(replace);
    if (!current()) return;
    overlayOpen = true;
    // READY can precede the SDK open response, or be lost. The renderer answers
    // this one-shot probe; no heartbeat/render loop runs while the layer is idle.
    probeRenderer();
    deliver();
  });
  modalWork = work.catch(error => {
    if (current()) { overlayOpen = false; rendererReady = false; instance = ''; }
    console.warn('[workbench] notice overlay failed', error);
  });
  opening = modalWork.finally(() => {
    opening = undefined;
    if (ready && own !== revision) openOverlay();
  });
  return opening;
}
function deliver() {
  if (!ready || !queue.size) return;
  if (!timer) timer = setTimeout(() => {
    timer = undefined;
    if (!ready || !queue.size) return;
    if (++attempts >= 6) {
      const displayed = displayedIds();
      for (const data of queue.values()) {
        if (displayed.has(data.noticeId)) continue;
        const hidden = data.privateFor && role !== 'GM' && !data.privateFor.includes(player);
        const text = hidden ? data.privateSummary || '有人调整了资源' : data.summary || `${data.tokenName || ''} ${data.resource.name} ${data.delta > 0 ? '+' : ''}${data.delta}`;
        void OBR.notification.show(text, 'INFO').catch(() => {});
      }
      queue.clear(); attempts = 0; return;
    }
    // Resend within the existing iframe first. Rebuild once only if the
    // renderer disappeared or acknowledgements still fail to return.
    if (attempts === 3) openOverlay(true);
    deliver();
  }, RETRY_MS);
  if (rendererReady) {
    for (const [id, data] of queue) void OBR.broadcast.sendMessage(DELIVER, { id, instance, data }, { destination: 'LOCAL' }).catch(() => {});
  } else {
    openOverlay();
    probeRenderer();
  }
}
function sceneChanged(value: boolean) {
  if (ready !== value) revision++;
  ready = value;
  if (value) { openOverlay(); deliver(); return; }
  clearTimeout(timer); timer = undefined; queue.clear(); attempts = 0;
  overlayOpen = false; rendererReady = false; instance = '';
  modalWork = modalWork.then(() => OBR.modal.close(TOAST)).catch(() => {});
}

export function setupWorkbenchNotices() {
  if (started) return;
  started = true;
  setupActivityPanel();
  onActivityPanelChange(({dismissedAt})=>{
    overlayOpen=false;rendererReady=false;
    // Closing dismisses what existed at the gesture, not messages received
    // afterwards while the close broadcast/SDK call was still in flight.
    if(Number.isFinite(dismissedAt))for(const [id,row] of recent)if(row.at>dismissedAt!&&row.at>performance.timeOrigin+performance.now()-20000)queue.set(id,row.data);
    if(queue.size)queueMicrotask(deliver);
  });
  // Subscribe synchronously, before reading SDK state or starting any module.
  OBR.broadcast.onMessage(NOTICE_CHANNEL, event => accept(event.data as WorkbenchNotice));
  OBR.broadcast.onMessage(ACK, event => {
    if (!connection || event.connectionId !== connection) return;
    const ack=event.data as {id?:string;instance?:string};if(!instance||ack?.instance!==instance)return;
    queue.delete(ack.id || '');
    if (!queue.size) { clearTimeout(timer); timer = undefined; attempts = 0; }
  });
  OBR.broadcast.onMessage('com.obr-suite/resources/toast-mounted',event=>{if(event.connectionId===connection)probeRenderer();});
  OBR.broadcast.onMessage(READY, event => {
    if (!connection || event.connectionId !== connection || !instance || (event.data as any)?.instance !== instance) return;
    rendererReady = true; deliver();
  });
  OBR.scene.onReadyChange(sceneChanged);
  let roleObserved = false;
  OBR.player.onChange(value => { roleObserved = true; role = value.role; });
  const own = revision;
  void OBR.player.getRole().then(initialRole => { if (!roleObserved) role = initialRole; }).catch(() => {});
  void Promise.all([OBR.scene.isReady(), OBR.player.getConnectionId(), OBR.player.getId()]).then(([initial, id, playerId]) => {
    connection = id; player = playerId;
    if (own === revision) ready = initial;
    if (ready) { openOverlay(); deliver(); }
  }).catch(error => console.warn('[workbench] notice startup failed', error));
}

export async function publishWorkbenchNotice(data: WorkbenchNotice) {
  // Keep entry snapshots bounded; bad imported rule text must never fail a committed edit.
  let entry:SharedEntry|undefined;try{if(data.entry)entry=sharedEntry(data.entry);}catch{}
  const {entry:unused,...resource}=data.resource as Resource & {entry?:unknown};
  data={...data,entry,resource};
  // Never depend on a sender receiving its own SDK broadcast. A single notice
  // ID covers local enqueue, remote delivery, retries and iframe replacement.
  accept(data);
  // Broadcast has no recipient targeting. A private payload must be reduced
  // before crossing the wire, not merely hidden by each receiver's DOM. Remote
  // owners also receive only the summary; their card remains available through
  // the existing permission-checked reader.
  const summary=data.privateSummary||'有人调整了资源';
  const remote:WorkbenchNotice=data.privateFor?{noticeId:data.noticeId,tokenId:'private:'+data.noticeId,summary,resource:{id:'private',name:summary,current:0,max:0,type:'number',icon:'gem'},delta:0,prevValue:0}:data;
  // The mutation has already committed. A delayed broadcast receipt must not
  // hold its acknowledgement or the next mutation in the host write queue.
  // Keep the original ID for local/remote delivery and renderer deduplication.
  void OBR.broadcast.sendMessage(NOTICE_CHANNEL, remote, { destination: 'REMOTE' })
    .catch(error => console.warn('[workbench] notice broadcast failed', { noticeId: data.noticeId, error }));
}
