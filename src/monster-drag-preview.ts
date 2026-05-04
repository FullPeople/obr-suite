// Monster drag-spawn preview modal.
//
// The bestiary panel iframe broadcasts BC_MONSTER_DRAG_START on
// pointerdown (after a 3 px move threshold). The bestiary background
// module opens THIS modal with the start payload baked into the URL
// hash — slug, display name, token URL, expected ghost size.
//
// From mount onwards, the modal owns the gesture:
//   - Blocker covers the entire OBR viewport, so no canvas click
//     leaks through during the drag.
//   - document.pointermove updates the ghost image's CSS top/left
//     to track the cursor (centered on the cursor, not corner).
//   - document.pointerup → convert clientX/Y to scene coords via
//     OBR.viewport.inverseTransformPoint(), broadcast
//     BC_MONSTER_DROP. The bestiary panel iframe (which still has
//     the loaded monster data + cache) listens and runs the actual
//     spawn. Background module closes us in the same handler.
//   - Esc / right-click on blocker / 30-second timeout = cancel.

import OBR from "@owlbear-rodeo/sdk";

const BC_MONSTER_DROP = "com.obr-suite/bestiary-drop";
const BC_MONSTER_DRAG_CANCEL = "com.obr-suite/bestiary-drag-cancel";

interface StartPayload {
  slug: string;
  name: string;
  tokenUrl: string;
  /** Expected ghost size in screen pixels. Caller (background) reads
   *  scene DPI × current viewport scale × monster size factor, then
   *  passes the result so the preview is roughly the size of the
   *  spawned token at the current zoom level. */
  ghostSize: number;
}

const blocker = document.getElementById("blocker") as HTMLDivElement;
const ghost = document.getElementById("ghost") as HTMLDivElement;
const ghostImg = document.getElementById("ghost-img") as HTMLImageElement;
const ghostLabel = document.getElementById("ghost-label") as HTMLSpanElement;

let session: StartPayload | null = null;

function teardown(persist: boolean, sceneX: number, sceneY: number): void {
  if (!session) return;
  const cur = session;
  session = null;
  if (persist) {
    try {
      OBR.broadcast.sendMessage(
        BC_MONSTER_DROP,
        { slug: cur.slug, sceneX, sceneY },
        { destination: "LOCAL" },
      );
    } catch {}
  } else {
    try {
      OBR.broadcast.sendMessage(
        BC_MONSTER_DRAG_CANCEL,
        { slug: cur.slug },
        { destination: "LOCAL" },
      );
    } catch {}
  }
}

function applyGhost(clientX: number, clientY: number): void {
  if (!session) return;
  // Center the ghost on the cursor — the user's "grip point" is
  // implicitly the centre of the token (more natural for a circular
  // token than top-left).
  const half = session.ghostSize / 2;
  ghost.style.left = `${Math.round(clientX - half)}px`;
  ghost.style.top = `${Math.round(clientY - half)}px`;
  ghost.classList.add("is-visible");
}

OBR.onReady(() => {
  // Read the StartPayload from the URL hash. Background.ts encoded it
  // there before opening the modal so we can render the ghost on
  // first paint without a broadcast race.
  try {
    const raw = location.hash.replace(/^#/, "");
    if (raw) {
      const payload = JSON.parse(decodeURIComponent(raw)) as StartPayload;
      session = payload;
      ghostImg.src = payload.tokenUrl;
      ghostLabel.textContent = payload.name;
      ghost.style.setProperty("--ghost-size", `${payload.ghostSize}px`);
    }
  } catch (e) {
    console.warn("[monster-drag-preview] failed to parse hash payload", e);
  }

  // Pointer tracking — document level so the blocker doesn't have to
  // be the literal pointermove target. Modal is fullscreen so any
  // event lands here anyway.
  document.addEventListener("pointermove", (e) => {
    if (!session) return;
    applyGhost(e.clientX, e.clientY);
  });

  document.addEventListener("pointerup", async (e) => {
    if (!session) return;
    let scenePoint;
    try {
      scenePoint = await OBR.viewport.inverseTransformPoint({
        x: e.clientX,
        y: e.clientY,
      });
    } catch (err) {
      console.warn("[monster-drag-preview] inverseTransformPoint failed", err);
      teardown(false, 0, 0);
      return;
    }
    teardown(true, scenePoint.x, scenePoint.y);
  });

  document.addEventListener("pointercancel", () => {
    teardown(false, 0, 0);
  });

  // Esc cancels — quick escape hatch.
  document.addEventListener("keydown", (e) => {
    if (!session) return;
    if (e.key === "Escape") {
      e.preventDefault();
      teardown(false, 0, 0);
    }
  });

  // Right-click on the blocker also cancels (alternate escape).
  blocker.addEventListener("contextmenu", (e) => {
    if (!session) return;
    e.preventDefault();
    teardown(false, 0, 0);
  });

  // 30-second safety timeout — if no events arrive (e.g. focus lost
  // mid-gesture) the modal still ends up closed.
  const safetyTimer = setTimeout(() => {
    if (session) {
      console.warn("[monster-drag-preview] safety timeout — cancelling");
      teardown(false, 0, 0);
    }
  }, 30_000);
  window.addEventListener("beforeunload", () => clearTimeout(safetyTimer));
});
