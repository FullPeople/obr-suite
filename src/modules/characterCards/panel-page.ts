import OBR from "@owlbear-rodeo/sdk";
import { ICONS } from "../../icons";
import { applyI18nDom, t } from "../../i18n";
import { getLocalLang, onLangChange } from "../../state";
import { assetUrl } from "../../asset-base";
import { reconcileUploadedCardShieldState } from "./xlsx-shield-state";

let lang = getLocalLang();
const tt = (k: Parameters<typeof t>[1]) => t(lang, k);

// LOCAL broadcast: when the local-file refresh succeeds, every cc
// panel instance reloads the affected card iframe so other clients
// (DM + players) see the new content without re-uploading.
const BC_CARD_UPDATED = "com.obr-suite/cc-card-updated";

// Suite-namespaced popover ID so the standalone plugin's panel doesn't
// fight with us during dual-install. Scene-metadata keys (the bound card
// list, BIND_META) stay under the original com.character-cards/* namespace
// for backward compatibility.
// Switched from popover to modal so open/close is instant (no
// fade-in/out transition). Modal is fullScreen — no need for setWidth /
// setHeight, the iframe always covers the viewport.
const PANEL_MODAL_ID = "com.obr-suite/cc-panel";
// Shared open-state key — index.ts's toolbar tool reads it to decide
// open-vs-close. Cleared by every close path here (X / Esc / backdrop,
// plus pagehide/beforeunload for OBR's click-outside close). A
// synchronous localStorage write is reliable on unload; the async OBR
// broadcast this replaced was not — the "click-twice-to-reopen" bug.
const PANEL_OPEN_KEY = "com.obr-suite/cc-panel-open";
const API_BASE = "https://obr.dnd.center/api/character";
const SCENE_META_KEY = "com.character-cards/list";
const LS_PREFIX = "character-cards/";

const POPOVER_BOX = 64;

interface CardEntry {
  id: string;
  name: string;
  uploader: string;
  uploaded_at: string;
  url: string;
  /** Visibility (added 2026-05-03):
   *    - undefined / "public" → all clients see this card in the
   *      sidebar list (default).
   *    - "dm" → only the DM sees the card row. Other players don't
   *      get it in their list at all.
   *    - "owners" → DM + listed `owner_ids` see it. Useful for "this
   *      is player A's secret backup character — only A and the DM
   *      should see the card row".
   *  Soft hide: the data.json on the server isn't access-controlled
   *  (no auth layer), so a player who knows a card's URL could still
   *  open it directly. The toggle hides it from the in-app discovery
   *  flow, which covers the "DM doesn't want NPC cards in players'
   *  sidebars" use case. */
  visibility?: "public" | "dm" | "owners";
  owner_ids?: string[];
}

function canSeeCard(card: CardEntry, isGM: boolean, playerId: string): boolean {
  if (isGM) return true;
  const v = card.visibility ?? "public";
  if (v === "public") return true;
  if (v === "owners") return Array.isArray(card.owner_ids) && card.owner_ids.includes(playerId);
  return false;  // "dm" or unknown
}

function nextVisibilityLevel(v: CardEntry["visibility"]): CardEntry["visibility"] {
  // Cycle: public → dm → public.
  // (owners level is set via the owner-picker dialog; the cycle button
  // skips it to keep the one-click flow simple.)
  if (v === "dm") return "public";
  return "dm";
}

interface ResourceDef {
  slug: string;
  label: string;
  icon: string;
  url: string;
}

// 2026-05-14 — removed 不全书 (5echm.kagangtuya.top) per user request.
// Previous removal in this round dropped 5etool (5e.kiwee.top) for V8
// heap reasons; now the entire book/resource column is retired. The
// array is kept (empty) so the column wiring can re-host a future
// resource without touching the render pipeline. buildResourceColumn
// detects empty RESOURCES and hides the column entirely.
const RESOURCES: ResourceDef[] = [];

type View =
  | { type: "empty" }
  | { type: "card"; id: string }
  | { type: "resource"; slug: string };

let roomId = "";
let playerName = "anonymous";
let myPlayerId = "";
let isGM = false;
let profileReady = false;
let profileRequest = 0;
let panelAlive = true;
let panelClosing = false;
let sceneReady: boolean | undefined;
let sceneEpoch = 0;
let readinessRequest = 0;
let metadataRequest = 0;
let metadataLoaded = false;
let cardReadRetry: (() => Promise<void>) | undefined;
const panelSubscriptions: (() => void)[] = [];
interface PanelWrite {
  epoch: number;
  room: string;
  player: string;
  gm: boolean;
  cardId?: string;
  kind: "upload" | "refresh" | "delete" | "visibility";
  controller: AbortController;
  metadataDispatched: boolean;
  uploading: boolean;
}
const panelWrites = new Set<PanelWrite>();
let metadataWriteQueue: Promise<unknown> = Promise.resolve();
let cards: CardEntry[] = [];
let current: View = { type: "empty" };
let maximized = false;
const cardIframes = new Map<string, HTMLIFrameElement>();
const resourceIframes = new Map<string, HTMLIFrameElement>();

const viewer = document.getElementById("viewer") as HTMLDivElement;
const listEl = document.getElementById("list") as HTMLDivElement;
const errEl = document.getElementById("error") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const resCol = document.getElementById("resCol") as HTMLElement;
const emptyText = document.getElementById("emptyText") as HTMLDivElement;
// miniBtn removed in v1.1 — the cluster's "角色卡界面" button is the
// only way to open this panel.
const closeBtn = document.getElementById("closeBtn") as HTMLButtonElement;
// "About" button removed — suite's About panel covers it.
// "弹窗" toggle moved to the floating controls popover next to the main button.

function safeRoomId(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "default";
}

function stateKey(): string {
  return `${LS_PREFIX}state/${roomId}`;
}

function saveState() {
  try {
    let scrollY = 0;
    let activeCardId: string | null = null;
    let activeResource: string | null = null;
    if (current.type === "card") {
      activeCardId = current.id;
      const f = cardIframes.get(current.id);
      try { scrollY = f?.contentWindow?.scrollY || 0; } catch {}
    } else if (current.type === "resource") {
      activeResource = current.slug;
    }
    localStorage.setItem(stateKey(), JSON.stringify({ activeCardId, activeResource, scrollY, maximized }));
  } catch {}
}

