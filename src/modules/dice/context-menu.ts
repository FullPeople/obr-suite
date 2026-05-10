import OBR from "@owlbear-rodeo/sdk";
import { resolveClickRollTarget } from "./tags";
import { assetUrl } from "../../asset-base";

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
const URL = assetUrl("dice-rollable-menu.html");
const POPOVER_W = 170;
const POPOVER_H = 268; // 6 items (incl. 重击) + separator + paddings
const EDGE_MARGIN = 8;

// Quick-pick popup (LEFT click) — full dice picker (7 dice + expression
// + label + 劣势/普通/优势/重击 + DM 暗骰), modeled on the dice action
// panel. Lets the user pick a roll mode AND tweak the expression /
// dice counts inline without committing to "always normal" or having
// to right-click + dispatch through the action panel.
const QUICK_POPOVER_ID = "com.obr-suite/rollable-quick";
const QUICK_URL = assetUrl("dice-quick-popup.html");
const QUICK_POPOVER_W = 320;
const QUICK_POPOVER_H = 296;

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

async function openQuickPopupAt(
  args: {
    expression: string;
    label: string;
    itemId: string | null;
  },
  viewportPos: { x: number; y: number },
): Promise<void> {
  const params = new URLSearchParams();
  params.set("expr", args.expression);
  params.set("label", args.label);
  if (args.itemId) params.set("itemId", args.itemId);

  const [vw, vh] = await Promise.all([
    OBR.viewport.getWidth().catch(() => 1280),
    OBR.viewport.getHeight().catch(() => 720),
  ]);
  const left = Math.max(
    EDGE_MARGIN,
    Math.min(viewportPos.x, vw - QUICK_POPOVER_W - EDGE_MARGIN),
  );
  const top = Math.max(
    EDGE_MARGIN,
    Math.min(viewportPos.y, vh - QUICK_POPOVER_H - EDGE_MARGIN),
  );

  try { await OBR.popover.close(QUICK_POPOVER_ID); } catch {}
  await OBR.popover.open({
    id: QUICK_POPOVER_ID,
    url: `${QUICK_URL}?${params.toString()}`,
    width: QUICK_POPOVER_W,
    height: QUICK_POPOVER_H,
    anchorReference: "POSITION",
    anchorPosition: { left: Math.round(left), top: Math.round(top) },
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
    transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    hidePaper: true,
    disableClickAway: false,
  });
}

// Bind a click listener to a root element so any LEFT click on a
// `.rollable` descendant opens the quick-pick popup (劣势/普通/优势 +
// 重击) instead of immediately rolling normally. The popup itself
// broadcasts BC_QUICK_ROLL when the user picks a mode. Idempotent.
//
// `iframeOrigin` returns the iframe's top-left corner in OBR viewport
// pixels so the popup anchors at the actual click point. Without it the
// popup falls back to top-center.
export function bindRollableClickPopup(
  root: HTMLElement,
  itemIdResolver?: () => Promise<string | null>,
  iframeOrigin?: IframeOriginGetter,
): void {
  if ((root as any)._rollableClickPopupBound) return;
  (root as any)._rollableClickPopupBound = true;
  root.addEventListener("click", async (e) => {
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
      const vw = await OBR.viewport.getWidth().catch(() => 1280);
      viewportPos = { x: vw / 2 - QUICK_POPOVER_W / 2, y: 80 };
    }

    // Brief flash so the user sees which span they hit before the
    // popup masks the click point.
    target.classList.remove("rollable-flash");
    void target.offsetWidth;
    target.classList.add("rollable-flash");

    try {
      await openQuickPopupAt({ expression, label, itemId }, viewportPos);
    } catch (err) {
      console.error("[obr-suite/dice] openRollableQuickPopup failed", err);
    }
  }, { capture: true });
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
