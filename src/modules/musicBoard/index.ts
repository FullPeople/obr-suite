/* Music board module — owns:
 *   • The background-resident engine (audio + PeerJS) — survives
 *     popover open/close cycles. See engine.ts.
 *   • The OBR tool button that opens the (thin viewer) popover.
 *
 * Dev-only (gated in background.ts via STABLE_HIDES).
 */

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { setupMusicEngine, teardownMusicEngine } from "./engine";

const ACTION_ID  = "com.obr-suite/music-board";
const POPOVER_ID = "com.obr-suite/music-board/popover";
const ICON_URL   = assetUrl("music-board-icon.svg");
const PAGE_URL   = assetUrl("music-board.html");

const POPOVER_W = 380;
const POPOVER_H = 540;

export async function setupMusicBoard(): Promise<void> {
  // 1) Register the tool button FIRST so user always sees the icon,
  //    even if the engine setup blows up below. Filter explicitly to
  //    show on all roles — without `filter` some OBR builds quietly
  //    hide the icon depending on activation state.
  try {
    await OBR.tool.create({
      id: ACTION_ID,
      icons: [
        {
          icon: ICON_URL,
          label: "音乐板 (听)",
          filter: { roles: ["GM", "PLAYER"] },
        },
      ],
      onClick: () => {
        void openPopover();
        return false;
      },
    });
    console.info("[music-board] tool registered:", ACTION_ID);
  } catch (e) {
    console.error("[music-board] tool.create failed", e);
  }

  // 2) Engine lives in the background context — created once, survives
  //    popover open/close so audio + PeerJS connection persist. Wrap
  //    in try/catch so any failure here can't break the tool button.
  try {
    await setupMusicEngine();
    console.info("[music-board] engine started");
  } catch (e) {
    console.error("[music-board] engine setup failed", e);
  }
}

let popoverOpen = false;

async function openPopover(): Promise<void> {
  if (popoverOpen) {
    try { await OBR.popover.close(POPOVER_ID); } catch {}
    popoverOpen = false;
    return;
  }

  // Right-edge placement. OBR.viewport.getWidth() returns the scene
  // canvas width which can be unexpectedly small in some setups (the
  // user reported the popover covering the left toolbar). Defensive
  // floor + a window.innerWidth fallback keeps the popover anchored
  // to the right regardless.
  let vw = 0, vh = 0;
  try { vw = await OBR.viewport.getWidth(); } catch {}
  try { vh = await OBR.viewport.getHeight(); } catch {}
  vw = Math.max(vw || 0, window.innerWidth || 0, 1024);
  vh = Math.max(vh || 0, window.innerHeight || 0, 720);

  try {
    await OBR.popover.open({
      id: POPOVER_ID,
      url: PAGE_URL,
      width: POPOVER_W,
      height: Math.min(POPOVER_H, vh - 80),
      anchorReference: "POSITION",
      // Place the anchor at the right edge with a small inset; the
      // RIGHT/TOP transformOrigin means the popover's right edge
      // aligns to this point, so it always sits on the right side.
      anchorPosition: { left: vw - 16, top: 56 },
      anchorOrigin:    { horizontal: "RIGHT", vertical: "TOP" },
      transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
    popoverOpen = true;
  } catch (e) {
    console.warn("[music-board] popover.open failed", e);
  }
}

export function teardownMusicBoard(): void {
  try { OBR.tool.remove(ACTION_ID); } catch {}
  if (popoverOpen) {
    void OBR.popover.close(POPOVER_ID).catch(() => {});
    popoverOpen = false;
  }
  teardownMusicEngine();
}
