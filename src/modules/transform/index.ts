/* Transform (变身 / polymorph) module — background side.
 *
 * Right-click a CHARACTER token you own → "变身" → opens the form
 * picker popover. On confirm the popover broadcasts BC_APPLY_FORM and
 * THIS module runs the transform on the canvas:
 *
 *   1. Snapshot the token's current {image, grid, scale, name, text,
 *      bestiary-slug} and PUSH it onto a transform stack stored in the
 *      token's own metadata (com.obr-suite/transform:stack).
 *   2. Swap image / grid / scale / name to the new form and bind its
 *      bestiary data + bubbles HP/AC metadata.
 *
 * "解除变身" pops the top snapshot and restores it. Nested transforms
 * are FORBIDDEN since 2026-08-20 (checklist §4): while the stack is
 * non-empty BOTH 变身 menus hide — GM included (user decision
 * 2026-08-21: to edit the per-token POLICY the GM reverts first, then
 * reopens the picker) — and every apply path still refuses: picker
 * click, racing / UI-bypassing broadcasts, and finally inside the
 * updateItems draft. Multi-entry stacks written by OLD builds are left
 * untouched and still unwind layer by layer via 解除变身.
 *
 * Ownership model: each player transforms tokens THEY created
 * (createdUserId === own id); the GM can transform anything. The image
 * swap is a real item mutation, so every client sees the new form —
 * this is polymorph, not a per-viewer illusion.
 */

import OBR, { buildImage } from "@owlbear-rodeo/sdk";
import type { Image, Item } from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { getLocalLang } from "../../state";
import {
  TRANSFORM_POLICY_KEY,
  TRANSFORM_STACK_KEY,
  normalizeTransformHpMode,
  normalizeTransformPolicy,
  transformPolicyAllowsMonster,
  type TransformHpMode,
} from "./shared";

// Per-client language read once at init (context menus
// register at boot, so a live re-render isn't needed).
const en = getLocalLang() === "en";

// NOTE: all metadata / broadcast / popover keys are written as FULL
// literal "com.obr-suite/…" strings (not built from a PLUGIN_ID
// constant). The dev build's namespace-isolation vite plugin rewrites
// the literal substring "com.obr-suite/" → "com.obr-suite-dev/" so the
// dev install doesn't collide with stable in a shared room. A
// template-literal `${PLUGIN_ID}/…` would slip past that rewrite.
const POPOVER_ID = "com.obr-suite/transform/picker";
const PAGE_URL = assetUrl("transform.html");

// The transform stack: an ARRAY of snapshots on the token's metadata.
// Top of stack = the form most recently applied. Empty / absent =
// the token is in its original (un-transformed) state.
const META_STACK = TRANSFORM_STACK_KEY;
const META_POLICY = TRANSFORM_POLICY_KEY;
// Reused from the bestiary module — swapping a form may also point the
// token at a monster stat-block. The dev plugin does NOT rewrite
// "com.bestiary/" (only "com.obr-suite/"), so this key is shared
// dev↔stable, exactly like the bestiary module's own usage.
const BESTIARY_SLUG_KEY = "com.bestiary/slug";
const BUBBLES_META = "com.obr-suite/bubbles/data";
const BUBBLES_NAME = "com.owlbear-rodeo-bubbles-extension/name";
const INITIATIVE_MODKEY = "com.initiative-tracker/dexMod";
const CC_BIND_KEY = "com.character-cards/boundCardId";

const CTX_TRANSFORM = "com.obr-suite/transform/ctx-transform";
const CTX_TRANSFORM_PLAYER = "com.obr-suite/transform/ctx-transform-player";
const CTX_REVERT = "com.obr-suite/transform/ctx-revert";

// Popover → background: "apply this form to this token".
const BC_APPLY_FORM = "com.obr-suite/transform:apply";
// Bestiary picker (transform mode) → background: the user picked a
// monster to morph INTO. Carries the monster's token image + size.
const BC_TRANSFORM_PICK = "com.obr-suite/transform:pick";
// We reuse the bestiary panel as the form picker (opened as a modal
// with ?transformForItemId=). Far better UX than pasting a direct
// image URL — the user just searches the monster manual.
const PICKER_MODAL_ID = "com.obr-suite/transform/bestiary-picker";
const BESTIARY_PANEL_URL = assetUrl("bestiary-panel.html");

