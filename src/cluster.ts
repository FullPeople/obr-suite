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
let initialApplied = false;     // guards first applyExpanded

async function setPopoverWidth(w: number) {
  try { await OBR.popover.setWidth(POPOVER_ID, w); } catch {}
}

async function applyExpanded(next: boolean) {
  expanded = next;
  writeLS(LS_EXPANDED, next ? "1" : "0");
  wrapEl.classList.toggle("expanded", next);
  // Always render the row (it's hidden by CSS when collapsed). Doing this
  // on EVERY apply ensures the buttons are pre-built before the popover
  // visually expands, so the first expand always shows them.
  renderRow();
  await setPopoverWidth(next ? W_EXPANDED : W_COLLAPSED);
}

mainEl.addEventListener("click", () => {
  // Guard against the rare race where the user clicks before init has
  // finished applying initial state.
  if (!initialApplied) return;
  applyExpanded(!expanded).catch(() => {});
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
  try {
    isGM = (await OBR.player.getRole()) === "GM";
  } catch {}

  startSceneSync();

  // ⑨ Re-render on every state change so disabled-module toggles disappear
  // immediately when the DM flips them. Also belt-and-suspenders subscribe
  // directly to scene metadata changes for resilience.
  onStateChange(() => renderRow());
  OBR.scene.onMetadataChange(() => {
    refreshFromScene().then(() => renderRow());
  });

  // Read persisted expanded state and apply.
  expanded = readLS(LS_EXPANDED, "0") === "1";
  await applyExpanded(expanded);
  initialApplied = true;
});
