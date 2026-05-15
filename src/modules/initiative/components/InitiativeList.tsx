import { Ref } from "preact";
import { useState, useEffect } from "preact/hooks";
import { InitiativeItem } from "../types";
import { InitiativeItemRow } from "./InitiativeItem";
import { RollType } from "../hooks/useInitiative";
import { Lang, t } from "../utils/i18n";
import { ICONS } from "../../../icons";

interface Props {
  items: InitiativeItem[];
  inCombat: boolean;
  preparing: boolean;
  isGM: boolean;
  playerId: string;
  diceRolling: boolean;
  canEdit: (item: InitiativeItem) => boolean;
  canShowDice: boolean;
  /** "raw" = show the d20 result as the count; "final" = show count+mod
   *  with the formula in a smaller sub-line. Per-client preference. */
  displayMode: "raw" | "final";
  /** Resolves the displayable HP ratio for a given item (or null if
   *  no HP data / viewer should not see). Implemented at the panel
   *  level because the rules depend on the viewer's role + ownership
   *  + combat-active state, which the row itself doesn't know. */
  resolveHpRatio: (item: InitiativeItem) => number | null;
  /** Per-token tint color from the owner's player color (DM uses
   *  their own DM color). Empty string = no tint, fall back to
   *  default slot styling. Resolved in useInitiative against the
   *  live OBR.party players + own OBR.player.color. */
  resolveOwnerColor?: (item: InitiativeItem) => string;
  /** Forwarded to the .initiative-list root so panel-page can attach
   *  wheel + pointer drag handlers directly via ref instead of via
   *  a fragile querySelector lookup. */
  listRef?: Ref<HTMLDivElement>;
  onFocus: (id: string) => void;
  onHover?: (id: string | null) => void;
  onUpdateCount: (id: string, count: number) => void;
  onUpdateModifier: (id: string, mod: number) => void;
  onRoll: (id: string, type: RollType) => void;
  onEndTurn?: () => void;
  endTurnLabel?: string;
  lang: Lang;
  // 2026-05-14 (#5) — DM-only manual reorder mode. When `reorderMode`
  // is on, the normal row controls are covered by a click-catch layer.
  //
  // Interaction (refined 2026-05-14):
  //   1. First click on a card  → PICK it. The card STAYS in place
  //      (highlighted); an arrow appears at the cursor and follows the
  //      mouse so it's obvious something is "in hand".
  //   2. Second click:
  //      • on a GAP (kart-slot)  → onPlaceAtSlot(index): panel-page
  //        nudges the picked card's `count` so its (count+modifier)
  //        total lands between the gap's two neighbours. Modifier
  //        untouched.
  //      • on another CARD       → onSwapWith(id): the two cards swap
  //        positions — each takes the other's total slot (count
  //        recomputed, modifier untouched).
  //      • on the picked card    → cancels the pick.
  // Slots immediately adjacent to the picked card are inert (dropping
  // there would be a no-op).
  reorderMode?: boolean;
  pickedId?: string | null;
  onPickItem?: (id: string) => void;
  onPlaceAtSlot?: (slotIndex: number) => void;
  onSwapWith?: (targetId: string) => void;
}

// 2026-05-14 (#5) — floating arrow that follows the cursor while a
// card is "in hand". position:fixed + pointer-events:none so it never
// blocks the slot / card click targets underneath.
function ReorderArrow() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    document.addEventListener("mousemove", h);
    return () => document.removeEventListener("mousemove", h);
  }, []);
  if (!pos) return null;
  return (
    <div class="reorder-arrow" style={{ left: `${pos.x}px`, top: `${pos.y}px` }}>
      <svg viewBox="0 0 24 24" width="22" height="22">
        <path
          d="M12 3 L12 17 M12 17 L7 12 M12 17 L17 12"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
  );
}

