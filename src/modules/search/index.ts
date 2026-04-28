import OBR from "@owlbear-rodeo/sdk";

// Search module — opens the 5etools-powered search bar at top-right of
// the viewport.
//
// Strategy: open the popover once at setup time and trust OBR's popover
// layer (same pattern as initiative). The popover host page renders a
// static search box immediately; data (5etools index + books) is loaded
// lazily on first user interaction.
//
// Vertical position: the search bar sits below the cluster. The cluster
// can wrap onto a second row when long-label languages overflow its
// max width, so we listen for the cluster's layout broadcast and slide
// our top offset down to clear it. When it changes, we tear-down and
// re-open the popover (OBR has no setPosition for popovers).

const POPOVER_ID = "com.obr-suite/search-bar";
const URL = "https://obr.dnd.center/suite/search-bar.html";
const BC_CLUSTER_LAYOUT = "com.obr-suite/cluster-layout";
const BC_SEARCH_QUERY = "com.obr-suite/search-query";
// Cluster broadcasts this when it wants the search popover dismissed
// (e.g. user pressed Esc / clicked the ✕ in the cluster's input).
const BC_SEARCH_CLOSE = "com.obr-suite/search-close";

// The popover anchor sits BELOW the cluster + offset. Width is sized
// to fit the dropdown / preview comfortably; the cluster's inline
// input is the typed-into element so the popover doesn't need an
// input row.
const BAR_W = 720;
const BAR_H = 440;
const RIGHT_OFFSET = 65;
const CLUSTER_TOP_OFFSET = 14;
const GAP_BELOW_CLUSTER = 8;
// Generous default so the popover lands BELOW even an expanded /
// wrapped cluster on first open, before BC_CLUSTER_LAYOUT arrives.
const DEFAULT_CLUSTER_HEIGHT = 130;

function topOffsetFor(clusterHeight: number): number {
  return CLUSTER_TOP_OFFSET + clusterHeight + GAP_BELOW_CLUSTER;
}

function isMobileDevice(): boolean {
  const ua = navigator.userAgent || "";
  return /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
}

let unsubs: Array<() => void> = [];
// Track open state so layout-broadcast reposition only fires when
// the popover is actually visible. Without this, scene events that
// re-render the cluster (height changes, language switch, etc.)
// would re-open the popover even when the user has dismissed it —
// the "popover reappears on token move / monster spawn" bug.
let isOpen = false;
let lastClusterHeight = DEFAULT_CLUSTER_HEIGHT;
let openInFlight = false;

async function openBar(): Promise<void> {
  if (openInFlight || isOpen) return;
  openInFlight = true;
  try {
    const vw = await OBR.viewport.getWidth();
    const top = topOffsetFor(lastClusterHeight);
    try { await OBR.popover.close(POPOVER_ID); } catch {}
    await OBR.popover.open({
      id: POPOVER_ID,
      url: URL,
      width: BAR_W,
      height: BAR_H,
      anchorReference: "POSITION",
      anchorPosition: { left: vw - RIGHT_OFFSET, top },
      anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      hidePaper: true,
      // disableClickAway:true so OBR doesn't auto-close the popover
      // when the user clicks the canvas / a different popover —
      // closing is driven explicitly via BC_SEARCH_CLOSE (Esc / ✕)
      // and via the in-iframe click-away handler below.
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

  // Eager-open at setup. The popover stays open the whole session;
  // its iframe content is invisible (transparent body, no contents)
  // when query is empty. This avoids the open-then-deliver race we
  // hit when trying to lazy-open per query — the BC_SEARCH_QUERY
  // listener inside the iframe wasn't registered yet when the
  // opening broadcast arrived.
  await openBar();

  // Cluster height changes — track for repositioning. Re-open at
  // new offset only if the popover is currently open (we don't
  // resurrect closed popovers from cluster events).
  unsubs.push(
    OBR.broadcast.onMessage(BC_CLUSTER_LAYOUT, async (event) => {
      const h = (event.data as any)?.height;
      if (typeof h !== "number" || h <= 0) return;
      if (h === lastClusterHeight) return;
      lastClusterHeight = h;
      if (!isOpen) return;
      try { await OBR.popover.close(POPOVER_ID); } catch {}
      isOpen = false;
      await openBar();
    }),
  );

  // Explicit close request (Esc / ✕ in cluster's input). Only
  // affects the popover's open/closed state — the iframe will
  // re-open the next time setup runs (scene-ready / module enable).
  unsubs.push(
    OBR.broadcast.onMessage(BC_SEARCH_CLOSE, async () => {
      await closeBar();
    }),
  );

  // When user types something, ensure popover is open. (Normally it
  // already is from eager-open above, but if a click-away closed it,
  // typing should re-open.)
  unsubs.push(
    OBR.broadcast.onMessage(BC_SEARCH_QUERY, async (event) => {
      const q = (event.data as { q?: string } | undefined)?.q ?? "";
      if (q.trim().length > 0 && !isOpen) {
        await openBar();
      }
    }),
  );
}

export async function teardownSearch(): Promise<void> {
  for (const u of unsubs.splice(0)) u();
  await closeBar();
}
