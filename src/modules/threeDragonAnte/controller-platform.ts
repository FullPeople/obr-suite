import { TABLE_NETWORK, TABLE_ROOM_KEY } from "./protocol";

export interface TableMember { id: string; connectionId: string; name: string }
/** The real SDK supplies connectionId. Never obtain sender identity from data. */
export interface ControllerPlatform {
  roomId: string;
  self(): Promise<TableMember>;
  players(): Promise<TableMember[]>;
  readTable(): Promise<unknown>;
  writeTable(value: unknown): Promise<void>;
  send(value: unknown): Promise<void>;
  onTable(callback: (value: unknown) => void): () => void;
  onPlayers(callback: (players: TableMember[]) => void): () => void;
  onSelf(callback: (player: TableMember) => void): () => void;
  onMessage(callback: (data: unknown, connectionId: string) => void): () => void;
}

export async function sdkTablePlatform(): Promise<ControllerPlatform> {
  const { default: OBR } = await import("@owlbear-rodeo/sdk");
  return {
    roomId: OBR.room.id,
    self: async () => {
      const [id, connectionId, name] = await Promise.all([OBR.player.getId(), OBR.player.getConnectionId(), OBR.player.getName()]);
      return { id, connectionId, name };
    },
    players: () => OBR.party.getPlayers(),
    readTable: async () => (await OBR.room.getMetadata())[TABLE_ROOM_KEY],
    writeTable: value => OBR.room.setMetadata({ [TABLE_ROOM_KEY]: value }),
    send: value => OBR.broadcast.sendMessage(TABLE_NETWORK, value, { destination: "REMOTE" }),
    onTable: callback => OBR.room.onMetadataChange(metadata => callback(metadata[TABLE_ROOM_KEY])),
    onPlayers: callback => OBR.party.onChange(callback),
    onSelf: callback => OBR.player.onChange(callback),
    onMessage: callback => OBR.broadcast.onMessage(TABLE_NETWORK, event => callback(event.data, event.connectionId)),
  };
}
