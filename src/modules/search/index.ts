import OBR from "@owlbear-rodeo/sdk";

// Search module — opens the 5etools-powered search bar at top-right of the
// viewport. The page's own iframe (search-bar.html) handles its expand /
// collapse behaviour internally. Suite settings (dataVersion, language,
// allowPlayerMonsters) are read inside the iframe via state.ts.

const POPOVER_ID = "com.obr-suite/search-bar";
const URL = "https://obr.dnd.center/suite/search-bar.html";

const BAR_W = 280;
const BAR_H = 40;
const RIGHT_OFFSET = 200;
const TOP_OFFSET = 12;

async function openSearchPopover() {
  const vw = await OBR.viewport.getWidth();
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
}

export async function setupSearch(): Promise<void> {
  try {
    // ⑤ Bug: on first scene-ready, the popover sometimes fails to render.
    // Workaround: open, then re-open after a short delay so OBR's popover
    // layer settles after the rest of the suite's popovers come up.
    await openSearchPopover();
    setTimeout(() => {
      // Close + reopen forces OBR to re-render the iframe content if the
      // first attempt's iframe didn't finish loading.
      OBR.popover
        .close(POPOVER_ID)
        .then(() => openSearchPopover())
        .catch(() => {});
    }, 600);
  } catch (e) {
    console.error("[obr-suite/search] setup failed", e);
  }
}

export async function teardownSearch(): Promise<void> {
  try { await OBR.popover.close(POPOVER_ID); } catch {}
}
