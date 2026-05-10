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

async function readBestiaryAutoName(): Promise<boolean> {
  try {
    const meta = await OBR.scene.getMetadata();
    const s = meta[SUITE_STATE_KEY] as { bestiaryAutoName?: boolean } | undefined;
    if (typeof s?.bestiaryAutoName === "boolean") return s.bestiaryAutoName;
  } catch {}
  // Default OFF — legacy behaviour. DM opts in via the panel toggle.
  return false;
}

const BUBBLES_META = "com.obr-suite/bubbles/data";
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

/** Detect the right MIME type from a token URL extension. OBR's
 *  image-fetcher validates the ImageContent.mime field against the
 *  actual fetched response; if we hardcode "image/webp" but the URL
 *  is a .png from a homebrew bestiary, the validation rejects the
 *  image AFTER it lands in the scene — that's the "panel + drag
 *  preview look fine but the spawned token shows the broken-image
 *  icon" bug. Defaults to webp because the official 5etools
 *  bestiary URLs all end in .webp. */
function mimeFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (/\.svg(\?|#|$)/.test(u)) return "image/svg+xml";
  if (/\.png(\?|#|$)/.test(u)) return "image/png";
  if (/\.(jpe?g)(\?|#|$)/.test(u)) return "image/jpeg";
  if (/\.gif(\?|#|$)/.test(u)) return "image/gif";
  if (/\.bmp(\?|#|$)/.test(u)) return "image/bmp";
  if (/\.avif(\?|#|$)/.test(u)) return "image/avif";
  return "image/webp";
}

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

  // 2026-05-10: D&D 5e creature-size → grid-cell footprint. Mapping
  // matches the official "Squares" rule (PHB 191 / DMG 251 / DMG'24
  // 28). Tiny is normalised to 1 cell visually since 0.5-cell tokens
  // are awkward to manipulate; the small footprint is preserved
  // narratively but not mechanically.
  //
  //   Tiny → 1 (was 0.5; bumped per UX preference for click-target size)
  //   Small / Medium → 1
  //   Large → 2
  //   Huge → 3
  //   Gargantuan → 4
  //
  // ParsedMonster.size is the Chinese / English label produced by
  // parseMon's SIZE_MAP. We accept both the raw single-char code
  // (T/S/M/L/H/G) and the localised label, falling back to 1 when
  // unrecognised so homebrew sources with custom size strings still
  // spawn at sensible default size.
  const sizeFootprint = (() => {
    const s = String(monster.size ?? "").trim();
    if (!s) return 1;
    const lower = s.toLowerCase();
    if (s === "T" || s === "超小型" || lower === "tiny") return 1;
    if (s === "S" || s === "小型" || lower === "small") return 1;
    if (s === "M" || s === "中型" || lower === "medium") return 1;
    if (s === "L" || s === "大型" || lower === "large") return 2;
    if (s === "H" || s === "巨型" || lower === "huge") return 3;
    if (s === "G" || s === "超巨型" || lower === "gargantuan") return 4;
    return 1;
  })();

  // Honor the suite's "auto-add to initiative" toggle (Settings →
  // 怪物图鉴 → 加入场景时自动加入先攻). When it's off, we leave the
  // initiative metadata off, and the DM has to right-click → Add to
  // initiative manually — useful when pre-staging tokens during prep.
  const autoInit = await readBestiaryAutoInit();
  const autoHide = await readBestiaryAutoHide();
  const autoName = await readBestiaryAutoName();
  const meta: Record<string, unknown> = {
    [BUBBLES_META]: {
      "health": monster.hp,
      "max health": monster.hp,
      "temporary health": 0,
      "armor class": monster.ac,
      "hide": false,
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

  // DPI = image width → 1 grid-cell footprint. For non-Medium
  // creatures we scale up via item.scale so the token occupies its
  // proper size (Large = 2x2, Huge = 3x3, Gargantuan = 4x4). Keeps
  // dpi pinned to imgSize.w so OBR's grid-anchor still snaps cleanly
  // — only the rendered bounding box grows.
  const item = buildImage(
    {
      width: imgSize.w,
      height: imgSize.h,
      url: tokenUrl,
      mime: mimeFromUrl(tokenUrl),
    },
    { dpi: imgSize.w, offset: { x: halfW, y: halfH } }
  )
    .position({ x: worldX + offsetX, y: worldY + offsetY })
    .scale({ x: sizeFootprint, y: sizeFootprint })
    .name(monster.name)
    .visible(!autoHide)
    .layer("CHARACTER")
    .metadata(meta)
    .build();

  // When auto-name is on, prefill the OBR-native plainText label so
  // players see the monster's display name under the token without
  // the DM needing to click-sync per token. Mirrors the shape used by
  // monster-info-page.ts → toggleTokenNameText.
  if (autoName) {
    const anyItem = item as any;
    anyItem.text = {
      ...(anyItem.text ?? {}),
      type: anyItem.text?.type ?? "PLAIN",
      plainText: monster.name,
    };
  }

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
