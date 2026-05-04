import OBR from "@owlbear-rodeo/sdk";
import {
  startSceneSync,
  getState,
  onStateChange,
  refreshFromScene,
  readLS,
  writeLS,
  getLocalLang,
  onLangChange,
} from "./state";
import { t } from "./i18n";
import { assetUrl } from "./asset-base";
import { bindPanelDrag, applyDragSide, watchDragSide } from "./utils/panelDrag";
import { PANEL_IDS } from "./utils/panelLayout";
import { installDebugOverlay } from "./utils/debugOverlay";

// Cluster ROW iframe — only rendered while the user has the trigger
// toggled on. Holds the actual action buttons. The row popover is
// opened/closed by background.ts based on the trigger's broadcast.

function isMobileDevice(): boolean {
  const ua = navigator.userAgent || "";
  return /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
}
const IS_MOBILE = isMobileDevice();

const SETTINGS_POPOVER_ID = "com.obr-suite/settings";
const SETTINGS_URL = assetUrl("settings.html");

// Broadcast IDs
const BC_TIMESTOP_TOGGLE = "com.obr-suite/timestop-toggle";
const BC_FOCUS_TRIGGER = "com.obr-suite/focus-trigger";
const BC_BESTIARY_AUTOPOPUP = "com.bestiary/auto-popup-toggled";
const BC_CHARCARD_AUTOPOPUP = "com.character-cards/auto-info-toggled";
const BC_TOGGLE_CC_PANEL = "com.obr-suite/cc-panel-toggle";

const LS_AUTO_BESTIARY = "com.bestiary/auto-popup";
const LS_AUTO_CHARCARD = "character-cards/auto-info";

const rowEl = document.getElementById("row") as HTMLDivElement;

const GEAR_SVG = `<svg class="gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const MEGAPHONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 8a4 4 0 0 1 0 8"/><path d="M19 5a8 8 0 0 1 0 14"/></svg>`;

const ANNOUNCEMENT_MODAL_ID = "com.obr-suite/dm-announcement";
const ANNOUNCEMENT_URL = assetUrl("dm-announcement.html");
const ANNOUNCEMENT_MD_URL = assetUrl("announcement.md");
const LS_ANNOUNCE_SEEN = "obr-suite/announce-seen-version";
let cachedAnnounceVersion: string | null = null;

let timeStopActive = false;
let isGM = false;

function isAutoPopupOn(key: string): boolean {
  return readLS(key, "1") !== "0";
}
function setAutoPopupOn(key: string, on: boolean, msg: string) {
  writeLS(key, on ? "1" : "0");
  try {
    OBR.broadcast.sendMessage(msg, {}, { destination: "LOCAL" });
  } catch {}
}

function btnHTML(opts: {
  id: string;
  labelHtml: string;
  toggle?: boolean;
  on?: boolean;
  active?: boolean;
  title?: string;
}): string {
  const cls = ["btn"];
  if (opts.toggle) cls.push("toggle", opts.on ? "on" : "off");
  if (opts.active) cls.push("timestop-active");
  return `<button id="${opts.id}" class="${cls.join(
    " "
  )}" type="button" title="${opts.title ?? ""}">${opts.labelHtml}</button>`;
}

// `renderRow` rewrites the row's children via innerHTML — the persistent
// drag handle (created statically in cluster-row.html) lives outside
// `rowEl`, but if anyone moves it in we need to skip detaching it. The
// handle is currently a sibling of `rowEl` inside the `.wrap` container,
// so the renderer can safely replace `rowEl.innerHTML` without nuking it.

const BC_CLUSTER_ROW_WIDTH = "com.obr-suite/cluster-row-width";

function reportNaturalWidth() {
  const wrap = document.getElementById("wrap");
  const row = document.getElementById("row");
  const grip = document.getElementById("row-drag-handle");
  if (!wrap || !row) return;
  // Sum: drag-grip (incl. its own margins) + row content. Add 16px
  // padding so the popover frame doesn't crowd the buttons.
  let w = row.offsetWidth + 16;
  if (grip) w += grip.offsetWidth + 12;
  // Clamp so absurd lang strings don't grow the popover wider than
  // the viewport (background also clamps).
  w = Math.max(120, Math.min(960, Math.round(w)));
  // No dedupe here — background's setWidth is idempotent and the
  // broadcast is cheap. Skipping based on a cached "last value" was
  // suppressing post-drag re-measurements when the iframe re-mounted
  // and computed the same width as before, leaving the popover at
  // the open-time width:ROW_W (the user's "stuck at widest" bug).
  try {
    OBR.broadcast.sendMessage(
      BC_CLUSTER_ROW_WIDTH,
      { width: w },
      { destination: "LOCAL" },
    );
  } catch {}
}

