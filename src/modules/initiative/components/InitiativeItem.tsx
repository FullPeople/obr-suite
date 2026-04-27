import { useState, useRef, useEffect } from "preact/compat";
import { RollType } from "../hooks/useInitiative";
import { D20Icon, D20AdvIcon, D20DisIcon } from "./DiceIcons";

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
      title={name}
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

      {/* Count footer — always visible, editable by owner/GM */}
      <div
        className={`item-count ${canEdit ? "" : "locked"}`}
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
        ) : (
          <span className="count-display">{count}</span>
        )}
      </div>

      {/* Roll buttons — absolutely positioned BELOW the card, fit exactly
          the card width so rows don't collide. */}
      {showRollButtons && (
        <div className="roll-buttons" onClick={(e) => e.stopPropagation()}>
          <button
            className="roll-btn roll-dis"
            onClick={() => onRoll(id, "disadvantage")}
            disabled={disableRoll}
            title="2d20kl1 (劣势)"
          >
            <D20DisIcon />
          </button>
          <button
            className="roll-btn roll-normal"
            onClick={() => onRoll(id, "normal")}
            disabled={disableRoll}
            title="1d20"
          >
            <D20Icon />
          </button>
          <button
            className="roll-btn roll-adv"
            onClick={() => onRoll(id, "advantage")}
            disabled={disableRoll}
            title="2d20kh1 (优势)"
          >
            <D20AdvIcon />
          </button>
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