const ICON_URL = assetUrl("transform-icon.svg");

// ---- Form + snapshot shapes ----------------------------------------

/** A form the user wants to morph INTO. Built by the picker popover
 *  (bestiary picker entries carry image URL + size + stat metadata). */
export interface TransformForm {
  image: { url: string; width: number; height: number; mime: string };
  /** Grid-cell footprint (1 = Medium, 2 = Large, …). Maps to scale. */
  footprint: number;
  name: string;
  /** Optional bestiary slug to bind on top of the new form. */
  bestiarySlug?: string | null;
  hp?: number;
  ac?: number;
  /** The form's initiative bonus from its stat block — see ParsedMonster.initiative. */
  initiativeMod?: number;
  /** monster = use bestiary HP while transformed; card = preserve CC HP if bound. */
  hpMode?: TransformHpMode;
  type?: string;
  cr?: string;
  /** Human label for the "解除变身 → back to <label>" affordance. */
  label?: string;
}

/** Everything we need to restore the token to how it looked BEFORE a
 *  transform. Stored (as plain JSON) on the stack. */
interface TransformSnapshot {
  image: { url: string; width: number; height: number; mime: string };
  grid: { dpi: number; offset: { x: number; y: number } };
  scale: { x: number; y: number };
  name: string;
  /** OBR-native plainText label (token name text), if any. */
  text: any | null;
  /** Metadata values restored on revert. New snapshots use metadata;
   *  bestiarySlug is kept for old stacks already written by dev builds. */
  metadata?: Record<string, unknown>;
  bestiarySlug?: string | null;
  /** Label of the form that was applied on top of this snapshot. */
  appliedLabel?: string;
  appliedHpMode?: TransformHpMode;
  ts: number;
}

let myRole: "GM" | "PLAYER" = "PLAYER";
let myId: string | null = null;
const unsubs: Array<() => void> = [];

// ---- helpers --------------------------------------------------------

function isImage(item: Item | undefined | null): item is Image {
  return !!item && item.type === "IMAGE";
}

/** May the current user transform this token? GM = anything; player =
 *  only tokens they created. Mirrors bestiary's ownsItem check. */
function canControl(item: Item | undefined | null): boolean {
  if (!item) return false;
  if (myRole === "GM") return true;
  return !!(myId && item.createdUserId === myId);
}

function readStack(item: Item): TransformSnapshot[] {
  const raw = (item.metadata as any)?.[META_STACK];
  return Array.isArray(raw) ? (raw as TransformSnapshot[]) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasCharacterCardBinding(meta: Record<string, unknown>): boolean {
  const cardId = meta[CC_BIND_KEY];
  return typeof cardId === "string" && cardId.trim().length > 0;
}

function buildTransformBubblesMeta(
  meta: Record<string, unknown>,
  form: TransformForm,
): Record<string, unknown> | null {
  const next = isRecord(meta[BUBBLES_META]) ? { ...meta[BUBBLES_META] } : {};
  const hpMode = normalizeTransformHpMode(form.hpMode);
  const keepCharacterHp = hpMode === "card" && hasCharacterCardBinding(meta);
  let touched = false;

  if (!keepCharacterHp && typeof form.hp === "number") {
    next.health = form.hp;
    next["max health"] = form.hp;
    next["temporary health"] = 0;
    touched = true;
  }
  if (typeof form.ac === "number") {
    next["armor class"] = form.ac;
    touched = true;
  }

  if (!touched && Object.keys(next).length === 0) return null;
  if (!("hide" in next)) next.hide = false;
  if (!("locked" in next)) next.locked = true;
  return next;
}

const SNAPSHOT_METADATA_KEYS = [
  BESTIARY_SLUG_KEY,
  BUBBLES_META,
  BUBBLES_NAME,
  INITIATIVE_MODKEY,
] as const;

function snapshotMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!meta) return out;
  for (const key of SNAPSHOT_METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(meta, key)) {
      out[key] = meta[key];
    }
  }
  return out;
}

