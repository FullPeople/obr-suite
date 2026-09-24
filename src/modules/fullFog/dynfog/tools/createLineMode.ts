// "Line" mode under Owlbear's fog tool — drag to lay a straight fog
// line, which the wall engine turns into a wall. This is what makes it
// possible to draw a bare wall segment (and then hang a door on it)
// instead of having to enclose an area with the fog shapes.
//
// Direct port of upstream `createLineMode`.

import OBR, {
  buildLine,
  Math2,
  type InteractionManager,
  type Line,
  type ToolEvent,
  type Vector2,
} from "@owlbear-rodeo/sdk";
import { getLocalLang } from "../../../../state";
import { ICON_LINE } from "../overlayAssets";
import { LINE_MODE_ID, OBR_FOG_TOOL } from "../ids";

let interaction: InteractionManager<Line> | null = null;

async function createLine(start: Vector2): Promise<Line> {
  const [color, strokeWidth] = await Promise.all([
    OBR.scene.fog.getColor(),
    OBR.scene.fog.getStrokeWidth(),
  ]);
  return buildLine()
    .startPosition(start)
    .endPosition(start)
    .strokeWidth(strokeWidth)
    .strokeColor(color)
    .layer("FOG")
    .build();
}

async function getDragPosition(event: ToolEvent): Promise<Vector2> {
  return await OBR.scene.grid.snapPosition(event.pointerPosition);
}

export async function createLineMode(): Promise<void> {
  const en = getLocalLang() === "en";
  await OBR.tool.createMode({
    id: LINE_MODE_ID,
    icons: [
      {
        icon: ICON_LINE,
        label: en ? "Line" : "直线墙",
        filter: { activeTools: [OBR_FOG_TOOL] },
      },
    ],
    async onToolDragStart(_, event) {
      const position = await getDragPosition(event);
      const line = await createLine(position);
      interaction = await OBR.interaction.startItemInteraction(line);
    },
    async onToolDragMove(_, event) {
      if (!interaction) return;
      const position = await getDragPosition(event);
      const [update] = interaction;
      update((line) => {
        line.endPosition = position;
      });
    },
    async onToolDragEnd(_, event) {
      if (!interaction) return;
      const position = await getDragPosition(event);
      const [update, stop] = interaction;
      const line = update((item) => {
        // Re-origin so the line's own position is its start point —
        // matches how Owlbear's native tools emit lines.
        item.position = item.startPosition;
        item.endPosition = Math2.subtract(position, item.startPosition);
        item.startPosition = { x: 0, y: 0 };
        item.zIndex = Date.now();
      });
      stop();
      interaction = null;
      try {
        await OBR.scene.items.addItems([line]);
      } catch (e) {
        console.warn("[dynfog] failed to add fog line", e);
      }
    },
    async onToolDragCancel() {
      if (!interaction) return;
      const [, stop] = interaction;
      stop();
      interaction = null;
    },
    cursors: [{ cursor: "crosshair" }],
  });
}

export async function removeLineMode(): Promise<void> {
  try {
    await OBR.tool.removeMode(LINE_MODE_ID);
  } catch {}
}
