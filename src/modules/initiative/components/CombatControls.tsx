
import { CombatState } from "../types";
import { EffectType } from "../hooks/useInitiative";
import { Lang, t } from "../utils/i18n";

interface Props {
  combatState: CombatState;
  hasItems: boolean;
  onStartPreparation: (effectType: EffectType) => void;
  onStartCombat: () => void;
  onCancelPreparation: () => void;
  onPrevTurn: () => void;
  onNextTurn: () => void;
  onEndCombat: () => void;
  lang: Lang;
}

export function CombatControls({
  combatState,
  hasItems,
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
            <span className="btn-icon">⚔</span> {t(lang, "startPreparation")}
          </button>
          <button
            className="btn btn-ambush"
            onClick={() => onStartPreparation("ambush")}
            disabled={!hasItems}
            title={!hasItems ? t(lang, "addFirst") : ""}
          >
            <span className="btn-icon">⚡</span> {t(lang, "ambush")}
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
          <button
            className="btn btn-start"
            onClick={onStartCombat}
            disabled={!hasItems}
          >
            <span className="btn-icon">⚔</span> {t(lang, "startCombat")}
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
        <button className="btn btn-prev" onClick={onPrevTurn}>
          {t(lang, "prev")}
        </button>
        <button className="btn btn-next" onClick={onNextTurn}>
          {t(lang, "next")}
        </button>
      </div>
      <button className="btn btn-end" onClick={onEndCombat}>
        {t(lang, "endCombat")}
      </button>
    </div>
  );
}
