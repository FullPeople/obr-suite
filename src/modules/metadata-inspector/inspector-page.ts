// Metadata inspector popover.
//
//   ?mode=item   — small popover anchored next to the selected token.
//                  Renders ONLY that item's metadata + native fields.
//                  No tabs. This is the default behavior of the
//                  telescope tool: select an item → bubble pops up.
//   ?mode=scene  — bigger top-right popover. Shows scene metadata.
//                  Has 2 tabs (场景 / 房间) so the user can flip
//                  between scene-scoped and room-scoped data without
//                  reopening.
//   ?mode=room   — same popover as scene but defaults to room tab.
//
// The 物体 tab was removed entirely — item inspection is a separate
// (smaller, item-anchored) popover with its own popover id, so the
// scene/room popover never needs to display item metadata.
//
// Switching between scene and room modes inside the popover happens
// either via tab clicks OR via a LOCAL broadcast `SET_MODE` from the
// background (when the user clicks the top action-bar buttons while
// the popover is already open).

import OBR from "@owlbear-rodeo/sdk";

// Two distinct popover ids — see modules/metadata-inspector/index.ts.
const POPOVER_ITEM_ID = "com.obr-suite/metadata-inspector/item";
const POPOVER_META_ID = "com.obr-suite/metadata-inspector/meta";

const ttlEl = document.getElementById("ttl") as HTMLDivElement;
const subEl = document.getElementById("sub") as HTMLDivElement;
const bodyEl = document.getElementById("body") as HTMLDivElement;
const xBtn = document.getElementById("x") as HTMLButtonElement;
const tabsEl = document.getElementById("tabs") as HTMLDivElement;
const tabSceneBtn = document.getElementById("tab-scene") as HTMLButtonElement;
const tabRoomBtn = document.getElementById("tab-room") as HTMLButtonElement;

type Mode = "item" | "scene" | "room";
let currentMode: Mode = "item";
let currentItemId: string | null = null;

const params = new URLSearchParams(location.search);
const initialItemId = params.get("id") ?? null;
const initialMode: Mode = (() => {
  const m = params.get("mode");
  return m === "scene" || m === "room" ? m : "item";
})();
currentMode = initialMode;

// Which popover id we live inside — derived from the initial mode.
// Determines which `OBR.popover.close(...)` call closes us via the
// X / Esc handlers.
const myPopoverId = initialMode === "item" ? POPOVER_ITEM_ID : POPOVER_META_ID;

// LOCAL broadcast channel — background fires SET_MODE when the user
// clicks a top action-bar button while the meta popover is already
// open, jumping to the requested tab without reopening the iframe.
const BC_INSPECTOR_SET_MODE = "com.obr-suite/metadata-inspector/set-mode";

interface PluginInfo {
  prefix: string;
  zh: string;
  en: string;
  badgeClass: "suite" | "external" | "builtin" | "";
}

