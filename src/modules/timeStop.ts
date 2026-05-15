import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../asset-base";

// "Time Stop" / 时停模式 module — migrated from time-stop plugin.
//
// Trigger paths:
//   1. Right-click empty space → context menu "开启/关闭时停"
//   2. Cluster button → broadcasts BC_TIMESTOP_TOGGLE (handled here)
//
// State persisted in scene metadata so mid-scene joiners auto-enter time
// stop. Player tokens are locked when on, unlocked (only those WE locked)
// when off.

const PLUGIN_ID = "com.time-stop"; // backward-compat scene-meta key
const META_KEY = `${PLUGIN_ID}/state`;
const LOCK_TAG = `${PLUGIN_ID}/locked-by-timestop`;
const MODAL_ID = `${PLUGIN_ID}/overlay`;
const BROADCAST_ON = `${PLUGIN_ID}/on`;
const BROADCAST_OFF = `${PLUGIN_ID}/off`;
const BC_TOGGLE = "com.obr-suite/timestop-toggle";
const BC_STATE = "com.obr-suite/timestop-state";

const MENU_ID = `${PLUGIN_ID}/toggle`;
// 2026-05-14 (#7) — "显示为 CG" right-click menu on MAP items.
const CG_MENU_ID = `${PLUGIN_ID}/show-as-cg`;
const ICON_URL = assetUrl("timestop-icon.svg");
const OVERLAY_URL = assetUrl("timestop-overlay.html");

const unsubs: Array<() => void> = [];
let isGM = false;

async function isTimeStopActive(): Promise<boolean> {
  try {
    const meta = await OBR.scene.getMetadata();
    return !!(meta[META_KEY] as any)?.active;
  } catch { return false; }
}

// 2026-05-14 (#7) — full time-stop state including the optional CG
// image url. The scene-metadata value is `{ active, cgUrl? }`;
// cgUrl present → the overlay shows that image fullscreen instead of
// the cinematic bars.
async function getTimeStopState(): Promise<{ active: boolean; cgUrl: string | null }> {
  try {
    const meta = await OBR.scene.getMetadata();
    const s = meta[META_KEY] as { active?: unknown; cgUrl?: unknown } | undefined;
    return {
      active: !!s?.active,
      cgUrl: typeof s?.cgUrl === "string" && s.cgUrl ? s.cgUrl : null,
    };
  } catch {
    return { active: false, cgUrl: null };
  }
}

// Track local overlay state so we don't re-issue OBR.modal.open on a
// modal that's already shown — that re-fires the iframe's CSS
// transition and the user sees the cinematic letterbox bars
// "flicker" / re-animate. Reproed on the GM client when scene
// metadata changes during an active time stop (state-sync triggers
// a re-checkState which would call showOverlay a second time).
let overlayShown = false;
let overlayPassThrough = false;
// 2026-05-14 (#7) — currently-displayed CG url (null = cinematic-bars
// mode). Part of the dedupe key so a state-sync re-check doesn't
// needlessly reload the iframe, but a switch INTO / OUT OF cg mode
// (or a different cg image) does reopen it.
let overlayCgUrl: string | null = null;

async function showOverlay(passThrough: boolean, cgUrl: string | null = null) {
  // Already visible with the exact same gating + cg url? No-op.
  if (overlayShown && overlayPassThrough === passThrough && overlayCgUrl === cgUrl) return;
  // Switching cg state / image → close first so the iframe reloads
  // cleanly with the new URL params (OBR.modal.open on the same id
  // doesn't reliably re-navigate the iframe).
  if (overlayShown && overlayCgUrl !== cgUrl) {
    await hideOverlay();
  }
  try {
    // CG mode encodes the image url + (for the GM) a `dm=1` flag so
    // the overlay renders the image at 0.1 opacity behind the
    // pass-through modal.
    const url = cgUrl
      ? `${OVERLAY_URL}?cg=${encodeURIComponent(cgUrl)}${isGM ? "&dm=1" : ""}`
      : OVERLAY_URL;
    await OBR.modal.open({
      id: MODAL_ID,
      url,
      fullScreen: true,
      hidePaper: true,
      hideBackdrop: true,
      disablePointerEvents: passThrough,
    });
    overlayShown = true;
    overlayPassThrough = passThrough;
    overlayCgUrl = cgUrl;
  } catch {}
}