function loadState(): { activeCardId: string | null; activeResource: string | null; scrollY: number; maximized: boolean } {
  try {
    const raw = localStorage.getItem(stateKey());
    if (raw) {
      const o = JSON.parse(raw);
      return {
        activeCardId: o.activeCardId ?? null,
        activeResource: o.activeResource ?? null,
        scrollY: o.scrollY ?? 0,
        maximized: !!o.maximized,
      };
    }
  } catch {}
  return { activeCardId: null, activeResource: null, scrollY: 0, maximized: false };
}

async function setMaximized(next: boolean) {
  maximized = next;
  document.body.classList.toggle("maximized", next);
  try {
    if (next) {
      // Modal is fullScreen — no setWidth/setHeight needed.
    } else {
      // The blue circular floating button was removed — there's no longer
      // a minimized state. Close the modal entirely; the user re-opens via
      // the cluster's "角色卡界面" button.
      saveState();
      // Clear the shared open-state key so index.ts's toolbar tool
      // sees the panel as closed. A synchronous localStorage write is
      // reliable on every close path; the async OBR broadcast this
      // replaced got killed mid-unload on the click-outside path —
      // the root of the click-twice-to-reopen bug.
      try { localStorage.removeItem(PANEL_OPEN_KEY); } catch {}
      await OBR.modal.close(PANEL_MODAL_ID);
      stopPanelReads();
      return;
    }
  } catch (e) {
    console.error("[character-cards] setMaximized failed", e);
    if (panelAlive && panelClosing) {
      panelClosing = false;
      maximized = true;
      document.body.classList.add("maximized");
      try { localStorage.setItem(PANEL_OPEN_KEY, "1"); } catch {}
      showError(tt("ccPanelCloseFailed"));
      render();
    }
  }
  saveState();
}

