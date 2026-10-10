// The old effect remains a leaf frame. No room writes or result broadcasts.
import type OBRType from '@owlbear-rodeo/sdk';
const channel = 'workbench-dice-2d/v1';
let anchor = {x: innerWidth / 2, y: innerHeight / 2, scale: 1};
const send = (type: string, data?: unknown) => parent.postMessage({channel, type, data}, location.origin);
let begin: () => void;
const started = new Promise<void>(resolve => { begin = resolve; });
const listeners = new Set<(event: any) => void>();
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== channel) return;
  const m = event.data;
  if (m.type === 'anchor') anchor = m.data;
  else if (m.type === 'start') begin();
  else if (m.type === 'clear') listeners.forEach(fn => fn({data: {}}));
});
const sdk = {
  onReady: async (fn: () => void) => {
    document.body.dataset.dice2dReady = 'true'; send('ready'); await started; await fn();
  },
  scene: {items: {getItems: async (ids: string[]) => ids.map(id => ({id, position: {x: anchor.x / anchor.scale, y: anchor.y / anchor.scale + 50}}))}, grid: {getDpi: async () => 100}},
  viewport: {getPosition: async () => ({x: 0, y: 0}), getScale: async () => anchor.scale},
  modal: {close: async () => { send('complete'); }},
  broadcast: {
    sendMessage: async (name: string, data: any, options?: {destination: string}) => {
      if (options?.destination !== 'REMOTE' && name === 'com.obr-suite/sfx') send('sfx', data);
    },
    onMessage: (_name: string, fn: (event: any) => void) => {listeners.add(fn); return () => listeners.delete(fn);},
  },
};
export default sdk as unknown as typeof OBRType;
