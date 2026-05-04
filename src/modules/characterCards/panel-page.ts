import OBR from "@owlbear-rodeo/sdk";
import { ICONS } from "../../icons";
import { applyI18nDom, t } from "../../i18n";
import { getLocalLang, onLangChange } from "../../state";
import { assetUrl } from "../../asset-base";

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

// Only 不全书 remains. Previously also had 5etool (5e.kiwee.top) pages —
// they shared a single renderer process whose V8 heap blew past the ~4GB
// ceiling and crashed the tab. Removed. 不全书 is a lighter site and safe
// to keep resident for all players.
const RESOURCES: ResourceDef[] = [
  { slug: "bqs", label: "不全书", icon: ICONS.book, url: "https://5echm.kagangtuya.top/" },
];

type View =
  | { type: "empty" }
  | { type: "card"; id: string }
  | { type: "resource"; slug: string };

let roomId = "";
let playerName = "anonymous";
let myPlayerId = "";
let isGM = false;
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
      // Tell index.ts the panel just closed so its cached `panelOpen`
      // flag stays in sync. Without this notification the next
      // cluster-button click runs a closeMainPopover() against an
      // already-closed modal (no-op), and the user has to click a
      // SECOND time to reopen.
      try {
        OBR.broadcast.sendMessage(
          "com.obr-suite/cc-panel-closed",
          {},
          { destination: "LOCAL" },
        );
      } catch {}
      await OBR.modal.close(PANEL_MODAL_ID);
      return;
    }
  } catch (e) {
    console.error("[character-cards] setMaximized failed", e);
  }
  saveState();
}

function showError(msg: string) {
  errEl.textContent = msg;
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
  saveState();
  setMaximized(false);
}

async function toggleCardVisibility(id: string) {
  if (!isGM) return;
  const next = cards.map((c) => {
    if (c.id !== id) return c;
    return { ...c, visibility: nextVisibilityLevel(c.visibility) };
  });
  cards = next;
  await writeCardsToScene(next);
  render();
}

async function readCardsFromScene(): Promise<CardEntry[]> {
  try {
    const meta = await OBR.scene.getMetadata();
    const list = meta[SCENE_META_KEY];
    if (Array.isArray(list)) return list as CardEntry[];
  } catch {}
  return [];
}

async function writeCardsToScene(list: CardEntry[]) {
  await OBR.scene.setMetadata({ [SCENE_META_KEY]: list });
}

async function refreshFromScene() {
  cards = await readCardsFromScene();
  // Clean up iframes for cards no longer in scene
  for (const [id, frame] of cardIframes) {
    if (!cards.find((c) => c.id === id)) {
      frame.remove();
      cardIframes.delete(id);
    }
  }
  // If current card was deleted, fall back to empty
  if (current.type === "card") {
    const curId = current.id;
    if (!cards.find((c) => c.id === curId)) current = { type: "empty" };
  }
  render();
}

async function uploadFile(file: File) {
  showError("");
  const sideEl = document.getElementById("side");
  sideEl?.classList.add("busy");
  try {
    const fd = new FormData();
    fd.append("file", file);
    const u = encodeURIComponent(playerName);
    const r = await fetch(`${API_BASE}/upload?room=${roomId}&uploader=${u}`, {
      method: "POST",
      body: fd,
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error(err || `HTTP ${r.status}`);
    }
    const entry = (await r.json()) as CardEntry;
    const updated = [entry, ...cards];
    await writeCardsToScene(updated);
    cards = updated;
    current = { type: "card", id: entry.id };
    showStatus(`${ICONS.check} ${tt("ccPanelUploaded")}: ${escapeHtml(entry.name)}`);
    render();
  } catch (e: any) {
    showError(`${tt("ccPanelUploadFailed")}: ${e?.message || e}`);
  } finally {
    sideEl?.classList.remove("busy");
  }
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

// "Link a local xlsx" entry point. With FSA blocked, this just opens
// a regular file picker; the resulting card behaves identically to a
// drag-drop upload. The refresh button on each row uses the same
// picker on subsequent clicks so the user can re-pick the freshly
// edited xlsx without deleting + re-uploading the card.
async function linkLocalFile(): Promise<void> {
  const f = await pickXlsxFile();
  if (!f) return;
  await uploadFile(f);
}

// Refresh a card by re-picking the xlsx from disk. Cross-origin
// iframes can't persist a FileSystemFileHandle, so the user has to
// confirm the file each time — but the browser remembers the last
// folder, so it's still a 2-click flow (pick + open).
async function refreshCardFromPicker(card: CardEntry): Promise<void> {
  const file = await pickXlsxFile();
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    showError(tt("ccPanelOnlyXlsx"));
    return;
  }
  const row = document.querySelector<HTMLElement>(`.card[data-id="${card.id}"]`);
  const btn = row?.querySelector<HTMLButtonElement>(".card-refresh");
  btn?.classList.add("spinning");
  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(
      `${API_BASE}/refresh?room=${roomId}&card=${encodeURIComponent(card.id)}`,
      { method: "POST", body: fd },
    );
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    const updated = (await r.json()) as CardEntry;
    cards = cards.map((c) => (c.id === updated.id ? { ...c, ...updated } : c));
    await writeCardsToScene(cards);
    const iframe = cardIframes.get(card.id);
    if (iframe) {
      iframe.src = buildCardIframeSrc(card, true);
    }
    try {
      OBR.broadcast.sendMessage(
        BC_CARD_UPDATED,
        { cardId: card.id, url: updated.url },
        { destination: "REMOTE" },
      );
    } catch {}
    showStatus(`${ICONS.check} ${tt("ccPanelRefreshed")}: ${escapeHtml(updated.name)}`);
    render();
  } catch (e: any) {
    showError(`${tt("ccPanelRefreshFailed")}: ${e?.message || e}`);
  } finally {
    btn?.classList.remove("spinning");
  }
}

