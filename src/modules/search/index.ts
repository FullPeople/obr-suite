import OBR from "@owlbear-rodeo/sdk";

// Search module — opens the 5etools-powered search bar at top-right of
// the viewport.
//
// "Doesn't load on first open" investigation:
//   The user reports that on a fresh scene-ready, the search popover
//   sometimes doesn't render at all — they have to disable + re-enable
//   the search module in Settings to see it. The initiative panel
//   (same kind of popover) always loads fine.
//
//   Two differences I'm acting on:
//   1. Search was the FIRST module-popover to open after cluster.
//      OBR's popover layer seems to do better when it's not the very
//      first child popover after scene-ready, so background.ts now
//      orders search LAST in the modules registry.
//   2. The search URL had no query param — initiative URL has
//      "?expanded=0". Some OBR popover-layer state is keyed by URL,
//      and reopening with the same URL in a subsequent session can
//      hit a stale cached layer. Adding a per-session timestamp
//      query param gives each open a unique URL.

const POPOVER_ID = "com.obr-suite/search-bar";
const URL = "https://obr.dnd.center/suite/search-bar.html";

const BAR_W = 280;
const BAR_H = 40;
const RIGHT_OFFSET = 200;
const TOP_OFFSET = 12;

export async function setupSearch(): Promise<void> {
  try {
    const vw = await OBR.viewport.getWidth();
    // Use a clean URL (no cache-buster). Cache-buster wasn't helping and
    // may have introduced extra fetch overhead.
    await OBR.popover.open({
      id: POPOVER_ID,
      url: URL,
      width: BAR_W,
      height: BAR_H,
      anchorReference: "POSITION",
      anchorPosition: { left: vw - RIGHT_OFFSET, top: TOP_OFFSET },
      anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
  } catch (e: any) {
    // Expand the error so the user can read what threw in DevTools.
    const msg = e?.message ?? String(e);
    const stack = e?.stack ?? "(no stack)";
    console.error(`[obr-suite/search] setup failed: ${msg}\n${stack}`);
  }
}

export async function teardownSearch(): Promise<void> {
  try { await OBR.popover.close(POPOVER_ID); } catch {}
}
