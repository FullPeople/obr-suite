import OBR from "@owlbear-rodeo/sdk";
import { getState } from "../state";

// Cross-scene character-card sync.
//
// When `state.crossSceneSyncCards` is ON in suite state, this module
// keeps the character-card list (`com.character-cards/list` in scene
// metadata) mirrored into ROOM metadata under
// `com.character-cards/list-room`. A scene that has NEVER had a card
// list of its own adopts the room copy once; see hydrateOnSceneReady.
//
// When the flag flips OFF, the room mirror is cleared so other
// scenes stop hydrating from it.
//
// The card data itself (per-card data.json + index.html) lives on
// our server keyed by roomId, so existing cards are reachable from
// every scene regardless of sync. The only thing that needs syncing
// is the LIST (which card slugs/uploads exist).

const SCENE_CARDS_KEY = "com.character-cards/list";
const ROOM_CARDS_KEY = "com.character-cards/list-room";

let unsubs: Array<() => void> = [];
let lastSceneCardsJson = "";

async function readRoomCards(): Promise<any[] | null> {
  try {
    const m = await OBR.room.getMetadata();
    const v = m[ROOM_CARDS_KEY];
    if (Array.isArray(v)) return v;
    return null;
  } catch { return null; }
}

async function writeRoomCards(cards: any[] | null): Promise<void> {
  try {
    await OBR.room.setMetadata({ [ROOM_CARDS_KEY]: cards ?? undefined });
  } catch (e) {
    console.warn("[obr-suite/cross-scene-cards] room write failed", e);
  }
}

/** The scene's own card list, or null when the scene has never had one.
 *  The difference matters: an EMPTY ARRAY is a deliberate "no cards here"
 *  (that is exactly what deleting the last card writes), while a missing
 *  key means this scene has no list of its own yet. */
async function readSceneCards(): Promise<any[] | null> {
  try {
    const m = await OBR.scene.getMetadata();
    const v = m[SCENE_CARDS_KEY];
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

async function writeSceneCards(cards: any[]): Promise<void> {
  try {
    await OBR.scene.setMetadata({ [SCENE_CARDS_KEY]: cards });
  } catch (e) {
    console.warn("[obr-suite/cross-scene-cards] scene write failed", e);
  }
}

// On scene-ready: adopt the room mirror ONLY into a scene that has no card
// list of its own yet. Hydration used to overwrite the scene list with the
// room copy on every scene-ready, which made the mirror destructive: any
// scene with its own deck lost it, and a card deleted in the current scene
// came straight back from another client's older mirror. Both are now
// impossible, because a scene whose key exists (even as []) is never
// written to by this path — so a deletion (which writes []) is final, and a
// scene's independent list is never overwritten.
async function hydrateOnSceneReady(): Promise<void> {
  const s = getState();
  if (!s.crossSceneSyncCards) return;
  const sceneCards = await readSceneCards();
  if (sceneCards !== null) return;
  const roomCards = await readRoomCards();
  if (!roomCards || roomCards.length === 0) return;
  await writeSceneCards(roomCards);
}

// On scene metadata change: if sync is on AND the cards list changed,
// mirror it to room metadata. Dedup with lastSceneCardsJson so we
// only fire OBR.room.setMetadata when the list actually moved.
async function mirrorCardsIfChanged(): Promise<void> {
  const s = getState();
  if (!s.crossSceneSyncCards) return;
  const sceneCards = await readSceneCards();
  if (sceneCards === null) return;  // this scene has no list of its own to mirror
  const json = JSON.stringify(sceneCards);
  if (json === lastSceneCardsJson) return;
  lastSceneCardsJson = json;
  await writeRoomCards(sceneCards);
}

// When the user flips crossSceneSyncCards from OFF → ON we ALSO want
// to immediately seed the room mirror with the current scene's
// cards so scenes without a list of their own adopt it. The settings
// UI handles the confirmation prompt; this just exports a primitive
// the UI can call at the right moment.
export async function seedRoomCardsFromCurrentScene(): Promise<void> {
  const sceneCards = await readSceneCards();
  if (sceneCards === null) return;  // nothing to seed; never clear the mirror here
  await writeRoomCards(sceneCards);
  lastSceneCardsJson = JSON.stringify(sceneCards);
}

// And the inverse — clearing the room mirror when sync is turned off
// so other scenes don't keep hydrating from a stale list.
export async function clearRoomCardsMirror(): Promise<void> {
  await writeRoomCards(null);
  lastSceneCardsJson = "";
}

export async function setupCrossSceneCards(): Promise<void> {
  // Subscribe AFTER startSceneSync has populated cached state, so
  // getState() returns real values. background.ts wires this in
  // sequence accordingly.
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (ready) {
        await hydrateOnSceneReady();
        await rememberSceneCards();
      }
    }),
  );
  unsubs.push(
    OBR.scene.onMetadataChange(async (meta) => {
      if (!(SCENE_CARDS_KEY in meta)) return;
      await mirrorCardsIfChanged();
    }),
  );
  // Initial hydrate if scene is already ready when this module starts.
  try {
    if (await OBR.scene.isReady()) {
      await hydrateOnSceneReady();
      await rememberSceneCards();
    }
  } catch {}
}

/** Reset dedup so the next mirror cycle compares against the freshly
 *  hydrated list (else we'd skip the first real change). "" means "this
 *  scene has no list of its own" and never equals a real array's JSON. */
async function rememberSceneCards(): Promise<void> {
  const sceneCards = await readSceneCards();
  lastSceneCardsJson = sceneCards === null ? "" : JSON.stringify(sceneCards);
}

export async function teardownCrossSceneCards(): Promise<void> {
  for (const u of unsubs.splice(0)) u();
  lastSceneCardsJson = "";
}
