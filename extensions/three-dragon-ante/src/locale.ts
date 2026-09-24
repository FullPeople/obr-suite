export type Language = "zh" | "en";
const key = "three-dragon-ante/language";
const listeners = new Set<(language: Language) => void>();
export function getLocalLang(): Language {
  try { const value = localStorage.getItem(key); if (value === "zh" || value === "en") return value; } catch {}
  return navigator.language.startsWith("zh") ? "zh" : "en";
}
export function setLocalLang(language: Language): void {
  try { localStorage.setItem(key, language); } catch {}
  for (const listener of listeners) listener(language);
}
export function onLangChange(listener: (language: Language) => void): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}
window.addEventListener("storage", event => { if (event.key === key) for (const listener of listeners) listener(getLocalLang()); });
