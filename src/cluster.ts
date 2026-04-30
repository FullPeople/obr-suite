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
import { ICONS } from "./icons";
import { subscribeToSfx } from "./modules/dice/sfx-broadcast";
import { assetUrl } from "./asset-base";

// Crude device detection. OBR doesn't expose one; user-agent matching
// covers the common phone/tablet cases well enough to decide whether to
// hide the fullscreen character-card button (which is unusable on a
// phone-sized viewport).
function isMobileDevice(): boolean {
  const ua = navigator.userAgent || "";
  return /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
}
const IS_MOBILE = isMobileDevice();

// Cluster popover internals.

const POPOVER_ID = "com.obr-suite/cluster";
const W_COLLAPSED = 64;
// Was 540 before the inline-search input moved into the cluster.
// Bumped to fit the buttons + a usable search-input width without
// the row wrapping to two lines on the default 中文 setup.
// Cap the expanded width — instead of stretching wider for long-label
// languages, we let the inner row wrap onto a second line. Same width
// for every language; height grows when wrapping happens, and the
// search bar listens for the new height to slide down accordingly.
const W_EXPANDED = 760;
const H_COLLAPSED = 64;

const SETTINGS_POPOVER_ID = "com.obr-suite/settings";
const SETTINGS_URL = assetUrl("settings.html");

// Broadcast IDs
const BC_TIMESTOP_TOGGLE = "com.obr-suite/timestop-toggle";
const BC_FOCUS_TRIGGER = "com.obr-suite/focus-trigger";
const BC_BESTIARY_AUTOPOPUP = "com.bestiary/auto-popup-toggled";
const BC_CHARCARD_AUTOPOPUP = "com.character-cards/auto-info-toggled";
const BC_OPEN_CHARCARD_PANEL = "com.character-cards/panel-open";
const BC_TOGGLE_CC_PANEL = "com.obr-suite/cc-panel-toggle";
// Dice-history popover (bottom-left). Same shape as the bestiary /
// cc auto-popup toggles — per-client localStorage preference + a
// LOCAL broadcast that the dice background module listens for.
const BC_DICE_HISTORY_TOGGLE = "com.obr-suite/dice-history-toggle";

// Per-client preferences
const LS_EXPANDED = "obr-suite/cluster-expanded";
const LS_AUTO_BESTIARY = "com.bestiary/auto-popup";
const LS_AUTO_CHARCARD = "character-cards/auto-info";
const LS_AUTO_DICE_HISTORY = "com.obr-suite/dice-history-on";

const wrapEl = document.getElementById("wrap") as HTMLDivElement;
const rowEl = document.getElementById("row") as HTMLDivElement;
const mainEl = document.getElementById("main") as HTMLButtonElement;

