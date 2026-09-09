import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { getLocalLang } from "../../state";
import {
  BC_TRANSITIONS_OPEN, BC_TRANSITIONS_RUN, BC_TRANSITIONS_PLAY, BC_TRANSITIONS_STATUS,
  BC_TRANSITIONS_DISMISS, CONTROL_ID, DISPLAY_ID, SCENE_KEY, TRANSITION_TTL_MS,
  createTransitionGate, parseTransition, prefersReducedMotion, type TransitionEvent, type TransitionPeer,
} from "./protocol";
import { removeOrphanScreenTransitions, stopScreenTransition } from "./screen-effect";

let running = false;
let epoch = 0;
let ready = false;
let readyAt = Date.now();
let myConnection = "";
let myId = "";
let observedRole: "GM" | "PLAYER" = "PLAYER";
let roleRevision = 0;
let displayId: string | null = null;
let displaySequence = 0;
let lifetime = 0;
let displayController: AbortController | null = null;
let displayTimer: ReturnType<typeof setTimeout> | undefined;
let unsubs: Array<() => void> = [];
const gate = createTransitionGate();
const nativeWindows = new Set<string>();
const nativeClosures = new Map<string, Promise<void>>();

function closeNative(id: string): Promise<void> {
  const pending = nativeClosures.get(id);
  if (pending) return pending;
  const closing = OBR.modal.close(id).then(() => { nativeWindows.delete(id); })
    .finally(() => { nativeClosures.delete(id); });
  nativeClosures.set(id, closing);
  return closing;
}

async function closeDisplay(invalidate = true) {
  if (invalidate) displaySequence++;
  const closingId = displayId;
  displayId = null;
  displayController?.abort();
  displayController = null;
  if (displayTimer) clearTimeout(displayTimer);
  displayTimer = undefined;
  // Unique event IDs make closing independent of opening the next banner.
  // A stuck close RPC must not stall the next presentation.
  if (closingId) void closeNative(`${DISPLAY_ID}/${closingId}`).catch(error => console.warn("[transitions] close failed", error));
  if (closingId) await stopScreenTransition(closingId);
}

async function currentRole(): Promise<"GM" | "PLAYER"> {
  const revision = roleRevision;
  const role = await OBR.player.getRole();
  if (revision !== roleRevision) return observedRole;
  observedRole = role;
  return role;
}

async function show(event: TransitionEvent, ownEpoch: number) {
  const sequence = ++displaySequence;
  await closeDisplay(false);
  if (sequence !== displaySequence || !running || !ready || ownEpoch !== epoch || event.expiresAt <= Date.now()) return;
  displayId = event.id;
  const controller = new AbortController();
  displayController = controller;
  const expiresAt = event.expiresAt;
  displayTimer = setTimeout(() => { if (displayId === event.id) void closeDisplay(); }, Math.max(0, expiresAt - Date.now()));
  const popoverId = `${DISPLAY_ID}/${event.id}`;
  const payload = { ...event, expiresAt, lang: getLocalLang(), reduced: prefersReducedMotion(), popoverId };
  const url = `${assetUrl("transition-display.html")}#${encodeURIComponent(JSON.stringify(payload))}`;
  try {
    nativeWindows.add(popoverId);
    await OBR.modal.open({ id: popoverId, url, fullScreen: true,
      hidePaper: true, hideBackdrop: true,
    });
    if (controller.signal.aborted || ownEpoch !== epoch) {
      nativeWindows.add(popoverId); // A close before the open ACK may precede actual creation.
      await closeNative(popoverId);
    }
  } catch (error) {
    if (displayId === event.id) await closeDisplay();
    console.warn("[transitions] display could not open", error);
  }
}

async function openControl() {
  const vw = await OBR.viewport.getWidth();
  if (!running) return;
  await OBR.popover.open({ id: CONTROL_ID, url: assetUrl("transition-control.html"),
    width: Math.min(380, vw - 24), height: 390, anchorPosition: { left: vw / 2, top: 88 },
    anchorReference: "POSITION", anchorOrigin: { horizontal: "CENTER", vertical: "TOP" },
    transformOrigin: { horizontal: "CENTER", vertical: "TOP" }, disableClickAway: true,
  });
}

