// Panel-layout editor modal.
//
// Opened from Settings → 基础设置 → "调整面板布局". Renders a
// fullscreen blocker with a draggable + resizable proxy rectangle for
// every suite-anchored popover, regardless of whether each one is
// currently displayed. Background.ts gathers each panel's bbox via
// the registry (which now always returns the EXPECTED bbox even for
// closed panels) and packs them into the modal URL hash so the
// editor can render proxies on first paint.
//
// Features:
//   * Drag any proxy to reposition. Position is clamped to the
//     viewport so panels can't escape past an edge.
//   * Drag the bottom-right corner handle to resize panels whose
//     modules honour size overrides (dice-history / bestiary panel /
//     cc-info / monster info). Cluster + initiative auto-fit their
//     content and don't expose a resize handle.
//   * "重置全部" wipes all per-panel offsets + sizes.
//   * "完成" closes the editor.
//
// Both gestures finish by writing offset+size to localStorage and
// firing BC_PANEL_DRAG_END so the underlying panel re-anchors live.

import OBR from "@owlbear-rodeo/sdk";
import {
  PANEL_IDS,
  setPanelOffset,
  setPanelSize,
  resetAllPanelOffsets,
  BC_PANEL_DRAG_END,
  BC_PANEL_RESET,
  type PanelOffset,
  type PanelSize,
} from "./utils/panelLayout";

interface ProxyRect {
  panelId: string;
  label: string;
  /** Currently-rendered bbox in modal-viewport coords. Live during
   *  drag / resize; persisted to localStorage on release. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Snapshot at gesture start, used to compute delta. */
  startLeft: number;
  startTop: number;
  startWidth: number;
  startHeight: number;
  startOffset: PanelOffset;
  startSize: PanelSize;
  /** Whether this panel honours runtime size overrides — controls
   *  whether the corner resize handle is rendered. */
  resizable: boolean;
  el: HTMLDivElement;
}

const blocker = document.getElementById("blocker") as HTMLDivElement;
const hintEl = document.getElementById("hint") as HTMLElement;
const btnReset = document.getElementById("btn-reset") as HTMLButtonElement;
const btnDone = document.getElementById("btn-done") as HTMLButtonElement;

const PANEL_LABELS: Record<string, string> = {
  [PANEL_IDS.cluster]: "快捷键按钮",
  [PANEL_IDS.clusterRow]: "快捷键栏",
  [PANEL_IDS.diceHistoryTrigger]: "投骰记录按钮",
  [PANEL_IDS.diceHistory]: "投骰记录面板",
  [PANEL_IDS.initiative]: "先攻条",
  [PANEL_IDS.bestiaryPanel]: "怪物图鉴",
  [PANEL_IDS.bestiaryInfo]: "怪物详情",
  [PANEL_IDS.ccInfo]: "角色卡信息",
  [PANEL_IDS.search]: "搜索栏",
  [PANEL_IDS.portalEdit]: "传送门编辑",
};

// Cluster + initiative auto-fit their inner content; runtime size
// overrides would just be fought back by their own measure-and-resize
// passes. Search is also self-resizing (idle/expanded states). Skip
// the resize handle for these.
const NON_RESIZABLE = new Set<string>([
  PANEL_IDS.cluster,
  PANEL_IDS.clusterRow,
  PANEL_IDS.diceHistoryTrigger,
  PANEL_IDS.initiative,
  PANEL_IDS.search,
]);

// Min size for resizable panels — smaller than this and the panels
// become unusable.
const MIN_W = 160;
const MIN_H = 100;

const proxies: ProxyRect[] = [];

interface DragSession {
  proxy: ProxyRect;
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  mode: "move" | "resize";
}
let session: DragSession | null = null;

function readStoredOffset(panelId: string): PanelOffset {
  try {
    const raw = localStorage.getItem(`obr-suite/panel-offset/${panelId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.dx === "number" && typeof parsed?.dy === "number") {
        return { dx: parsed.dx, dy: parsed.dy };
      }
    }
  } catch {}
  return { dx: 0, dy: 0 };
}

function readStoredSize(panelId: string): PanelSize | null {
  try {
    const raw = localStorage.getItem(`obr-suite/panel-size/${panelId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.width === "number" && typeof parsed?.height === "number") {
        return { width: parsed.width, height: parsed.height };
      }
    }
  } catch {}
  return null;
}

