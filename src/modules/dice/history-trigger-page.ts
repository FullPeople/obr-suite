import OBR from "@owlbear-rodeo/sdk";
import { bindPanelDrag, applyDragSide, watchDragSide } from "../../utils/panelDrag";
import { PANEL_IDS } from "../../utils/panelLayout";
import { installDebugOverlay } from "../../utils/debugOverlay";

// Dice-history TRIGGER iframe — small button at the bottom-right.
// Click broadcasts BC_DICE_HISTORY_TOGGLE; the dice background module
// opens / closes the actual dice-history popover above this trigger.

const BC_DICE_HISTORY_TOGGLE = "com.obr-suite/dice-history-toggle";
const BC_DICE_HISTORY_STATE = "com.obr-suite/dice-history-state";
// Local storage key shared with the dice panel + history popover so we
// can disable the trigger button when the user has no roll history.
const LS_HISTORY = "obr-suite/dice/history";

const mainEl = document.getElementById("main") as HTMLButtonElement;
const dragEl = document.getElementById("drag-handle") as HTMLElement | null;
const wrapEl = document.getElementById("wrap") as HTMLElement | null;

function hasHistory(): boolean {
  try {
    const raw = localStorage.getItem(LS_HISTORY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch { return false; }
}

function refreshDisabled(): void {
  const empty = !hasHistory();
  mainEl.disabled = empty;
  mainEl.title = empty
    ? "投骰记录为空 / Dice log empty"
    : "投骰记录 / Dice Log";
}

mainEl.addEventListener("click", () => {
  if (mainEl.disabled) return;
  try {
    OBR.broadcast.sendMessage(
      BC_DICE_HISTORY_TOGGLE,
      {},
      { destination: "LOCAL" },
    );
  } catch (e) {
    console.error("[obr-suite/dice-history-trigger] toggle broadcast failed", e);
  }
});

OBR.onReady(() => {
  installDebugOverlay();
  OBR.broadcast.onMessage(BC_DICE_HISTORY_STATE, (event) => {
    const data = event.data as { open?: boolean } | undefined;
    mainEl.classList.toggle("is-on", !!data?.open);
  });

  if (dragEl) {
    bindPanelDrag(dragEl, PANEL_IDS.diceHistoryTrigger);
    watchDragSide(PANEL_IDS.diceHistoryTrigger, (side) => {
      applyDragSide(dragEl, side);
      if (wrapEl) wrapEl.setAttribute("data-side", side);
    });
  }

  refreshDisabled();
  // Cross-tab updates: the dice panel writes to LS on every roll, and
  // the history popover writes too. The `storage` event fires in
  // OTHER tabs; the dice panel/popover are separate iframes so this
  // works for our case.
  window.addEventListener("storage", (e) => {
    if (e.key === LS_HISTORY) refreshDisabled();
  });
  // Same-iframe writes don't fire `storage`; poll briefly so the
  // button enables shortly after a fresh roll lands. Cheap (one read
  // per second) and self-stops once disabled state matches.
  setInterval(refreshDisabled, 1000);
});
