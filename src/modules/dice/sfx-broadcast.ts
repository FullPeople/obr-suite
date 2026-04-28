import OBR from "@owlbear-rodeo/sdk";
import { PLAYERS, SfxName, primeAudio } from "./sfx";

// Cross-iframe SFX dispatch.
//
// The dice-effect modal is opened with `disablePointerEvents:true`
// and never receives a user gesture, so its AudioContext is locked in
// `suspended` state and `sfx.*` calls are silent. Workaround: every
// public sfx call also fires a `BC_SFX` broadcast; iframes that DO
// have user gesture (cluster, dice-panel, cc-info, bestiary, search,
// initiative) call `subscribeToSfx()` to receive the broadcast and
// play the sound locally. As long as ANY user-clicked iframe is
// alive, the sound plays.
//
// This file is intentionally separate from `sfx.ts` so `sfx.ts` can
// stay an OBR-free leaf module — putting the OBR import inside sfx
// caused vite/rollup to entangle sfx into the shared `lib` chunk via
// a CJS-helper, producing a circular ESM dep that crashed at load
// time with "e is not a function".

const BC_SFX = "com.obr-suite/sfx";

function broadcast(name: SfxName): void {
  try {
    OBR.broadcast
      .sendMessage(BC_SFX, { name }, { destination: "LOCAL" })
      .catch(() => {});
  } catch {}
}

// Public sfx calls — try locally (succeeds only when the AudioContext
// is active in this frame) AND broadcast for any other iframe to
// pick up. Replace direct `sfx.sfxXxx()` imports in dice-effect with
// these wrappers wherever cross-iframe playback matters.
export function sfxParabola(): void { PLAYERS.parabola(); broadcast("parabola"); }
export function sfxScalePunch(): void { PLAYERS.scalePunch(); broadcast("scalePunch"); }
export function sfxNumFly(): void { PLAYERS.numFly(); broadcast("numFly"); }
export function sfxNumLand(): void { PLAYERS.numLand(); broadcast("numLand"); }
export function sfxFlashCrit(): void { PLAYERS.flashCrit(); broadcast("flashCrit"); }
export function sfxFlashFail(): void { PLAYERS.flashFail(); broadcast("flashFail"); }
export function sfxSpin(): void { PLAYERS.spin(); broadcast("spin"); }
export function sfxBurst(): void { PLAYERS.burst(); broadcast("burst"); }
export function sfxSame(): void { PLAYERS.same(); broadcast("same"); }
export function sfxSyncView(): void { PLAYERS.syncView(); broadcast("syncView"); }
export function sfxNextTurn(): void { PLAYERS.nextTurn(); broadcast("nextTurn"); }

// Subscribe the current iframe to play sounds requested via BC_SFX.
// Also primes the AudioContext on the first user gesture (capture-
// phase click / keydown / pointerdown). Call inside OBR.onReady.
let sfxSubscribed = false;
export function subscribeToSfx(): void {
  if (sfxSubscribed) return;
  sfxSubscribed = true;

  const prime = () => primeAudio();
  document.addEventListener("click", prime, { capture: true });
  document.addEventListener("keydown", prime, { capture: true });
  document.addEventListener("pointerdown", prime, { capture: true });

  try {
    OBR.broadcast.onMessage(BC_SFX, (event) => {
      const name = (event.data as { name?: SfxName } | undefined)?.name;
      if (!name) return;
      const player = PLAYERS[name];
      if (player) player();
    });
  } catch {}
}
