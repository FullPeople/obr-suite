
import { useState, useRef, useEffect } from "preact/hooks";
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
  /** 2026-05-16 — wipe every token's initiative metadata. UI gates
   *  this behind a two-click confirm (first click arms the button,
   *  second within 3 s commits, mouse-out / 3-s timer disarms). */
  onClearAllInit: () => void;
  lang: Lang;
  // 2026-05-14 (#5) — manual reorder mode toggle. ON = the initiative
  // strip enters click-to-pick / click-to-place mode (kart-slot gaps).
  // GM-only; shown during prep + combat (when there's a list to sort).
  reorderMode: boolean;
  onToggleReorder: () => void;
}

/**
 * Two-click confirm button. First click arms (red + "再点一次确认"
 * label); second click within 3 s commits. Mouse-out + timeout both
 * disarm so a wandering cursor doesn't leave the button armed.
 */
function ClearAllButton({
  onConfirm,
  disabled,
  lang,
}: { onConfirm: () => void; disabled: boolean; lang: Lang }) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  const disarm = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setArmed(false);
  };
  const handle = () => {
    if (armed) {
      disarm();
      onConfirm();
      return;
    }
    setArmed(true);
    timerRef.current = window.setTimeout(disarm, 3000);
  };
  return (
    <button
      type="button"
      className={`btn btn-clear-all ${armed ? "armed" : ""}`}
      onClick={handle}
      onMouseLeave={armed ? disarm : undefined}
      disabled={disabled}
      title={t(lang, "clearAllInitTitle")}
    >
      {t(lang, armed ? "clearAllInitConfirm" : "clearAllInit")}
    </button>
  );
}

function ReorderButton({
  reorderMode,
  onToggle,
  lang,
}: { reorderMode: boolean; onToggle: () => void; lang: Lang }) {
  return (
    <button
      type="button"
      className={`btn btn-reorder ${reorderMode ? "on" : "off"}`}
      onClick={onToggle}
      title={t(lang, "reorderTitle")}
      aria-pressed={reorderMode}
    >
      {t(lang, reorderMode ? "reorderOn" : "reorderOff")}
    </button>
  );
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
  onClearAllInit,
  lang,
  reorderMode,
  onToggleReorder,
}: Props) {
  // Idle: two buttons side by side — "战斗准备" (yellow) + "突袭" (red).
  // 2026-05-16 — "一键清空" appears here too when there are items
  // already in initiative (DM may want to wipe leftover entries from a
  // previous fight before starting the next encounter).
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
          {hasItems && (
            <ClearAllButton onConfirm={onClearAllInit} disabled={false} lang={lang} />
          )}
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
          {hasItems && <ReorderButton reorderMode={reorderMode} onToggle={onToggleReorder} lang={lang} />}
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

  // In Combat: prev/next + end + clear-all
  return (
    <div className="combat-controls">
      <div className="turn-controls">
        <DragInAutoButton dragInAuto={dragInAuto} onToggle={onToggleDragInAuto} lang={lang} />
        {hasItems && <ReorderButton reorderMode={reorderMode} onToggle={onToggleReorder} lang={lang} />}
        <button className="btn btn-prev" onClick={onPrevTurn}>
          {t(lang, "prev")}
        </button>
        <button className="btn btn-next" onClick={onNextTurn}>
          {t(lang, "next")}
        </button>
      </div>
      <div className="end-row" style={{ display: "flex", gap: "6px" }}>
        <ClearAllButton onConfirm={onClearAllInit} disabled={false} lang={lang} />
        <button className="btn btn-end" onClick={onEndCombat}>
          <span className="btn-icon" dangerouslySetInnerHTML={{ __html: ICONS.stop }} /> {t(lang, "endCombat")}
        </button>
      </div>
    </div>
  );
}
