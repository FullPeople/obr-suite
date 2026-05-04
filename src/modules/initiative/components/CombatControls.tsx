
import { CombatState } from "../types";
import { EffectType } from "../hooks/useInitiative";
import { Lang, t } from "../utils/i18n";
import { ICONS } from "../../../icons";

interface Props {
  combatState: CombatState;
  hasItems: boolean;
  /** Drag-in auto-add toggle. ON = dragging a token in during prep/combat
   *  triggers the "add to initiative?" modal. OFF (strikethrough) = silent.
   *  GM-side preference — passed as null on player clients. */
  dragInAuto: boolean;
  onToggleDragInAuto: () => void;
  onStartPreparation: (effectType: EffectType) => void;
  onStartCombat: () => void;
  onCancelPreparation: () => void;
  onPrevTurn: () => void;
  onNextTurn: () => void;
  onEndCombat: () => void;
  lang: Lang;
}

function DragInAutoButton({
  dragInAuto,
  onToggle,
  lang,
}: { dragInAuto: boolean; onToggle: () => void; lang: Lang }) {
  return (
    <button
      type="button"
      className={`btn btn-drag-in-auto ${dragInAuto ? "on" : "off"}`}
      onClick={onToggle}
      title={t(lang, "dragInAutoTitle")}
      aria-pressed={dragInAuto}
    >
      {t(lang, dragInAuto ? "dragInAutoOn" : "dragInAutoOff")}
    </button>
  );
}

export function CombatControls({
  combatState,
  hasItems,
  dragInAuto,
  onToggleDragInAuto,
  onStartPreparation,
  onStartCombat,
  onCancelPreparation,
  onPrevTurn,
  onNextTurn,
  onEndCombat,
  lang,
}: Props) {
  // Idle: two buttons side by side — "战斗准备" (yellow) + "突袭" (red)
  if (!combatState.inCombat && !combatState.preparing) {
    return (
      <div className="combat-controls">
        <div className="prep-controls">
          <button
            className="btn btn-prepare"
            onClick={() => onStartPreparation("prepare")}
            disabled={!hasItems}
            title={!hasItems ? t(lang, "addFirst") : ""}
          >
            <span className="btn-icon" dangerouslySetInnerHTML={{ __html: ICONS.swords }} /> {t(lang, "startPreparation")}
          </button>
          <button
            className="btn btn-ambush"
            onClick={() => onStartPreparation("ambush")}
            disabled={!hasItems}
            title={!hasItems ? t(lang, "addFirst") : ""}
          >
            <span className="btn-icon" dangerouslySetInnerHTML={{ __html: ICONS.zap }} /> {t(lang, "ambush")}
          </button>
        </div>
      </div>
    );
  }

  // Preparing: "开始战斗" + "取消"
  if (combatState.preparing) {
    return (
      <div className="combat-controls">
        <div className="prep-controls">
          <DragInAutoButton dragInAuto={dragInAuto} onToggle={onToggleDragInAuto} lang={lang} />
          <button
            className="btn btn-start"
            onClick={onStartCombat}
            disabled={!hasItems}
          >
            <span className="btn-icon" dangerouslySetInnerHTML={{ __html: ICONS.swords }} /> {t(lang, "startCombat")}
          </button>
          <button
            className="btn btn-cancel"
            onClick={onCancelPreparation}
          >
            {t(lang, "cancelPreparation")}
          </button>
        </div>
      </div>
    );
  }

  // In Combat: prev/next + end
  return (
    <div className="combat-controls">
      <div className="turn-controls">
        <DragInAutoButton dragInAuto={dragInAuto} onToggle={onToggleDragInAuto} lang={lang} />
        <button className="btn btn-prev" onClick={onPrevTurn}>
          {t(lang, "prev")}
        </button>
        <button className="btn btn-next" onClick={onNextTurn}>
          {t(lang, "next")}
        </button>
      </div>
      <button className="btn btn-end" onClick={onEndCombat}>
        <span className="btn-icon" dangerouslySetInnerHTML={{ __html: ICONS.stop }} /> {t(lang, "endCombat")}
      </button>
    </div>
  );
}