// Inline SVG icons used in row buttons.
const GEAR_SVG = `<svg class="gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

// State
let expanded = false;          // synced with LS during init below
let timeStopActive = false;
let isGM = false;
// Last known cluster height (popover height) — used to dedupe setHeight
// + broadcast calls so the search bar isn't churning every render.
let lastClusterHeight = H_COLLAPSED;

const BC_CLUSTER_LAYOUT = "com.obr-suite/cluster-layout";

function clusterEl(): HTMLDivElement | null {
  return document.getElementById("cluster") as HTMLDivElement | null;
}

// Measure the cluster's actual rendered height and apply it to the
// popover + broadcast it to other modules (the search bar listens so it
// can slide its top offset down when the cluster wraps to 2 rows). Calls
// after a renderRow / applyExpanded should run on rAF so layout has
// settled. Idempotent — only fires when the value changes.
function syncClusterHeight() {
  requestAnimationFrame(() => {
    let h = H_COLLAPSED;
    if (expanded) {
      const el = clusterEl();
      if (el) h = Math.max(H_COLLAPSED, Math.round(el.getBoundingClientRect().height));
    }
    if (h === lastClusterHeight) return;
    lastClusterHeight = h;
    OBR.popover.setHeight(POPOVER_ID, h).catch(() => {});
    OBR.broadcast
      .sendMessage(BC_CLUSTER_LAYOUT, { height: h, expanded }, { destination: "LOCAL" })
      .catch(() => {});
  });
}

// applyExpanded runs ONLY on user click after init. It updates the visual
// state, persists to localStorage, AND calls setWidth ONCE. No retries,
// no setTimeout pulses — those caused flicker on rapid toggles.
async function applyExpanded(next: boolean) {
  if (next === expanded) return;
  expanded = next;
  writeLS(LS_EXPANDED, next ? "1" : "0");
  wrapEl.classList.toggle("expanded", next);
  try { renderRow(); } catch (e) { console.error("[obr-suite/cluster] renderRow failed", e); }
  try {
    await OBR.popover.setWidth(POPOVER_ID, next ? W_EXPANDED : W_COLLAPSED);
  } catch (e) {
    console.warn("[obr-suite/cluster] setWidth failed", e);
  }
  // Height may need to grow if buttons wrap onto a second line. Re-measure
  // after the row has rendered + setWidth is in flight.
  syncClusterHeight();
}

mainEl.addEventListener("click", () => {
  applyExpanded(!expanded).catch((e) => {
    console.error("[obr-suite/cluster] applyExpanded failed", e);
  });
});

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
  labelHtml: string;        // raw HTML (allows <svg> for gear)
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

function renderRow() {
  const s = getState();
  const lang = getLocalLang();

  const parts: string[] = [];

  // GM-only: time stop, sync viewport — only if module enabled.
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

  // === Popup toggles (悬浮窗) — only the toggles whose modules are enabled
  const popupBtns: string[] = [];
  // Bestiary popup is GM-only — players never see the bestiary so they
  // shouldn't have a toggle for its monster info popover either.
  if (isGM && s.enabled.bestiary) {
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
  // Dice history popover toggle — visible to ALL roles (DM and
  // players both want a glanceable last-roll feed). The popover
  // itself sits bottom-left when on. Default ON.
  if (s.enabled.dice) {
    popupBtns.push(
      btnHTML({
        id: "btnDiceHistoryPopup",
        labelHtml: lang === "zh" ? "投骰记录" : "Dice Log",
        toggle: true,
        on: isAutoPopupOn(LS_AUTO_DICE_HISTORY),
        title: lang === "zh" ? "投骰记录浮窗" : "Dice history popover",
      })
    );
  }
  // Only render the wrapper group when there is at least one toggle.
  if (popupBtns.length) {
    const labelText = t(lang, "groupLabelPopups");
    // For Chinese the 悬浮窗 label is 3 chars stacked vertically (one per
    // line); for any other language we render it as a single horizontal
    // label so it doesn't get character-broken into "A\nu\nt\no...".
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

  // The dice button used to live here. It now lives as the suite's
  // native OBR action button (top-left corner), configured via the
  // `action` block in manifest.json. Keeping the cluster slot empty
  // here so the rest of the cluster row layout is unchanged.

  // 角色卡界面 button — fullscreen panel, hidden on phone-sized devices
  // since the panel layout assumes desktop width.
  if (s.enabled.characterCards && !IS_MOBILE) {
    parts.push(
      btnHTML({
        id: "btnCharCardPanel",
        labelHtml: t(lang, "btnCharCardPanel"),
        title: t(lang, "btnCharCardPanel"),
      })
    );
  }

  // Search input now lives in its OWN top-right popover (not in the
  // cluster). See modules/search/index.ts.

  // Merged settings/about gear — always present.
  parts.push(
    btnHTML({
      id: "btnGear",
      labelHtml: GEAR_SVG,
      title: `${t(lang, "btnSettings")} / ${t(lang, "btnAbout")}`,
    })
  );

  rowEl.innerHTML = parts.join("");

  // Wire handlers.
  document.getElementById("btnTimeStop")?.addEventListener("click", onTimeStop);
  document.getElementById("btnFocus")?.addEventListener("click", onFocus);
  document
    .getElementById("btnBestiaryPopup")
    ?.addEventListener("click", onBestiaryPopup);
  document
    .getElementById("btnCharCardPopup")
    ?.addEventListener("click", onCharCardPopup);
  document
    .getElementById("btnDiceHistoryPopup")
    ?.addEventListener("click", onDiceHistoryPopup);
  document
    .getElementById("btnCharCardPanel")
    ?.addEventListener("click", onCharCardPanel);
  // Dice panel handler removed — dice now lives in the OBR action.
  document.getElementById("btnGear")?.addEventListener("click", onGear);

  // Re-measure after layout updates so the popover height tracks the
  // actual wrapped row count (and the search bar follows along).
  syncClusterHeight();
}

// --- Button handlers ---
function onTimeStop() {
  try {
    OBR.broadcast.sendMessage(
      BC_TIMESTOP_TOGGLE,
      { source: "cluster" },
      { destination: "LOCAL" }
    );
  } catch {}
}

function onFocus() {
  try {
    OBR.broadcast.sendMessage(
      BC_FOCUS_TRIGGER,
      { source: "cluster" },
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
function onDiceHistoryPopup() {
  const next = !isAutoPopupOn(LS_AUTO_DICE_HISTORY);
  setAutoPopupOn(LS_AUTO_DICE_HISTORY, next, BC_DICE_HISTORY_TOGGLE);
  renderRow();
}
function onCharCardPanel() {
  // Toggle: open if closed, close if open. The cc module listens for the
  // toggle broadcast and decides which side to call.
  try {
    OBR.broadcast.sendMessage(
      BC_TOGGLE_CC_PANEL,
      {},
      { destination: "LOCAL" }
    );
  } catch {}
}

function onDicePanel() {
  // Toggle the dice panel popover. The dice module owns the
  // open/close logic (it knows the popover ID + URL).
  try {
    OBR.broadcast.sendMessage(
      "com.obr-suite/dice-panel-toggle",
      {},
      { destination: "LOCAL" }
    );
  } catch {}
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
    console.error("[obr-suite] open settings failed", e);
  }
}

// --- Init ---
OBR.onReady(async () => {
  // Subscribe this iframe to dice-effect SFX broadcasts. Cluster is
  // always-present and frequently clicked, so its AudioContext is
  // usually warm enough to play sounds when dice-effect (which has
  // disablePointerEvents and can never warm its own context) requests
  // them.
  subscribeToSfx();

  // TimeStop activity tracking — must be inside OBR.onReady, otherwise
  // calling broadcast.onMessage too early throws "Unable to send message:
  // not ready".
  OBR.broadcast.onMessage("com.obr-suite/timestop-state", (event) => {
    timeStopActive = !!(event.data as any)?.active;
    renderRow();
  });

  // Robust role detection: try getRole, then also subscribe to player
  // changes so any future role updates (or successful role read) refresh
  // the buttons. Some OBR sessions take a moment to settle the role.
  const recheckRole = async () => {
    try {
      const role = await OBR.player.getRole();
      const next = role === "GM";
      if (next !== isGM) {
        isGM = next;
        renderRow();
      }
    } catch (e) {
      console.warn("[obr-suite/cluster] getRole failed", e);
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

  // Read expanded state from URL query param (set by background.ts) so the
  // cluster iframe always knows the persisted state at load — no race with
  // localStorage cross-iframe sync. The popover was already opened at the
  // correct width by background.ts, so we just sync the CSS class.
  const params = new URLSearchParams(location.search);
  expanded = params.get("expanded") === "1";
  wrapEl.classList.toggle("expanded", expanded);

  startSceneSync();
  onStateChange(() => renderRow());
  // Per-client language: re-render when this iframe's localStorage lang
  // is changed (settings panel writes it). Players + DM are independent.
  // Width is fixed at W_EXPANDED for every language; if labels can't
  // fit (English) the row wraps and the height grows — which the
  // sync logic below then propagates to the popover height + the
  // search bar's anchor.
  onLangChange(() => {
    renderRow();
    syncClusterHeight();
  });

  // Belt-and-suspenders #1: scene metadata listener for cross-iframe sync.
  OBR.scene.onMetadataChange(() => {
    refreshFromScene().then(() => renderRow());
  });

  // Belt-and-suspenders #2: explicit broadcast that setState fires after
  // every change. This is what makes the cluster reliably re-render when
  // the DM toggles a module in Settings.
  OBR.broadcast.onMessage("com.obr-suite/state-changed", () => {
    refreshFromScene().then(() => renderRow());
  });

  // Initial state load + render.
  await refreshFromScene();
  renderRow();
});