function showError(msg: string) {
  errEl.textContent = msg;
  // pre-line so the multi-line upload-failure hint (新行分隔) renders
  // with line breaks. textContent with default white-space:normal
  // collapses \n into spaces.
  errEl.style.whiteSpace = "pre-line";
  errEl.style.display = msg ? "block" : "none";
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showStatus(msg: string) {
  // Switched from textContent to innerHTML so SVG icons inside status
  // messages render. Callers must HTML-escape any untrusted text first.
  statusEl.innerHTML = msg;
  statusEl.style.display = msg ? "block" : "none";
  if (msg) setTimeout(() => { statusEl.style.display = "none"; }, 3000);
}

function minimize() {
  if (!panelAlive || panelClosing) return;
  panelClosing = true;
  cancelPanelWrites();
  render();
  saveState();
  setMaximized(false);
}

async function toggleCardVisibility(id: string) {
  const op = beginPanelWrite("visibility", id);
  if (!op) return;
  // Capture the intended destination, so a second local click or an intervening
  // update cannot turn a request to hide a card into a request to publish it.
  const visibility = nextVisibilityLevel(cards.find(c => c.id === id)?.visibility);
  try {
    await mutateCardsInScene(op, list => list.map(c => c.id === id ? { ...c, visibility } : c));
  } catch (error) { showWriteError(op, error); }
  finally { finishPanelWrite(op); }
}

function writeIsCurrent(op: PanelWrite, list = cards): boolean {
  if (!panelAlive || panelClosing || op.controller.signal.aborted || !profileReady || !metadataLoaded
      || sceneReady !== true || op.epoch !== sceneEpoch || op.room !== roomId
      || op.player !== myPlayerId || op.gm !== isGM) return false;
  if (op.kind === "visibility" && !isGM) return false;
  if (!op.cardId) return true;
  const card = list.find(c => c.id === op.cardId);
  return card ? canSeeCard(card, isGM, myPlayerId)
    : op.kind === "delete" && op.metadataDispatched;
}

function assertWriteCurrent(op: PanelWrite, list = cards): void {
  if (!writeIsCurrent(op, list)) throw new DOMException(tt("ccPanelWriteCancelled"), "AbortError");
}

function beginPanelWrite(kind: PanelWrite["kind"], cardId?: string): PanelWrite | undefined {
  const op: PanelWrite = { epoch: sceneEpoch, room: roomId, player: myPlayerId,
    gm: isGM, cardId, kind, controller: new AbortController(), metadataDispatched: false, uploading: false };
  if (!writeIsCurrent(op)) {
    if (panelAlive) showError(tt("ccPanelWriteUnavailable"));
    return;
  }
  // A file picker is part of the operation. Do not open another picker or
  // start a conflicting refresh/delete for that same card while it is pending.
  if ([...panelWrites].some(p => !p.controller.signal.aborted &&
      (cardId ? p.cardId === cardId : p.kind === "upload"))) return;
  panelWrites.add(op);
  render();
  return op;
}

function finishPanelWrite(op: PanelWrite): void {
  panelWrites.delete(op);
  render();
}

function cancelPanelWrites(resetQueue = false): void {
  for (const op of panelWrites) op.controller.abort();
  panelWrites.clear();
  // Keep same-scene writes serialized even if identity changes or closing
  // fails. Only a new scene/lifetime may bypass the old scene's pending ACK.
  if (resetQueue) metadataWriteQueue = Promise.resolve();
}

function showWriteError(op: PanelWrite, error: unknown, key: Parameters<typeof t>[1] = "ccPanelWriteFailed"): void {
  if (!writeIsCurrent(op)) return;
  showError(`${tt(key)}: ${error instanceof Error ? error.message : String(error)}`);
}

function cardList(meta: Record<string, unknown>): CardEntry[] {
  const list = meta[SCENE_META_KEY];
  return Array.isArray(list) ? list.filter((card): card is CardEntry =>
    !!card && typeof card === "object" && typeof card.id === "string") : [];
}

async function readWriteCards(op: PanelWrite): Promise<CardEntry[]> {
  assertWriteCurrent(op);
  const beforeRead = metadataRequest;
  const meta = await OBR.scene.getMetadata();
  assertWriteCurrent(op);
  // A complete event received during this read takes precedence over a
  // captured response. Check discovery permission against the latest list.
  if (beforeRead === metadataRequest) applyCardSnapshot(meta);
  const latest = cards;
  assertWriteCurrent(op, latest);
  return latest;
}

function mutateCardsInScene(op: PanelWrite, transform: (list: CardEntry[]) => CardEntry[]): Promise<void> {
  const run = async () => {
    const latest = await readWriteCards(op);
    assertWriteCurrent(op, latest);
    const next = transform(latest);
    const beforeWrite = metadataRequest;
    op.metadataDispatched = true;
    await OBR.scene.setMetadata({ [SCENE_META_KEY]: next });
    assertWriteCurrent(op);
    // The host may deliver events before acknowledging this write. Never put
    // an old proposal back over an event, especially after a scene change.
    if (beforeWrite === metadataRequest) applyCardSnapshot({ [SCENE_META_KEY]: next });
  };
  const result = metadataWriteQueue.then(run);
  metadataWriteQueue = result.catch(() => {});
  return result;
}

function broadcastCardUpdate(op: PanelWrite, card: CardEntry): void {
  if (!writeIsCurrent(op)) return;
  // The service entry URL can end in index.html. Derive the canonical data
  // address instead of concatenating onto that URL; full-sheet listeners
  // deliberately reject relative or unrelated data URLs.
  const payload = { cardId: card.id, roomId: op.room,
    url: `https://obr.dnd.center/characters/${encodeURIComponent(op.room)}/${encodeURIComponent(card.id)}/data.json` };
  for (const destination of ["LOCAL", "REMOTE"] as const) {
    void OBR.broadcast.sendMessage(BC_CARD_UPDATED, payload, { destination }).catch(() => {});
  }
}

function applyCardSnapshot(meta: Record<string, unknown>): void {
  if (!panelAlive || sceneReady === false) return;
  // Metadata events contain the complete current snapshot. Apply it now,
  // without a second read that could finish after a newer event.
  ++metadataRequest;
  cards = cardList(meta);
  metadataLoaded = true;
  for (const op of panelWrites) if (!writeIsCurrent(op)) op.controller.abort();
  if (cardReadRetry && (cardReadRetry !== readInitialSceneReadiness || sceneReady !== undefined)) {
    cardReadRetry = undefined;
    showError("");
  }
  render();
}

async function refreshFromScene(): Promise<void> {
  if (!panelAlive || sceneReady === false) return;
  const request = ++metadataRequest;
  const epoch = sceneEpoch;
  const valid = () => panelAlive && sceneReady !== false && epoch === sceneEpoch && request === metadataRequest;
  try {
    const meta = await OBR.scene.getMetadata();
    if (valid()) applyCardSnapshot(meta);
  } catch {
    if (!valid()) return;
    showCardReadError(refreshFromScene);
  }
}

function showCardReadError(action: () => Promise<void>): void {
  cardReadRetry = action;
  showError(tt("ccPanelLoadFailed"));
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "link-local-btn";
  retry.textContent = tt("ccPanelRetry");
  retry.addEventListener("click", () => { void action(); });
  errEl.append(" ", retry);
  render();
}

async function readInitialSceneReadiness(): Promise<void> {
  const request = ++readinessRequest;
  const epoch = sceneEpoch;
  const snapshot = metadataRequest;
  // A newer scene event or metadata snapshot takes precedence over this
  // initial query. A rejected query means unknown, not "scene closed".
  const sameScene = () => panelAlive && epoch === sceneEpoch && request === readinessRequest;
  const valid = () => sameScene() && snapshot === metadataRequest;
  try {
    const ready = await OBR.scene.isReady();
    if (valid()) changeSceneReadiness(ready, true);
    else if (sameScene() && sceneReady === undefined && metadataLoaded) {
      // Early metadata may already have restored a card before isReady replies.
      // Confirm this same scene without discarding its snapshot or iframe;
      // otherwise the read UI works but all write buttons stay disabled forever.
      if (ready) changeSceneReadiness(true, true);
      else showCardReadError(readInitialSceneReadiness);
    }
  } catch {
    if (valid() || (sameScene() && sceneReady === undefined)) showCardReadError(readInitialSceneReadiness);
  }
}

function changeSceneReadiness(ready: boolean, initial = false): void {
  if (!panelAlive) return;
  cancelPanelWrites(true);
  ++sceneEpoch;
  ++metadataRequest;
  sceneReady = ready;
  if (cardReadRetry) { cardReadRetry = undefined; showError(""); }
  if (initial && ready && metadataLoaded) {
    // The first ready event confirms a snapshot already received during
    // initialization. Keep that selection and its live iframe intact.
    render();
    return;
  }
  metadataLoaded = false;
  cards = [];
  if (!initial || !ready) current = { type: "empty" };
  for (const frame of cardIframes.values()) frame.remove();
  cardIframes.clear();
  render();
  if (ready) void refreshFromScene();
}

async function acceptUploadedCard(op: PanelWrite, entry: CardEntry): Promise<void> {
  assertWriteCurrent(op);
  await mutateCardsInScene(op, list => [entry, ...list.filter(c => c.id !== entry.id)]);
  assertWriteCurrent(op);
  // Another client may have removed or restricted the entry before our ACK.
  const installed = cards.find(c => c.id === entry.id);
  if (!installed || !canSeeCard(installed, isGM, myPlayerId)) return;
  broadcastCardUpdate(op, installed);
  current = { type: "card", id: installed.id };
  showStatus(`${ICONS.check} ${tt("ccPanelUploaded")}: ${escapeHtml(installed.name)}`);
  render();
}

async function uploadJsonAsCard(parsed: unknown, op: PanelWrite): Promise<void> {
  assertWriteCurrent(op);
  showError("");
  op.uploading = true;
  render();
  const u = encodeURIComponent(playerName);
  const response = await fetch(`${API_BASE}/create-from-json?room=${op.room}&uploader=${u}`, {
    method: "POST", signal: op.controller.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: parsed }),
  });
  assertWriteCurrent(op);
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
  const entry = await response.json() as CardEntry;
  await acceptUploadedCard(op, entry);
}

