import OBR from "@owlbear-rodeo/sdk";

// Dev-only "position test panel" — verifies whether OBR.popover.open
// can re-anchor an already-open popover to a different corner of the
// viewport without an unacceptable visual flicker. Used as a probe
// before re-architecting cluster / dice-history / etc. as draggable
// "floating ball" entry points.
//
// Tool button: a small dev icon in the canvas toolbar (DM only).
// Clicking opens the test popover at top-left. The popover's 9
// quadrant buttons broadcast BC_MOVE { corner }; the bg handler
// re-issues OBR.popover.open with the matching anchor params so we
// can directly observe what works.
//
// The whole thing is gated on `import.meta.env.BASE_URL` containing
// `/suite-dev/` so the stable build never registers it.

const TOOL_ID = "com.obr-suite/dev-test-tool";
const POPOVER_ID = "com.obr-suite/dev-test-panel";
const BASE_URL = import.meta.env.BASE_URL || "/suite/";
const PANEL_URL = `https://obr.dnd.center${BASE_URL}test-panel.html`;
const ICON_URL = `https://obr.dnd.center${BASE_URL}icon.svg`;

const BC_MOVE = "com.obr-suite/dev-test-move";
const BC_INFO = "com.obr-suite/dev-test-info";
const BC_INFO_REQUEST = "com.obr-suite/dev-test-info-request";

const PANEL_W = 320;
const PANEL_H = 240;
const EDGE = 16; // safety margin from viewport edge

type Corner = "TL" | "TC" | "TR" | "ML" | "CC" | "MR" | "BL" | "BC" | "BR";

interface AnchorSpec {
  anchorPosition: { left: number; top: number };
  anchorOrigin: { horizontal: "LEFT" | "CENTER" | "RIGHT"; vertical: "TOP" | "CENTER" | "BOTTOM" };
  transformOrigin: { horizontal: "LEFT" | "CENTER" | "RIGHT"; vertical: "TOP" | "CENTER" | "BOTTOM" };
  label: string;
}

let unsubs: Array<() => void> = [];
let lastCorner: Corner = "TL";