async function localRequest(value: unknown, sender: string) {
  if (!running || sender !== myConnection) return;
  const request = value as { kind?: string; text?: string; targets?: "all" | string[]; preview?: boolean; requestId?: string; issuedAt?: number };
  if (!request || !["short", "long", "text"].includes(request.kind ?? "")) return;
  if (typeof request.issuedAt !== "number" || !Number.isFinite(request.issuedAt)
    || request.issuedAt < readyAt || request.issuedAt > Date.now() + 1_000
    || Date.now() - request.issuedAt > TRANSITION_TTL_MS) return;
  const ownEpoch = epoch;
  try {
    if (!ready) throw new Error("scene");
    const role = await currentRole();
    if (ownEpoch !== epoch || !running) return;
    const preview = request.preview === true || role !== "GM";
    let sceneKey = `local-${epoch}`;
    if (!preview) {
      let metadata = await OBR.scene.getMetadata();
      if (ownEpoch !== epoch || !ready) return;
      if (typeof metadata[SCENE_KEY] !== "string") {
        if (await currentRole() !== "GM") throw new Error("role");
        if (ownEpoch !== epoch || !ready || !running) return;
        await OBR.scene.setMetadata({ [SCENE_KEY]: crypto.randomUUID() });
        if (ownEpoch !== epoch || !ready) return;
        metadata = await OBR.scene.getMetadata();
      }
      sceneKey = String(metadata[SCENE_KEY] ?? "");
    }
    if (ownEpoch !== epoch || !running || !ready) return;
    const now = Date.now();
    const event = parseTransition({ version: 1, id: crypto.randomUUID(), sceneKey,
      issuedAt: now, expiresAt: now + TRANSITION_TTL_MS, kind: request.kind,
      text: typeof request.text === "string" ? request.text.trim().slice(0, 120) : "",
      targets: preview ? [myId] : request.targets ?? "all",
    });
    if (!event || (event.kind === "text" && !event.text) || (event.targets !== "all" && !event.targets.length)) throw new Error("input");
    if (!preview) {
      if (await currentRole() !== "GM") throw new Error("role");
      if (ownEpoch !== epoch || !ready || !running || Date.now() - request.issuedAt > TRANSITION_TTL_MS) return;
      await OBR.broadcast.sendMessage(BC_TRANSITIONS_PLAY, event, { destination: "REMOTE" });
    }
    if (ownEpoch !== epoch || !ready) return;
    if (event.targets === "all" || event.targets.includes(myId)) void show(event, ownEpoch);
    await OBR.broadcast.sendMessage(BC_TRANSITIONS_STATUS, { requestId: request.requestId, ok: true, preview }, { destination: "LOCAL" });
  } catch (error) {
    console.warn("[transitions] request failed", error);
    await OBR.broadcast.sendMessage(BC_TRANSITIONS_STATUS, { requestId: request.requestId, ok: false,
      reason: error instanceof Error ? error.message : "unknown" }, { destination: "LOCAL" }).catch(() => {});
  }
}

async function remoteEvent(value: unknown, sender: string) {
  if (!running || !ready || !parseTransition(value)) return;
  const ownEpoch = epoch;
  try {
    const [metadata, peers, role] = await Promise.all([OBR.scene.getMetadata(), OBR.party.getPlayers(), OBR.player.getRole()]);
    if (ownEpoch !== epoch || !ready || !running) return;
    const allPeers: TransitionPeer[] = [...peers, { id: myId, connectionId: myConnection, role }];
    const accepted = gate.accept(value, sender, { now: Date.now(), readyAt,
      sceneKey: typeof metadata[SCENE_KEY] === "string" ? metadata[SCENE_KEY] as string : "",
      playerId: myId, peers: allPeers,
    });
    if (accepted) await show(accepted, ownEpoch);
  } catch (error) { console.warn("[transitions] event ignored", error); }
}

export async function setupTransitions(): Promise<void> {
  if (running) return;
  running = true;
  const ownLifetime = ++lifetime;
  const ownEpoch = ++epoch;
  await Promise.all([...nativeWindows].map(closeNative));
  if (!running || ownEpoch !== epoch || ownLifetime !== lifetime) return;
  [myConnection, myId] = await Promise.all([OBR.player.getConnectionId(), OBR.player.getId()]);
  if (!running || ownEpoch !== epoch || ownLifetime !== lifetime) return;
  const sceneChanged = (next: boolean) => {
    epoch++;
    ready = next;
    readyAt = Date.now();
    gate.clear();
    void closeDisplay();
    void OBR.popover.close(CONTROL_ID).catch(() => {});
    if (next) void removeOrphanScreenTransitions(true);
  };
  unsubs.push(OBR.scene.onReadyChange(sceneChanged), OBR.player.onChange((player) => {
    observedRole = player.role;
    roleRevision++;
  }));
  const checkedEpoch = epoch;
  const initialReady = await OBR.scene.isReady();
  if (checkedEpoch === epoch) { ready = initialReady; readyAt = Date.now(); }
  if (ready) await removeOrphanScreenTransitions();
  if (!running || ownLifetime !== lifetime) return;
  unsubs.push(
    OBR.broadcast.onMessage(BC_TRANSITIONS_OPEN, (message) => {
      if (message.connectionId === myConnection) void openControl().catch((error) => console.warn("[transitions] control unavailable", error));
    }),
    OBR.broadcast.onMessage(BC_TRANSITIONS_RUN, (message) => { void localRequest(message.data, message.connectionId); }),
    OBR.broadcast.onMessage(BC_TRANSITIONS_PLAY, (message) => { void remoteEvent(message.data, message.connectionId); }),
    OBR.broadcast.onMessage(BC_TRANSITIONS_DISMISS, (message) => {
      if (message.connectionId === myConnection && (message.data as any)?.id === displayId) void closeDisplay();
    }),
  );
  const close = () => { void closeDisplay(); };
  const hidden = () => { if (document.hidden) close(); };
  window.addEventListener("pagehide", close);
  document.addEventListener("visibilitychange", hidden);
  unsubs.push(() => window.removeEventListener("pagehide", close), () => document.removeEventListener("visibilitychange", hidden));
}

export async function teardownTransitions(): Promise<void> {
  running = false;
  lifetime++;
  roleRevision++;
  observedRole = "PLAYER";
  ready = false;
  epoch++;
  for (const unsub of unsubs.splice(0)) unsub();
  gate.clear();
  await closeDisplay();
  await Promise.all([...nativeWindows].map(closeNative));
  await OBR.popover.close(CONTROL_ID).catch(() => {});
  await removeOrphanScreenTransitions();
}
