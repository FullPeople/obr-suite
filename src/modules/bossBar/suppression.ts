// Local presentation ownership only. Never persisted to a token or broadcast
// to other clients: hiding/disabling this client's Boss view restores its bars.
let shown = new Set<string>();
let revision = 0;
const listeners = new Set<() => void>();
export function bossReplacesHealthBar(id: string): boolean { return shown.has(id); }
export function presentedBossesRevision(): number { return revision; }
export function setPresentedBosses(ids: readonly string[]): void {
  const next = new Set(ids);
  if (next.size === shown.size && [...next].every(id => shown.has(id))) return;
  shown = next;
  revision++;
  for (const listener of listeners) listener();
}
export function onPresentedBossesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