const KNOWN_NAMESPACES: PluginInfo[] = [
  { prefix: "com.obr-suite/", zh: "枭熊套件 — 套件状态 / 面板布局", en: "OBR Suite — state / panel layout", badgeClass: "suite" },
  { prefix: "com.obr-suite/portals/", zh: "枭熊套件 · 传送门", en: "OBR Suite · Portals", badgeClass: "suite" },
  { prefix: "com.obr-suite/dice", zh: "枭熊套件 · 骰子", en: "OBR Suite · Dice", badgeClass: "suite" },
  { prefix: "com.obr-suite/portals", zh: "枭熊套件 · 传送门数据", en: "OBR Suite · Portals data", badgeClass: "suite" },
  { prefix: "com.bestiary/", zh: "枭熊套件 · 怪物图鉴", en: "OBR Suite · Bestiary", badgeClass: "suite" },
  { prefix: "com.character-cards/", zh: "枭熊套件 · 人物卡", en: "OBR Suite · Character Cards", badgeClass: "suite" },
  { prefix: "com.initiative-tracker/", zh: "枭熊套件 · 先攻追踪", en: "OBR Suite · Initiative Tracker", badgeClass: "suite" },
  { prefix: "com.owlbear-rodeo-bubbles-extension/", zh: "外部插件 · Stat Bubbles for D&D", en: "External · Stat Bubbles for D&D", badgeClass: "external" },
  { prefix: "rodeo.owlbear.smoke/", zh: "外部插件 · Smoke!（动态视野）", en: "External · Smoke! (dynamic vision)", badgeClass: "external" },
  { prefix: "com.battle-tracker/", zh: "外部插件 · Battle Tracker", en: "External · Battle Tracker", badgeClass: "external" },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatValue(v: unknown): { html: string; long: boolean } {
  if (v === null) return { html: '<span style="color:#888">null</span>', long: false };
  if (v === undefined) return { html: '<span style="color:#888">undefined</span>', long: false };
  if (typeof v === "string") {
    if (v.length > 80) return { html: escapeHtml(v), long: true };
    return { html: escapeHtml(`"${v}"`), long: false };
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return { html: `<span style="color:#c89251">${escapeHtml(String(v))}</span>`, long: false };
  }
  try {
    const json = JSON.stringify(v, null, 2);
    return { html: escapeHtml(json), long: json.length > 80 };
  } catch {
    return { html: escapeHtml(String(v)), long: false };
  }
}

function classifyKey(key: string): { label: string; badgeClass: string; namespace: string } {
  let best: PluginInfo | null = null;
  for (const ns of KNOWN_NAMESPACES) {
    if (key.startsWith(ns.prefix)) {
      if (!best || ns.prefix.length > best.prefix.length) best = ns;
    }
  }
  if (best) {
    return {
      label: best.zh,
      badgeClass: best.badgeClass,
      namespace: best.prefix.replace(/\/$/, ""),
    };
  }
  const slash = key.indexOf("/");
  const ns = slash >= 0 ? key.slice(0, slash) : key;
  return { label: `未识别 — ${ns}`, badgeClass: "", namespace: ns || "(no-ns)" };
}

interface Group {
  namespace: string;
  label: string;
  badgeClass: string;
  entries: Array<{ key: string; value: unknown }>;
}

// Group a flat metadata record by plugin namespace. Used by all three
// modes — only item mode supplements the result with an OBR-native
// fields group.
function groupByNamespace(metadata: Record<string, unknown>): Group[] {
  const groups = new Map<string, Group>();
  for (const [k, v] of Object.entries(metadata ?? {})) {
    const { label, badgeClass, namespace } = classifyKey(k);
    let g = groups.get(namespace);
    if (!g) {
      g = { namespace, label, badgeClass, entries: [] };
      groups.set(namespace, g);
    }
    g.entries.push({ key: k, value: v });
  }
  // Sort: suite groups first, then external, then unknown. Within
  // each tier, alphabetical by namespace for determinism.
  return Array.from(groups.values()).sort((a, b) => {
    const order = { suite: 0, external: 1, builtin: 2, "": 3 } as Record<string, number>;
    const ao = order[a.badgeClass] ?? 3;
    const bo = order[b.badgeClass] ?? 3;
    if (ao !== bo) return ao - bo;
    return a.namespace.localeCompare(b.namespace);
  });
}

function renderGroup(g: Group): string {
  const badgeText = g.badgeClass === "suite" ? "枭熊"
    : g.badgeClass === "external" ? "外部"
    : g.badgeClass === "builtin" ? "原生"
    : "?";
  const rows = g.entries.map((e) => {
    const f = formatValue(e.value);
    return `
      <div class="kv">
        <span class="k">${escapeHtml(e.key)}</span>
        <span class="v ${f.long ? "long" : ""}"><pre style="margin:0;font-family:inherit;white-space:pre-wrap;word-break:break-all">${f.html}</pre></span>
      </div>
    `;
  }).join("");
  return `
    <div class="group">
      <div class="group-head">
        <div class="group-head-top">
          <span class="badge ${g.badgeClass}">${badgeText}</span>
          <span class="label">${escapeHtml(g.label)}</span>
        </div>
        <div class="group-head-bottom">${g.entries.length} 条 · <code>${escapeHtml(g.namespace)}</code></div>
      </div>
      <div class="kv-list">${rows}</div>
    </div>
  `;
}

function renderItem(item: any): void {
  ttlEl.textContent = item.name || `(${item.type})`;
  const tags: string[] = [];
  tags.push(`<span class="tag layer">${escapeHtml(item.type)}</span>`);
  if (item.layer) tags.push(`<span class="tag layer">${escapeHtml(item.layer)}</span>`);
  if (item.locked) tags.push(`<span class="tag locked">已锁定</span>`);
  if (item.visible === false) tags.push(`<span class="tag invisible">隐藏</span>`);
  subEl.innerHTML = `${tags.join("")}<b style="font-family:ui-monospace,Consolas,monospace;font-size:10px;color:#9aa0b3">${escapeHtml(item.id)}</b>`;

  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  const groups = groupByNamespace(meta);

  // OBR-builtin "group" — surfaces native item fields.
  const builtinEntries: Array<{ key: string; value: unknown }> = [];
  const pickFields = [
    "name", "type", "layer", "position", "scale", "rotation",
    "locked", "visible", "zIndex",
    "attachedTo", "disableHit", "disableAttachmentBehavior",
  ];
  for (const f of pickFields) {
    if (item[f] !== undefined) builtinEntries.push({ key: f, value: item[f] });
  }
  if (item.type === "IMAGE") {
    if (item.image) builtinEntries.push({ key: "image", value: item.image });
    if (item.grid) builtinEntries.push({ key: "grid", value: item.grid });
    if (item.text) builtinEntries.push({ key: "text", value: item.text });
  }

  const sections: string[] = [];
  sections.push(renderGroup({
    namespace: "(builtin)",
    label: "OBR 原生字段",
    badgeClass: "builtin",
    entries: builtinEntries,
  }));
  for (const g of groups) sections.push(renderGroup(g));
  if (groups.length === 0) {
    sections.push(`<div class="empty">该物体没有任何插件元数据 — 只有 OBR 原生字段。</div>`);
  }
  bodyEl.innerHTML = sections.join("");
}

function renderRawMetadata(
  title: string,
  subline: string,
  metadata: Record<string, unknown>,
): void {
  ttlEl.textContent = title;
  subEl.innerHTML = subline;
  const groups = groupByNamespace(metadata);
  if (groups.length === 0) {
    bodyEl.innerHTML = `<div class="empty">${title} 没有任何元数据。</div>`;
    return;
  }
  bodyEl.innerHTML = groups.map(renderGroup).join("");
}

// --- Mode handlers --------------------------------------------------

async function loadItemMode(): Promise<void> {
  if (!currentItemId) {
    ttlEl.textContent = "未选中物体";
    subEl.innerHTML = `<span style="color:#888">激活望远镜工具后，在场景里选中任何物体即可查看</span>`;
    bodyEl.innerHTML = `<div class="empty">在场景中点选任意物体后会在这里展示它的元数据。<br>切换上方「场景」/「房间」标签可查看场景级 / 房间级元数据。</div>`;
    return;
  }
  try {
    const items = await OBR.scene.items.getItems([currentItemId]);
    if (items.length === 0) {
      bodyEl.innerHTML = `<div class="empty">物体不存在 — 可能已被删除。</div>`;
      return;
    }
    renderItem(items[0] as any);
  } catch (e) {
    bodyEl.innerHTML = `<div class="empty">加载失败：${escapeHtml(String((e as Error).message ?? e))}</div>`;
  }
}

async function loadSceneMode(): Promise<void> {
  try {
    const meta = await OBR.scene.getMetadata();
    const keyCount = Object.keys(meta).length;
    const subline = `<b style="color:#7ec8f0">OBR.scene.getMetadata()</b> · ${keyCount} 个 key`;
    renderRawMetadata("场景元数据", subline, meta as Record<string, unknown>);
  } catch (e) {
    bodyEl.innerHTML = `<div class="empty">加载场景元数据失败：${escapeHtml(String((e as Error).message ?? e))}</div>`;
  }
}

async function loadRoomMode(): Promise<void> {
  try {
    const meta = await OBR.room.getMetadata();
    const keyCount = Object.keys(meta).length;
    const subline = `<b style="color:#7ec8f0">OBR.room.getMetadata()</b> · ${keyCount} 个 key · <span style="color:#9aa0b3">跨 scene 的房间级数据</span>`;
    renderRawMetadata("房间元数据", subline, meta as Record<string, unknown>);
  } catch (e) {
    bodyEl.innerHTML = `<div class="empty">加载房间元数据失败：${escapeHtml(String((e as Error).message ?? e))}</div>`;
  }
}

async function refresh(): Promise<void> {
  if (currentMode === "item") await loadItemMode();
  else if (currentMode === "scene") await loadSceneMode();
  else if (currentMode === "room") await loadRoomMode();
}

function setMode(next: Mode): void {
  // Item mode is its own popover — never switched into via the tabs
  // (tabs aren't even visible there). Guard so a stray broadcast
  // doesn't put us into an inconsistent state.
  if (next === "item" && currentMode !== "item") return;
  currentMode = next;
  tabSceneBtn.classList.toggle("on", next === "scene");
  tabRoomBtn.classList.toggle("on", next === "room");
  void refresh();
}

// --- Resize observer (unchanged from previous version) --------------

function watchContentSize(): void {
  const root = document.querySelector(".bubble") as HTMLElement | null;
  const headEl = document.querySelector(".head") as HTMLElement | null;
  const tabsRefEl = document.querySelector(".tabs") as HTMLElement | null;
  const subRefEl = document.querySelector(".sub") as HTMLElement | null;
  if (!root) return;
  let lastH = -1;
  const apply = async () => {
    const tabsH = tabsRefEl && tabsRefEl.offsetParent !== null ? tabsRefEl.offsetHeight : 0;
    const chrome =
      (headEl?.offsetHeight ?? 0) +
      tabsH +
      (subRefEl?.offsetHeight ?? 0);
    const want = chrome + bodyEl.scrollHeight + 16;
    let target = Math.max(180, Math.ceil(want));
    try {
      const vh = await OBR.viewport.getHeight();
      target = Math.min(target, Math.floor(vh * 0.85));
    } catch {}
    if (target === lastH) return;
    lastH = target;
    try {
      await OBR.popover.setHeight(myPopoverId, target);
    } catch {}
  };
  const ro = new ResizeObserver(() => { void apply(); });
  ro.observe(bodyEl);
  requestAnimationFrame(() => requestAnimationFrame(() => { void apply(); }));
}

// --- Wire-up --------------------------------------------------------

OBR.onReady(async () => {
  // Seed selected item: prefer URL param (when background opened us
  // for a specific item) else read the live selection.
  if (initialItemId) {
    currentItemId = initialItemId;
  } else if (currentMode === "item") {
    try {
      const sel = (await OBR.player.getSelection()) ?? [];
      if (sel.length > 0) currentItemId = sel[0];
    } catch {}
  }

  // Tabs row only renders in scene/room mode. Item mode is the small
  // pop-by-token popover and doesn't need navigation.
  if (currentMode === "item") {
    if (tabsEl) tabsEl.style.display = "none";
  } else {
    if (tabsEl) tabsEl.style.display = "";
    tabSceneBtn.classList.toggle("on", currentMode === "scene");
    tabRoomBtn.classList.toggle("on", currentMode === "room");
  }

  void refresh().then(() => watchContentSize());

  // Tab clicks switch between scene / room only.
  tabSceneBtn.addEventListener("click", () => setMode("scene"));
  tabRoomBtn.addEventListener("click", () => setMode("room"));

  // Background broadcasts SET_MODE when the user clicks a top
  // action-bar button while we're already open.
  const unsubSetMode = OBR.broadcast.onMessage(BC_INSPECTOR_SET_MODE, (msg) => {
    const data = msg.data as { mode?: Mode } | undefined;
    if (data?.mode === "item" || data?.mode === "scene" || data?.mode === "room") {
      setMode(data.mode);
    }
  });
  window.addEventListener("beforeunload", () => { try { unsubSetMode(); } catch {} });

  xBtn.addEventListener("click", async () => {
    try { await OBR.popover.close(myPopoverId); } catch {}
  });

  // Live updates per mode. We register all watchers always; each
  // checks the current mode before re-rendering so an irrelevant
  // event doesn't trigger unnecessary work.
  const unsubItems = OBR.scene.items.onChange((items) => {
    if (currentMode !== "item") return;
    if (!currentItemId) return;
    const me = items.find((i) => i.id === currentItemId);
    if (me) renderItem(me as any);
  });
  const unsubSelection = OBR.player.onChange((p) => {
    const sel = p.selection ?? [];
    const next = sel.length > 0 ? sel[0] : null;
    if (next !== currentItemId) {
      currentItemId = next;
      // Auto-refresh only when the user is on the item tab — flipping
      // selection while on scene/room should NOT yank them away.
      if (currentMode === "item") void loadItemMode();
    }
  });
  const unsubScene = OBR.scene.onMetadataChange(() => {
    if (currentMode === "scene") void loadSceneMode();
  });
  let unsubRoom: (() => void) | null = null;
  try {
    unsubRoom = OBR.room.onMetadataChange(() => {
      if (currentMode === "room") void loadRoomMode();
    });
  } catch {}
  window.addEventListener("beforeunload", () => {
    try { unsubItems(); } catch {}
    try { unsubSelection(); } catch {}
    try { unsubScene(); } catch {}
    try { unsubRoom?.(); } catch {}
  });

  window.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      try { await OBR.popover.close(myPopoverId); } catch {}
    }
    // Quick keyboard tab switch — only relevant in scene/room popover.
    if (currentMode !== "item") {
      if (e.key === "1") setMode("scene");
      if (e.key === "2") setMode("room");
    }
  });
});
