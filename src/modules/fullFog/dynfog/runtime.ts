// Small synchronous cache of async scene facts the reconciler needs.
//
// Actors run inside a synchronous reconcile pass, so they can't await
// `OBR.scene.grid.getDpi()` or `OBR.player.getRole()`. This module keeps
// those values warm and hands out plain getters; the owning module
// (`dynfog/index.ts`) refreshes them and re-runs the reconciler when one
// actually changes.

import OBR, { type Player } from "@owlbear-rodeo/sdk";
import { CARD_LIST_KEY, readVisionCards, type VisionCard, type VisionContext } from "./light/visionPolicy";

let sceneDpi = 150;
let role: "GM" | "PLAYER" = "PLAYER";
let playerId = "";
/** GM setting: may players see and toggle door/window indicators? */
let playerOpenings = true;
/** GM setting: show the GM's indicators even without the fog tool. */
let alwaysShowOverlay = false;
/** GM setting: hide other people's lights unless a wall-free sight line
 *  reaches them from one of your own. See `light/occlusion.ts`. */
let lightOcclusion = true;
let shareVision = false;
let runtimeRevision = 0;
let identityRevision = 0, partyRevision = 0, cardsRevision = 0, dpiRevision = 0;
let party: Pick<Player, "id" | "role">[] = [];
let cards = new Map<string, VisionCard>();

export function getVisionContext(): VisionContext {
  const playerIds = new Set(party.filter(player => player.role === "PLAYER").map(player => player.id));
  playerIds.delete(playerId);
  if (role === "PLAYER" && playerId) playerIds.add(playerId);
  return { playerId, playerIds, cards };
}
export function getShareVisionEnabled(): boolean { return shareVision; }
export function setShareVisionEnabled(value: boolean): boolean {
  if (shareVision === value) return false;
  shareVision = value; return true;
}
export function clearSceneVision(): void {
  runtimeRevision++;
  cards = new Map();
}
export function setVisionParty(players: Pick<Player, "id" | "role">[]): boolean {
  partyRevision++;
  const next = players.map(({ id, role }) => ({ id, role })).sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(next) === JSON.stringify(party)) return false;
  party = next; return true;
}
export function setVisionCards(metadata: Record<string, unknown>): boolean {
  cardsRevision++;
  const next = readVisionCards(metadata[CARD_LIST_KEY]);
  if (JSON.stringify([...next]) === JSON.stringify([...cards])) return false;
  cards = next; return true;
}

export function getSceneDpi(): number {
  return sceneDpi;
}
export function getRole(): "GM" | "PLAYER" {
  return role;
}
export function isGM(): boolean {
  return role === "GM";
}
export function getPlayerId(): string {
  return playerId;
}
export function getPlayerOpeningsEnabled(): boolean {
  return playerOpenings;
}
export function getAlwaysShowOverlay(): boolean {
  return alwaysShowOverlay;
}
export function getLightOcclusionEnabled(): boolean {
  return lightOcclusion;
}

/** @returns true when the value actually changed. */
export function setSceneDpi(value: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  dpiRevision++;
  if (sceneDpi === value) return false;
  sceneDpi = value;
  return true;
}

export function setRole(value: "GM" | "PLAYER"): boolean {
  identityRevision++;
  if (role === value) return false;
  role = value;
  return true;
}

export function setPlayerId(value: string): boolean {
  identityRevision++;
  if (playerId === value) return false;
  playerId = value;
  return true;
}

export function setPlayerOpeningsEnabled(value: boolean): boolean {
  if (playerOpenings === value) return false;
  playerOpenings = value;
  return true;
}

export function setAlwaysShowOverlay(value: boolean): boolean {
  if (alwaysShowOverlay === value) return false;
  alwaysShowOverlay = value;
  return true;
}

export function setLightOcclusionEnabled(value: boolean): boolean {
  if (lightOcclusion === value) return false;
  lightOcclusion = value;
  return true;
}


/** Pull the current values from OBR. Returns true when anything moved. */
export async function refreshRuntime(): Promise<boolean> {
  const revision = ++runtimeRevision;
  const versions = { identityRevision, partyRevision, cardsRevision, dpiRevision };
  const [nextRole, nextId, players, metadata, dpi] = await Promise.all([
    OBR.player.getRole().catch(() => null),
    OBR.player.getId().catch(() => null),
    OBR.party.getPlayers().catch(() => null),
    OBR.scene.getMetadata().catch(() => null),
    OBR.scene.grid.getDpi().catch(() => null),
  ]);
  if (revision !== runtimeRevision) return false;
  let changed = false;
  if (versions.identityRevision === identityRevision) {
    if (nextRole) changed = setRole(nextRole) || changed;
    if (nextId) changed = setPlayerId(nextId) || changed;
  }
  if (players && versions.partyRevision === partyRevision) changed = setVisionParty(players) || changed;
  if (metadata && versions.cardsRevision === cardsRevision) changed = setVisionCards(metadata) || changed;
  if (dpi && versions.dpiRevision === dpiRevision) changed = setSceneDpi(dpi) || changed;
  return changed;
}