async function hideOverlay() {
  try { await OBR.modal.close(MODAL_ID); } catch {}
  overlayShown = false;
  overlayCgUrl = null;
}

/**
 * 2026-05-12 — interrupt any in-flight pointer drag on the current
 * client. `player.deselect()` alone doesn't tear down an active
 * drag (OBR's drag handler is independent of selection state), so
 * a player who was MID-DRAG when time stop / focus camera fired
 * would happily keep dragging right through the cinematic.
 *
 * Recipe: briefly toggle `locked: true` on the currently-selected
 * items (which DOES break OBR's drag handler), then deselect, then
 * restore unlock after a short delay. Players have write permission
 * on tokens they own (createdUserId match), which covers every
 * token they could be dragging in the first place.
 *
 * Safe to call on GM too — it's a no-op if nothing is selected and
 * any in-flight drag will be interrupted symmetrically.
 */
async function interruptInFlightDrag(): Promise<void> {
  try {
    const sel = await OBR.player.getSelection();
    if (!sel || sel.length === 0) return;
    const ids = [...sel];
    try {
      await OBR.scene.items.updateItems(ids, (drafts) => {
        for (const d of drafts) d.locked = true;
      });
    } catch { /* no write perms — skip lock */ }
    try { await OBR.player.deselect(); } catch {}
    // Unlock after the drag has had time to die. 250 ms is enough
    // for OBR's drag system to register the lock + cancel the
    // gesture; longer would visibly delay the player's next click.
    setTimeout(() => {
      OBR.scene.items.updateItems(ids, (drafts) => {
        for (const d of drafts) d.locked = false;
      }).catch(() => {});
    }, 250);
  } catch {}
}

// Per user feedback (2026-04-30): time stop should ONLY block player
// input via the full-screen overlay + force-deselect. We no longer
// lock individual tokens — that was belt-and-suspenders that also
// unhelpfully prevented the GM from moving anything during the
// effect. Kept unlockOldLockedItems() as a one-time migration so any
// tokens still carrying the legacy LOCK_TAG from older versions get
// unlocked the next time time stop fires (or scene loads).
async function unlockOldLockedItems() {
  try {
    const items = await OBR.scene.items.getItems(
      (item) => item.metadata[LOCK_TAG] === true
    );
    if (items.length === 0) return;
    const ids = items.map((i) => i.id);
    await OBR.scene.items.updateItems(ids, (drafts) => {
      for (const d of drafts) {
        d.locked = false;
        delete d.metadata[LOCK_TAG];
      }
    });
  } catch (e) {
    console.warn("[obr-suite/timeStop] legacy unlock skipped", e);
  }
}

function notifyClusterState(active: boolean) {
  try {
    OBR.broadcast.sendMessage(BC_STATE, { active }, { destination: "LOCAL" });
  } catch {}
}

// `cgUrl` non-null → "显示为 CG" variant: every client shows that
// image fullscreen instead of the cinematic bars. The GM still gets
// a pass-through overlay (so they can keep working — the image just
// sits at 0.1 opacity on the GM client); players get a blocking
// overlay (handled in the BROADCAST_ON listener).
async function turnOn(cgUrl: string | null = null) {
  await OBR.scene.setMetadata({
    [META_KEY]: { active: true, ...(cgUrl ? { cgUrl } : {}) },
  });
  await OBR.broadcast.sendMessage(BROADCAST_ON, { cgUrl: cgUrl ?? undefined });
  await showOverlay(true, cgUrl); // GM gets pass-through overlay
  // Belt-and-suspenders: scrub any legacy locked tokens left over
  // from the old "lock all characters" behaviour so they don't stay
  // un-movable by the GM during this time stop.
  await unlockOldLockedItems();
  notifyClusterState(true);
}

/** Programmatic entry point for other modules (e.g. trickster) to
 *  force-on time stop without going through the user toggle. Only the
 *  GM client should call this — players don't have scene-write
 *  permission for the time-stop scene metadata key. Idempotent: if
 *  time stop is already active, returns without re-firing. */
