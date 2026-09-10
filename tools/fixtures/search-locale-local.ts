const local = { index: { x: [] as any[], m: { s: {} } }, data: {} as Record<string, any[]> };
(globalThis as any).__searchLocal = local;
export const getLocalIndexFile = () => local.index;
export const getLocalDataByKeySource = (key: string, source: string) => (local.data[key] ?? []).filter((entry) => !source || String(entry.source ?? "").toUpperCase() === source.toUpperCase());
export const getLocalContentSignature = () => JSON.stringify(local.index);
export const initLocalContent = async () => {};
export const forceReloadLocalContent = async () => {};
export const BC_LOCAL_CONTENT_CHANGED = "search-test/local-content";
