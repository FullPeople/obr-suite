import OBR, { buildImage } from "@owlbear-rodeo/sdk";
import { ParsedMonster } from "./types";
import { getRawMonster, makeSlug } from "./data";

// The bestiary panel iframe doesn't run startSceneSync(), so calling
// getState() from src/state.ts here would return only DEFAULT_STATE.
// Read the suite-state object straight off scene metadata instead.
const SUITE_STATE_KEY = "com.obr-suite/state";
async function readBestiaryAutoInit(): Promise<boolean> {
  try {
    const meta = await OBR.scene.getMetadata();
    const s = meta[SUITE_STATE_KEY] as { bestiaryAutoInitiative?: boolean } | undefined;
    if (typeof s?.bestiaryAutoInitiative === "boolean") return s.bestiaryAutoInitiative;
  } catch {}
  // Default to legacy behavior — auto-add to initiative — when the
  // suite metadata hasn't been written yet.
  return true;
}

async function readBestiaryAutoHide(): Promise<boolean> {
  try {
    const meta = await OBR.scene.getMetadata();
    const s = meta[SUITE_STATE_KEY] as { bestiaryAutoHide?: boolean } | undefined;
    if (typeof s?.bestiaryAutoHide === "boolean") return s.bestiaryAutoHide;
  } catch {}
  // Default to legacy behavior — spawn invisible — so the DM has
  // a beat to position the token before players see it.
  return true;
}

const BUBBLES_META = "com.owlbear-rodeo-bubbles-extension/metadata";
const BUBBLES_NAME = "com.owlbear-rodeo-bubbles-extension/name";
const INITIATIVE_META = "com.initiative-tracker/data";
const INITIATIVE_MODKEY = "com.initiative-tracker/dexMod";

// Each spawned item stores a slug reference to a shared monster-data table
// on the scene metadata. Same-kind monsters share one entry → scene stays
// small even with many tokens.
const BESTIARY_SLUG_KEY = "com.bestiary/slug";
const BESTIARY_DATA_KEY = "com.bestiary/monsters";

// Scene metadata read-modify-write is not atomic: parallel spawns can clobber
// each other's additions. We serialize writes through a promise chain so each
// update sees the result of the previous one.
let writeChain: Promise<void> = Promise.resolve();

async function ensureSharedMonsterData(slug: string, raw: any) {
  if (!raw) return;
  writeChain = writeChain.then(async () => {
    try {
      const meta = await OBR.scene.getMetadata();
      const table = (meta[BESTIARY_DATA_KEY] as Record<string, any>) || {};
      if (table[slug]) return;
      table[slug] = raw;
      await OBR.scene.setMetadata({ [BESTIARY_DATA_KEY]: table });
    } catch (e) {
      console.error("[bestiary] ensureSharedMonsterData failed", e);
    }
  });
  await writeChain;
}

function roll1d20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

// Probe actual image dimensions
function getImageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 280, h: 280 }); // fallback
    img.src = url;
  });
}

/** Same as getImageSize but also reports whether the image actually
 *  loaded. Lets spawnMonster fall back to a placeholder when a
 *  homebrew monster has no token (the auto-built kiwee URL 404s). */
function probeImage(url: string): Promise<{ ok: boolean; w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ ok: false, w: 280, h: 280 });
    img.src = url;
  });
}

const FALLBACK_TOKEN_URL = `https://obr.dnd.center/5etools-img/bestiary/tokens/MM/Commoner.webp`;

