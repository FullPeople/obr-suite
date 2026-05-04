import OBR from "@owlbear-rodeo/sdk";
import { subscribeToSfx } from "./modules/dice/sfx-broadcast";
import { assetUrl } from "./asset-base";
import { bindPanelDrag, applyDragSide, watchDragSide } from "./utils/panelDrag";
import { PANEL_IDS } from "./utils/panelLayout";
import { installDebugOverlay } from "./utils/debugOverlay";

// Cluster trigger iframe — JUST the toggle button. Clicking broadcasts
// to background.ts which opens / closes the separate cluster-row popover
// anchored ABOVE this trigger. The trigger never changes size; the row
// is its own popover that overlays above the trigger when toggled on.

const BC_CLUSTER_ROW_TOGGLE = "com.obr-suite/cluster-row-toggle";
const BC_CLUSTER_ROW_STATE = "com.obr-suite/cluster-row-state";

const mainEl = document.getElementById("main") as HTMLButtonElement;
const dragHandleEl = document.getElementById("drag-handle") as HTMLElement | null;
const wrapEl = document.getElementById("wrap") as HTMLElement | null;

mainEl.addEventListener("click", () => {
  try {
    OBR.broadcast.sendMessage(
      BC_CLUSTER_ROW_TOGGLE,
      {},
      { destination: "LOCAL" },
    );
  } catch (e) {
    console.error("[obr-suite/cluster] toggle broadcast failed", e);
  }
});

OBR.onReady(() => {
  // Cluster trigger is always-mounted, so it's a reliable iframe to
  // host AudioContext for shared SFX broadcast.
  subscribeToSfx();
  installDebugOverlay();

  // Reflect the row open-state in the trigger's visual (.is-on glow).
  OBR.broadcast.onMessage(BC_CLUSTER_ROW_STATE, (event) => {
    const data = event.data as { open?: boolean } | undefined;
    mainEl.classList.toggle("is-on", !!data?.open);
  });

  // Drag handle — flips to opposite side of the cluster button based
  // on which half of the viewport the trigger sits on. Background
  // computes the side at open time and passes it through `?side=`.
  if (dragHandleEl) {
    bindPanelDrag(dragHandleEl, PANEL_IDS.cluster);
    watchDragSide(PANEL_IDS.cluster, (side) => {
      applyDragSide(dragHandleEl, side);
      if (wrapEl) wrapEl.setAttribute("data-side", side);
    });
  }
});
// Touch the assetUrl import so unused-import lint stays happy if we
// later want to load assets here.
void assetUrl;
