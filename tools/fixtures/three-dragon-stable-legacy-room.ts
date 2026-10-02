import type { TableSummary } from '../../src/modules/threeDragonAnte/protocol';
/** Synthetic v1 metadata using the stable Suite v1 schema. These are not
 * freshly-created controller rooms: no timestamp, lease or archive. */
export function legacyLobby(): TableSummary {
  return { version: 1, id: 'historical-table', hostPlayerId: 'old-creator',
    hostConnectionId: 'old-browser', hostName: 'Former creator', stage: 'lobby',
    seats: [{ playerId: 'old-creator', seatId: 'historical-seat', name: 'Former creator' }], revision: 7 };
}
