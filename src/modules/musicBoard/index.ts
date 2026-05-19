/* Music board module — registers the tool button. Audio + PeerJS
 * live in the popover itself; the previous background-engine
 * attempt failed because WebAudio contexts can only be resumed by
 * a user gesture in the SAME document, and the background iframe
 * has no UI to gesture against. (You'd hear silence even though the
 * pipeline appeared connected.)
 *
 * Tradeoff: closing the popover stops music. The popover has a
 * built-in "minimize" button that collapses the UI to a thin status
 * strip while keeping the iframe alive — that's how the user keeps
 * music running without the full panel in the way.
 */

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";

const ACTION_ID  = "com.obr-suite/music-board";
const POPOVER_ID = "com.obr-suite/music-board/popover";
const ICON_URL   = assetUrl("music-board-icon.svg");
const PAGE_URL   = assetUrl("music-board.html");

const POPOVER_W = 380;
const POPOVER_H = 540;
// Right-edge inset large enough to clear OBR's right-side panels
// (people list / scene settings). 120 px is conservative — leaves a
// visible gap even when the right panel is collapsed.
const RIGHT_INSET = 120;

export async function setupMusicBoard(): Promise<void> {
  try {
    await OBR.tool.create({
      id: ACTION_ID,
      icons: [{
        icon: ICON_URL,
        label: "音乐板 (听)",
        filter: { roles: ["GM", "PLAYER"] },
      }],
      onClick: () => {
        void openPopover();
        return false;
      },
    });
    console.info("[music-board] tool registered:", ACTION_ID);
  } catch (e) {
    console.error("[music-board] tool.create failed", e);
  }
}

let popoverOpen = false;

async function openPopover(): Promise<void> {
  if (popoverOpen) {
    try { await OBR.popover.close(POPOVER_ID); } catch {}
    popoverOpen = false;
    return;
  }
  // Defensive viewport: OBR.viewport.getWidth() can return 0/undefined
  // in some setups (the popover-on-left-toolbar bug we hit earlier),
  // so floor against window.innerWidth + 1024 sanity minimum.
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
      // Right edge of the popover sits RIGHT_INSET px from the right
      // edge of the OBR viewport, clearing the right toolbar / panels.
      anchorPosition: { left: vw - RIGHT_INSET, top: 56 },
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
}
