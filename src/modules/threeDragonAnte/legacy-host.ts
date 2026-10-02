import type { TableMember } from './controller-platform';
import type { TableSummary } from './protocol';

/** Pre-server v1 summaries have no lease or heartbeat fields. Authority comes
 * from current SDK membership, never an invented age of the persisted record.
 * Prefer an online historical seat; only an otherwise orphaned lobby may
 * fall back to a verified room GM. Stable connection selection also prevents
 * two windows of the same player from both claiming an abandoned lobby. */
export function legacyLobbySuccessor(table: TableSummary, members: readonly TableMember[]): TableMember | undefined {
  if (table.stage !== 'lobby' || members.some(member => member.id === table.hostPlayerId)) return;
  const online = [...members].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.connectionId < b.connectionId ? -1 : a.connectionId > b.connectionId ? 1 : 0);
  for (const seat of table.seats) {
    const candidate = online.find(member => member.id === seat.playerId);
    if (candidate) return candidate;
  }
  return online.find(member => member.role === 'GM');
}