async function reconcileCardShield(op: PanelWrite, entry: CardEntry, file: File): Promise<void> {
  assertWriteCurrent(op);
  try {
    await reconcileUploadedCardShieldState({ apiBase: API_BASE, roomId: op.room,
      cardId: entry.id, xlsx: file, signal: op.controller.signal,
      isCurrent: () => writeIsCurrent(op) });
  } catch (error) {
    assertWriteCurrent(op);
    console.warn("[cc-panel] shield equipped reconciliation failed", error);
  }
  assertWriteCurrent(op);
}

async function uploadFile(file: File, op: PanelWrite): Promise<void> {
  assertWriteCurrent(op);
  showError("");
  op.uploading = true;
  render();
  const fd = new FormData();
  fd.append("file", file);
  const u = encodeURIComponent(playerName);
  const response = await fetch(`${API_BASE}/upload?room=${op.room}&uploader=${u}`, {
    method: "POST", body: fd, signal: op.controller.signal,
  });
  assertWriteCurrent(op);
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
  const entry = await response.json() as CardEntry;
  await reconcileCardShield(op, entry, file);
  await acceptUploadedCard(op, entry);
}

// Open a native file picker dialog. Returns the chosen File or null
// if the user cancelled. We DON'T use `showOpenFilePicker()` here —
// the File System Access API is blocked in cross-origin iframes
// (which is exactly what OBR plugin frames are), so an attempt
// throws SecurityError. Plain `<input type=file>` works everywhere.
function pickXlsxFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // 'cancel' fires on modern Chromium when the user closes the
    // picker without choosing. On older browsers we fall back to
    // never resolving — the input is GC'd when the user picks again
    // anyway. Either way, no leak.
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

// 2026-05-10: multi-file picker for bulk upload. Same SecurityError
// caveat as above (no FSA in iframes), so it's just a plain
// `<input type=file multiple>`.
function pickXlsxFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx";
    input.multiple = true;
    input.onchange = () => {
      const out = input.files ? Array.from(input.files) : [];
      resolve(out);
    };
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

// "Link a local xlsx" entry point. With FSA blocked, this just opens
// a regular file picker; the resulting card behaves identically to a
// drag-drop upload. The refresh button on each row uses the same
// picker on subsequent clicks so the user can re-pick the freshly
// edited xlsx without deleting + re-uploading the card.
//
// 2026-05-10: now multi-select capable — picking N files uploads each
// one sequentially, creating N new cards. UI stays responsive because
// each uploadFile() is awaited (the side-panel busy spinner stays up
// for the whole batch).
async function linkLocalFile(): Promise<void> {
  const op = beginPanelWrite("upload");
  if (!op) return;
  try {
    const files = await pickXlsxFiles();
    assertWriteCurrent(op);
    await uploadFilesBatch(files, op);
  } catch (error) { showWriteError(op, error, "ccPanelUploadFailed"); }
  finally { finishPanelWrite(op); }
}

// The entire batch belongs to its initiating scene, including the picker.
// Stop after any failed upload; a later file must not silently start in a new scene.
async function uploadFilesBatch(files: File[], op: PanelWrite): Promise<void> {
  for (const file of files) {
    assertWriteCurrent(op);
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      throw new Error(`${tt("ccPanelOnlyXlsx")}: ${file.name}`);
    }
    await uploadFile(file, op);
  }
}

async function refreshCardFromPicker(card: CardEntry): Promise<void> {
  const op = beginPanelWrite("refresh", card.id);
  if (!op) return;
  try {
    const file = await pickXlsxFile();
    assertWriteCurrent(op);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error(tt("ccPanelOnlyXlsx"));
    // Refresh overwrites server content. Re-read the target after the native
    // picker, before sending that request, even if its metadata event is late.
    await readWriteCards(op);
    assertWriteCurrent(op);
    const fd = new FormData();
    fd.append("file", file);
    const response = await fetch(
      `${API_BASE}/refresh?room=${op.room}&card=${encodeURIComponent(card.id)}`,
      { method: "POST", body: fd, signal: op.controller.signal },
    );
    assertWriteCurrent(op);
    if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
    const updated = await response.json() as CardEntry;
    assertWriteCurrent(op);
    if (updated.id !== card.id) throw new Error(tt("ccPanelWriteFailed"));
    await reconcileCardShield(op, updated, file);
    await mutateCardsInScene(op, list => list.map(c => c.id === card.id ? {
      ...c, name: updated.name, url: updated.url,
      uploader: updated.uploader, uploaded_at: updated.uploaded_at,
      // Visibility and owners belong to current scene metadata, not the service response.
    } : c));
    assertWriteCurrent(op);
    const installed = cards.find(c => c.id === card.id);
    if (!installed) return;
    const iframe = cardIframes.get(card.id);
    if (iframe) iframe.src = buildCardIframeSrc(installed, true);
    broadcastCardUpdate(op, installed);
    showStatus(`${ICONS.check} ${tt("ccPanelRefreshed")}: ${escapeHtml(installed.name)}`);
    render();
  } catch (error) { showWriteError(op, error, "ccPanelRefreshFailed"); }
  finally { finishPanelWrite(op); }
}

async function deleteCard(id: string) {
  const op = beginPanelWrite("delete", id);
  if (!op) return;
  try {
    await mutateCardsInScene(op, list => list.filter(c => c.id !== id));
    assertWriteCurrent(op);
    // Do not remove a server card that has been re-added while the ACK was pending.
    if ((await readWriteCards(op)).some(c => c.id === id)) return;
    assertWriteCurrent(op);
    const response = await fetch(`${API_BASE}/${encodeURIComponent(op.room)}/${encodeURIComponent(id)}`, {
      method: "DELETE", signal: op.controller.signal,
    });
    assertWriteCurrent(op);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) { showWriteError(op, error); }
  finally { finishPanelWrite(op); }
}

function selectCard(id: string) {
  current = { type: "card", id };
  render();
}

function selectResource(slug: string) {
  current = { type: "resource", slug };
  render();
}

/** Build the iframe src for a card. v2 (2026-05-03+) loads our own
 *  data-driven Preact renderer (cc-fullscreen.html) which fetches
 *  /characters/<room>/<card>/data.json directly. The legacy Jinja2-
 *  rendered index.html on the server is still served for backward
 *  compat (e.g. raw link sharing) but no longer embedded in the
 *  panel — that lets us iterate on layout / edit / export / import
 *  features without redeploying the server. */
