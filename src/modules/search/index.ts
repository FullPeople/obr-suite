import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";

// Search module — independent always-visible popover at the top-right
// of the OBR viewport, mirroring the legacy 5e-search standalone.
//
// Layout:
//   - Idle:    280×40 (just the input row; clicks pass through below)
//   - Active:  720×440 (input + filter row + dropdown + preview)
// The iframe itself drives the resize via OBR.popover.setWidth/setHeight
// when the user types / clears.
//
// Cluster does NOT have a search input anymore — this popover owns its
// own input row. Other modules can still ASK us to fill the search by
// broadcasting BC_SEARCH_QUERY (e.g. character-card search-chips); the
// iframe listens for the broadcast and runs the query.

const POPOVER_ID = "com.obr-suite/search-bar";
const URL = assetUrl("search-bar.html");

const BAR_W_IDLE = 280;
const BAR_H_IDLE = 40;
const RIGHT_OFFSET = 200;
const TOP_OFFSET = 12;

function isMobileDevice(): boolean {
  const ua = navigator.userAgent || "";
  return /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
}

let unsubs: Array<() => void> = [];
let isOpen = false;
let openInFlight = false;

async function openBar(): Promise<void> {
  if (openInFlight || isOpen) return;
  openInFlight = true;
  try {
    const vw = await OBR.viewport.getWidth();
    try { await OBR.popover.close(POPOVER_ID); } catch {}
    await OBR.popover.open({
      id: POPOVER_ID,
      url: URL,
      width: BAR_W_IDLE,
      height: BAR_H_IDLE,
      anchorReference: "POSITION",
      anchorPosition: { left: vw - RIGHT_OFFSET, top: TOP_OFFSET },
      anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      hidePaper: true,
      // Stays open even when the user clicks the canvas. The iframe
      // collapses itself to BAR_W_IDLE×BAR_H_IDLE on blur, so the
      // popover only physically blocks the small input strip — clicks
      // below it always pass through.
      disableClickAway: true,
    });
    isOpen = true;
  } catch (e) {
    console.error("[obr-suite/search] openPopover failed", e);
  } finally {
    openInFlight = false;
  }
}

async function closeBar(): Promise<void> {
  if (!isOpen) return;
  try { await OBR.popover.close(POPOVER_ID); } catch {}
  isOpen = false;
}

export async function setupSearch(): Promise<void> {
  if (isMobileDevice()) return;

  const showIfReady = async () => {
    try {
      if (await OBR.scene.isReady()) await openBar();
      else await closeBar();
    } catch {}
  };
  await showIfReady();
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (ready) await openBar();
      else await closeBar();
    }),
  );
}

export async function teardownSearch(): Promise<void> {
  for (const u of unsubs.splice(0)) u();
  await closeBar();
}
