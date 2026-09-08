import OBR, { fixture } from "./transitions-sdk";
export * from "./transitions-sdk";
export const isImage = (item: any) => item?.type === "IMAGE";
const sdk: any = OBR;
const metadataListeners = new Set<(metadata: any) => void>();
const fogListeners = new Set<(fog: any) => void>();
let filled = true;
sdk.room = { id: "ui-audit-room", getMetadata: async () => ({}), setMetadata: async () => {}, onMetadataChange: () => () => {} };
sdk.scene.onMetadataChange = (fn: (metadata: any) => void) => { metadataListeners.add(fn); return () => metadataListeners.delete(fn); };
sdk.scene.setMetadata = async (metadata: any) => {
  Object.assign(fixture.metadata, metadata);
  for (const fn of metadataListeners) fn(fixture.metadata);
};
sdk.scene.fog = {
  getFilled: async () => filled,
  setFilled: async (next: boolean) => { filled = next; for (const fn of fogListeners) fn({ filled }); },
  onChange: (fn: (fog: any) => void) => { fogListeners.add(fn); return () => fogListeners.delete(fn); },
};
sdk.notification = { show: async () => "notification" };
sdk.modal = { open: async () => {}, close: async () => {} };
sdk.popover.setWidth = async () => {};
sdk.player.getMetadata = async () => ({});
sdk.player.setMetadata = async () => {};
export default sdk;
