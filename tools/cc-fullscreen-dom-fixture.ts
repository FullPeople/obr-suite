const mock = (window as any).fullMock;
export const getState = () => mock.state;
export const getLocalLang = () => mock.lang;
export const onLangChange = (callback: any) => { mock.langListeners.add(callback); return () => mock.langListeners.delete(callback); };
export const onStateChange = (callback: any) => { mock.stateListeners.add(callback); return () => mock.stateListeners.delete(callback); };
export const onStateRefreshed = (callback: any) => { (mock.refreshed ??= new Set()).add(callback); return () => mock.refreshed.delete(callback); };
export const onStateRefreshFailed = (callback: any) => { (mock.refreshFailed ??= new Set()).add(callback); return () => mock.refreshFailed.delete(callback); };
export const refreshFromScene = async () => { if (mock.holdSettings) return; for (const callback of mock.refreshed ?? []) callback(); return mock.state; };
export const startSceneSync = () => { void refreshFromScene(); };
export const subscribeToSfx = () => () => {};
export const fireQuickRoll = (...args: any[]) => mock.rolls.push(args);
export const patchBubbles = async (...args: any[]) => { mock.patches.push(args); return {}; };
export const reconcileUploadedCardShieldState = async () => false;
export default {
  onReady(callback: any) { queueMicrotask(callback); },
  broadcast: {
    onMessage(id: string, callback: any) { const listeners = mock.listeners[id] ??= new Set(); listeners.add(callback); return () => listeners.delete(callback); },
    async sendMessage(id: string, data: any, options: any) { mock.sent.push({ id, data, options }); if (options.destination === "LOCAL") for (const callback of mock.listeners[id] ?? []) callback({ data }); },
  },
  scene: { onReadyChange(callback: any) { (mock.sceneListeners ??= new Set()).add(callback); return () => mock.sceneListeners.delete(callback); }, items: { async getItems() { return []; } } },
};