function restoreSnapshotMetadata(meta: Record<string, unknown>, snap: TransformSnapshot): void {
  for (const key of SNAPSHOT_METADATA_KEYS) delete meta[key];
  if (snap.metadata) {
    for (const [key, value] of Object.entries(snap.metadata)) {
      meta[key] = value;
    }
    return;
  }

  // Backwards compatibility for stacks written before this module also
  // snapshotted bubbles / initiative metadata.
  if (snap.bestiarySlug) meta[BESTIARY_SLUG_KEY] = snap.bestiarySlug;
}

function mimeFromUrl(url: string): string {
  const u = url.split("?")[0].toLowerCase();
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
  if (u.endsWith(".gif")) return "image/gif";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

async function canUsePickedMonster(itemId: string, pick: { type?: unknown; cr?: unknown }): Promise<boolean> {
  let item: Item | undefined;
  try {
    const arr = await OBR.scene.items.getItems([itemId]);
    item = arr[0];
  } catch {
    return false;
  }
  if (!isImage(item) || !canControl(item)) return false;
  if (myRole === "GM") return true;
  const policy = normalizeTransformPolicy((item.metadata as any)?.[META_POLICY]);
  return transformPolicyAllowsMonster(policy, pick);
}

// ---- core engine ----------------------------------------------------

/** Snapshot the token's current visual state, push it on the stack,
 *  and swap to the new form. Image/grid/scale/name change for everyone
 *  (real item mutation) and bestiary / HP metadata change with it. */
async function applyTransform(itemId: string, form: TransformForm): Promise<void> {
  let item: Item | undefined;
  try {
    const arr = await OBR.scene.items.getItems([itemId]);
    item = arr[0];
  } catch (e) {
    console.warn("[transform] getItems failed", e);
    return;
  }
  if (!isImage(item)) return;
  if (!canControl(item)) {
    try { await OBR.notification.show(en ? "You don't have permission to transform this token" : "你没有权限变身这个 token", "WARNING"); } catch {}
    return;
  }
  // Nesting guard, layer 1 of 2: refuse while already transformed. This
  // covers both broadcast entry points (BC_TRANSFORM_PICK from a stale
  // picker, raw BC_APPLY_FORM). Layer 2 re-checks inside the draft
  // because two calls can both pass this read before either writes.
  const preStack = readStack(item);
  if (preStack.length > 0) {
    console.warn("[transform] apply refused: stack non-empty", {
      itemId,
      stackDepth: preStack.length,
      form: form.label ?? form.name,
    });
    try { await OBR.notification.show(en ? "Revert this token before transforming it again" : "请先解除当前变身，再进行新的变身", "WARNING"); } catch {}
    return;
  }
  // Build the snapshot from the LIVE item before we mutate it.
  const img = item.image;
  const snap: TransformSnapshot = {
    image: {
      url: img.url,
      width: img.width,
      height: img.height,
      mime: img.mime,
    },
    grid: {
      dpi: item.grid.dpi,
      offset: { x: item.grid.offset.x, y: item.grid.offset.y },
    },
    scale: { x: item.scale.x, y: item.scale.y },
    name: item.name,
    text: (item as any).text ?? null,
    metadata: snapshotMetadata(item.metadata as Record<string, unknown> | undefined),
    bestiarySlug:
      typeof (item.metadata as any)?.[BESTIARY_SLUG_KEY] === "string"
        ? ((item.metadata as any)[BESTIARY_SLUG_KEY] as string)
        : null,
    appliedLabel: form.label ?? form.name,
    appliedHpMode: normalizeTransformHpMode(form.hpMode),
    ts: Date.now(),
  };

  // New form's grid math — pin dpi to the new image width so it
  // occupies one grid cell at footprint 1, then scale up. Mirrors
  // bestiary/spawn.ts so transformed tokens align with spawned ones.
  const newDpi = form.image.width;
  const newOffset = { x: form.image.width / 2, y: form.image.height / 2 };
  const footprint = Math.max(0.25, form.footprint || 1);

  // Nesting guard, layer 2: the draft callback runs against the
  // authoritative current item state, so a racer that pushed between
  // our pre-check read and this write is visible here. Skip the entire
  // mutation for that draft — a half-applied form over a foreign
  // snapshot would corrupt the stack.
  let blockedNested = false;
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      for (const d of drafts) {
        const stack = readStack(d as Item);
        if (stack.length > 0) {
          blockedNested = true;
          continue;
        }
        stack.push(snap);
        (d.metadata as any)[META_STACK] = stack;

        const di = d as Image;
        di.image = {
          url: form.image.url,
          width: form.image.width,
          height: form.image.height,
          mime: form.image.mime,
        };
        di.grid = { dpi: newDpi, offset: newOffset };
        di.scale = { x: footprint, y: footprint };
        d.name = form.name;
        // Keep the OBR plainText label in sync with the new name when
        // the token already shows one.
        const anyD = d as any;
        if (anyD.text && typeof anyD.text === "object") {
          anyD.text = { ...anyD.text, plainText: form.name };
        }
        if (typeof form.bestiarySlug === "string" && form.bestiarySlug) {
          d.metadata[BESTIARY_SLUG_KEY] = form.bestiarySlug;
        }
        const bubbles = buildTransformBubblesMeta(d.metadata as Record<string, unknown>, form);
        if (bubbles) {
          d.metadata[BUBBLES_META] = bubbles;
          d.metadata[BUBBLES_NAME] = form.name;
        }
        if (typeof form.initiativeMod === "number") {
          d.metadata[INITIATIVE_MODKEY] = form.initiativeMod;
        }
      }
    });
  } catch (e) {
    console.error("[transform] applyTransform updateItems failed", e);
    return;
  }
  if (blockedNested) {
    console.warn("[transform] apply blocked in draft: stack became non-empty during apply", {
      itemId,
      form: form.label ?? form.name,
    });
    try { await OBR.notification.show(en ? "Revert this token before transforming it again" : "请先解除当前变身，再进行新的变身", "WARNING"); } catch {}
  }
}

