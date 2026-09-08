// Only used by runtime-selftest.mjs --sdk-mock, never by a product build.
type Listener = (...args: any[]) => void;
export const readyListeners: Listener[] = [];
export const sceneListeners: Listener[] = [];
export const writes: Record<string, unknown>[] = [];
const sdk = {
  scene: {
    getMetadata: async (): Promise<Record<string, any>> => ({}),
    setMetadata: async (data: Record<string, unknown>) => { writes.push(data); },
    onReadyChange: (fn: Listener) => { readyListeners.push(fn); return () => {}; },
    onMetadataChange: (fn: Listener) => { sceneListeners.push(fn); return () => {}; },
  },
  room: {
    getMetadata: async (): Promise<Record<string, any>> => ({}),
    setMetadata: async (_data: unknown) => {},
    onMetadataChange: (_fn: Listener) => () => {},
  },
  broadcast: { sendMessage: async (..._args: unknown[]) => {} },
};
export default sdk;
