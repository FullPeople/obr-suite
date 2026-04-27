import OBR from "@owlbear-rodeo/sdk";

// Suite-namespaced popover ID so the standalone plugin's panel doesn't
// fight with us during dual-install. Scene-metadata keys (the bound card
// list, BIND_META) stay under the original com.character-cards/* namespace
// for backward compatibility.
const POPOVER_ID = "com.obr-suite/cc-panel";
const API_BASE = "https://obr.dnd.center/api/character";
const SERVER_ORIGIN = "https://obr.dnd.center";
const SCENE_META_KEY = "com.character-cards/list";
const LS_PREFIX = "character-cards/";

const POPOVER_BOX = 64;

interface CardEntry {
  id: string;
  name: string;
  uploader: string;
  uploaded_at: string;
  url: string;
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
  { slug: "bqs", label: "不全书", icon: "📖", url: "https://5echm.kagangtuya.top/" },
];

type View =
  | { type: "empty" }
  | { type: "card"; id: string }
  | { type: "resource"; slug: string };

let roomId = "";
let playerName = "anonymous";
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
      const [w, h] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
      await OBR.popover.setWidth(POPOVER_ID, w);
      await OBR.popover.setHeight(POPOVER_ID, h);
    } else {
      // The blue circular floating button was removed — there's no longer a
      // 64×64 minimized state. Close the popover entirely instead. The user
      // re-opens via the cluster's "角色卡界面" button.
      saveState();
      await OBR.popover.close(POPOVER_ID);
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

function showStatus(msg: string) {
  statusEl.textContent = msg;
  statusEl.style.display = msg ? "block" : "none";
  if (msg) setTimeout(() => { statusEl.style.display = "none"; }, 3000);
}

function minimize() {
  saveState();
  setMaximized(false);
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
    showStatus(`✓ 已上传: ${entry.name}`);
    render();
  } catch (e: any) {
    showError(`上传失败: ${e?.message || e}`);
  } finally {
    sideEl?.classList.remove("busy");
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

function ensureCardIframe(card: CardEntry): HTMLIFrameElement {
  let f = cardIframes.get(card.id);
  if (!f) {
    f = document.createElement("iframe");
    f.src = SERVER_ORIGIN + card.url;
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
  // Sidebar list
  listEl.innerHTML = "";
  if (cards.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "还没有角色卡\n拖拽 xlsx 到左侧上传";
    empty.style.whiteSpace = "pre-line";
    listEl.appendChild(empty);
  } else {
    for (const c of cards) {
      const card = document.createElement("div");
      const isActive = current.type === "card" && current.id === c.id;
      card.className = "card" + (isActive ? " active" : "");
      card.addEventListener("click", () => selectCard(c.id));

      const name = document.createElement("div");
      name.className = "card-name";
      name.textContent = c.name;
      const sub = document.createElement("div");
      sub.className = "card-sub";
      sub.textContent = `${c.uploader} · ${timeAgo(c.uploaded_at)}`;

      const del = document.createElement("button");
      del.className = "card-del";
      del.textContent = "×";
      del.title = "删除";
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm(`删除 "${c.name}"？`)) await deleteCard(c.id);
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
    emptyText.textContent = cards.length > 0 ? "从右侧选择一张角色卡" : "暂无角色卡";
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
    const t = new Date(isoZ).getTime();
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    return `${Math.floor(diff / 86400)}天前`;
  } catch { return ""; }
}

// --- setup ---
OBR.onReady(async () => {
  roomId = safeRoomId(OBR.room.id || "default");
  try { playerName = (await OBR.player.getName()) || "anonymous"; } catch {}
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
  sideEl.addEventListener("drop", (e) => {
    e.preventDefault();
    sideEl.classList.remove("drag-over");
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (f.name.toLowerCase().endsWith(".xlsx")) uploadFile(f);
    else showError("只支持 .xlsx 文件");
  });

  document.addEventListener("dragover", (e) => { e.preventDefault(); });
  document.addEventListener("drop", (e) => { e.preventDefault(); });

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
    // ④ Shift+A from inside the panel closes it. OBR's tool-action
    // shortcut only fires when keyboard focus is on OBR's main window —
    // once the user clicks into our panel, the shortcut goes nowhere.
    // So we capture it ourselves.
    if (e.shiftKey && (e.key === "A" || e.key === "a")) {
      e.preventDefault();
      minimize();
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