/** Pop the top snapshot and restore it. No-op if the stack is empty
 *  (token is already in its original form). */
async function revertTransform(itemId: string): Promise<void> {
  let item: Item | undefined;
  try {
    const arr = await OBR.scene.items.getItems([itemId]);
    item = arr[0];
  } catch (e) {
    console.warn("[transform] revert getItems failed", e);
    return;
  }
  if (!isImage(item)) return;
  if (!canControl(item)) {
    try { await OBR.notification.show(en ? "You don't have permission to revert this token" : "你没有权限解除这个 token 的变身", "WARNING"); } catch {}
    return;
  }
  const stack = readStack(item);
  if (stack.length === 0) return;

  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      for (const d of drafts) {
        const s = readStack(d as Item);
        const snap = s.pop();
        if (!snap) continue;
        if (s.length > 0) (d.metadata as any)[META_STACK] = s;
        else delete (d.metadata as any)[META_STACK];

        const di = d as Image;
        di.image = { ...snap.image };
        di.grid = { dpi: snap.grid.dpi, offset: { ...snap.grid.offset } };
        di.scale = { ...snap.scale };
        d.name = snap.name;
        const anyD = d as any;
        if (snap.text) anyD.text = snap.text;
        restoreSnapshotMetadata(d.metadata as Record<string, unknown>, snap);
      }
    });
  } catch (e) {
    console.error("[transform] revertTransform updateItems failed", e);
  }
}

// ---- monster picker (reuses the bestiary panel) ---------------------

// Open the bestiary panel as a modal in transform mode. Picking a
// monster there broadcasts BC_TRANSFORM_PICK back to us.
async function openMonsterPicker(itemId: string): Promise<void> {
  try {
    await OBR.modal.open({
      id: PICKER_MODAL_ID,
      url: `${BESTIARY_PANEL_URL}?transformForItemId=${encodeURIComponent(itemId)}`,
      width: 400,
      height: 600,
    });
  } catch (e) {
    console.warn("[transform] open monster picker failed", e);
  }
}

async function closeMonsterPicker(): Promise<void> {
  try { await OBR.modal.close(PICKER_MODAL_ID); } catch {}
}

// D&D 5e creature-size → grid-cell footprint (mirrors bestiary/spawn.ts).
function footprintForSize(size: string | undefined): number {
  const s = String(size ?? "").trim();
  const lower = s.toLowerCase();
  if (s === "L" || s === "大型" || lower === "large") return 2;
  if (s === "H" || s === "巨型" || lower === "huge") return 3;
  if (s === "G" || s === "超巨型" || lower === "gargantuan") return 4;
  return 1; // Tiny / Small / Medium (+ unknown) → 1 cell
}