export async function turnOnTimeStop(): Promise<void> {
  if (!isGM) return;
  if (await isTimeStopActive()) return;
  await turnOn();
}

async function turnOff() {
  await OBR.scene.setMetadata({ [META_KEY]: { active: false } });
  await OBR.broadcast.sendMessage(BROADCAST_OFF, {});
  await hideOverlay();
  await unlockOldLockedItems();
  notifyClusterState(false);
}

async function toggle() {
  if (!isGM) return;
  if (await isTimeStopActive()) await turnOff();
  else await turnOn();
}

export async function setupTimeStop(): Promise<void> {
  isGM = (await OBR.player.getRole()) === "GM";

  // The 开启/关闭时停 right-click menu was removed earlier — the
  // cluster's 时停 button is the toggle entry point.
  //
  // 2026-05-14 (#7) — but we DO add a GM-only "显示为 CG" menu on MAP
  // items: right-click a map image → every client time-stops AND the
  // overlay paints that image fullscreen (aspect-correct, letterboxed
  // black, no cinematic bars). The GM's copy is pass-through + 0.1
  // opacity so they can keep running the game behind it. Turn it off
  // with the normal 时停 cluster button (turnOff clears cgUrl too).
  if (isGM) {
    try {
      await OBR.contextMenu.create({
        id: CG_MENU_ID,
        icons: [
          {
            icon: ICON_URL,
            label: "显示为 CG",
            filter: {
              roles: ["GM"],
              every: [
                { key: "type", value: "IMAGE" },
                { key: "layer", value: "MAP" },
              ],
              max: 1,
            },
          },
        ],
        onClick: async (ctx) => {
          const item = ctx.items[0] as { image?: { url?: unknown } } | undefined;
          const url = item?.image?.url;
          if (typeof url !== "string" || !url) return;
          // turnOn() with a cgUrl works whether or not time-stop is
          // already active — re-firing just switches the overlay to
          // (or between) CG image(s).
          await turnOn(url);
        },
      });
    } catch (e) {
      console.warn("[obr-suite/timeStop] CG menu create failed", e);
    }
  }

  unsubs.push(
    OBR.broadcast.onMessage(BC_TOGGLE, async () => {
      if (!isGM) return;
      await toggle();
    })
  );

  // Players: on ON broadcast, interrupt any in-flight drag (lock+
  // deselect+unlock) + show overlay (modal blocks pointer). The
  // interrupt is critical — bare deselect doesn't kill an active
  // drag, so a player mid-drag at the moment of time-stop would
  // happily fly their token across the map.
  // 2026-05-14 (#7) — the payload may carry `cgUrl`; when set the
  // player's overlay shows that image fullscreen instead of the bars.
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_ON, async (event) => {
      const cgUrl = (event.data as { cgUrl?: string } | undefined)?.cgUrl ?? null;
      if (!isGM) {
        await interruptInFlightDrag();
        await showOverlay(false, cgUrl);
      }
      notifyClusterState(true);
    })
  );

  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_OFF, async () => {
      await hideOverlay();
      notifyClusterState(false);
    })
  );

  // Mid-scene join: re-apply state — including the CG image if the
  // current time-stop is a "显示为 CG" one.
  const checkState = async () => {
    if (!(await OBR.scene.isReady())) return;
    const st = await getTimeStopState();
    if (st.active) {
      if (!isGM) await interruptInFlightDrag();
      await showOverlay(isGM, st.cgUrl);
      notifyClusterState(true);
    } else {
      notifyClusterState(false);
    }
  };
  await checkState();
  // OBR.scene.onReadyChange is added at the shell level — when scene ready
  // flips and modules need to re-check their state, the shell calls
  // teardownTimeStop / setupTimeStop. So no need for our own listener.
}

export async function teardownTimeStop(): Promise<void> {
  // MENU_ID was removed in an earlier version but we still try in case
  // an old listener lingered. CG_MENU_ID is the live one (#7).
  try { await OBR.contextMenu.remove(MENU_ID); } catch {}
  try { await OBR.contextMenu.remove(CG_MENU_ID); } catch {}
  for (const u of unsubs.splice(0)) u();
  await hideOverlay();
}