function buildCardIframeSrc(card: CardEntry, cacheBust = false): string {
  const params = new URLSearchParams();
  params.set("room", roomId);
  params.set("card", card.id);
  if (cacheBust) params.set("t", String(Date.now()));
  return `${assetUrl("cc-fullscreen.html")}?${params.toString()}`;
}

function ensureCardIframe(card: CardEntry): HTMLIFrameElement {
  let f = cardIframes.get(card.id);
  if (!f) {
    f = document.createElement("iframe");
    f.src = buildCardIframeSrc(card);
    f.setAttribute("scrolling", "yes");
    f.dataset.kind = "card";
    f.dataset.id = card.id;
    f.style.display = "none";
    f.addEventListener("load", () => {
      try {
        const st = loadState();
        if (st.activeCardId === card.id && f!.contentWindow) {
          f!.contentWindow.scrollTo({ top: st.scrollY || 0 });
        }
      } catch {}
    });
    viewer.appendChild(f);
    cardIframes.set(card.id, f);
  }
  return f;
}

// Single-live-iframe policy for external resources.
// All 5e.kiwee.top iframes share one Chrome renderer process and a single
// V8 heap (~4GB ceiling). Keeping 6 heavy reference pages resident easily
// crashes that process. We only keep ONE resource iframe alive at a time —
// switching tabs unloads the previous one. Angular state loss on switch is
// an acceptable trade-off vs. crashing the whole app.
function ensureResourceIframe(def: ResourceDef): HTMLIFrameElement {
  // Unload every other resource iframe.
  for (const [slug, f] of resourceIframes) {
    if (slug !== def.slug) {
      f.remove();
      resourceIframes.delete(slug);
    }
  }
  let f = resourceIframes.get(def.slug);
  if (!f) {
    f = document.createElement("iframe");
    f.src = def.url;
    f.setAttribute("scrolling", "yes");
    f.dataset.kind = "resource";
    f.dataset.slug = def.slug;
    f.style.display = "none";
    viewer.appendChild(f);
    resourceIframes.set(def.slug, f);
  }
  return f;
}

function render() {
  if (!panelAlive) return;
  const activeWrites = [...panelWrites].filter(op => !op.controller.signal.aborted);
  const canWrite = !panelClosing && profileReady && metadataLoaded && sceneReady === true;
  const uploading = activeWrites.some(op => op.kind === "upload");
  document.getElementById("side")?.classList.toggle("busy", activeWrites.some(op => op.uploading));
  for (const id of ["btnLinkLocal", "btnPasteJson"]) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button) button.disabled = !canWrite || uploading;
  }
  // Sidebar list — filter by visibility per requestor's role + id.
  // DM sees everything; players only see public + (owners they're in).
  const visibleCards = profileReady ? cards.filter((c) => canSeeCard(c, isGM, myPlayerId)) : [];
  const visibleIds = new Set(visibleCards.map((card) => card.id));
  // A revoked/deleted card must stop running, including while another card
  // is selected. Merely hiding its iframe leaves its subscriptions alive.
  for (const [id, frame] of cardIframes) {
    if (!visibleIds.has(id)) { frame.remove(); cardIframes.delete(id); }
  }
  // If the currently-active card was hidden by the DM and we're a
  // player, drop the view back to empty so the iframe doesn't keep
  // a stale reference visible.
  if (current.type === "card" && profileReady && metadataLoaded) {
    const currentId = current.id;
    if (!visibleCards.find((c) => c.id === currentId)) {
      current = { type: "empty" };
    }
  }
  listEl.innerHTML = "";
  if (visibleCards.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = sceneReady === false ? tt("ccPanelOpenScene")
      : cardReadRetry ? "" : !profileReady || !metadataLoaded ? tt("ccPanelLoading") : tt("ccPanelEmpty3");
    empty.style.whiteSpace = "pre-line";
    listEl.appendChild(empty);
  } else {
    for (const c of visibleCards) {
      const card = document.createElement("div");
      const isActive = current.type === "card" && current.id === c.id;
      const v = c.visibility ?? "public";
      const isHidden = v !== "public";  // DM-only flag for visual dim
      card.className = "card" + (isActive ? " active" : "") + (isHidden ? " is-hidden" : "");
      card.dataset.id = c.id;
      const changing = activeWrites.some(op => op.cardId === c.id);
      card.addEventListener("click", () => selectCard(c.id));

      const name = document.createElement("div");
      name.className = "card-name";
      // Lock prefix on hidden cards so DM can spot them at a glance.
      name.textContent = (isHidden ? "🔒 " : "") + c.name;
      const sub = document.createElement("div");
      sub.className = "card-sub";
      const visLabel = isHidden
        ? tt(v === "dm" ? "ccPanelVisibilityDm" : "ccPanelVisibilityOwners")
        : "";
      sub.textContent = `${c.uploader} · ${timeAgo(c.uploaded_at)}` + (visLabel ? ` · ${visLabel}` : "");

      // 👁 / 🔒 visibility toggle — DM only. Cycles public ↔ dm.
      // owners-mode (specific player allowlist) is set via a separate
      // dialog; the cycle button keeps the one-click flow simple.
      if (isGM) {
        const visBtn = document.createElement("button");
        visBtn.className = "card-vis";
        visBtn.disabled = !canWrite || changing;
        visBtn.textContent = isHidden ? "🔒" : "👁";
        visBtn.title = nextVisibilityLevel(v) === "public"
          ? `${visLabel} — ${tt("ccPanelMakePublic")}`
          : `${visLabel || tt("ccPanelVisibilityPublic")} — ${tt("ccPanelMakePrivate")}`;
        visBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await toggleCardVisibility(c.id);
        });
        card.appendChild(visBtn);
      }

      // ↻ refresh — every card row has one. Clicking opens a file
      // picker so the user can re-pick the (possibly newly-saved)
      // xlsx; the server overwrites the existing card's data.
      const refresh = document.createElement("button");
      refresh.className = "card-refresh";
      refresh.disabled = !canWrite || changing;
      refresh.classList.toggle("spinning", activeWrites.some(op => op.kind === "refresh" && op.cardId === c.id));
      refresh.textContent = "↻";
      refresh.title = tt("ccPanelRefreshTitle");
      refresh.addEventListener("click", async (e) => {
        e.stopPropagation();
        await refreshCardFromPicker(c);
      });
      card.appendChild(refresh);

      const del = document.createElement("button");
      del.className = "card-del";
      del.disabled = !canWrite || changing;
      del.textContent = "×";
      del.title = tt("ccPanelDeleteTitle");
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        const promptText = lang === "zh" ? `删除 "${c.name}"？` : `Delete "${c.name}"?`;
        if (confirm(promptText)) await deleteCard(c.id);
      });

      card.appendChild(name);
      card.appendChild(sub);
      card.appendChild(del);
      listEl.appendChild(card);
    }
  }

  // Resource tabs — active state
  const curView = current;
  for (const btn of resCol.querySelectorAll<HTMLButtonElement>(".res-tab")) {
    const slug = btn.dataset.slug!;
    btn.classList.toggle("active", curView.type === "resource" && curView.slug === slug);
  }

  // Viewer: ensure the target iframe exists, then toggle visibility
  if (curView.type === "card") {
    const c = visibleCards.find((x) => x.id === curView.id);
    if (c) ensureCardIframe(c);
  } else if (curView.type === "resource") {
    const def = RESOURCES.find((r) => r.slug === curView.slug);
    if (def) ensureResourceIframe(def);
  }

  // Hide every iframe except the active one
  viewer.querySelectorAll<HTMLIFrameElement>("iframe").forEach((f) => {
    let show = false;
    if (curView.type === "card" && f.dataset.kind === "card" && f.dataset.id === curView.id) show = true;
    if (curView.type === "resource" && f.dataset.kind === "resource" && f.dataset.slug === curView.slug) show = true;
    f.style.display = show ? "block" : "none";
  });

  const hasContent = current.type === "card" ? visibleIds.has(current.id) : current.type !== "empty";
  viewer.classList.toggle("is-empty", !hasContent);
  viewer.classList.toggle("has-content", hasContent);
  if (!hasContent) {
    emptyText.textContent = sceneReady === false ? tt("ccPanelOpenScene")
      : cardReadRetry ? tt("ccPanelLoadFailed") : !profileReady || !metadataLoaded ? tt("ccPanelLoading")
        : visibleCards.length > 0 ? tt("ccPanelEmpty") : tt("ccPanelNoCards");
  }
}

