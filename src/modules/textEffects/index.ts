import OBR from '@owlbear-rodeo/sdk';
import { assetUrl } from '../../asset-base';
import { prefersReducedMotion } from '../transitions/protocol';
import { duration, hasContent, parseConfig } from './model';
import { CONTROL_ID, DISPLAY_ID, OPEN, PLAY, REQUEST, SCENE_KEY, STATUS, STOP, createEventGate, identifier, parseStop, type EffectEvent, type Peer } from './protocol';

let startup: Promise<void> | undefined, ready = false, epoch = 0, readyAt = Date.now(), connection = '';
let sequence = 0, intent = 0, current: { event: EffectEvent; preview: boolean; modalId: string } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const gate = createEventGate(), windows = new Set<string>();
const stopped = new Set<string>();
const requests = new Map<string, { signature: string; result: Promise<EffectResult> }>();
export interface EffectResult { requestId: string; ok: true; id: string; preview: boolean; expiresAt?: number }

async function closeWindow(id: string) {
  try { await OBR.modal.close(id); windows.delete(id); } catch (error) { console.warn('[text-effects] close failed', error); }
}
function closeCurrent() {
  sequence++; if (timer) clearTimeout(timer); timer = undefined;
  const previous = current; current = undefined;
  if (previous) void closeWindow(previous.modalId);
}
async function show(event: EffectEvent, preview: boolean, expectedEpoch: number) {
  closeCurrent();
  const ownSequence = sequence, modalId = `${DISPLAY_ID}/${event.id}`;
  if (!ready || epoch !== expectedEpoch || event.expiresAt <= Date.now()) return;
  current = { event, preview, modalId };
  timer = setTimeout(() => { if (current?.event.id === event.id) closeCurrent(); }, Math.max(0, event.expiresAt - Date.now()));
  const payload = { ...event, reduced: prefersReducedMotion(), modalId };
  const url = `${assetUrl('text-effect-display.html')}#${encodeURIComponent(JSON.stringify(payload))}`;
  windows.add(modalId);
  try {
    await OBR.modal.open({ id: modalId, url, fullScreen: true, hidePaper: true, hideBackdrop: true, disablePointerEvents: true });
    // A scene change or stop may finish before the native open acknowledgment.
    if (ownSequence !== sequence || epoch !== expectedEpoch) await closeWindow(modalId);
  } catch (error) { if (current?.event.id === event.id) closeCurrent(); throw error; }
}
async function sceneKey(expectedEpoch: number, create = false) {
  let metadata = await OBR.scene.getMetadata();
  if (!ready || epoch !== expectedEpoch) throw Error('场景已切换，请重新播放');
  if (!identifier(metadata[SCENE_KEY]) && create) {
    if (await OBR.player.getRole() !== 'GM') throw Error('只有 DM 可以向房间播放');
    if (!ready || epoch !== expectedEpoch) throw Error('场景已切换，请重新播放');
    await OBR.scene.setMetadata({ [SCENE_KEY]: crypto.randomUUID() });
    metadata = await OBR.scene.getMetadata();
  }
  if (!ready || epoch !== expectedEpoch) throw Error('场景已切换，请重新播放');
  return identifier(metadata[SCENE_KEY]) ? metadata[SCENE_KEY] as string : '';
}
async function peers(): Promise<Peer[]> {
  const [party, role] = await Promise.all([OBR.party.getPlayers(), OBR.player.getRole()]);
  return [...party.map(p => ({ connectionId: p.connectionId, role: p.role })), { connectionId: connection, role }];
}
async function execute(value: unknown): Promise<EffectResult> {
  const request = value as { requestId?: unknown; action?: unknown; preview?: unknown; config?: unknown; id?: unknown };
  if (!request || !identifier(request.requestId) || !['play', 'stop'].includes(String(request.action)) || typeof request.preview !== 'boolean') throw Error('无效的文字演出请求');
  const requestId = request.requestId;
  const ownIntent = ++intent;
  if (!ready) throw Error('请先打开枭熊场景');
  const ownEpoch = epoch;
  const checkIntent = () => { if (intent !== ownIntent || epoch !== ownEpoch || !ready) throw Error('演出请求已被更新或场景已切换'); };
  if (!request.preview && await OBR.player.getRole() !== 'GM') throw Error('只有 DM 可以向房间播放');
  if (!ready || epoch !== ownEpoch) throw Error('场景已切换，请重新播放');
  if (request.action === 'stop') {
    if (!identifier(request.id)) throw Error('无效的演出标识');
    if (!request.preview) {
      const key = await sceneKey(ownEpoch);
      checkIntent();
      if (await OBR.player.getRole() !== 'GM') throw Error('只有 DM 可以停止房间演出');
      if (!ready || epoch !== ownEpoch) throw Error('场景已切换');
      await OBR.broadcast.sendMessage(STOP, { version: 1, id: request.id, sceneKey: key, issuedAt: Date.now() }, { destination: 'REMOTE' });
    }
    checkIntent(); stopped.add(request.id);
    if (stopped.size > 128) stopped.delete(stopped.values().next().value!);
    if (current?.event.id === request.id && current.preview === request.preview) closeCurrent();
    return { requestId, ok: true, id: request.id, preview: request.preview };
  }
  const config = parseConfig(request.config);
  if (!config || !hasContent(config)) throw Error('请填写文字或选择视觉效果');
  const key = request.preview ? `preview-${ownEpoch}` : await sceneKey(ownEpoch, true);
  checkIntent();
  const now = Date.now(), event: EffectEvent = { version: 1, id: crypto.randomUUID(), sceneKey: key, order: ownIntent, issuedAt: now, startsAt: now + 500, expiresAt: now + 500 + duration(config) + 500, config };
  if (!request.preview) {
    if (await OBR.player.getRole() !== 'GM') throw Error('只有 DM 可以向房间播放');
    checkIntent();
    if (!ready || epoch !== ownEpoch) throw Error('场景已切换，请重新播放');
    await OBR.broadcast.sendMessage(PLAY, event, { destination: 'REMOTE' });
  }
  checkIntent();
  await show(event, request.preview, ownEpoch);
  checkIntent();
  return { requestId, ok: true, id: event.id, preview: request.preview, expiresAt: event.expiresAt };
}
export async function requestTextEffect(value: unknown): Promise<EffectResult> {
  await setupTextEffects();
  const id = (value as any)?.requestId;
  if (!identifier(id)) throw Error('无效的文字演出请求');
  let signature: string; try { signature = JSON.stringify(value); } catch { throw Error('无效的文字演出配置'); }
  if (new TextEncoder().encode(signature).length > 12000) throw Error('文字演出配置过长');
  const previous = requests.get(id);
  if (previous) { if (previous.signature !== signature) throw Error('演出请求已改变，请重新操作'); return previous.result; }
  const result = execute(value); requests.set(id, { signature, result });
  if (requests.size > 128) requests.delete(requests.keys().next().value!);
  return result;
}
export function setupTextEffects(): Promise<void> {
  if (startup) return startup;
  const unsubscribe: (() => void)[] = [];
  startup = (async () => {
    connection = await OBR.player.getConnectionId();
    const sceneChanged = (next: boolean) => { epoch++; intent++; ready = next; readyAt = Date.now(); gate.clear(); stopped.clear(); requests.clear(); closeCurrent(); void OBR.popover.close(CONTROL_ID).catch(() => {}); };
    unsubscribe.push(OBR.scene.onReadyChange(sceneChanged));
    unsubscribe.push(OBR.broadcast.onMessage(REQUEST, event => {
      if (event.connectionId !== connection) return;
      void requestTextEffect(event.data).then(result => OBR.broadcast.sendMessage(STATUS, result, { destination: 'LOCAL' }))
        .catch(error => OBR.broadcast.sendMessage(STATUS, { requestId: (event.data as any)?.requestId, ok: false, message: error instanceof Error ? error.message : '文字演出未能播放' }, { destination: 'LOCAL' }).catch(() => {}));
    }));
    unsubscribe.push(OBR.broadcast.onMessage(OPEN, event => {
      if (event.connectionId !== connection) return;
      void Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]).then(([width, height]) => OBR.popover.open({ id: CONTROL_ID, url: assetUrl('text-effect-control.html'), width: Math.min(1000, Math.max(280, width - 24)), height: Math.min(780, Math.max(240, height - 48)), anchorReference: 'POSITION', anchorPosition: { left: width / 2, top: 24 }, anchorOrigin: { horizontal: 'CENTER', vertical: 'TOP' }, transformOrigin: { horizontal: 'CENTER', vertical: 'TOP' }, disableClickAway: true })).catch(error => console.warn('[text-effects] editor failed', error));
    }));
    unsubscribe.push(OBR.broadcast.onMessage(PLAY, event => {
      if (!ready || event.connectionId === connection) return;
      const ownEpoch = epoch;
      void Promise.all([sceneKey(ownEpoch), peers()]).then(([key, party]) => {
        if (!ready || epoch !== ownEpoch) return;
        const accepted = gate.accept(event.data, event.connectionId, { now: Date.now(), readyAt, sceneKey: key, peers: party });
        if (accepted && !stopped.has(accepted.id)) return show(accepted, false, ownEpoch);
      }).catch(error => console.warn('[text-effects] room presentation failed', error));
    }));
    unsubscribe.push(OBR.broadcast.onMessage(STOP, event => {
      const stop = parseStop(event.data), ownEpoch = epoch;
      if (!ready || !stop) return;
      void Promise.all([sceneKey(ownEpoch), peers()]).then(([key, party]) => {
        if (epoch !== ownEpoch || !ready || stop.sceneKey !== key || stop.issuedAt < readyAt || Date.now() - stop.issuedAt >= 4000 || stop.issuedAt > Date.now() + 1000 || !party.some(p => p.connectionId === event.connectionId && p.role === 'GM')) return;
        stopped.add(stop.id); if (stopped.size > 128) stopped.delete(stopped.values().next().value!);
        if (current?.event.id === stop.id && !current.preview && stop.issuedAt >= current.event.issuedAt) closeCurrent();
      }).catch(() => {});
    }));
    const revision = epoch, initial = await OBR.scene.isReady();
    if (revision === epoch) { ready = initial; readyAt = Date.now(); }
  })().catch(error => { unsubscribe.forEach(off => off()); ready = false; closeCurrent(); startup = undefined; throw error; });
  return startup;
}
