/** Actual open panels, separate from the layout editor's closed-panel previews.
 * Background modules report successful open/close; there is no idle polling. */
const opened = new Set<string>();
const listeners = new Set<() => void>();
export function setPanelOpen(id: string, value: boolean): void {
  if (value) opened.add(id); else opened.delete(id);
  // Reopening an existing host panel may also have changed its geometry.
  notifyPanelGeometry();
}
export function openPanelIds(): string[] { return [...opened]; }
export function notifyPanelGeometry(): void { for (const listener of listeners) listener(); }
export function onPanelGeometryChange(listener: () => void): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}
