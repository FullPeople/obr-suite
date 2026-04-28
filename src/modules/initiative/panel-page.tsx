import { render } from "preact";
import { useEffect, useState, useRef, useCallback, createContext } from "preact/compat";
import OBR from "@owlbear-rodeo/sdk";
import { InitiativeList } from "./components/InitiativeList";
import { CombatControls } from "./components/CombatControls";
import { useInitiative, RollType } from "./hooks/useInitiative";
import { METADATA_KEY } from "./utils/constants";
import { Lang, t } from "./utils/i18n";
import {
  startSceneSync,
  getLocalLang,
  onLangChange,
} from "../../state";
import { ICONS } from "../../icons";
import {
  setActiveRing,
  setHoverRing,
  clearAllRings,
} from "./utils/visualEffects";
import { subscribeToSfx } from "../dice/sfx-broadcast";
import "./styles/initiative.css";

// Suite-namespaced popover ID so the standalone plugin (same logical UI)
// doesn't fight with us over the same iframe during the deprecation window.
const POPOVER_ID = "com.obr-suite/initiative-panel";
// Mirrors background.ts constants — horizontal strip top-center.
const COLLAPSED_WIDTH = 120;
const COLLAPSED_HEIGHT = 40;
const EXPANDED_WIDTH = 720;
// 162 + 22px (one roll-button row + breathing room) so the horizontal
// scrollbar that appears with many initiative entries doesn't clip the
// below-card buttons. Same height for everyone — owner-players also need
// this room for roll/end-turn buttons during preparing/their active turn.
const EXPANDED_HEIGHT = 184;

export const LangContext = createContext<Lang>("zh");

