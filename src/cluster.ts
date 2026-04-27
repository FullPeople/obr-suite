import OBR from "@owlbear-rodeo/sdk";
import {
  startSceneSync,
  getState,
  onStateChange,
  readLS,
  writeLS,
} from "./state";
import { t } from "./i18n";

// Cluster popover internals. Background.ts opened this iframe at 64×64,
// bottom-right anchored. We grow horizontally (LEFT) when the user clicks
// the main button, by asking OBR to resize the popover via setWidth.

const POPOVER_ID = "com.obr-suite/cluster";
const W_COLLAPSED = 64;
const W_EXPANDED = 540;
const H = 64;

const SETTINGS_POPOVER_ID = "com.obr-suite/settings";
const ABOUT_MODAL_ID = "com.obr-suite/about";
const SETTINGS_URL = "https://obr.dnd.center/suite/settings.html";
const ABOUT_URL = "https://obr.dnd.center/suite/about.html";

// Broadcast messages — these signal to the relevant module's setup() handler
// (or, for not-yet-migrated features, to the corresponding standalone plugin)
// that the user clicked something in the cluster.
const BC_TIMESTOP_TOGGLE = "com.obr-suite/timestop-toggle";
const BC_FOCUS_TRIGGER = "com.obr-suite/focus-trigger";
// Cross-plugin compatibility (works against both the unified suite and the
// existing standalone plugins, until migration finishes):
const BC_BESTIARY_AUTOPOPUP = "com.bestiary/auto-popup-toggled";
const BC_CHARCARD_AUTOPOPUP = "com.character-cards/auto-info-toggled";
const BC_OPEN_CHARCARD_PANEL = "com.character-cards/panel-open";

// Per-client preferences (auto-popup toggles, expanded state).
const LS_EXPANDED = "obr-suite/cluster-expanded";
const LS_AUTO_BESTIARY = "com.bestiary/auto-popup";
const LS_AUTO_CHARCARD = "character-cards/auto-info";

const wrapEl = document.getElementById("wrap") as HTMLDivElement;
const rowEl = document.getElementById("row") as HTMLDivElement;
const mainEl = document.getElementById("main") as HTMLButtonElement;

let expanded = readLS(LS_EXPANDED, "0") === "1";
let timeStopActive = false;
let isGM = false;

async function setPopoverWidth(w: number) {
  try { await OBR.popover.setWidth(POPOVER_ID, w); } catch {}
}

async function applyExpanded(next: boolean) {
  expanded = next;
  writeLS(LS_EXPANDED, next ? "1" : "0");
  wrapEl.classList.toggle("expanded", next);
  await setPopoverWidth(next ? W_EXPANDED : W_COLLAPSED);
  if (next) renderRow();
}

mainEl.addEventListener("click", () => {
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
  label: string;
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
  )}" type="button" title="${opts.title ?? opts.label}">${opts.label}</button>`;
}

function renderRow() {
  const s = getState();
  const lang = s.language;

  const parts: string[] = [];

  if (s.enabled.timeStop) {
    parts.push(
      btnHTML({
        id: "btnTimeStop",
        label: t(lang, "btnTimeStop"),
        active: timeStopActive,
      })
    );
  }
  if (s.enabled.focus) {
    parts.push(btnHTML({ id: "btnFocus", label: t(lang, "btnFocus") }));
  }

  // Grouped popup toggles (悬浮窗)
  const popupBtns: string[] = [];
  if (s.enabled.bestiary) {
    popupBtns.push(
      btnHTML({
        id: "btnBestiaryPopup",
        label: t(lang, "btnBestiaryPopup"),
        toggle: true,
        on: isAutoPopupOn(LS_AUTO_BESTIARY),
      })
    );
  }
  if (s.enabled.characterCards) {
    popupBtns.push(
      btnHTML({
        id: "btnCharCardPopup",
        label: t(lang, "btnCharCardPopup"),
        toggle: true,
        on: isAutoPopupOn(LS_AUTO_CHARCARD),
      })
    );
  }
  if (popupBtns.length) {
    parts.push(
      `<div class="group"><span class="glabel">${t(
        lang,
        "groupLabelPopups"
      )}</span>${popupBtns.join("")}</div>`
    );
  }

  if (s.enabled.characterCards) {
    parts.push(
      btnHTML({ id: "btnCharCardPanel", label: t(lang, "btnCharCardPanel") })
    );
  }

  parts.push(btnHTML({ id: "btnSettings", label: t(lang, "btnSettings") }));
  parts.push(btnHTML({ id: "btnAbout", label: t(lang, "btnAbout") }));

  rowEl.innerHTML = parts.join("");

  // Wire handlers
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
  document.getElementById("btnSettings")?.addEventListener("click", onSettings);
  document.getElementById("btnAbout")?.addEventListener("click", onAbout);
}

// --- Button handlers ---
function onTimeStop() {
  // Tell the time-stop module to toggle. (For backward-compat with the
  // standalone time-stop plugin, the existing right-click flow still works.)
  try {
    OBR.broadcast.sendMessage(
      BC_TIMESTOP_TOGGLE,
      { source: "cluster" },
      { destination: "LOCAL" }
    );
  } catch {}
}

function onFocus() {
  // Trigger a focus-camera at the current selection center, or screen center.
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
  // Tell character-cards plugin to open its panel.
  try {
    OBR.broadcast.sendMessage(
      BC_OPEN_CHARCARD_PANEL,
      {},
      { destination: "LOCAL" }
    );
  } catch {}
}

async function onSettings() {
  try {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    await OBR.popover.open({
      id: SETTINGS_POPOVER_ID,
      url: SETTINGS_URL,
      width: 460,
      height: 560,
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

async function onAbout() {
  try {
    await OBR.modal.open({
      id: ABOUT_MODAL_ID,
      url: ABOUT_URL,
      width: 580,
      height: 680,
    });
  } catch (e) {
    console.error("[obr-suite] open about failed", e);
  }
}

// --- TimeStop activity tracking — module broadcasts state so we can color the
// cluster button when on. ---
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
  onStateChange(() => renderRow());

  // Apply initial expanded state.
  await applyExpanded(expanded);
  renderRow();
});
