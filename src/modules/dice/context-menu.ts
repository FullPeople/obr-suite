import OBR from "@owlbear-rodeo/sdk";
import { resolveClickRollTarget } from "./tags";

// Right-click context menu for `.rollable` spans. Implemented as an
// OBR popover (`dice-rollable-menu.html`) — NOT an in-iframe DOM
// menu — because in-iframe menus are clipped by the parent popover's
// fixed dimensions and don't reliably receive pointer events through
// OBR's overlay layer.
//
// Menu actions (handled by the popover itself):
//   投掷       — open roll
//   优势 / 劣势 — d20 advantage / disadvantage variant
//   添加到骰盘  — opens dice panel and pre-fills the expression

export type RollableMenuKind = "open" | "dark";

const POPOVER_ID = "com.obr-suite/rollable-menu";
const URL = "https://obr.dnd.center/suite/dice-rollable-menu.html";
const POPOVER_W = 170;
const POPOVER_H = 232; // 5 items + separator + paddings
const EDGE_MARGIN = 8;

// Returns the iframe's TOP-LEFT corner in OBR viewport pixels, used to
// translate iframe-local clientX/clientY into viewport coords for
// `anchorPosition`. Each parent iframe knows its own popover anchor
// setup (we wrote those) so each caller passes a getter matching its
// layout — see bestiary monster-info-page.ts and characterCards
// info-page.ts.
export type IframeOriginGetter = () => Promise<{ left: number; top: number }>;

async function openMenuPopoverAt(
  args: {
    expression: string;
    label: string;
    kind: RollableMenuKind;
    itemId: string | null;
  },
  viewportPos: { x: number; y: number },
): Promise<void> {
  const params = new URLSearchParams();
  params.set("expr", args.expression);
  params.set("label", args.label);
  params.set("kind", args.kind);
  if (args.itemId) params.set("itemId", args.itemId);

  // Clamp inside the OBR viewport so the menu never lands off-screen
  // when the click happens near the right / bottom edge of the parent
  // popover. The popover's anchorOrigin is TOP-LEFT — anchorPosition
  // is therefore the menu's top-left corner.
  const [vw, vh] = await Promise.all([
    OBR.viewport.getWidth().catch(() => 1280),
    OBR.viewport.getHeight().catch(() => 720),
  ]);
  const left = Math.max(
    EDGE_MARGIN,
    Math.min(viewportPos.x, vw - POPOVER_W - EDGE_MARGIN),
  );
  const top = Math.max(
    EDGE_MARGIN,
    Math.min(viewportPos.y, vh - POPOVER_H - EDGE_MARGIN),
  );

  try { await OBR.popover.close(POPOVER_ID); } catch {}
  await OBR.popover.open({
    id: POPOVER_ID,
    url: `${URL}?${params.toString()}`,
    width: POPOVER_W,
    height: POPOVER_H,
    anchorReference: "POSITION",
    anchorPosition: { left: Math.round(left), top: Math.round(top) },
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
    transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    hidePaper: true,
    // Click-away closes the menu without an action.
    disableClickAway: false,
  });
}

// Bind a contextmenu listener to a root element. Any right-click on a
// `.rollable` descendant pops the OBR menu popover. Idempotent.
//
// `iframeOrigin` returns the iframe's top-left corner in OBR viewport
// pixels. The right-click's iframe-local `clientX/Y` is added to this
// origin to position the menu at the actual click point. If omitted,
// the menu falls back to top-center of the viewport.
export function bindRollableContextMenu(
  root: HTMLElement,
  kindFor: (target: HTMLElement) => RollableMenuKind,
  itemIdResolver?: () => Promise<string | null>,
  iframeOrigin?: IframeOriginGetter,
): void {
  if ((root as any)._rollableCmBound) return;
  (root as any)._rollableCmBound = true;
  root.addEventListener("contextmenu", async (e) => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".rollable",
    );
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const expression = target.dataset.expr ?? "";
    if (!expression) return;
    const label = target.dataset.label ?? "";
    const itemId = itemIdResolver
      ? await itemIdResolver()
      : await resolveClickRollTarget();

    let viewportPos: { x: number; y: number };
    if (iframeOrigin) {
      const origin = await iframeOrigin();
      viewportPos = { x: origin.left + e.clientX, y: origin.top + e.clientY };
    } else {
      // Fallback — center-top of viewport.
      const vw = await OBR.viewport.getWidth().catch(() => 1280);
      viewportPos = { x: vw / 2 - POPOVER_W / 2, y: 80 };
    }

    try {
      await openMenuPopoverAt(
        { expression, label, kind: kindFor(target), itemId },
        viewportPos,
      );
    } catch (err) {
      console.error("[obr-suite/dice] openRollableMenu failed", err);
    }
  });
}
