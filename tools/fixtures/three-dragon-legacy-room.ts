import type { TableSummary } from '../../extensions/three-dragon-ante/src/game/protocol';
/** Synthetic v1 metadata using the historical 642a989 schema. These are not
 * freshly-created controller rooms: no variant, timestamp, lease or archive. */
export function legacyLobby(): TableSummary {
  return { version: 1, id: 'historical-table', hostPlayerId: 'old-creator',
    hostConnectionId: 'old-browser', hostName: 'Former creator', stage: 'lobby',
    seats: [{ playerId: 'old-creator', seatId: 'historical-seat', name: 'Former creator' }], revision: 7 };
}
