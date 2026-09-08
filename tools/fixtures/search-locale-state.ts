const listeners = new Set<() => void>();
const langListeners = new Set<(language: "zh" | "en") => void>();
const model = { language: "en", libraries: [] as any[], dataVersion: "all", allowPlayerMonsters: true };
export const getState = () => model;
export const getLocalLang = () => model.language;
export const startSceneSync = () => {};
export const onStateChange = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
export const onLangChange = (listener: (language: "zh" | "en") => void) => { langListeners.add(listener); return () => langListeners.delete(listener); };
export const fixture = {
  setLibraries(libraries: any[]) { model.libraries = libraries; listeners.forEach((listener) => listener()); },
  setLanguage(language: "zh" | "en") { model.language = language; langListeners.forEach((listener) => listener(language)); },
};
(globalThis as any).__searchState = fixture;
