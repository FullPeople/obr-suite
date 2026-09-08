// fullFog — two independent modules that happen to share a folder.
//
//   1. fogEditor   (GM only). Right-click a MAP-layer image → "编辑地图
//      迷雾" → fullscreen modal. Image decode, thresholding algorithms,
//      mask painting and save all live in `editor-page.ts`. It writes a
//      FOG-layer Path whose commands trace the walls it found, and then
//      it is done — it has no runtime.
//
//   2. dynamicFog  (`dynfog/`). A port of owlbear-rodeo/dynamic-fog: it
//      watches EVERY FOG-layer drawing — the editor's traced outline,
//      shapes drawn with Owlbear's own fog tool, and lines drawn with
//      our Line mode — and derives per-client `Wall` items from them,
//      minus whatever the openings on them currently remove. It also
//      owns light sources, light occlusion and the
//      door / secret door / window indicators.
//
// They were ONE module until 2026-08-25 and are now separately
// switchable, because they answer different questions: the editor is a
// content-authoring convenience, while the engine is what makes fog
// block vision at all. A table that hand-draws its fog wants the engine
// without the editor; a table using another vision extension wants
// neither, and should not have to give up the tracer to say so.
//
// Turning the editor off does NOT break fog it already produced — the
// saved Path is an ordinary FOG-layer item and the engine keeps walling
// it. Turning the ENGINE off is the one that makes fog inert.
//
// History (2026-08-25): the engine replaced three home-grown subsystems
// — a wall watcher that only understood the editor's own outline Path,
// a door tool that could only attach openings to that same Path, and a
// reduced light system with no angle / type / self light. See
// docs/DYNAMIC_FOG_PARITY.md.

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { getLocalLang, getState, onStateChange } from "../../state";
import { STABLE_HIDES } from "../../feature-flags";
import { CTX_EDIT_FOG, MODAL_ID, PLUGIN_ID } from "./types";
import {
  applyDynfogSettings,
  setupDynfog,
  teardownDynfog,
  type DynfogOptions,
} from "./dynfog";

const ICON_URL = assetUrl("fullfog-icon.svg");
const EDIT_PAGE_URL = assetUrl("fullfog-edit.html");

// --- 1. the editor ----------------------------------------------------------

let editorRegistered = false;
let contextMenuRegistered = false;
const editorUnsubs: Array<() => void> = [];

async function openEditor(mapItemId: string): Promise<void> {
  try {
    await OBR.modal.close(MODAL_ID);
  } catch {}
  const url = `${EDIT_PAGE_URL}?id=${encodeURIComponent(mapItemId)}`;
  try {
    await OBR.modal.open({
      id: MODAL_ID,
      url,
      fullScreen: true,
      hidePaper: true,
    });
  } catch (e) {
    console.error("[fullFog] open editor failed", e);
  }
}

async function registerEditorMenu(): Promise<void> {
  if (contextMenuRegistered) return;
  const en = getLocalLang() === "en";
  try {
    await OBR.contextMenu.create({
      id: CTX_EDIT_FOG,
      icons: [
        {
          icon: ICON_URL,
          label: en ? "Edit map fog" : "编辑地图迷雾",
          filter: {
            every: [
              { key: "type", value: "IMAGE" },
              { key: "layer", value: "MAP" },
            ],
            max: 1,
          },
        },
      ],
      onClick: async (ctx) => {
        if (ctx.items.length > 0) await openEditor(ctx.items[0].id);
      },
    });
    contextMenuRegistered = true;
  } catch (e) {
    console.warn("[fullFog] contextMenu.create failed", e);
  }
}

export async function setupFogEditor(): Promise<void> {
  if (editorRegistered) return;
  editorRegistered = true;

  let role: "GM" | "PLAYER" = "PLAYER";
  try {
    role = (await OBR.player.getRole()) as "GM" | "PLAYER";
  } catch {}
  if (role === "GM") await registerEditorMenu();

  // A player promoted to GM mid-session should get the editor menu.
  try {
    editorUnsubs.push(
      OBR.player.onChange((player) => {
        if (player.role === "GM") void registerEditorMenu();
      }),
    );
  } catch {}
}

export async function teardownFogEditor(): Promise<void> {
  if (!editorRegistered) return;
  editorRegistered = false;
  for (const unsubscribe of editorUnsubs.splice(0)) {
    try {
      unsubscribe();
    } catch {}
  }
  if (contextMenuRegistered) {
    contextMenuRegistered = false;
    try {
      await OBR.contextMenu.remove(CTX_EDIT_FOG);
    } catch {}
  }
  try {
    await OBR.modal.close(MODAL_ID);
  } catch {}
}

// --- 2. the engine ----------------------------------------------------------

let engineRegistered = false;
const engineUnsubs: Array<() => void> = [];

function currentOptions(): DynfogOptions {
  const state = getState();
  return {
    playerOpenings: state.fogPlayerDoors,
    alwaysShowOverlay: state.fogDoorOverlayAlways,
    lightOcclusion: state.fogLightOcclusion,
    shareVision: state.fogShareVision,
    // The authoring surface (light menu, fog-tool modes, indicators,
    // player toggle tool) is dev-channel only
    // for now; the wall engine runs everywhere because the stable fog
    // editor's output is worthless without it.
    authoring: !STABLE_HIDES,
  };
}

export async function setupDynamicFog(): Promise<void> {
  if (engineRegistered) return;
  engineRegistered = true;

  // The engine runs on every client — Wall, Light and Effect items are
  // local per-client, so each client derives its own from the shared
  // fog drawings.
  await setupDynfog(currentOptions());

  // Keep the engine in step with the GM's suite settings.
  engineUnsubs.push(
    onStateChange(() => {
      void applyDynfogSettings(currentOptions());
    }),
  );
}

export async function teardownDynamicFog(): Promise<void> {
  if (!engineRegistered) return;
  engineRegistered = false;
  for (const unsubscribe of engineUnsubs.splice(0)) {
    try {
      unsubscribe();
    } catch {}
  }
  await teardownDynfog();
}

void PLUGIN_ID;
