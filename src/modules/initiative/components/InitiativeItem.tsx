import { useState, useRef, useEffect } from "preact/compat";
import { RollType } from "../hooks/useInitiative";
// (D20 icons removed — roll buttons are now plain colored brackets.)

interface Props {
  id: string;
  name: string;
  count: number;
  modifier: number;
  active: boolean;
  rolled: boolean;
  imageUrl: string;
  inCombat: boolean;
  preparing: boolean;
  isGM: boolean;
  canEdit: boolean;
  canShowDice: boolean;
  diceRolling: boolean;
  /** "raw" → show count alone (default; the d20 result). "final" →
   *  show count+modifier with a small sub-line "(count+mod)" so
   *  whoever runs the panel sees the resolved initiative value at a
   *  glance and can still verify the math. Toggled in the panel
   *  header; per-client localStorage. */
  displayMode: "raw" | "final";
  /** Display-only HP ratio in [0, 1]; null when no HP info available
   *  (no bubbles binding) or when the viewer's role/lock combo says
   *  not to show it. The bar is drawn ABOVE the count footer as a
   *  numberless progress strip so the user sees combat health at a
   *  glance without revealing exact HP for locked tokens. */
  hpRatio: number | null;
  onFocus: (id: string) => void;
  onHover?: (id: string | null) => void;
  onUpdateCount: (id: string, count: number) => void;
  onUpdateModifier: (id: string, mod: number) => void;
  onRoll: (id: string, type: RollType) => void;
  onEndTurn?: () => void;
  endTurnLabel?: string;
}