function App() {
  // Language is per-client (localStorage). Each player picks their own
  // UI language; the DM's choice doesn't propagate.
  const [lang, setLang] = useState<Lang>(
    () => (getLocalLang() as Lang) ?? "zh"
  );
  useEffect(() => {
    startSceneSync();
    const unsub = onLangChange((l) => setLang(l as Lang));
    return unsub;
  }, []);
  const {
    items,
    combatState,
    diceRolling,
    isGM,
    canEdit,
    focusItem,
    updateCount,
    updateModifier,
    rollInitiativeLocal,
    rollInitiativeDicePlus,
    startPreparation,
    startCombat,
    cancelPreparation,
    nextTurn,
    prevTurn,
    endCombat,
    requestEndTurn,
    dicePlusAvailable,
  } = useInitiative();

  // React state is the authoritative source — not window.innerWidth. The old
  // resize listener flipped expanded→collapsed mid-way through OBR's iframe
  // resize animation (when width crossed the threshold), so the UI briefly
  // rendered mismatched layouts. Now we only change state on explicit calls.
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem("it-expanded") !== "0"; } catch { return true; }
  });
  const [transitioning, setTransitioning] = useState(false);
  const expandedRef = useRef(expanded);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);

  // Apply current state to OBR popover once on mount.
  useEffect(() => {
    const w = expandedRef.current ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
    const h = expandedRef.current ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
    OBR.popover.setWidth(POPOVER_ID, w).catch(() => {});
    OBR.popover.setHeight(POPOVER_ID, h).catch(() => {});
  }, []);

  // GM always rolls locally; players use Dice+ when installed and fall back
  // to a local roll otherwise. Buttons are now always shown for owner-players
  // during preparing — `canShowDice` is only consulted for GM combat rolls.
  const canShowDice = isGM || dicePlusAvailable !== false;

  const setPanelExpanded = useCallback((next: boolean) => {
    if (next === expandedRef.current) return;
    expandedRef.current = next;
    try { localStorage.setItem("it-expanded", next ? "1" : "0"); } catch {}

    // Hide content for the length of OBR's resize animation so the user
    // never sees mismatched layout (expanded content in a shrinking iframe,
    // or collapsed rail stretched in a widening iframe). Feels like an
    // abrupt snap, which is what the user asked for.
    setTransitioning(true);
    setExpanded(next);
    const w = next ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
    const h = next ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
    OBR.popover.setWidth(POPOVER_ID, w).catch(() => {});
    OBR.popover.setHeight(POPOVER_ID, h).catch(() => {});
    setTimeout(() => setTransitioning(false), 260);
  }, []);

  const toggleExpanded = useCallback(() => {
    setPanelExpanded(!expanded);
  }, [expanded, setPanelExpanded]);

  // ① Auto expand/collapse based on combat state
  const wasActive = useRef(false);
  useEffect(() => {
    const isActive = combatState.preparing || combatState.inCombat;
    // Enter active phase — expand
    if (isActive && !wasActive.current) {
      setPanelExpanded(true);
    }
    // Leave active phase — collapse
    else if (!isActive && wasActive.current) {
      setPanelExpanded(false);
    }
    wasActive.current = isActive;
  }, [combatState.preparing, combatState.inCombat, setPanelExpanded]);

  // ⑥ Visual effects — Active character ring (rotating, local)
  const activeId = items.find((i) => i.active)?.id;
  useEffect(() => {
    if (combatState.inCombat && activeId) {
      setActiveRing(activeId);
    } else {
      setActiveRing(null);
    }
    return () => { if (!combatState.inCombat) clearAllRings(); };
  }, [activeId, combatState.inCombat]);

  // Hover ring — local
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  useEffect(() => {
    setHoverRing(hoveredId);
  }, [hoveredId]);

  // Catch fast mouse exits: clear hover when window/document loses focus
  useEffect(() => {
    const clear = () => setHoveredId(null);
    window.addEventListener("blur", clear);
    document.addEventListener("mouseleave", clear);
    return () => {
      window.removeEventListener("blur", clear);
      document.removeEventListener("mouseleave", clear);
    };
  }, []);

  // Clean up on unmount
  useEffect(() => () => { clearAllRings(); }, []);

  // Language is set by suite Settings; the in-panel CN/EN selector was
  // removed in favour of centralized control.

  const handleRoll = useCallback(async (itemId: string, type: RollType) => {
    if (isGM || combatState.inCombat) {
      await rollInitiativeLocal(itemId, type);
    } else if (combatState.preparing) {
      // Owner-player during prep: use Dice+ when available so everyone sees
      // the roll, otherwise fall back to a silent local roll so the click
      // still does something on clients that don't have Dice+ installed.
      if (dicePlusAvailable === false) {
        await rollInitiativeLocal(itemId, type);
      } else {
        await rollInitiativeDicePlus(itemId, type);
      }
    }
  }, [isGM, combatState, dicePlusAvailable, rollInitiativeLocal, rollInitiativeDicePlus]);

  const handleClick = useCallback(async (itemId: string) => {
    focusItem(itemId);
  }, [focusItem]);

  const stateClass = combatState.preparing ? "state-preparing"
    : combatState.inCombat ? "state-combat" : "";

  // Collapsed: compact pill. Stays top-center like the expanded bar.
  if (!expanded) {
    return (
      <div className={`app-pill ${stateClass} ${transitioning ? "transitioning" : ""}`}>
        <button className="pill-btn" onClick={toggleExpanded} title="展开先攻面板">
          <span className="icon" dangerouslySetInnerHTML={{ __html: ICONS.swords }} />
          {combatState.inCombat && (
            <span className="pill-round">R{combatState.round}</span>
          )}
          {combatState.preparing && (
            <span className="pill-round">{t(lang, "preparing")}</span>
          )}
        </button>
      </div>
    );
  }

  return (
    <LangContext.Provider value={lang}>
      <div className={`app-hbar ${stateClass} ${transitioning ? "transitioning" : ""} ${canShowDice ? "" : "no-dice"}`}>
        {/* Controls row — single centered cluster: 折叠 / state / 战斗按钮 /
            EN / 关于. Everything hugs the middle so it doesn't waste edge space. */}
        <div className="hbar-row hbar-row-controls">
          <div className="hbar-cluster">
            <button
              className="collapse-btn"
              onClick={toggleExpanded}
              title="折叠"
              aria-label="折叠"
            >
              {/* Chevron-down "V" — panel will collapse downward into the pill */}
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path
                  d="M3 6 L8 11 L13 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {combatState.preparing && (
              <span className="state-text preparing">{t(lang, "preparing")}</span>
            )}
            {combatState.inCombat && (
              <span className="state-text combat">
                {t(lang, "round")} {combatState.round}
              </span>
            )}

            {isGM && (
              <CombatControls
                combatState={combatState}
                hasItems={items.length > 0}
                onStartPreparation={startPreparation}
                onStartCombat={startCombat}
                onCancelPreparation={cancelPreparation}
                onPrevTurn={prevTurn}
                onNextTurn={nextTurn}
                onEndCombat={endCombat}
                lang={lang}
              />
            )}

            {/* CN/EN selector + About button removed — both are centrally
                controlled by the suite Settings / About panels. */}
          </div>
        </div>

        <div className="hbar-row hbar-row-items">
          <InitiativeList
            items={items}
            inCombat={combatState.inCombat}
            preparing={combatState.preparing}
            isGM={isGM}
            playerId=""
            diceRolling={diceRolling}
            canEdit={canEdit}
            canShowDice={canShowDice}
            onFocus={handleClick}
            onHover={setHoveredId}
            onUpdateCount={updateCount}
            onUpdateModifier={updateModifier}
            onRoll={handleRoll}
            onEndTurn={requestEndTurn}
            endTurnLabel={t(lang, "endTurn") || "结束回合"}
            lang={lang}
          />
        </div>
      </div>
    </LangContext.Provider>
  );
}

function PluginGate() {
  const [ready, setReady] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);

  useEffect(() => {
    OBR.onReady(() => {
      subscribeToSfx();
      setReady(true);
      OBR.scene.isReady().then(setSceneReady);
      OBR.scene.onReadyChange(setSceneReady);
    });
  }, []);

  if (!ready || !sceneReady) {
    return (
      <div className="app-container">
        <div className="loading-state">加载中...</div>
      </div>
    );
  }

  return <App />;
}

render(<PluginGate />, document.getElementById("root")!);