function clampToViewport(p: ProxyRect): void {
  // Modal is fullScreen so window.innerWidth/Height === OBR viewport.
  // Boundary clamp keeps the proxy fully on screen — user can still
  // see and grab the handle. If a future feature wants "partial
  // off-screen allowed" we can drop the lower bound to negative.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  p.left = Math.max(0, Math.min(vw - p.width, p.left));
  p.top = Math.max(0, Math.min(vh - p.height, p.top));
  // Also cap size if the proxy is bigger than the viewport.
  p.width = Math.max(MIN_W, Math.min(vw, p.width));
  p.height = Math.max(MIN_H, Math.min(vh, p.height));
}

function applyProxyDom(p: ProxyRect): void {
  p.el.style.left = `${Math.round(p.left)}px`;
  p.el.style.top = `${Math.round(p.top)}px`;
  p.el.style.width = `${Math.round(p.width)}px`;
  p.el.style.height = `${Math.round(p.height)}px`;
  const sizeEl = p.el.querySelector(".psize");
  if (sizeEl) {
    sizeEl.textContent = `${Math.round(p.width)} × ${Math.round(p.height)}`;
  }
}

function isPanelOpen(panelId: string): boolean {
  // Best effort — read the corresponding "is open" flag from
  // localStorage where we have it. Cluster is presumed always open
  // when the suite is active. The other panels don't expose a
  // localStorage open-flag, so we treat them as "closed" for the
  // purposes of the visual style only — the hash payload from
  // background already tells us their bbox.
  if (panelId === PANEL_IDS.cluster) return true;
  return false;
}

function buildProxy(
  panelId: string,
  bbox: { left: number; top: number; width: number; height: number },
): void {
  const label = PANEL_LABELS[panelId] ?? panelId;
  const resizable = !NON_RESIZABLE.has(panelId);
  const open = isPanelOpen(panelId);
  const el = document.createElement("div");
  el.className = "proxy" + (open ? "" : " is-closed");
  el.dataset.panelId = panelId;
  el.innerHTML = `
    <span class="pname">${label}</span>
    <span class="psize">${Math.round(bbox.width)} × ${Math.round(bbox.height)}</span>
    ${resizable ? '<div class="resize-handle"></div>' : ""}
  `;
  blocker.appendChild(el);

  const proxy: ProxyRect = {
    panelId,
    label,
    left: bbox.left,
    top: bbox.top,
    width: bbox.width,
    height: bbox.height,
    startLeft: bbox.left,
    startTop: bbox.top,
    startWidth: bbox.width,
    startHeight: bbox.height,
    startOffset: readStoredOffset(panelId),
    startSize: readStoredSize(panelId) ?? { width: bbox.width, height: bbox.height },
    resizable,
    el,
  };
  applyProxyDom(proxy);
  proxies.push(proxy);

  // Move handler — pointerdown anywhere on the proxy except the
  // resize handle (which gets its own listener that calls
  // stopPropagation).
  el.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");
    session = {
      proxy,
      pointerId: e.pointerId,
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      mode: "move",
    };
    proxy.startLeft = proxy.left;
    proxy.startTop = proxy.top;
    proxy.startOffset = readStoredOffset(panelId);
  });

  // Resize handle — only present on resizable panels. Stops
  // propagation so the move handler doesn't also fire.
  const resizeHandle = el.querySelector<HTMLDivElement>(".resize-handle");
  if (resizeHandle) {
    resizeHandle.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      resizeHandle.setPointerCapture(e.pointerId);
      el.classList.add("is-resizing");
      session = {
        proxy,
        pointerId: e.pointerId,
        startScreenX: e.screenX,
        startScreenY: e.screenY,
        mode: "resize",
      };
      proxy.startWidth = proxy.width;
      proxy.startHeight = proxy.height;
      proxy.startOffset = readStoredOffset(panelId);
      proxy.startSize = readStoredSize(panelId) ?? { width: proxy.width, height: proxy.height };
    });
  }

  // Single set of pointermove / up / cancel handlers per element
  // dispatching on session.mode.
  const onMove = (e: PointerEvent) => {
    if (!session || e.pointerId !== session.pointerId) return;
    if (session.proxy !== proxy) return;
    const dx = e.screenX - session.startScreenX;
    const dy = e.screenY - session.startScreenY;
    if (session.mode === "move") {
      proxy.left = proxy.startLeft + dx;
      proxy.top = proxy.startTop + dy;
    } else {
      proxy.width = proxy.startWidth + dx;
      proxy.height = proxy.startHeight + dy;
    }
    clampToViewport(proxy);
    applyProxyDom(proxy);
  };

  const onUp = (e: PointerEvent) => {
    if (!session || e.pointerId !== session.pointerId) return;
    if (session.proxy !== proxy) return;
    const finishedMode = session.mode;
    el.classList.remove("is-dragging");
    el.classList.remove("is-resizing");
    try { el.releasePointerCapture(e.pointerId); } catch {}
    if (resizeHandle) {
      try { resizeHandle.releasePointerCapture(e.pointerId); } catch {}
    }
    const dx = e.screenX - session.startScreenX;
    const dy = e.screenY - session.startScreenY;
    session = null;

    if (finishedMode === "move") {
      if (dx === 0 && dy === 0) return;
      // Compute new offset from the CLAMPED final position so the
      // panel's open() math agrees with what we drew.
      const moveDx = proxy.left - proxy.startLeft;
      const moveDy = proxy.top - proxy.startTop;
      const next: PanelOffset = {
        dx: proxy.startOffset.dx + moveDx,
        dy: proxy.startOffset.dy + moveDy,
      };
      setPanelOffset(panelId, next);
      try {
        OBR.broadcast.sendMessage(
          BC_PANEL_DRAG_END,
          { panelId, offset: next },
          { destination: "LOCAL" },
        );
      } catch {}
    } else {
      // Resize commit. Persist new size + send drag-end with both
      // the (unchanged) offset and the new size so the panel
      // re-anchors and re-sizes in one go.
      if (proxy.width === proxy.startWidth && proxy.height === proxy.startHeight) return;
      const newSize: PanelSize = { width: proxy.width, height: proxy.height };
      setPanelSize(panelId, newSize);
      try {
        OBR.broadcast.sendMessage(
          BC_PANEL_DRAG_END,
          { panelId, offset: proxy.startOffset, size: newSize },
          { destination: "LOCAL" },
        );
      } catch {}
    }
  };

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  if (resizeHandle) {
    resizeHandle.addEventListener("pointermove", onMove);
    resizeHandle.addEventListener("pointerup", onUp);
    resizeHandle.addEventListener("pointercancel", onUp);
  }
}