async function computeAnchor(corner: Corner): Promise<AnchorSpec> {
  const [vw, vh] = await Promise.all([
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);
  switch (corner) {
    case "TL":
      return {
        anchorPosition: { left: EDGE, top: EDGE },
        anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
        transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
        label: `TL (${EDGE},${EDGE})`,
      };
    case "TC":
      return {
        anchorPosition: { left: Math.round(vw / 2), top: EDGE },
        anchorOrigin: { horizontal: "CENTER", vertical: "TOP" },
        transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
        label: `TC (${Math.round(vw / 2)},${EDGE})`,
      };
    case "TR":
      return {
        anchorPosition: { left: vw - EDGE, top: EDGE },
        anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" },
        transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
        label: `TR (${vw - EDGE},${EDGE})`,
      };
    case "ML":
      return {
        anchorPosition: { left: EDGE, top: Math.round(vh / 2) },
        anchorOrigin: { horizontal: "LEFT", vertical: "CENTER" },
        transformOrigin: { horizontal: "LEFT", vertical: "CENTER" },
        label: `ML (${EDGE},${Math.round(vh / 2)})`,
      };
    case "CC":
      return {
        anchorPosition: { left: Math.round(vw / 2), top: Math.round(vh / 2) },
        anchorOrigin: { horizontal: "CENTER", vertical: "CENTER" },
        transformOrigin: { horizontal: "CENTER", vertical: "CENTER" },
        label: `CC (${Math.round(vw / 2)},${Math.round(vh / 2)})`,
      };
    case "MR":
      return {
        anchorPosition: { left: vw - EDGE, top: Math.round(vh / 2) },
        anchorOrigin: { horizontal: "RIGHT", vertical: "CENTER" },
        transformOrigin: { horizontal: "RIGHT", vertical: "CENTER" },
        label: `MR (${vw - EDGE},${Math.round(vh / 2)})`,
      };
    case "BL":
      return {
        anchorPosition: { left: EDGE, top: vh - EDGE },
        anchorOrigin: { horizontal: "LEFT", vertical: "BOTTOM" },
        transformOrigin: { horizontal: "LEFT", vertical: "BOTTOM" },
        label: `BL (${EDGE},${vh - EDGE})`,
      };
    case "BC":
      return {
        anchorPosition: { left: Math.round(vw / 2), top: vh - EDGE },
        anchorOrigin: { horizontal: "CENTER", vertical: "BOTTOM" },
        transformOrigin: { horizontal: "CENTER", vertical: "BOTTOM" },
        label: `BC (${Math.round(vw / 2)},${vh - EDGE})`,
      };
    case "BR":
      return {
        anchorPosition: { left: vw - EDGE, top: vh - EDGE },
        anchorOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
        transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
        label: `BR (${vw - EDGE},${vh - EDGE})`,
      };
  }
}

async function openAt(corner: Corner): Promise<void> {
  lastCorner = corner;
  const spec = await computeAnchor(corner);
  // The probe: does OBR.popover.open on an already-open popover
  // re-anchor smoothly, or does it require an explicit close first?
  // Try the no-close path first; if visual artifacts show, switch
  // to close + open.
  try { await OBR.popover.close(POPOVER_ID); } catch {}
  await OBR.popover.open({
    id: POPOVER_ID,
    url: PANEL_URL,
    width: PANEL_W,
    height: PANEL_H,
    anchorReference: "POSITION",
    anchorPosition: spec.anchorPosition,
    anchorOrigin: spec.anchorOrigin,
    transformOrigin: spec.transformOrigin,
    hidePaper: true,
    disableClickAway: true,
  });
  // Push the current anchor label back to the iframe so the head
  // shows what's active. Slight delay so the iframe's onMessage
  // listener has time to register.
  setTimeout(() => {
    void OBR.broadcast.sendMessage(
      BC_INFO,
      {
        label: spec.label,
        note: `corner=<b>${corner}</b> · anchorOrigin/transformOrigin = <b>${spec.anchorOrigin.vertical} ${spec.anchorOrigin.horizontal}</b>`,
      },
      { destination: "LOCAL" },
    );
  }, 80);
}

export async function setupDevTest(): Promise<void> {
  // Stable build: skip registration entirely so the dev-only tool
  // doesn't ship to live users.
  if (!BASE_URL.includes("/suite-dev/")) return;
  let role: "GM" | "PLAYER" = "PLAYER";
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}
  if (role !== "GM") return;

  await OBR.tool.create({
    id: TOOL_ID,
    icons: [
      {
        icon: ICON_URL,
        label: "Dev: Position Test",
        filter: { roles: ["GM"] },
      },
    ],
    onClick: async () => {
      await openAt(lastCorner);
      return false;
    },
  });

  unsubs.push(
    OBR.broadcast.onMessage(BC_MOVE, async (event) => {
      const data = event.data as { corner?: string } | undefined;
      const c = data?.corner;
      if (
        c === "TL" || c === "TC" || c === "TR" ||
        c === "ML" || c === "CC" || c === "MR" ||
        c === "BL" || c === "BC" || c === "BR"
      ) {
        await openAt(c);
      }
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_INFO_REQUEST, async () => {
      const spec = await computeAnchor(lastCorner);
      await OBR.broadcast.sendMessage(
        BC_INFO,
        {
          label: spec.label,
          note: `corner=<b>${lastCorner}</b> · anchorOrigin = <b>${spec.anchorOrigin.vertical} ${spec.anchorOrigin.horizontal}</b>`,
        },
        { destination: "LOCAL" },
      );
    }),
  );
}

export async function teardownDevTest(): Promise<void> {
  if (!BASE_URL.includes("/suite-dev/")) return;
  for (const u of unsubs.splice(0)) u();
  try { await OBR.popover.close(POPOVER_ID); } catch {}
  try { await OBR.tool.remove(TOOL_ID); } catch {}
}
