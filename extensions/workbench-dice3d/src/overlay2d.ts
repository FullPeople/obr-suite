import {CHANNEL, errorText, type Roll} from './types';
import {unmaskRoll} from './hidden-roll';
import {diceCatalog} from './asset-catalog';
import './overlay2d.css';

const channel = 'workbench-dice-2d/v1';
export async function mountOverlay2d(container: HTMLElement, client: string) {
  const bus = new BroadcastChannel(`${CHANNEL}:local:${client}`);
  const prepared = new Map<string, Roll>(), archive = new Map<string, Roll>();
  const active = new Map<string, {frame?: HTMLIFrameElement; placeholder?: HTMLElement; timer?: number; started?: boolean; ready?: boolean; replay?: boolean}>();
  let anchors: Record<string, {x: number; y: number}> = {}, scale = 1;
  const labels = document.createElement('div'); container.append(labels);
  const emit = (event: string, roll: string) => bus.postMessage({type: 'renderer-event', event, detail: {roll, mode: '2d'}});
  const track = () => bus.postMessage({type: 'track-tokens', ids: [...new Set([...active.keys()].map(id => archive.get(id)?.formulaData?.context?.itemId).filter(Boolean))]});
  const finish = (id: string, cancelled = false) => {
    const entry = active.get(id); if (!entry) return;
    clearTimeout(entry.timer); entry.frame?.remove(); entry.placeholder?.remove(); active.delete(id); prepared.delete(id);
    emit(cancelled ? 'render-cancelled' : 'render-complete', id); track();
  };
  const point = (roll: Roll) => anchors[roll.formulaData?.context?.itemId || ''] || {x: innerWidth / 2, y: innerHeight / 2};
  const sendAnchor = (frame: HTMLIFrameElement, roll: Roll) => frame.contentWindow?.postMessage({channel, type: 'anchor', data: {...point(roll), scale: roll.formulaData?.context?.itemId ? scale : 1}}, location.origin);
  const startFrame = (id: string, at: number) => {
    const entry = active.get(id); if (!entry || entry.started) return;
    clearTimeout(entry.timer); entry.timer = window.setTimeout(() => {
      entry.started = true; prepared.delete(id); emit('render-start', id);
      if (entry.frame) {entry.frame.style.visibility = 'visible'; sendAnchor(entry.frame, archive.get(id)!); entry.frame.contentWindow?.postMessage({channel, type: 'start'}, location.origin);}
      else {entry.placeholder!.hidden = false; entry.timer = window.setTimeout(() => finish(id), 2600);}
    }, Math.max(0, at - (performance.timeOrigin + performance.now())));
  };
  const makeFrame = (roll: Roll, replay = false) => {
    const id = roll.request.id, rows = roll.formulaData?.logicalRows || roll.formulaData?.rows;
    if (roll.masked || !rows) {
      const placeholder = document.createElement('div'); placeholder.className = 'dice2d-private'; placeholder.textContent = '暗骰 · ?';
      placeholder.hidden = true; container.append(placeholder); active.set(id, {placeholder, ready: true, replay});
      if (replay) startFrame(id, performance.timeOrigin + performance.now()); else bus.postMessage({type: 'prepared', id}); return;
    }
    const dice = rows.flatMap(row => row.dice), starts: number[] = [];
    let offset = 0; for (const row of rows) { starts.push(offset); offset += row.dice.length; }
    const values = dice.map(d => d.kind === 'd_percentile' ? Math.max(1, d.value) : d.value);
    const total = rows.reduce((n, row) => n + row.total, 0);
    const q = new URLSearchParams({
      dtypes: dice.map(d => d.kind === 'd_percentile' ? 'd100' : d.kind).join(','),
      dvalues: values.join(','), dlosers: dice.map(d => d.kept ? '0' : '1').join(','),
      doriginals: dice.map(d => d.raw !== d.value ? d.raw : '').join(','),
      dparents: dice.map(d => d.parent ? dice.findIndex(parent => parent.id === d.parent) : '').join(','),
      dsubtract: dice.map(d => d.sign < 0 ? '1' : '0').join(','),
      winner: '-1', total: String(total), modifier: String(total - dice.filter(d => d.kept).reduce((n, d) => n + d.value * d.sign, 0)),
      label: roll.formulaData?.context?.label || '', rollId: id, color: roll.request.bodyColor || '#999999',
      hidden: roll.request.visibility && roll.request.visibility !== 'all' ? '1' : '0',
      itemId: roll.formulaData?.context?.itemId || '', wx: String(point(roll).x), wy: String(point(roll).y),
      rowStarts: rows.length > 1 ? starts.join(',') : '', same: dice.some(d => d.flags.includes('同值')) ? '1' : '0',
    });
    const frame = document.createElement('iframe'); frame.className = 'dice2d-effect'; frame.title = '2D 骰子动画'; frame.style.visibility = 'hidden';
    // Keep authorized private results in the browser fragment, out of HTTP logs.
    frame.src = '/suite-dev/workbench-dice/effect2d.html#' + q;
    active.set(id, {frame, replay}); container.append(frame); track();
  };
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.channel !== channel) return;
    const found = [...active].find(([, entry]) => entry.frame?.contentWindow === event.source); if (!found) return;
    const [id, entry] = found, m = event.data;
    if (m.type === 'ready') {entry.ready = true; sendAnchor(entry.frame!, archive.get(id)!); if (entry.replay) startFrame(id, performance.timeOrigin + performance.now()); else bus.postMessage({type: 'prepared', id});}
    else if (m.type === 'complete' && entry.started) finish(id);
    else if (m.type === 'sfx' && entry.started) bus.postMessage({type: 'legacy-sfx', name: m.data?.name});
  });
  bus.onmessage = event => {const p = event.data; try {
    if (p.type === 'prepare') {
      prepared.set(p.roll.request.id, p.roll); archive.set(p.roll.request.id, p.roll);
      while (archive.size > 20 || [...archive.values()].reduce((n, r) => n + r.poses.byteLength, 0) > 64000000) {
        const id = [...archive.keys()].find(id => !active.has(id)); if (!id) break; archive.delete(id);
      }
      if (active.has(p.roll.request.id)) {const entry=active.get(p.roll.request.id)!; if (entry.started) return; if (entry.ready) bus.postMessage({type:'prepared',id:p.roll.request.id});}
      else makeFrame(p.roll);
    } else if (p.type === 'start') {
      startFrame(p.id, p.at);
    } else if (p.type === 'token-results') {
      anchors = p.anchors || {}; scale = Number.isFinite(p.scale) && p.scale > 0 ? p.scale : 1; for (const [id, entry] of active) if (entry.frame) sendAnchor(entry.frame, archive.get(id)!);
      labels.replaceChildren(); for (const group of p.groups || []) if (group.visible) for (const row of group.rows) {
        const anchor = anchors[row.itemId]; if (!anchor) continue;
        const label = document.createElement('div'); label.className = 'dice2d-result'; label.style.left = anchor.x + 'px'; label.style.top = anchor.y + 'px';
        label.style.color = /^#[0-9a-f]{6}$/i.test(row.color) ? row.color : '#fff'; label.textContent = row.total + ' · ' + row.text; labels.append(label);
      }
    } else if (p.type === 'clear') {for (const id of [...active.keys()]) finish(id, true);}
    else if (p.type === 'discard') {if (!active.get(p.id)?.started) finish(p.id, true);}
    else if (p.type === 'suite-unmask-archive') {const roll = archive.get(p.id); if (roll?.masked) archive.set(p.id, unmaskRoll(roll, p.details, diceCatalog()));}
    else if (p.type === 'suite-replay') {for (const id of p.ids) {const roll = archive.get(id); if (!roll) throw Error('该投骰已超出最近 20 条回放范围'); if (!active.has(id)) makeFrame(roll, true);}}
    else if (p.type === 'result-bubble' && p.highlight) bus.postMessage({type: 'suite-reveal-highlight', id: p.record.id});
  } catch (error) {bus.postMessage({type: 'renderer-event', event: 'error', detail: {message: errorText(error)}});}};
  // Only the seven existing grayscale images are needed. No skins, WebGL, fonts or audio bank.
  await Promise.all(['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'].map(kind => new Promise<void>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(); image.onerror = () => reject(Error('2D 骰子图像加载失败：' + kind)); image.src = '/suite-dev/' + kind + '.png';
  })));
  bus.postMessage({type: 'overlay-ready', detail: {mode: '2d', view: {w: innerWidth, h: innerHeight}}});
  return {bus, active, archive};
}
if (location.pathname.endsWith('/overlay2d.html')) {
  const client = new URLSearchParams(location.search).get('client'); if (!client) throw Error('缺少本地客户端身份');
  void mountOverlay2d(document.body, client).catch(error => new BroadcastChannel(`${CHANNEL}:local:${client}`).postMessage({type: 'renderer-event', event: 'error', detail: {message: errorText(error)}}));
}