function buildResourceColumn() {
  resCol.innerHTML = "";
  // 2026-05-14 — empty resource list collapses the column entirely so
  // there's no zero-width sliver next to the card list.
  if (RESOURCES.length === 0) {
    resCol.style.display = "none";
    return;
  }
  for (const r of RESOURCES) {
    const btn = document.createElement("button");
    btn.className = "res-tab";
    btn.dataset.slug = r.slug;
    btn.title = r.label;
    btn.innerHTML = `<span class="ico">${r.icon}</span><span class="lbl">${r.label}</span>`;
    btn.addEventListener("click", () => selectResource(r.slug));
    resCol.appendChild(btn);
  }
  resCol.style.display = "flex";
}

function timeAgo(isoZ: string): string {
  try {
    const ts = new Date(isoZ).getTime();
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return tt("ccPanelJustNow");
    if (lang === "zh") {
      if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
      return `${Math.floor(diff / 86400)}天前`;
    }
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
    return `${Math.floor(diff / 86400)} d ago`;
  } catch { return ""; }
}

// The example opens a read-only preview. Pasted JSON uses the separate
// creation dialog below and persists only after its explicit Create action.
const PREVIEW_MODAL_ID = "com.obr-suite/cc-preview";
const PREVIEW_LS_KEY = "obr-suite/cc-preview-payload";

function setPreviewPayload(kind: "sample" | "paste", json: unknown): void {
  try {
    localStorage.setItem(PREVIEW_LS_KEY, JSON.stringify({ kind, json, ts: Date.now() }));
  } catch (e) {
    console.warn("[cc-panel/preview] localStorage write failed", e);
  }
}

async function openPreviewModal(kind: "sample" | "paste"): Promise<void> {
  const url = `${assetUrl("cc-fullscreen.html")}?preview=${kind}`;
  try {
    await OBR.modal.open({
      id: PREVIEW_MODAL_ID,
      url,
      width: Math.min(1080, Math.floor(window.innerWidth * 0.92)),
      height: Math.floor(window.innerHeight * 0.86),
    });
  } catch (e) {
    console.warn("[cc-panel/preview] modal open failed", e);
  }
}

