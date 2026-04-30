import OBR from "@owlbear-rodeo/sdk";
import { getState } from "../state";

// Cross-scene character-card sync.
//
// When `state.crossSceneSyncCards` is ON in suite state, this module
// keeps the character-card list (`com.character-cards/list` in scene
// metadata) mirrored into ROOM metadata under
// `com.character-cards/list-room`. Every scene-load checks the room
// mirror first; if it exists, the scene's card list is overwritten
// with the room copy so all scenes show the same deck.
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

async function readSceneCards(): Promise<any[]> {
  try {
    const m = await OBR.scene.getMetadata();
    const v = m[SCENE_CARDS_KEY];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

async function writeSceneCards(cards: any[]): Promise<void> {
  try {
    await OBR.scene.setMetadata({ [SCENE_CARDS_KEY]: cards });
  } catch (e) {
    console.warn("[obr-suite/cross-scene-cards] scene write failed", e);
  }
}

// On scene-ready: if sync is on AND room has a mirror, hydrate the
// scene from the room copy. Always before the cc panel reads scene
// metadata.
async function hydrateOnSceneReady(): Promise<void> {
  const s = getState();
  if (!s.crossSceneSyncCards) return;
  const roomCards = await readRoomCards();
  if (!roomCards) return;
  // Avoid no-op writes that cause unnecessary re-renders.
  const sceneCards = await readSceneCards();
  if (JSON.stringify(sceneCards) === JSON.stringify(roomCards)) return;
  await writeSceneCards(roomCards);
}

// On scene metadata change: if sync is on AND the cards list changed,
// mirror it to room metadata. Dedup with lastSceneCardsJson so we
// only fire OBR.room.setMetadata when the list actually moved.
async function mirrorCardsIfChanged(): Promise<void> {
  const s = getState();
  if (!s.crossSceneSyncCards) return;
  const sceneCards = await readSceneCards();
  const json = JSON.stringify(sceneCards);
  if (json === lastSceneCardsJson) return;
  lastSceneCardsJson = json;
  await writeRoomCards(sceneCards);
}

// When the user flips crossSceneSyncCards from OFF → ON we ALSO want
// to immediately seed the room mirror with the current scene's
// cards so other scenes hydrate from it. The settings UI handles the
// confirmation prompt; this just exports a primitive the UI can call
// at the right moment.
export async function seedRoomCardsFromCurrentScene(): Promise<void> {
  const sceneCards = await readSceneCards();
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
        // Reset dedup so the next mirror cycle compares against the
        // freshly hydrated list (else we'd skip the first real change).
        lastSceneCardsJson = JSON.stringify(await readSceneCards());
      }
    }),
  );
  unsubs.push(
    OBR.scene.onMetadataChange(async () => {
      await mirrorCardsIfChanged();
    }),
  );
  // Initial hydrate if scene is already ready when this module starts.
  try {
    if (await OBR.scene.isReady()) {
      await hydrateOnSceneReady();
      lastSceneCardsJson = JSON.stringify(await readSceneCards());
    }
  } catch {}
}

export async function teardownCrossSceneCards(): Promise<void> {
  for (const u of unsubs.splice(0)) u();
  lastSceneCardsJson = "";
}