// Portrait card for the horizontal top-center strip. Image fills the top
// ~80% (top-aligned, cropped), count + modifier tile at the bottom.
// Active item bulges downward (taller). Roll buttons float below the card
// when applicable.
export function InitiativeItemRow({
  id, name, count, modifier, active, rolled, imageUrl,
  inCombat, preparing, isGM, canEdit, canShowDice, diceRolling,
  displayMode, hpRatio,
  onFocus, onHover, onUpdateCount, onUpdateModifier, onRoll,
  onEndTurn, endTurnLabel,
}: Props) {
  const [editingCount, setEditingCount] = useState(false);
  const [editingMod, setEditingMod] = useState(false);
  const [countVal, setCountVal] = useState(String(count));
  const [modVal, setModVal] = useState(String(modifier));
  const countRef = useRef<HTMLInputElement>(null);
  const modRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Scroll active item into view horizontally when it becomes active
  useEffect(() => {
    if (active && inCombat && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [active, inCombat]);

  const commitCount = () => {
    setEditingCount(false);
    const p = parseFloat(countVal);
    if (!isNaN(p) && p !== count) onUpdateCount(id, p);
  };

  const commitMod = () => {
    setEditingMod(false);
    const p = parseInt(modVal);
    if (!isNaN(p) && p !== modifier) onUpdateModifier(id, p);
  };

  const isActive = active && inCombat;
  const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;

  // Preparing: GM and owner-players can roll any number of times — visible
  // regardless of Dice+ availability (we fall back to a local roll if Dice+
  // isn't installed). Combat: GM only, since player rolls during combat
  // would race with active-turn writes.
  // `canShowDice` only suppresses GM-side combat rolls when there's no way
  // to roll on this client (currently always true for GM, but kept for
  // future-proofing).
  const showRollButtons =
    (preparing && canEdit) || (inCombat && isGM && canShowDice);

  const disableRoll = !isGM && preparing && diceRolling;

  // Show "End Turn" button to the active non-GM owner so they can advance
  // their own turn without waiting on the GM.
  const showEndTurn =
    !!onEndTurn && isActive && !isGM && canEdit;

  return (
    <div
      ref={rowRef}
      className={`initiative-item ${isActive ? "active" : ""} ${preparing ? "preparing" : ""}`}
      onClick={() => onFocus(id)}
      onMouseEnter={() => onHover?.(id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="item-img">
        {imageUrl ? (
          <img src={imageUrl} alt="" draggable={false} />
        ) : (
          <div className="item-img-placeholder">{name.charAt(0).toUpperCase()}</div>
        )}
      </div>

      {/* Modifier overlay — top-left corner of the image area, click to edit */}
      <div
        className="item-mod"
        onClick={(e) => {
          e.stopPropagation();
          setModVal(String(modifier));
          setEditingMod(true);
          setTimeout(() => modRef.current?.select(), 0);
        }}
      >
        {editingMod ? (
          <input
            ref={modRef}
            type="number"
            className="mod-input"
            value={modVal}
            onInput={(e) => setModVal((e.target as HTMLInputElement).value)}
            onBlur={commitMod}
            onKeyDown={(e) => { if (e.key === "Enter") commitMod(); if (e.key === "Escape") setEditingMod(false); }}
          />
        ) : (
          <span>{modStr}</span>
        )}
      </div>

      {/* HP progress bar — numberless strip that sits just above the
          count footer. Width tracks current/max HP; ratio is computed
          upstream so locked tokens (player view) get phase-quantised
          values matching the bubbles module's silhouette mode. Hidden
          entirely when hpRatio is null (no bubbles data, or viewer
          shouldn't see this token's HP at all). */}
      {hpRatio != null && (
        <div className="item-hp-track" aria-hidden="true">
          <div
            className="item-hp-fill"
            style={{ width: `${Math.max(0, Math.min(1, hpRatio)) * 100}%` }}
          />
        </div>
      )}

      {/* Count footer — always visible, editable by owner/GM.
          In `final` mode, the visible "count" is count+modifier and a
          small `(count±mod)` formula is shown right under it. The
          editable raw value (the d20 result / manual count) is still
          `count` itself — clicking the cell still puts you into the
          count input, NOT count+mod, so the math stays unambiguous.
          The mode is honoured regardless of `rolled` so the toggle
          is visible immediately even when nobody has rolled yet. */}
      <div
        className={`item-count ${canEdit ? "" : "locked"} ${displayMode === "final" ? "show-final" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          if (!canEdit) return;
          setCountVal(String(count));
          setEditingCount(true);
          setTimeout(() => countRef.current?.select(), 0);
        }}
      >
        {editingCount && canEdit ? (
          <input
            ref={countRef}
            type="number"
            className="count-input"
            value={countVal}
            onInput={(e) => setCountVal((e.target as HTMLInputElement).value)}
            onBlur={commitCount}
            onKeyDown={(e) => { if (e.key === "Enter") commitCount(); if (e.key === "Escape") setEditingCount(false); }}
          />
        ) : displayMode === "final" ? (
          <>
            <span className="count-display">{count + modifier}</span>
            <span className="count-formula">({count}{modifier >= 0 ? "+" : ""}{modifier})</span>
          </>
        ) : (
          <span className="count-display">{count}</span>
        )}
      </div>

      {/* Roll buttons — three colored bracket-blocks beneath the slot.
          No text, no icons; color communicates intent (red=disadv,
          slate=normal, green=adv). dis hugs the LEFT edge with a
          bottom-left curve, adv hugs the RIGHT edge with a bottom-
          right curve, normal fills the middle with straight corners
          so the trio reads as a single shelf. */}
      {showRollButtons && (
        <div className="roll-buttons" onClick={(e) => e.stopPropagation()}>
          <button
            className="roll-btn roll-dis"
            onClick={() => onRoll(id, "disadvantage")}
            disabled={disableRoll}
            title="劣势 / Disadvantage (2d20 取较低)"
            aria-label="劣势"
          />
          <button
            className="roll-btn roll-normal"
            onClick={() => onRoll(id, "normal")}
            disabled={disableRoll}
            title="正常 / Normal (1d20)"
            aria-label="正常"
          />
          <button
            className="roll-btn roll-adv"
            onClick={() => onRoll(id, "advantage")}
            disabled={disableRoll}
            title="优势 / Advantage (2d20 取较高)"
            aria-label="优势"
          />
        </div>
      )}

      {/* End-turn button — active non-GM owner only. Takes the same slot as
          roll buttons (during combat, rolls aren't shown to non-GMs). */}
      {showEndTurn && !showRollButtons && (
        <button
          className="end-turn-btn"
          onClick={(e) => { e.stopPropagation(); onEndTurn?.(); }}
          title="结束当前回合，进入下一个"
        >
          {endTurnLabel ?? "结束回合"}
        </button>
      )}
    </div>
  );
}
