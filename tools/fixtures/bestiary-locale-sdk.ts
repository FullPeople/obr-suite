import OBR, { fixture } from "./suite-wiring-sdk";
export * from "./suite-wiring-sdk";
const sdk: any = OBR;
const state = { tokens: new Map<string, any>(), writes: 0 };
(globalThis as any).__bestiarySdk = state;
sdk.scene.items.getItems = async (ids?: string[]) => {
  const items = [...state.tokens.values()].filter((token) => !ids || ids.includes(token.id));
  const delay = Math.max(0, ...items.map((item) => item.testReadDelay ?? 0));
  if (delay) await new Promise((done) => setTimeout(done, delay));
  return items;
};
sdk.scene.items.onChange = () => () => {};
sdk.scene.items.updateItems = async (ids: string[], update: (items: any[]) => void) => {
  state.writes++; update([...state.tokens.values()].filter((token) => ids.includes(token.id)));
};
sdk.scene.setMetadata = async (metadata: any) => { state.writes++; Object.assign(fixture.metadata, metadata); };
export default sdk;
