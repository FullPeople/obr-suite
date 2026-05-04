import { Ref } from "preact";
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
}

export function InitiativeList({
  items, inCombat, preparing, isGM, diceRolling, canEdit, canShowDice,
  displayMode, resolveHpRatio, listRef,
  onFocus, onHover, onUpdateCount, onUpdateModifier, onRoll,
  onEndTurn, endTurnLabel, lang,
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

  return (
    <div
      ref={listRef}
      className="initiative-list"
      onMouseLeave={() => onHover?.(null)}
    >
      {items.map((item) => (
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
          onFocus={onFocus}
          onHover={onHover}
          onUpdateCount={onUpdateCount}
          onUpdateModifier={onUpdateModifier}
          onRoll={onRoll}
          onEndTurn={onEndTurn}
          endTurnLabel={endTurnLabel}
        />
      ))}
    </div>
  );
}
