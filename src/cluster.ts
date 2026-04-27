import OBR from "@owlbear-rodeo/sdk";
import {
  startSceneSync,
  getState,
  onStateChange,
  refreshFromScene,
  readLS,
  writeLS,
} from "./state";
import { t } from "./i18n";

// Cluster popover internals.

const POPOVER_ID = "com.obr-suite/cluster";
const W_COLLAPSED = 64;
const W_EXPANDED = 540;

const SETTINGS_POPOVER_ID = "com.obr-suite/settings";
const SETTINGS_URL = "https://obr.dnd.center/suite/settings.html";

// Broadcast IDs
const BC_TIMESTOP_TOGGLE = "com.obr-suite/timestop-toggle";
const BC_FOCUS_TRIGGER = "com.obr-suite/focus-trigger";
const BC_BESTIARY_AUTOPOPUP = "com.bestiary/auto-popup-toggled";
const BC_CHARCARD_AUTOPOPUP = "com.character-cards/auto-info-toggled";
const BC_OPEN_CHARCARD_PANEL = "com.character-cards/panel-open";
const BC_TOGGLE_CC_PANEL = "com.obr-suite/cc-panel-toggle";

// Per-client preferences
const LS_EXPANDED = "obr-suite/cluster-expanded";
const LS_AUTO_BESTIARY = "com.bestiary/auto-popup";
const LS_AUTO_CHARCARD = "character-cards/auto-info";

const wrapEl = document.getElementById("wrap") as HTMLDivElement;
const rowEl = document.getElementById("row") as HTMLDivElement;
const mainEl = document.getElementById("main") as HTMLButtonElement;

// Inline SVG icons used in row buttons.
const GEAR_SVG = `<svg class="gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

// State
let expanded = false;          // synced with LS during init below
let timeStopActive = false;
let isGM = false;

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
  const lang = s.language;

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
  // Only render the wrapper group when there is at least one toggle.
  if (popupBtns.length) {
    const labelText = t(lang, "groupLabelPopups");
    const labelChars = Array.from(labelText)
      .map((c) => `<span>${c}</span>`)
      .join("");
    parts.push(
      `<div class="group"><div class="glabel">${labelChars}</div>${popupBtns.join(
        ""
      )}</div>`
    );
  }

  if (s.enabled.characterCards) {
    parts.push(
      btnHTML({
        id: "btnCharCardPanel",
        labelHtml: t(lang, "btnCharCardPanel"),
        title: t(lang, "btnCharCardPanel"),
      })
    );
  }

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
    .getElementById("btnCharCardPanel")
    ?.addEventListener("click", onCharCardPanel);
  document.getElementById("btnGear")?.addEventListener("click", onGear);
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

// TimeStop activity tracking
OBR.broadcast.onMessage("com.obr-suite/timestop-state", (event) => {
  timeStopActive = !!(event.data as any)?.active;
  renderRow();
});

// --- Init ---
OBR.onReady(async () => {
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