// Probe an image's natural dimensions. Background iframe has a DOM, so
// `new Image()` works; crossOrigin isn't needed just to read the size.
function probeImageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 150, h: img.naturalHeight || 150 });
      img.onerror = () => resolve({ w: 150, h: 150 });
      img.src = url;
    } catch { resolve({ w: 150, h: 150 }); }
  });
}

// ---- setup / teardown ----------------------------------------------

export async function setupTransform(): Promise<void> {
  try { myRole = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}
  try { myId = await OBR.player.getId(); } catch {}

  try {
    const u = OBR.player.onChange((player) => {
      const nextRole = (player.role as "GM" | "PLAYER") || myRole;
      if (nextRole) myRole = nextRole;
      if (player.id) myId = player.id;
    });
    if (typeof u === "function") unsubs.push(u);
  } catch {}

  // DM "变身" — always visible on one CHARACTER token. The picker
  // header lets the DM configure what the token owner may use later.
  try {
    await OBR.contextMenu.create({
      id: CTX_TRANSFORM,
      icons: [
        {
          icon: ICON_URL,
          label: en ? "Transform" : "变身",
          filter: {
            roles: ["GM"],
            every: [
              { key: "type", value: "IMAGE" },
              { key: "layer", value: "CHARACTER" },
              // Hidden while transformed for the GM too (user decision
              // 2026-08-21): policy edits require reverting first. The
              // handleSpawn + applyTransform guards stay as backstop
              // against racing / UI-bypassing paths.
              { key: ["metadata", META_STACK], value: undefined },
            ],
            max: 1,
          },
        },
      ],
      onClick: (ctx) => {
        const id = ctx.items[0]?.id;
        if (!id) return;
        void openMonsterPicker(id);
      },
    });
  } catch (e) {
    console.warn("[transform] create CTX_TRANSFORM failed", e);
  }

  // Player "变身" — only appears for token owners when the DM has
  // explicitly enabled a per-token policy. The handler re-checks both
  // ownership and policy, because context-menu filters can't express
  // createdUserId === current player.
  try {
    await OBR.contextMenu.create({
      id: CTX_TRANSFORM_PLAYER,
      icons: [
        {
          icon: ICON_URL,
          label: en ? "Transform" : "变身",
          filter: {
            roles: ["PLAYER"],
            permissions: ["UPDATE"],
            every: [
              { key: "type", value: "IMAGE" },
              { key: "layer", value: "CHARACTER" },
              { key: ["metadata", META_POLICY, "enabled"], value: true },
              { key: ["metadata", META_STACK], value: undefined },
            ],
            max: 1,
          },
        },
      ],
      onClick: (ctx) => {
        const item = ctx.items[0] as Item | undefined;
        const id = item?.id;
        if (!id) return;
        const policy = normalizeTransformPolicy((item.metadata as any)?.[META_POLICY]);
        if (!canControl(item) || !policy.enabled) {
          void OBR.notification.show(
            en
              ? "This token has no transform permission configured for you"
              : "这个 token 还没有为你开启变身权限",
            "WARNING",
          );
          return;
        }
        if (readStack(item).length > 0) {
          console.warn("[transform] ctx-transform-player refused: stack non-empty", { itemId: id });
          void OBR.notification.show(en ? "Revert this token before transforming it again" : "请先解除当前变身，再进行新的变身", "WARNING");
          return;
        }
        void openMonsterPicker(id);
      },
    });
  } catch (e) {
    console.warn("[transform] create CTX_TRANSFORM_PLAYER failed", e);
  }

  // "解除变身" — only on tokens that actually have a transform stack.
  try {
    await OBR.contextMenu.create({
      id: CTX_REVERT,
      icons: [
        {
          icon: ICON_URL,
          label: en ? "Revert" : "解除变身",
          filter: {
            permissions: ["UPDATE"],
            every: [
              { key: "type", value: "IMAGE" },
              { key: "layer", value: "CHARACTER" },
              { key: ["metadata", META_STACK], operator: "!=", value: undefined },
            ],
            max: 1,
          },
        },
      ],
      onClick: (ctx) => {
        const id = ctx.items[0]?.id;
        if (!id) return;
        if (!canControl(ctx.items[0] as Item)) {
          void OBR.notification.show(en ? "You can only revert your own tokens" : "只能解除你自己 token 的变身", "WARNING");
          return;
        }
        void revertTransform(id);
      },
    });
  } catch (e) {
    console.warn("[transform] create CTX_REVERT failed", e);
  }

  // Bestiary picker (transform mode) → apply the chosen monster's
  // token image + size to the token, then close the picker.
  try {
    const u = OBR.broadcast.onMessage(BC_TRANSFORM_PICK, async (event) => {
      const data = event.data as {
        itemId?: string;
        tokenUrl?: string;
        size?: string;
        name?: string;
        bestiarySlug?: string;
        hp?: number;
        ac?: number;
        initiativeMod?: number;
        dexMod?: number;
        hpMode?: TransformHpMode;
        type?: string;
        cr?: string;
      } | undefined;
      if (!data?.itemId || !data.tokenUrl) return;
      if (!(await canUsePickedMonster(data.itemId, data))) {
        try {
          await OBR.notification.show(
            en
              ? "That form is outside this token's transform permission"
              : "该形态不在这个 token 的变身授权范围内",
            "WARNING",
          );
        } catch {}
        return;
      }
      const dim = await probeImageSize(data.tokenUrl);
      const form: TransformForm = {
        image: {
          url: data.tokenUrl,
          width: dim.w,
          height: dim.h,
          mime: mimeFromUrl(data.tokenUrl),
        },
        footprint: footprintForSize(data.size),
        name: data.name || (en ? "Transformed" : "变身形态"),
        label: data.name || (en ? "Transformed" : "变身形态"),
        bestiarySlug: data.bestiarySlug,
        hp: typeof data.hp === "number" ? data.hp : undefined,
        ac: typeof data.ac === "number" ? data.ac : undefined,
        // `dexMod` is the pre-rename field name, still accepted from a panel
        // bundle built before this change.
        initiativeMod: typeof data.initiativeMod === "number" ? data.initiativeMod : typeof data.dexMod === "number" ? data.dexMod : undefined,
        hpMode: normalizeTransformHpMode(data.hpMode),
        type: data.type,
        cr: data.cr,
      };
      await applyTransform(data.itemId, form);
      await closeMonsterPicker();
    });
    if (typeof u === "function") unsubs.push(u);
  } catch (e) {
    console.warn("[transform] subscribe BC_TRANSFORM_PICK failed", e);
  }

  // Legacy ad-hoc URL popover path (transform.html) — kept wired so a
  // power user could still paste a direct image URL, though the
  // bestiary picker is now the primary "变身" entry point.
  try {
    const u = OBR.broadcast.onMessage(BC_APPLY_FORM, async (event) => {
      const data = event.data as { itemId?: string; form?: TransformForm } | undefined;
      if (!data?.itemId || !data.form?.image?.url) return;
      if (!data.form.image.mime) data.form.image.mime = mimeFromUrl(data.form.image.url);
      await applyTransform(data.itemId, data.form);
      try { await OBR.popover.close(POPOVER_ID); } catch {}
    });
    if (typeof u === "function") unsubs.push(u);
  } catch (e) {
    console.warn("[transform] subscribe BC_APPLY_FORM failed", e);
  }

  console.info("[transform] module setup complete; role =", myRole);
}

export function teardownTransform(): void {
  for (const u of unsubs.splice(0)) { try { u(); } catch {} }
  try { void OBR.contextMenu.remove(CTX_TRANSFORM); } catch {}
  try { void OBR.contextMenu.remove(CTX_TRANSFORM_PLAYER); } catch {}
  try { void OBR.contextMenu.remove(CTX_REVERT); } catch {}
  void closeMonsterPicker();
  try { void OBR.popover.close(POPOVER_ID); } catch {}
}

// Silence unused warnings: buildImage is reserved for the Phase-2 form
// builder; PAGE_URL keeps the legacy transform.html popover entry on
// the books (still served + handled via BC_APPLY_FORM, just no longer
// the primary context-menu entry now that the bestiary picker is).
void buildImage;
void PAGE_URL;