export async function spawnMonster(
  monster: ParsedMonster,
  /** Explicit scene-coord drop position. When provided, the monster
   *  spawns exactly there with no random offset (drag-spawn flow).
   *  When omitted, falls back to the legacy "viewport center + random
   *  jitter" behaviour for the click-to-spawn path. */
  position?: { x: number; y: number },
) {
  // Probe the chosen tokenUrl up-front. If it 404s (typical for
  // homebrew monsters whose auto-built kiwee URL doesn't exist),
  // fall back to the Commoner placeholder so the token still spawns
  // — DM can swap in a real image later via OBR's image picker.
  let tokenUrl = monster.tokenUrl || FALLBACK_TOKEN_URL;
  if (tokenUrl !== FALLBACK_TOKEN_URL) {
    const probe = await probeImage(tokenUrl);
    if (!probe.ok) {
      console.warn(
        "[obr-suite/bestiary] tokenUrl 404, using Commoner fallback:",
        tokenUrl,
      );
      tokenUrl = FALLBACK_TOKEN_URL;
    }
  }

  const slug = makeSlug(monster.source, monster.engName);
  await ensureSharedMonsterData(slug, getRawMonster(slug));

  let ownerId = "";
  try { ownerId = await OBR.player.getId(); } catch {}

  const [vpWidth, vpHeight, vpPos, vpScale, imgSize] = await Promise.all([
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
    OBR.viewport.getPosition(),
    OBR.viewport.getScale(),
    getImageSize(tokenUrl),
  ]);

  let worldX: number;
  let worldY: number;
  let offsetX = 0;
  let offsetY = 0;
  if (position) {
    // Drag-drop: spawn exactly at the dropped scene position. No
    // jitter — the user already chose the location.
    worldX = position.x;
    worldY = position.y;
  } else {
    // Click-to-spawn: viewport centre + random jitter so multiple
    // clicks don't stack tokens at exactly the same point.
    worldX = (-vpPos.x + vpWidth / 2) / vpScale;
    worldY = (-vpPos.y + vpHeight / 2) / vpScale;
    offsetX = (Math.random() - 0.5) * 200;
    offsetY = (Math.random() - 0.5) * 200;
  }

  const initiativeRoll = roll1d20();
  const halfW = imgSize.w / 2;
  const halfH = imgSize.h / 2;

  // Honor the suite's "auto-add to initiative" toggle (Settings →
  // 怪物图鉴 → 加入场景时自动加入先攻). When it's off, we leave the
  // initiative metadata off, and the DM has to right-click → Add to
  // initiative manually — useful when pre-staging tokens during prep.
  const autoInit = await readBestiaryAutoInit();
  const autoHide = await readBestiaryAutoHide();
  const meta: Record<string, unknown> = {
    [BUBBLES_META]: {
      "health": monster.hp,
      "max health": monster.hp,
      "temporary health": 0,
      "armor class": monster.ac,
      // `hide:true` is the EXTERNAL "Stat Bubbles for D&D" extension's
      // "Dungeon Master Only" toggle. Players don't see the bubble
      // at all when set. We default it ON for newly-spawned bestiary
      // monsters so DMs running the external plugin get correct
      // out-of-the-box behaviour.
      "hide": true,
      // `locked:true` is the SUITE'S OWN bubbles module flag.
      // Combined with "locked + in-combat → silhouette mode for
      // players" it shows a quantised bar without exact numbers.
      // Both fields share the same metadata key — external plugin
      // reads hide, suite plugin reads locked.
      "locked": true,
    },
    [BUBBLES_NAME]: monster.name,
    [INITIATIVE_MODKEY]: monster.dexMod,
    [BESTIARY_SLUG_KEY]: slug,
  };
  if (autoInit) {
    meta[INITIATIVE_META] = {
      count: initiativeRoll,
      active: false,
      rolled: false,
      tiebreak: Math.random(),
      ownerId,
    };
  }

  // DPI = image width → token occupies exactly 1 grid cell
  const item = buildImage(
    {
      width: imgSize.w,
      height: imgSize.h,
      url: tokenUrl,
      mime: "image/webp",
    },
    { dpi: imgSize.w, offset: { x: halfW, y: halfH } }
  )
    .position({ x: worldX + offsetX, y: worldY + offsetY })
    .name(monster.name)
    .visible(!autoHide)
    .layer("CHARACTER")
    .metadata(meta)
    .build();

  await OBR.scene.items.addItems([item]);

  // ② Focus the DM's viewport on the newly spawned token so they can see
  // where it landed without manual panning. Skipped for drag-spawn —
  // the user just dropped the token at the spot they were looking at,
  // re-centering would yank the camera away from where they aimed.
  if (!position) {
    try {
      const x = worldX + offsetX;
      const y = worldY + offsetY;
      OBR.viewport.animateTo({
        position: {
          x: -x * vpScale + vpWidth / 2,
          y: -y * vpScale + vpHeight / 2,
        },
        scale: vpScale,
      });
    } catch {}
  }

  // Spawn notification removed per user feedback — silent.
}