export function InitiativeList({
  items, inCombat, preparing, isGM, diceRolling, canEdit, canShowDice,
  displayMode, resolveHpRatio, resolveOwnerColor, listRef,
  onFocus, onHover, onUpdateCount, onUpdateModifier, onRoll,
  onEndTurn, endTurnLabel, lang,
  reorderMode, pickedId, onPickItem, onPlaceAtSlot, onSwapWith,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon" dangerouslySetInnerHTML={{ __html: ICONS.swords }} />
        <div className="empty-text">{t(lang, "noCharacters")}</div>
        <div className="empty-hint">{t(lang, "rightClickHint")}</div>
      </div>
    );
  }

  // Each row in normal mode; in reorder mode it's wrapped with an
  // absolutely-positioned click-catch overlay so the row's own
  // buttons / inputs don't fire — the whole row just becomes a big
  // "pick me" target. `pickedId` styling is applied on the wrapper.
  const renderRow = (item: Props["items"][number]) => (
    <InitiativeItemRow
      key={item.id}
      id={item.id}
      name={item.name}
      count={item.count}
      modifier={item.modifier}
      active={item.active}
      rolled={item.rolled}
      imageUrl={item.imageUrl}
      inCombat={inCombat}
      preparing={preparing}
      isGM={isGM}
      canEdit={canEdit(item)}
      canShowDice={canShowDice}
      diceRolling={diceRolling}
      displayMode={displayMode}
      hpRatio={resolveHpRatio(item)}
      ownerColor={resolveOwnerColor?.(item) ?? ""}
      invisible={item.invisible}
      onFocus={onFocus}
      onHover={onHover}
      onUpdateCount={onUpdateCount}
      onUpdateModifier={onUpdateModifier}
      onRoll={onRoll}
      onEndTurn={onEndTurn}
      endTurnLabel={endTurnLabel}
    />
  );

  // === Reorder mode ====================================================
  if (reorderMode) {
    // Every card stays in its sorted position. Slots sit between every
    // pair of cards (and at both ends) — slot `s` is "between
    // items[s-1] and items[s]". Slots are only interactive once a card
    // is picked; the two slots touching the picked card are inert
    // (dropping there is a no-op).
    const pickedIdx = pickedId ? items.findIndex((i) => i.id === pickedId) : -1;
    const Slot = ({ index }: { index: number }) => {
      const adjacentToPicked =
        pickedIdx >= 0 && (index === pickedIdx || index === pickedIdx + 1);
      const active = pickedIdx >= 0 && !adjacentToPicked;
      return (
        <div
          className={`reorder-slot ${active ? "active" : ""}`}
          title={active ? "放到这里" : ""}
          onClick={() => { if (active) onPlaceAtSlot?.(index); }}
        />
      );
    };
    return (
      <div ref={listRef} className="initiative-list reorder-mode" onMouseLeave={() => onHover?.(null)}>
        <Slot index={0} />
        {items.map((item, i) => (
          <>
            <div
              key={`wrap-${item.id}`}
              className={`reorder-wrap ${item.id === pickedId ? "picked" : ""}`}
            >
              {renderRow(item)}
              {/* click-catch overlay — swallows row clicks, turns the
                  whole card into a click target. First click picks;
                  with something already picked, clicking the picked
                  card cancels, clicking a different card swaps. */}
              <div
                className="reorder-catch"
                title={
                  !pickedId
                    ? "点击拿起这张卡"
                    : item.id === pickedId
                      ? "再次点击取消"
                      : "点击与这张卡交换位置"
                }
                onClick={() => {
                  if (!pickedId || item.id === pickedId) {
                    onPickItem?.(item.id);          // pick / cancel
                  } else {
                    onSwapWith?.(item.id);          // swap two cards
                  }
                }}
              />
            </div>
            <Slot index={i + 1} />
          </>
        ))}
        {pickedId && <ReorderArrow />}
      </div>
    );
  }

  // === Normal mode =====================================================
  return (
    <div
      ref={listRef}
      className="initiative-list"
      onMouseLeave={() => onHover?.(null)}
    >
      {items.map((item) => renderRow(item))}
    </div>
  );
}
