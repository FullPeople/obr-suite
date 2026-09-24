// Browser-only SDK boundary for the notification lifecycle probe. Production
// host/renderer code is bundled unchanged; modal.open creates a real iframe.
type Listener = { window: Window; fn: (event: any) => void };
const root = window.top! as any;
if (!root.noticeMock) {
  const options = new URLSearchParams(location.search);
  const listeners = new Map<string, Set<Listener>>();
  const state = root.noticeMock = {
    listeners, ready: options.get('scene') !== 'off', role: 'GM', player: 'me',
    failOpen: options.has('failOpen'), openDelay: Number(options.get('openDelay')) || 0,
    deferToastRole: options.has('deferToastRole'), deferHostRole: options.has('deferHostRole'),
    dropReady: Number(options.get('dropReady')) || 0, dropAck: false,
    opens: [] as any[], closes: [] as any[], messages: [] as any[], notifications: [] as any[], visuals: [] as string[],
    emit(channel: string, data: any, connectionId = 'connection') {
      for (const listener of [...(listeners.get(channel) || [])]) queueMicrotask(() => listener.fn({ data: structuredClone(data), connectionId }));
    },
    removeFrame() {
      const frame = document.getElementById('notice-overlay') as HTMLIFrameElement | null;
      if (frame) for (const set of listeners.values()) for (const listener of set) if (listener.window === frame.contentWindow) set.delete(listener);
      frame?.remove();
    },
  };
  state.scene = (value: boolean) => { state.ready = value; state.emit('scene', value); };
  state.changeRole = (role: string) => { state.role = role; state.emit('player', { role }); };
}
const mock = root.noticeMock;
function subscribe(channel: string, fn: (event: any) => void) {
  const set = mock.listeners.get(channel) || new Set<Listener>();
  mock.listeners.set(channel, set);
  const listener = { window, fn }; set.add(listener);
  const off = () => set.delete(listener);
  window.addEventListener('unload', off, { once: true });
  return off;
}
const api = {
  room: { id: 'notice-probe-room' },
  onReady(fn: () => any) {
    if (window !== root) {
      const stack = document.getElementById('stack');
      if (stack) new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement && node.matches('.toast')) mock.visuals.push(node.textContent);
      }).observe(stack, { childList: true });
    }
    queueMicrotask(() => { Promise.resolve(fn()).catch(error => { setTimeout(() => { throw error; }); }); });
  },
  scene: { isReady: async () => mock.ready, onReadyChange: (fn: (ready: boolean) => void) => subscribe('scene', event => fn(event.data)) },
  player: {
    id: 'me', getId: async () => mock.player, getConnectionId: async () => 'connection',
    getRole: async () => {
      const role = mock.role;
      if (window !== root && mock.deferToastRole) return new Promise(resolve => { mock.resolveToastRole = () => resolve(role); });
      if (window === root && mock.deferHostRole) return new Promise(resolve => { mock.resolveHostRole = () => resolve(role); });
      return role;
    },
    onChange: (fn: (player: any) => void) => subscribe('player', event => fn(event.data)),
  },
  broadcast: {
    onMessage: subscribe,
    async sendMessage(channel: string, data: any, options: { destination: string }) {
      mock.messages.push({ channel, data: structuredClone(data), destination: options.destination, at: Date.now() });
      if (options.destination === 'REMOTE') return;
      if (channel.endsWith('/toast-ready') && mock.dropReady > 0) { mock.dropReady--; return; }
      if (channel.endsWith('/toast-ack') && mock.dropAck) return;
      mock.emit(channel, data);
    },
  },
  modal: {
    async open(options: any) {
      mock.opens.push({ ...options, at: Date.now() });
      if (mock.failOpen) throw new Error('probe modal open failed');
      if (mock.openDelay) await new Promise(resolve => setTimeout(resolve, mock.openDelay));
      mock.removeFrame();
      const frame = root.document.createElement('iframe');
      frame.id = 'notice-overlay'; frame.src = options.url;
      frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none';
      root.document.body.append(frame);
    },
    async close(id: string) { mock.closes.push({ id, at: Date.now() }); mock.removeFrame(); },
  },
  notification: { async show(text: string, variant: string) { mock.notifications.push({ text, variant, at: Date.now() }); } },
};
export default api;
