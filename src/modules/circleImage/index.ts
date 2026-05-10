// Circle-image module — background side. Owns:
//   1. The toolbar tool icon. Click → toggle the cropper popover.
//
// The popover handles bake + upload directly via
// OBR.assets.uploadImages; there's no drag-preview modal anymore
// (data-URL spawning didn't work — see modules/circleImage/types.ts
// header for context).

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { PLUGIN_ID, POPOVER_ID } from "./types";

const TOOL_ID = `${PLUGIN_ID}/tool`;
const ICON_URL = assetUrl("circleimage-icon.svg");
const POPOVER_URL = assetUrl("circleimage.html");

const POPOVER_W = 420;
const POPOVER_H = 600;

let role: "GM" | "PLAYER" = "PLAYER";

let popoverOpen = false;

async function openPopover(): Promise<void> {
  if (popoverOpen) return;
  try {
    const vw = await OBR.viewport.getWidth();
    await OBR.popover.open({
      id: POPOVER_ID,
      url: POPOVER_URL,
      width: POPOVER_W,
      height: POPOVER_H,
      anchorReference: "POSITION",
      anchorPosition: { left: Math.round(vw / 2), top: 60 },
      anchorOrigin: { horizontal: "CENTER", vertical: "TOP" },
      transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
      hidePaper: true,
      // Keep the canvas usable while the popover is up so users can
      // pan / drag tokens without first closing the cropper.
      disableClickAway: true,
    });
    popoverOpen = true;
  } catch (e) {
    console.error("[obr-suite/circleImage] openPopover failed", e);
  }
}

async function closePopover(): Promise<void> {
  if (!popoverOpen) return;
  try { await OBR.popover.close(POPOVER_ID); } catch {}
  popoverOpen = false;
}

export async function setupCircleImage(): Promise<void> {
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}

  // GM-only — only the DM produces circle / bg-removed images.
  if (role === "GM") {
    try {
      await OBR.tool.create({
        id: TOOL_ID,
        icons: [
          {
            icon: ICON_URL,
            label: "圆形图片 / 去底",
            filter: { roles: ["GM"] },
          },
        ],
        // Click toggles the popover. Don't activate as an OBR tool —
        // user keeps Move active so they can drag from the OBR asset
        // library straight to the canvas after the upload completes.
        // Returning false suppresses tool activation.
        onClick: async () => {
          if (popoverOpen) {
            await closePopover();
          } else {
            await openPopover();
          }
          return false;
        },
      });
    } catch (e) {
      console.warn("[obr-suite/circleImage] tool.create failed", e);
    }
  }
}

export async function teardownCircleImage(): Promise<void> {
  await closePopover();
  if (role === "GM") {
    try { await OBR.tool.remove(TOOL_ID); } catch {}
  }
}