async function openSamplePreview(): Promise<void> {
  // 2026-05-26 — fetch the language-matched example. There's a
  // dedicated EN translation (cc-example-card.en.json) since the
  // schema-0.3 card body is heavy with Chinese D&D terminology
  // (skill / weapon / class-feature / spell-description names) that
  // wouldn't be useful to non-Chinese DMs as a reference. ZH UI gets
  // 本杰明 (Sorcerer / Wild Magic); EN UI gets Benjamin Flamingo
  // with all the canonical 5E translations applied.
  const file = lang === "en" ? "cc-example-card.en.json" : "cc-example-card.json";
  try {
    const res = await fetch(assetUrl(file), { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    setPreviewPayload("sample", json);
    await openPreviewModal("sample");
  } catch (e: any) {
    showError(`${tt("ccPasteJsonInvalid")}: ${e?.message ?? e}`);
  }
}

function openPasteJsonPreview(): void {
  const existing = document.getElementById("ccPasteOverlay");
  if (existing) { existing.querySelector("textarea")?.focus(); return; }
  const openedInScene = sceneEpoch;
  const openedBy = myPlayerId;
  const openedAsGM = isGM;
  let pending: PanelWrite | undefined;
  const overlay = document.createElement("div");
  overlay.id = "ccPasteOverlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(8,10,14,0.78);" +
    "display:flex;align-items:center;justify-content:center;padding:20px";
  const panel = document.createElement("div");
  panel.style.cssText =
    "background:#161922;border:1px solid rgba(255,255,255,0.15);border-radius:10px;" +
    "padding:16px 18px;max-width:680px;width:100%;max-height:80vh;display:flex;" +
    "flex-direction:column;gap:10px;color:#e6e8ee;font-family:inherit;font-size:13px";
  const title = document.createElement("div");
  title.style.cssText = "font-size:14px;font-weight:600;color:#fff";
  title.textContent = tt("ccPasteJsonModalTitle");
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:11.5px;color:#9aa0b3;line-height:1.55";
  hint.textContent = tt("ccPasteJsonHint");
  const ta = document.createElement("textarea");
  ta.style.cssText =
    "flex:1 1 auto;min-height:280px;padding:9px 11px;border-radius:7px;" +
    "background:#0d1018;border:1px solid rgba(255,255,255,0.12);color:#e6e8ee;" +
    "font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;resize:vertical";
  ta.placeholder = "{ \"schema_version\": \"0.3\", \"identity\": { ... }, \"abilities\": { ... }, ... }";
  const errBox = document.createElement("div");
  errBox.style.cssText = "font-size:12px;color:#e74c3c;min-height:18px";
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
  const btnCancel = document.createElement("button");
  btnCancel.type = "button";
  btnCancel.textContent = tt("ccPasteJsonCancel");
  btnCancel.style.cssText =
    "padding:7px 14px;border-radius:6px;background:#262a38;color:#cfd3df;" +
    "border:1px solid rgba(255,255,255,0.12);font-size:13px;cursor:pointer";
  const btnApply = document.createElement("button");
  btnApply.type = "button";
  btnApply.textContent = tt("ccPasteJsonApply");
  btnApply.style.cssText =
    "padding:7px 14px;border-radius:6px;background:linear-gradient(180deg,#5dade2,#3b8fc5);" +
    "color:#fff;border:none;font-size:13px;font-weight:600;cursor:pointer";
  const close = () => {
    pending?.controller.abort();
    if (pending) finishPanelWrite(pending);
    overlay.remove();
    document.removeEventListener("keydown", onEsc);
    window.removeEventListener("pagehide", close);
    window.removeEventListener("beforeunload", close);
  };
  btnCancel.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  function onEsc(e: KeyboardEvent) {
    if (e.key === "Escape" && document.body.contains(overlay)) {
      e.preventDefault();
      close();
    }
  }
  document.addEventListener("keydown", onEsc);
  window.addEventListener("pagehide", close);
  window.addEventListener("beforeunload", close);
  btnApply.addEventListener("click", async () => {
    errBox.textContent = "";
    if (openedInScene !== sceneEpoch || openedBy !== myPlayerId || openedAsGM !== isGM) {
      errBox.textContent = tt("ccPanelWriteCancelled");
      return;
    }
    const raw = ta.value.trim();
    if (!raw) { errBox.textContent = tt("ccPasteJsonInvalid"); return; }
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch (e: any) {
      errBox.textContent = `${tt("ccPasteJsonInvalid")}: ${e?.message ?? e}`;
      return;
    }
    if (!parsed || typeof parsed !== "object" ||
        !("abilities" in parsed || "identity" in parsed)) {
      errBox.textContent = tt("ccPasteJsonInvalid");
      return;
    }
    // 2026-05-26 — POST to /create-from-json (server endpoint added
    // the same day). Mirrors the xlsx upload flow: server allocates a
    // cardId, writes data.json, broadcasts card-list refresh via
    // scene-metadata write. The new card appears in the panel like
    // any other card. Errors stay in errBox so the user can fix the
    // payload without losing what they pasted.
    btnApply.disabled = true;
    btnApply.textContent = tt("ccPasteJsonApplying");
    const op = beginPanelWrite("upload");
    if (!op) {
      btnApply.disabled = false;
      btnApply.textContent = tt("ccPasteJsonApply");
      return;
    }
    pending = op;
    try {
      await uploadJsonAsCard(parsed, op);
      close();
    } catch (e: any) {
      if (panelAlive && overlay.isConnected) errBox.textContent = writeIsCurrent(op)
        ? `${tt("ccPanelUploadFailed")}: ${e?.message || e}` : tt("ccPanelWriteCancelled");
    } finally {
      finishPanelWrite(op);
      pending = undefined;
      btnApply.disabled = false;
      btnApply.textContent = tt("ccPasteJsonApply");
    }
  });
  btnRow.append(btnCancel, btnApply);
  panel.append(title, hint, ta, errBox, btnRow);
  overlay.append(panel);
  document.body.append(overlay);
  setTimeout(() => { ta.focus(); }, 50);
}

// --- setup ---
panelSubscriptions.push(onLangChange((next) => {
  if (!panelAlive) return;
  lang = next;
  applyI18nDom(lang);
  if (cardReadRetry) showCardReadError(cardReadRetry);
  render();
}));

OBR.onReady(() => {
  if (!panelAlive) return;
  applyI18nDom(lang);
  roomId = safeRoomId(OBR.room.id || "default");
  // Watch for role / id changes (rare, but happens after disconnect-
  // reconnect or if the DM passes ownership). Re-render the list so
  // the visibility filter follows.
  panelSubscriptions.push(OBR.player.onChange((p) => {
    if (!panelAlive) return;
    if ((p.role === "GM") !== isGM || (p.id || "") !== myPlayerId) cancelPanelWrites();
    ++profileRequest;
    isGM = p.role === "GM";
    myPlayerId = p.id || "";
    playerName = p.name || "anonymous";
    profileReady = true;
    render();
  }));
  // Resource column is visible to ALL players now (not just GM) — with only
  // 不全书 in the list it's lightweight enough to share. Pre-warm it so the
  // page is ready the moment anyone clicks the tab.
  buildResourceColumn();
  for (const r of RESOURCES) ensureResourceIframe(r);

  // Restore previous state (kept from prior popover lifetime).
  // Only restore a resource slug if it still exists in RESOURCES (handles
  // legacy saved slugs like "spells" from before we removed 5etool pages).
  const saved = loadState();
  if (saved.activeResource && RESOURCES.some((r) => r.slug === saved.activeResource)) {
    current = { type: "resource", slug: saved.activeResource };
  } else if (saved.activeCardId) {
    current = { type: "card", id: saved.activeCardId };
  }
  // The popover opens already maximized (full viewport) from the cluster's
  // "角色卡界面" button. The blue circular mini-btn was removed.
  maximized = true;
  document.body.classList.add("maximized");
  // miniBtn is hidden via CSS — no listener needed.

  // Re-trigger maximize on broadcast (idempotent — useful if the user opens
  // the panel again while it's already alive somehow).
  panelSubscriptions.push(OBR.broadcast.onMessage("com.character-cards/panel-open", () => {
    if (panelAlive) void setMaximized(true);
  }));

  // Drag-drop on the right sidebar ONLY
  const sideEl = document.getElementById("side") as HTMLElement;

  sideEl.addEventListener("dragenter", (e) => {
    e.preventDefault();
    sideEl.classList.add("drag-over");
  });
  sideEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    sideEl.classList.add("drag-over");
  });
  sideEl.addEventListener("dragleave", (e) => {
    if (e.relatedTarget && sideEl.contains(e.relatedTarget as Node)) return;
    sideEl.classList.remove("drag-over");
  });
  sideEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    sideEl.classList.remove("drag-over");
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length === 0) return;
    const op = beginPanelWrite("upload");
    if (!op) return;
    try { await uploadFilesBatch(files, op); }
    catch (error) { showWriteError(op, error, "ccPanelUploadFailed"); }
    finally { finishPanelWrite(op); }
  });

  document.addEventListener("dragover", (e) => { e.preventDefault(); });
  document.addEventListener("drop", (e) => { e.preventDefault(); });

  // 📁 选择文件 button — alternate upload path for users who don't
  // want to drag. Shown on every browser (uses plain `<input type=file>`,
  // not the FSA picker which is blocked in cross-origin iframes).
  const linkBtn = document.getElementById("btnLinkLocal") as HTMLButtonElement | null;
  if (linkBtn) {
    linkBtn.style.display = "";
    linkBtn.addEventListener("click", () => { void linkLocalFile(); });
  }
  // 2026-05-26 — preview entry points (see openSamplePreview /
  // openPasteJsonPreview above). Both open cc-fullscreen.html in an
  // OBR modal with ?preview=…; nothing persists to the server.
  const sampleBtn = document.getElementById("btnViewSample") as HTMLButtonElement | null;
  sampleBtn?.addEventListener("click", () => { void openSamplePreview(); });
  const pasteBtn = document.getElementById("btnPasteJson") as HTMLButtonElement | null;
  pasteBtn?.addEventListener("click", () => { openPasteJsonPreview(); });

  // Listen for refresh broadcasts from other clients. When the DM (or
  // any other player) refreshes a linked card, we just bump our own
  // iframe's src with a cache-buster so the new index.html is fetched.
  panelSubscriptions.push(OBR.broadcast.onMessage(BC_CARD_UPDATED, (event) => {
    if (!panelAlive) return;
    const data = event.data as { cardId?: string; roomId?: string; url?: string } | undefined;
    if (!data?.cardId || (data.roomId !== undefined && data.roomId !== roomId)) return;
    const iframe = cardIframes.get(data.cardId);
    const card = cards.find((c) => c.id === data.cardId);
    if (iframe && card) {
      iframe.src = buildCardIframeSrc(card, true);
    }
  }));

  // Close via X button in the sidebar header, Esc, or clicking backdrop.
  closeBtn?.addEventListener("click", minimize);

  // About handler removed — centralized in suite About panel.

  // The "弹窗" toggle now lives in the floating controls popover sitting
  // to the left of the main 角色卡 button. localStorage key + broadcast id
  // are unchanged (character-cards/auto-info, com.character-cards/auto-info-toggled),
  // so background.ts picks up changes the same way.

  document.addEventListener("keydown", (e) => {
    if (!maximized) return;
    if (e.key === "Escape") {
      if (document.getElementById("ccPasteOverlay")) return;
      e.preventDefault();
      minimize();
      return;
    }
    // CapsLock from inside the panel closes it (mirror of the OBR
    // tool-action shortcut, which doesn't fire while focus is in our
    // iframe). The bestiary uses Shift+A from-inside.
    if (e.key === "CapsLock") {
      e.preventDefault();
      try {
        OBR.broadcast.sendMessage(
          "com.obr-suite/cc-shortcut-toggle",
          {},
          { destination: "LOCAL" }
        );
      } catch {}
    }
  });

  // Click on backdrop (transparent area) to minimize
  document.body.addEventListener("click", (e) => {
    if (maximized && e.target === document.body) minimize();
  });

  // Periodic save while open
  const saveInterval = setInterval(saveState, 5000);
  // Clear the shared open-state key on EVERY unload path. OBR's
  // click-outside modal close removes this iframe — that fires
  // pagehide (reliable for iframe removal) and usually beforeunload;
  // a synchronous localStorage write lands in both. Replaces an async
  // OBR broadcast that did NOT reliably land mid-unload — the cause
  // of the click-twice-to-reopen bug.
  const onPanelUnload = () => {
    clearInterval(saveInterval);
    saveState();
    try { localStorage.removeItem(PANEL_OPEN_KEY); } catch {}
  };
  window.addEventListener("pagehide", onPanelUnload);
  window.addEventListener("beforeunload", onPanelUnload);

  // Subscribe before the initial reads so role/scene events can invalidate
  // them even while one host request is slow.
  panelSubscriptions.push(OBR.scene.onMetadataChange(applyCardSnapshot));
  panelSubscriptions.push(OBR.scene.onReadyChange((ready) => changeSceneReadiness(ready, sceneReady === undefined)));
  const profile = ++profileRequest;
  void Promise.allSettled([OBR.player.getName(), OBR.player.getId(), OBR.player.getRole()]).then(([name, id, role]) => {
    if (!panelAlive || profile !== profileRequest) return;
    playerName = name.status === "fulfilled" ? name.value || "anonymous" : "anonymous";
    myPlayerId = id.status === "fulfilled" ? id.value : "";
    isGM = role.status === "fulfilled" && role.value === "GM";
    profileReady = true;
    render();
  });
  render();
  void readInitialSceneReadiness();
});

function stopPanelReads(): void {
  panelAlive = false;
  cancelPanelWrites(true);
  ++profileRequest;
  ++readinessRequest;
  ++metadataRequest;
  ++sceneEpoch;
  for (const unsubscribe of panelSubscriptions.splice(0)) {
    try { unsubscribe(); } catch {}
  }
}
window.addEventListener("pagehide", stopPanelReads);
window.addEventListener("beforeunload", stopPanelReads);