OBR.onReady(() => {
  let bboxMap: Record<string, { left: number; top: number; width: number; height: number }> = {};
  try {
    const raw = location.hash.replace(/^#/, "");
    if (raw) {
      bboxMap = JSON.parse(decodeURIComponent(raw));
    }
  } catch (e) {
    console.warn("[layout-editor] failed to parse hash payload", e);
  }
  // Render proxies in a stable order so the DOM doesn't reshuffle
  // when reopening (helps muscle-memory).
  const order = [
    PANEL_IDS.cluster,
    PANEL_IDS.clusterRow,
    PANEL_IDS.diceHistoryTrigger,
    PANEL_IDS.diceHistory,
    PANEL_IDS.search,
    PANEL_IDS.initiative,
    PANEL_IDS.bestiaryPanel,
    PANEL_IDS.bestiaryInfo,
    PANEL_IDS.ccInfo,
    PANEL_IDS.portalEdit,
  ];
  for (const panelId of order) {
    const bbox = bboxMap[panelId];
    if (bbox && typeof bbox.left === "number") {
      buildProxy(panelId, bbox);
    }
  }
  if (proxies.length === 0) {
    hintEl.textContent = "未读取到任何面板的位置信息";
  } else {
    hintEl.textContent = "拖动整体移动，拖右下角调整大小（虚线 = 当前未打开）";
  }

  btnReset.addEventListener("click", () => {
    const ok = window.confirm("重置所有面板位置和大小到默认？");
    if (!ok) return;
    resetAllPanelOffsets();
    try {
      OBR.broadcast.sendMessage(BC_PANEL_RESET, {}, { destination: "LOCAL" });
    } catch {}
    // Re-snap each on-screen proxy back to its default bbox (the
    // bbox passed in via the URL hash is already the no-offset
    // baseline, since the offset hadn't been applied to it). This
    // gives instant visual feedback without closing the editor —
    // the user can immediately resume arranging from a clean slate.
    for (const p of proxies) {
      p.left = p.startLeft;
      p.top = p.startTop;
      p.width = p.startWidth;
      p.height = p.startHeight;
      p.startOffset = { dx: 0, dy: 0 };
      p.startSize = { width: p.startWidth, height: p.startHeight };
      applyProxyDom(p);
    }
    hintEl.textContent = "已重置 · 拖动整体移动，拖右下角调整大小";
  });

  btnDone.addEventListener("click", () => closeEditor());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeEditor();
    }
  });
  blocker.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    closeEditor();
  });
});

function closeEditor(): void {
  try {
    OBR.modal.close("com.obr-suite/layout-editor");
  } catch {}
}