function renderRow() {
  const s = getState();
  const lang = getLocalLang();

  const parts: string[] = [];

  if (isGM && s.enabled.timeStop) {
    parts.push(
      btnHTML({
        id: "btnTimeStop",
        labelHtml: t(lang, "btnTimeStop"),
        active: timeStopActive,
        title: t(lang, "btnTimeStop"),
      })
    );
  }
  if (isGM && s.enabled.focus) {
    parts.push(
      btnHTML({
        id: "btnFocus",
        labelHtml: t(lang, "btnFocus"),
        title: t(lang, "btnFocus"),
      })
    );
  }

  // Popup toggles group (悬浮窗) — bestiary auto-popup + character-card
  // auto-info. Dice-history toggle moved out: it has its own dedicated
  // trigger button at the bottom-right.
  const popupBtns: string[] = [];
  // Bestiary popup toggle — visible to ALL roles now (was GM-only).
  // Players can also see the monster info popover when they own a
  // bestiary-bound token, so they need their own auto-popup control.
  if (s.enabled.bestiary) {
    popupBtns.push(
      btnHTML({
        id: "btnBestiaryPopup",
        labelHtml: t(lang, "btnBestiaryPopup"),
        toggle: true,
        on: isAutoPopupOn(LS_AUTO_BESTIARY),
        title: t(lang, "btnBestiaryPopup"),
      })
    );
  }
  if (s.enabled.characterCards) {
    popupBtns.push(
      btnHTML({
        id: "btnCharCardPopup",
        labelHtml: t(lang, "btnCharCardPopup"),
        toggle: true,
        on: isAutoPopupOn(LS_AUTO_CHARCARD),
        title: t(lang, "btnCharCardPopup"),
      })
    );
  }
  if (popupBtns.length) {
    const labelText = t(lang, "groupLabelPopups");
    const isVerticalLabel = lang === "zh";
    const labelInner = isVerticalLabel
      ? Array.from(labelText).map((c) => `<span>${c}</span>`).join("")
      : `<span>${labelText}</span>`;
    parts.push(
      `<div class="group${isVerticalLabel ? "" : " h-label"}"><div class="glabel">${labelInner}</div>${popupBtns.join(
        ""
      )}</div>`
    );
  }

  if (s.enabled.characterCards && !IS_MOBILE) {
    parts.push(
      btnHTML({
        id: "btnCharCardPanel",
        labelHtml: t(lang, "btnCharCardPanel"),
        title: t(lang, "btnCharCardPanel"),
      })
    );
  }

  parts.push(
    btnHTML({
      id: "btnAnnounce",
      labelHtml: MEGAPHONE_SVG,
      title: lang === "zh" ? "公告" : "Announcement",
    })
  );

  parts.push(
    btnHTML({
      id: "btnGear",
      labelHtml: GEAR_SVG,
      title: `${t(lang, "btnSettings")} / ${t(lang, "btnAbout")}`,
    })
  );

  rowEl.innerHTML = parts.join("");

  // Re-measure the row's natural width and ask the background to
  // resize the popover to fit. Without this the popover stays at
  // the open-time width:ROW_W (640) and clicks/hover land on blank
  // space when the active button set is narrow.
  //
  // We send the measurement at FOUR distinct moments because some
  // of them race with iframe mount / SDK readiness during a
  // post-drag re-open: rAF×2, +120ms, +400ms, and +1000ms. The
  // background's setWidth is idempotent so duplicates are harmless,
  // and the staggered fallbacks guarantee at least one lands after
  // the popover is fully alive on the OBR side.
  requestAnimationFrame(() => requestAnimationFrame(reportNaturalWidth));
  setTimeout(reportNaturalWidth, 120);
  setTimeout(reportNaturalWidth, 400);
  setTimeout(reportNaturalWidth, 1000);

  document.getElementById("btnTimeStop")?.addEventListener("click", onTimeStop);
  document.getElementById("btnFocus")?.addEventListener("click", onFocus);
  document
    .getElementById("btnBestiaryPopup")
    ?.addEventListener("click", onBestiaryPopup);
  document
    .getElementById("btnCharCardPopup")
    ?.addEventListener("click", onCharCardPopup);
  document
    .getElementById("btnCharCardPanel")
    ?.addEventListener("click", onCharCardPanel);
  document.getElementById("btnAnnounce")?.addEventListener("click", onAnnounce);
  document.getElementById("btnGear")?.addEventListener("click", onGear);
  applyAnnounceBlink();
}

function onTimeStop() {
  try {
    OBR.broadcast.sendMessage(
      BC_TIMESTOP_TOGGLE,
      { source: "cluster-row" },
      { destination: "LOCAL" }
    );
  } catch {}
}

