/* Music-board module.
 *
 * Lives in the background plugin iframe. Coordinates with cluster-row
 * (a "music" trigger button shows up there for the GM, replacing the
 * old left-toolbar tool icon) and with scene metadata to keep one
 * source of truth for the room-wide open/closed flag.
 *
 * Flow:
 *   • GM clicks the cluster-row "音乐" button →
 *     cluster-row.ts broadcasts "com.obr-suite/music-board:toggle"
 *     (LOCAL) → THIS module flips the `open` flag in scene metadata.
 *   • Every client's background subscribes to scene-metadata changes.
 *     On `open=true`: opens popover (minimized for PLAYER, full for GM).
 *     On `open=false`: closes popover.
 *   • Players never have a way to set `open=false` themselves (no
 *     cluster button, no in-popover close — only minimize). So the
 *     GM is the single arbiter of room-wide visibility.
 *
 * Popover audio + PeerJS live INSIDE the popover (music-board-page.ts)
 * because WebAudio autoplay policy needs a user gesture in the popover
 * document — background can't unsuspend the AudioContext.
 */

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";

const POPOVER_ID = "com.obr-suite/music-board/popover";
const PAGE_URL   = assetUrl("music-board.html");
// IMPORTANT: keep this metadata key SEPARATE from the music-state key
// the popover writes. The popover overwrites its entire key on every
// peer message; if we shared a key our `open` flag would be lost on
// the first bgm-load and the popover would auto-close.
const META_KEY_OPEN = "com.obr-suite/music-board:open";
const BC_TOGGLE     = "com.obr-suite/music-board:toggle";
const BC_ACTIVE     = "com.obr-suite/music-board:state-active";

const POPOVER_W = 380;
const POPOVER_H = 540;
// Clear OBR's right-side panels (people / scene settings) — 120 px
// gap leaves the popover well off the toolbar.
const RIGHT_INSET = 120;

let popoverOpen = false;
let myRole: "GM" | "PLAYER" = "PLAYER";
const unsubs: Array<() => void> = [];

export async function setupMusicBoard(): Promise<void> {
  try { myRole = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}

  // GM-only: react to the cluster-row toggle button.
  if (myRole === "GM") {
    try {
      const u = OBR.broadcast.onMessage(BC_TOGGLE, () => { void toggleRoomOpen(); });
      if (typeof u === "function") unsubs.push(u);
    } catch (e) {
      console.warn("[music-board] subscribe toggle failed", e);
    }
  }

  // EVERY client: react to scene-metadata `open` flag. This is what
  // actually opens / closes the popover on each user's screen.
  try {
    await OBR.scene.isReady();
  } catch {}
  try {
    // Initial pull — open if scene already says so (e.g. user joining
    // a session where the GM already opened music).
    const meta = await OBR.scene.getMetadata().catch(() => ({} as any));
    const init = meta[META_KEY_OPEN] as any;
    await reactToOpenFlag(!!init?.open);
  } catch (e) {
    console.warn("[music-board] initial metadata read failed", e);
  }
  try {
    const u = OBR.scene.onMetadataChange((meta) => {
      const cur = meta[META_KEY_OPEN] as any;
      void reactToOpenFlag(!!cur?.open);
    });
    if (typeof u === "function") unsubs.push(u);
  } catch (e) {
    console.warn("[music-board] subscribe scene metadata failed", e);
  }

  console.info("[music-board] module setup complete; role =", myRole);
}

async function toggleRoomOpen(): Promise<void> {
  if (myRole !== "GM") return;
  try {
    const meta = await OBR.scene.getMetadata();
    const cur = (meta[META_KEY_OPEN] as any) || {};
    const next = { open: !cur.open, ts: Date.now() };
    await OBR.scene.setMetadata({ [META_KEY_OPEN]: next as any });
  } catch (e) {
    console.warn("[music-board] toggle failed", e);
  }
}

async function reactToOpenFlag(shouldBeOpen: boolean): Promise<void> {
  // Mirror open state into the local cluster-row button highlight.
  try {
    OBR.broadcast.sendMessage(BC_ACTIVE, { open: shouldBeOpen },
      { destination: "LOCAL" });
  } catch {}

  if (shouldBeOpen && !popoverOpen) {
    await openPopover();
  } else if (!shouldBeOpen && popoverOpen) {
    await closePopover();
  }
}

async function openPopover(): Promise<void> {
  if (popoverOpen) return;
  let vw = 0, vh = 0;
  try { vw = await OBR.viewport.getWidth(); } catch {}
  try { vh = await OBR.viewport.getHeight(); } catch {}
  vw = Math.max(vw || 0, window.innerWidth || 0, 1024);
  vh = Math.max(vh || 0, window.innerHeight || 0, 720);
  // Players start MINIMIZED so the music popover doesn't slam over
  // their UI just because the GM hit play. The popover reads
  // ?mini=1 from the URL on boot.
  const url = `${PAGE_URL}?role=${myRole}${myRole === "PLAYER" ? "&mini=1" : ""}`;
  try {
    await OBR.popover.open({
      id: POPOVER_ID,
      url,
      width: POPOVER_W,
      height: Math.min(POPOVER_H, vh - 80),
      anchorReference: "POSITION",
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

async function closePopover(): Promise<void> {
  if (!popoverOpen) return;
  try { await OBR.popover.close(POPOVER_ID); } catch {}
  popoverOpen = false;
}

export function teardownMusicBoard(): void {
  for (const u of unsubs.splice(0)) { try { u(); } catch {} }
  if (popoverOpen) {
    void OBR.popover.close(POPOVER_ID).catch(() => {});
    popoverOpen = false;
  }
}
