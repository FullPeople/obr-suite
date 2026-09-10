import OBR from "./suite-wiring-sdk";
export * from "./suite-wiring-sdk";
const sdk: any = OBR;
const host = (parent as any).syncHost;
const name = location.pathname.includes("cluster-row") ? "row" : "settings";
type Fn = (value: any) => void;
const endpoint = {
  scene: new Set<Fn>(), room: new Set<Fn>(), ready: new Set<Fn>(), player: new Set<Fn>(), channels: new Map<string, Set<Fn>>(),
  holdNextRead: false, heldReads: [] as Array<() => void>, roleReads: [] as Array<() => void>,
  async read() { host.reads[name]++; const value = structuredClone(host.metadata); if(this.holdNextRead){this.holdNextRead=false;await new Promise<void>(done=>this.heldReads.push(done));}return value; },
};
host.clients[name] = endpoint;
(window as any).syncPort = endpoint;
const listen = (set: Set<Fn>, fn: Fn) => {set.add(fn);return()=>set.delete(fn);};
sdk.scene.isReady = async () => host.ready;
sdk.scene.onReadyChange = (fn: Fn) => listen(endpoint.ready,fn);
sdk.scene.getMetadata = () => endpoint.read();
sdk.scene.setMetadata = async (patch: any) => { if(host.failWrite)throw Error("controlled-write-failure");Object.assign(host.metadata,structuredClone(patch));host.emitScene(); };
sdk.scene.onMetadataChange = (fn: Fn) => listen(endpoint.scene,fn);
sdk.room.getMetadata = async () => structuredClone(host.roomMetadata);
sdk.room.setMetadata = async (patch: any) => {Object.assign(host.roomMetadata,structuredClone(patch));host.emitRoom();};
sdk.room.onMetadataChange = (fn: Fn) => listen(endpoint.room,fn);
sdk.player.getRole = async () => {
  const role = host.role;
  if(name === "row" && host.delayRowRole){host.delayRowRole=false;await new Promise<void>(done=>endpoint.roleReads.push(done));}
  return role;
};
sdk.player.onChange = (fn: Fn) => listen(endpoint.player,fn);
sdk.broadcast.onMessage = (channel: string, fn: Fn) => {
  if(!endpoint.channels.has(channel))endpoint.channels.set(channel,new Set());
  return listen(endpoint.channels.get(channel)!,fn);
};
sdk.broadcast.sendMessage = async (channel: string, data: any, options: any) => {
  host.sent.push({source:name,channel,data:structuredClone(data),destination:options?.destination});
  if(options?.destination !== "REMOTE")host.broadcast(channel,data);
};
export default sdk;
