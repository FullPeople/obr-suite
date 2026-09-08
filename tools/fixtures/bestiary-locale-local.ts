const local = { monsters: [] as any[] };
(globalThis as any).__bestiaryLocal = local;
export const getAllLocalMonsters = () => local.monsters;
export const getLocalContentSignature = () => JSON.stringify(local.monsters);
export const initLocalContent = async () => {};
export const forceReloadLocalContent = async () => {};
export const BC_LOCAL_CONTENT_CHANGED = "bestiary-test/local-content";