function onFocus() {
  try {
    OBR.broadcast.sendMessage(
      BC_FOCUS_TRIGGER,
      { source: "cluster-row" },
      { destination: "LOCAL" }
    );
  } catch {}
}

function onBestiaryPopup() {
  const next = !isAutoPopupOn(LS_AUTO_BESTIARY);
  setAutoPopupOn(LS_AUTO_BESTIARY, next, BC_BESTIARY_AUTOPOPUP);
  renderRow();
}
function onCharCardPopup() {
  const next = !isAutoPopupOn(LS_AUTO_CHARCARD);
  setAutoPopupOn(LS_AUTO_CHARCARD, next, BC_CHARCARD_AUTOPOPUP);
  renderRow();
}
function onCharCardPanel() {
  try {
    OBR.broadcast.sendMessage(
      BC_TOGGLE_CC_PANEL,
      {},
      { destination: "LOCAL" }
    );
  } catch {}
}

async function fetchAnnouncementVersion(): Promise<string | null> {
  try {
    const res = await fetch(ANNOUNCEMENT_MD_URL, { cache: "no-cache" });
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/^\s*-\s*(\d+\.\d+\.\d+(?:[-.][\w]+)*)\s*[·\-—]/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function applyAnnounceBlink() {
  const btn = document.getElementById("btnAnnounce");
  if (!btn) return;
  let seen = "";
  try { seen = localStorage.getItem(LS_ANNOUNCE_SEEN) || ""; } catch {}
  const unread = !!cachedAnnounceVersion && cachedAnnounceVersion !== seen;
  btn.classList.toggle("blink", unread);
}

async function refreshAnnouncementVersion() {
  cachedAnnounceVersion = await fetchAnnouncementVersion();
  applyAnnounceBlink();
}

async function onAnnounce() {
  if (cachedAnnounceVersion) {
    try { localStorage.setItem(LS_ANNOUNCE_SEEN, cachedAnnounceVersion); } catch {}
  }
  applyAnnounceBlink();
  try {
    await OBR.modal.open({
      id: ANNOUNCEMENT_MODAL_ID,
      url: ANNOUNCEMENT_URL,
      width: 560,
      height: 580,
    });
  } catch (e) {
    console.warn("[obr-suite/cluster-row] open announcement failed", e);
  }
  setTimeout(() => { void refreshAnnouncementVersion(); }, 1500);
}

async function onGear() {
  try {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    await OBR.popover.open({
      id: SETTINGS_POPOVER_ID,
      url: SETTINGS_URL,
      width: 640,
      height: 580,
      anchorReference: "POSITION",
      anchorPosition: { left: vw / 2, top: vh / 2 },
      anchorOrigin: { horizontal: "CENTER", vertical: "CENTER" },
      transformOrigin: { horizontal: "CENTER", vertical: "CENTER" },
      hidePaper: true,
    });
  } catch (e) {
    console.error("[obr-suite/cluster-row] open settings failed", e);
  }
}

OBR.onReady(async () => {
  installDebugOverlay();
  OBR.broadcast.onMessage("com.obr-suite/timestop-state", (event) => {
    timeStopActive = !!(event.data as any)?.active;
    renderRow();
  });

  const recheckRole = async () => {
    try {
      const role = await OBR.player.getRole();
      const next = role === "GM";
      if (next !== isGM) {
        isGM = next;
        renderRow();
      }
    } catch (e) {
      console.warn("[obr-suite/cluster-row] getRole failed", e);
    }
  };
  await recheckRole();
  OBR.player.onChange((p) => {
    const next = p.role === "GM";
    if (next !== isGM) {
      isGM = next;
      renderRow();
    }
  });

  startSceneSync();
  onStateChange(() => renderRow());
  onLangChange(() => renderRow());

  OBR.scene.onMetadataChange(() => {
    refreshFromScene().then(() => renderRow());
  });
  OBR.broadcast.onMessage("com.obr-suite/state-changed", () => {
    refreshFromScene().then(() => renderRow());
  });

  await refreshFromScene();
  renderRow();

  // Drag-handle for the row itself. Positioned at the start/end of
  // the row container so the user can grab it without overlapping any
  // button. Side flips based on the BC_PANEL_SIDE_HINT broadcast.
  const dragEl = document.getElementById("row-drag-handle") as HTMLElement | null;
  const wrapEl = document.getElementById("wrap") as HTMLElement | null;
  if (dragEl) {
    bindPanelDrag(dragEl, PANEL_IDS.clusterRow);
    watchDragSide(PANEL_IDS.clusterRow, (side) => {
      applyDragSide(dragEl, side);
      if (wrapEl) wrapEl.setAttribute("data-handle-side", side);
    });
  }

  void refreshAnnouncementVersion();
});
