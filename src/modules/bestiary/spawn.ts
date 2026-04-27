import OBR, { buildImage } from "@owlbear-rodeo/sdk";
import { ParsedMonster } from "./types";
import { getRawMonster, makeSlug } from "./data";

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

export async function spawnMonster(monster: ParsedMonster) {
  const tokenUrl = monster.tokenUrl || `https://obr.dnd.center/5etools-img/bestiary/tokens/MM/Commoner.webp`;

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

  const worldX = (-vpPos.x + vpWidth / 2) / vpScale;
  const worldY = (-vpPos.y + vpHeight / 2) / vpScale;
  const offsetX = (Math.random() - 0.5) * 200;
  const offsetY = (Math.random() - 0.5) * 200;

  const initiativeRoll = roll1d20();
  const halfW = imgSize.w / 2;
  const halfH = imgSize.h / 2;

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
    .visible(false)
    .layer("CHARACTER")
    .metadata({
      [BUBBLES_META]: {
        "health": monster.hp,
        "max health": monster.hp,
        "temporary health": 0,
        "armor class": monster.ac,
        "hide": true,
      },
      [BUBBLES_NAME]: monster.name,
      [INITIATIVE_META]: {
        count: initiativeRoll,
        active: false,
        rolled: false,
        tiebreak: Math.random(),
        ownerId,
      },
      [INITIATIVE_MODKEY]: monster.dexMod,
      [BESTIARY_SLUG_KEY]: slug,
    })
    .build();

  await OBR.scene.items.addItems([item]);

  const modStr = monster.dexMod >= 0 ? `+${monster.dexMod}` : `${monster.dexMod}`;
  OBR.notification.show(
    `${monster.name} 已加入 (隐藏) HP:${monster.hp} AC:${monster.ac} 先攻:${initiativeRoll}(${modStr})`
  );
}