async function deleteCard(id: string) {
  const updated = cards.filter((c) => c.id !== id);
  await writeCardsToScene(updated);
  cards = updated;
  const f = cardIframes.get(id);
  if (f) { f.remove(); cardIframes.delete(id); }
  if (current.type === "card" && current.id === id) current = { type: "empty" };
  render();
  try { await fetch(`${API_BASE}/${roomId}/${id}`, { method: "DELETE" }); } catch {}
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
  // Sidebar list — filter by visibility per requestor's role + id.
  // DM sees everything; players only see public + (owners they're in).
  const visibleCards = cards.filter((c) => canSeeCard(c, isGM, myPlayerId));
  // If the currently-active card was hidden by the DM and we're a
  // player, drop the view back to empty so the iframe doesn't keep
  // a stale reference visible.
  if (current.type === "card" && !visibleCards.find((c) => c.id === current.id)) {
    current = { type: "empty" };
  }
  listEl.innerHTML = "";
  if (visibleCards.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = tt("ccPanelEmpty3");
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
      card.addEventListener("click", () => selectCard(c.id));

      const name = document.createElement("div");
      name.className = "card-name";
      // Lock prefix on hidden cards so DM can spot them at a glance.
      name.textContent = (isHidden ? "🔒 " : "") + c.name;
      const sub = document.createElement("div");
      sub.className = "card-sub";
      const visLabel = isHidden
        ? (v === "dm" ? "仅 DM 可见" : `仅 ${(c.owner_ids || []).length + 1} 人可见`)
        : "";
      sub.textContent = `${c.uploader} · ${timeAgo(c.uploaded_at)}` + (visLabel ? ` · ${visLabel}` : "");

      // 👁 / 🔒 visibility toggle — DM only. Cycles public ↔ dm.
      // owners-mode (specific player allowlist) is set via a separate
      // dialog; the cycle button keeps the one-click flow simple.
      if (isGM) {
        const visBtn = document.createElement("button");
        visBtn.className = "card-vis";
        visBtn.textContent = isHidden ? "🔒" : "👁";
        visBtn.title = isHidden
          ? "仅 DM 可见 — 点击改为公开"
          : "公开 — 点击改为仅 DM 可见";
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
      refresh.textContent = "↻";
      refresh.title = tt("ccPanelRefreshTitle");
      refresh.addEventListener("click", async (e) => {
        e.stopPropagation();
        await refreshCardFromPicker(c);
      });
      card.appendChild(refresh);

      const del = document.createElement("button");
      del.className = "card-del";
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
    const c = cards.find((x) => x.id === curView.id);
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

  const hasContent = current.type !== "empty";
  viewer.classList.toggle("is-empty", !hasContent);
  viewer.classList.toggle("has-content", hasContent);
  if (!hasContent) {
    emptyText.textContent = cards.length > 0 ? tt("ccPanelEmpty") : tt("ccPanelNoCards");
  }
}

function buildResourceColumn() {
  resCol.innerHTML = "";
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

// --- setup ---
onLangChange((next) => {
  lang = next;
  applyI18nDom(lang);
  render();
});

OBR.onReady(async () => {
  applyI18nDom(lang);
  roomId = safeRoomId(OBR.room.id || "default");
  try { playerName = (await OBR.player.getName()) || "anonymous"; } catch {}
  try { myPlayerId = await OBR.player.getId(); } catch {}
  try { isGM = (await OBR.player.getRole()) === "GM"; } catch {}
  // Watch for role / id changes (rare, but happens after disconnect-
  // reconnect or if the DM passes ownership). Re-render the list so
  // the visibility filter follows.
  OBR.player.onChange(async (p) => {
    const nextGM = p.role === "GM";
    let changed = false;
    if (nextGM !== isGM) { isGM = nextGM; changed = true; }
    if (p.id && p.id !== myPlayerId) { myPlayerId = p.id; changed = true; }
    if (changed) render();
  });
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
  OBR.broadcast.onMessage("com.character-cards/panel-open", () => {
    setMaximized(true);
  });

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
    const f = e.dataTransfer?.files?.[0] ?? null;
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".xlsx")) {
      showError(tt("ccPanelOnlyXlsx"));
      return;
    }
    await uploadFile(f);
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

  // Listen for refresh broadcasts from other clients. When the DM (or
  // any other player) refreshes a linked card, we just bump our own
  // iframe's src with a cache-buster so the new index.html is fetched.
  OBR.broadcast.onMessage(BC_CARD_UPDATED, (event) => {
    const data = event.data as { cardId?: string; url?: string } | undefined;
    if (!data?.cardId) return;
    const iframe = cardIframes.get(data.cardId);
    const card = cards.find((c) => c.id === data.cardId);
    if (iframe && card) {
      iframe.src = buildCardIframeSrc(card, true);
    }
  });

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
  window.addEventListener("beforeunload", () => {
    clearInterval(saveInterval);
    saveState();
  });

  // Initial load + react to scene metadata changes
  await refreshFromScene();
  OBR.scene.onMetadataChange(() => { refreshFromScene(); });

  // Validate restored activeCardId still exists; otherwise clear
  if (current.type === "card") {
    const curId = current.id;
    if (!cards.find((c) => c.id === curId)) {
      current = { type: "empty" };
      render();
    }
  }
});
