import { render } from "preact";
import { useEffect, useState, useRef, useCallback, createContext, useMemo } from "preact/compat";
import OBR from "@owlbear-rodeo/sdk";
import { InitiativeList } from "./components/InitiativeList";
import { CombatControls } from "./components/CombatControls";
import { useInitiative, RollType } from "./hooks/useInitiative";
import { METADATA_KEY } from "./utils/constants";
import { Lang, t } from "./utils/i18n";
import type { InitiativeItem } from "./types";
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
import { bindPanelDrag } from "../../utils/panelDrag";
import { PANEL_IDS } from "../../utils/panelLayout";
import "./styles/initiative.css";

// Suite-namespaced popover ID so the standalone plugin (same logical UI)
// doesn't fight with us over the same iframe during the deprecation window.
const POPOVER_ID = "com.obr-suite/initiative-panel";
// Mirrors background.ts constants — horizontal strip top-center.
const COLLAPSED_WIDTH = 120;
const COLLAPSED_HEIGHT = 40;
// Initial pop-open width — the panel auto-resizes to its centered
// `.hbar-cluster` content width on first render via OBR.popover.setWidth(),
// so this only matters for the first frame. Generous-but-not-huge so
// the cluster has room to lay out before we measure it.
const EXPANDED_WIDTH = 720;
// Minimum width when expanded. Without this floor, the auto-fit in the
// resize effect below would shrink the panel below 410 px on CN locales
// with few items + idle cluster — the controls cluster ends up cramped
// and the round/preparing badge wraps. 410 was the empirical sweet spot
// the user requested.
const MIN_EXPANDED_WIDTH = 410;
// Per-combat-state heights. The panel is shorter when no combat is
// active (no roll-button row beneath portraits) and tallest in
// combat (active-bulge + end-turn button on the active card).
//   idle      = 129 (no buttons below cards)
//   preparing = 139 (roll buttons below every card; +5 over the
//                    user-spec'd 134 in this round to avoid the
//                    roll-button strip clipping at the bottom)
//   combat    = 159 (roll buttons + active-bulge below cards)
const HEIGHT_IDLE = 129;
const HEIGHT_PREPARING = 139;
const HEIGHT_COMBAT = 159;
// Backwards-compat default — the unused historical "154" baseline,
// kept for the initial popover open before combatState is available.
const EXPANDED_HEIGHT = HEIGHT_IDLE;
function heightFor(state: { inCombat: boolean; preparing: boolean }): number {
  if (state.inCombat) return HEIGHT_COMBAT;
  if (state.preparing) return HEIGHT_PREPARING;
  return HEIGHT_IDLE;
}

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

  // Per-client display-mode toggle: "raw" shows the d20 result alone;
  // "final" shows count+modifier with a small `(count±mod)` formula
  // beneath. Persisted to localStorage so each player's preference
  // survives panel close.
  const [displayMode, setDisplayMode] = useState<"raw" | "final">(() => {
    try { return localStorage.getItem("it-display-mode") === "final" ? "final" : "raw"; } catch { return "raw"; }
  });

  // Capture this client's player id once so resolveHpRatio can do
  // ownership comparisons without an OBR round-trip per render.
  const myIdRef = useRef("");
  useEffect(() => {
    OBR.player.getId().then((id) => { myIdRef.current = id; }).catch(() => {});
  }, []);

  // Per-client phase threshold for locked tokens shown to non-owners
  // during combat (mirrors the bubbles silhouette quantisation key).
  // Read once on mount + refresh on `storage` events so flipping the
  // setting in another tab is picked up.
  const PLAYER_THRESHOLD_KEY = "com.obr-suite/bubbles/player-threshold";
  const [playerThreshold, setPlayerThreshold] = useState<number>(() => {
    try {
      const v = localStorage.getItem(PLAYER_THRESHOLD_KEY);
      const n = v == null ? 25 : Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 25;
    } catch { return 25; }
  });
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PLAYER_THRESHOLD_KEY) return;
      const n = e.newValue == null ? 25 : Number(e.newValue);
      setPlayerThreshold(Number.isFinite(n) && n >= 0 && n <= 100 ? n : 25);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const resolveHpRatio = useCallback((item: InitiativeItem): number | null => {
    if (item.maxHp <= 0) return null;
    const ratio = Math.max(0, Math.min(1, item.hp / item.maxHp));
    const ownsItem = !!myIdRef.current && item.ownerId === myIdRef.current;
    // GM and the token's owner always see the actual ratio. Other
    // viewers follow the bubbles rules: locked + idle → hidden;
    // locked + combat → quantise to threshold steps; unlocked → full.
    if (isGM || ownsItem) return ratio;
    if (item.bubblesLocked) {
      const inCombatOrPrep = combatState.inCombat || combatState.preparing;
      if (!inCombatOrPrep) return null;
      // Quantise to ceiling step (matching bubbles' silhouette rule).
      if (playerThreshold <= 0) return ratio;
      const step = playerThreshold / 100;
      if (step >= 1) return ratio > 0 ? 1 : 0;
      return Math.max(0, Math.min(1, Math.ceil(ratio / step) * step));
    }
    return ratio;
  }, [isGM, combatState.inCombat, combatState.preparing, playerThreshold]);

  // Suppress unused-import warning until this hook becomes useMemo'd
  // (kept import for future-proofing other helpers in this file).
  void useMemo;

  // Drag-in auto-add: per-GM-client preference. When OFF, dragging a
  // character into the scene during prep/combat won't trigger the
  // auto-prompt modal in `modules/initiative/index.ts`. The watcher in
  // that file reads the same localStorage key on each items.onChange
  // tick so toggling here takes effect on the very next drag.
  const DRAG_IN_AUTO_KEY = "obr-suite/initiative/drag-in-auto";
  const [dragInAuto, setDragInAuto] = useState<boolean>(() => {
    try { return localStorage.getItem(DRAG_IN_AUTO_KEY) !== "0"; } catch { return true; }
  });
  const toggleDragInAuto = useCallback(() => {
    setDragInAuto((prev) => {
      const next = !prev;
      try { localStorage.setItem(DRAG_IN_AUTO_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);
  const toggleDisplayMode = useCallback(() => {
    setDisplayMode((m) => {
      const next = m === "raw" ? "final" : "raw";
      try { localStorage.setItem("it-display-mode", next); } catch {}
      return next;
    });
  }, []);

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
    const h = expandedRef.current ? heightFor(combatState) : COLLAPSED_HEIGHT;
    OBR.popover.setWidth(POPOVER_ID, w).catch(() => {});
    OBR.popover.setHeight(POPOVER_ID, h).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track combat-state height changes — the panel grows / shrinks as
  // the user moves between idle / preparing / combat phases.
  useEffect(() => {
    if (!expanded) return;
    OBR.popover.setHeight(POPOVER_ID, heightFor(combatState)).catch(() => {});
  }, [expanded, combatState.inCombat, combatState.preparing]);

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
    const h = next ? heightFor(combatState) : COLLAPSED_HEIGHT;
    OBR.popover.setWidth(POPOVER_ID, w).catch(() => {});
    OBR.popover.setHeight(POPOVER_ID, h).catch(() => {});
    setTimeout(() => setTransitioning(false), 260);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combatState.inCombat, combatState.preparing]);

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

  // Initial-load auto-collapse — if the scene comes up with NO items
  // tracked AND no combat is active, force the panel into pill form
  // even when the user's persisted preference (`it-expanded`) wants
  // it expanded. An empty expanded panel produces the layout glitch
  // the user reported (no list, the controls cluster floating in
  // empty space). Runs exactly once per panel mount; user can still
  // expand manually afterwards.
  const initialAutoCollapseDone = useRef(false);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const combatStateRef = useRef(combatState);
  useEffect(() => { combatStateRef.current = combatState; }, [combatState]);
  useEffect(() => {
    if (initialAutoCollapseDone.current) return;
    // 500 ms is enough for `useInitiative` to have populated `items`
    // from the scene's metadata. If items count is still zero by then,
    // there genuinely are none.
    const t = setTimeout(() => {
      if (initialAutoCollapseDone.current) return;
      initialAutoCollapseDone.current = true;
      const cs = combatStateRef.current;
      if (itemsRef.current.length === 0 && !cs.preparing && !cs.inCombat) {
        setPanelExpanded(false);
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⑥ Visual effects — Active character ring (rotating, local)
  const activeId = items.find((i) => i.active)?.id;
  useEffect(() => {
    if (combatState.inCombat && activeId) {
      // Player side: never put a ring on an invisible token — that would
      // immediately reveal the hidden character's canvas location even
      // though the panel only shows them as "?".
      const activeItem = items.find((i) => i.id === activeId);
      if (!isGM && activeItem?.invisible) {
        setActiveRing(null);
      } else {
        setActiveRing(activeId);
      }
    } else {
      setActiveRing(null);
    }
    return () => { if (!combatState.inCombat) clearAllRings(); };
  }, [activeId, combatState.inCombat, items, isGM]);

  // Hover ring — local
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  useEffect(() => {
    if (!hoveredId) {
      setHoverRing(null);
      return;
    }
    // Same defense as the active ring above: hovering the "?" placeholder
    // on a player client must not reveal the token's location.
    const target = items.find((i) => i.id === hoveredId);
    if (!isGM && target?.invisible) {
      setHoverRing(null);
      return;
    }
    setHoverRing(hoveredId);
  }, [hoveredId, items, isGM]);

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

  // Clean up on unmount. The hover ring's auto-hide is now handled
  // by a BG-iframe poll over the ring's `last-shown-ts` metadata
  // (see `modules/initiative/index.ts`) — that poll naturally
  // catches the panel-close case 3 s later, no heartbeat broadcast
  // needed.
  useEffect(() => () => { clearAllRings(); }, []);

  // ---- Auto-fit popover width to the cluster's natural content ----
  // The expanded popover is sized to whatever `.hbar-cluster` ends up
  // measuring after layout — that lets it shrink to the cluster's CN
  // width and grow for EN labels without a hard-coded language switch.
  // Items that overflow are reachable via wheel + drag scroll (below).
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (cancelled) return;
      const cluster = document.querySelector<HTMLElement>(".hbar-cluster");
      if (!cluster) return;
      // 16 px outer padding (8 each side) so buttons don't touch the iframe edge.
      const w = Math.max(MIN_EXPANDED_WIDTH, Math.ceil(cluster.offsetWidth) + 16);
      try { OBR.popover.setWidth(POPOVER_ID, w); } catch {}
    });
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [expanded, lang, displayMode, combatState.inCombat, combatState.preparing, combatState.round, items.length]);

  // ---- Wheel + drag scroll on .initiative-list ----
  // Items overflow horizontally; the scrollbar is hidden in CSS, so
  // we wire wheel-to-horizontal and click-drag-to-scroll behaviour
  // here. The previous round used document.querySelector + a deps
  // array tied to items.length — that turned out to skip re-binding
  // when InitiativeList unmounted and remounted on phase changes
  // (idle ↔ preparing ↔ combat re-creates the list element when
  // items count crosses zero). Switching to a ref forwarded by
  // InitiativeList makes the binding deterministic.
  //
  // Behaviour:
  //  - wheel: deltaY → horizontal scrollLeft (clamped); native CSS
  //    `scroll-behavior: smooth` makes successive wheel events ease.
  //  - drag: pointer-down on non-interactive area → enter drag state
  //    after a 4 px dead-zone (so taps still register as clicks),
  //    follow cursor with overscroll allowed up to OVERSCROLL_PX.
  //    On pointer-up we animate any overscroll back to its bound
  //    via rAF — the "dead-zone bounce" the user asked for.
  //  - both phases: there's no inCombat / preparing gating; all
  //    states get scroll. The previous "only combat phase works"
  //    impression was likely because preparing usually has fewer
  //    items than combat and didn't overflow.
  const listElRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listElRef.current;
    if (!el) return;

    const OVERSCROLL_PX = 32;
    const DRAG_THRESHOLD_PX = 4;
    const BOUNCE_DURATION_MS = 220;

    let bounceRaf = 0;
    const cancelBounce = () => {
      if (bounceRaf) { cancelAnimationFrame(bounceRaf); bounceRaf = 0; }
    };
    const animateBounceTo = (target: number) => {
      cancelBounce();
      const startVal = el.scrollLeft;
      const startTime = performance.now();
      // Ease-out cubic for a natural snap-back.
      const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
      const tick = (now: number) => {
        const t = Math.min(1, (now - startTime) / BOUNCE_DURATION_MS);
        el.scrollLeft = startVal + (target - startVal) * easeOut(t);
        if (t < 1) bounceRaf = requestAnimationFrame(tick);
        else bounceRaf = 0;
      };
      bounceRaf = requestAnimationFrame(tick);
    };

    const maxScroll = () => Math.max(0, el.scrollWidth - el.clientWidth);

    const onWheel = (e: WheelEvent) => {
      const dy = e.deltaY;
      const dx = e.deltaX;
      if (dy === 0 && dx === 0) return;
      e.preventDefault();
      cancelBounce();
      const delta = Math.abs(dy) > Math.abs(dx) ? dy : dx;
      // Clamp to bounds (no overscroll for wheel — only drag).
      el.scrollLeft = Math.max(0, Math.min(maxScroll(), el.scrollLeft + delta));
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });

    let dragging = false;
    let armedDrag = false;       // pointer is down but threshold not yet crossed
    let pointerId = -1;
    let startX = 0;
    let startScrollLeft = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      // Inputs / interactive controls own their pointer events.
      if (target?.closest("button, input, .item-mod, .item-count")) return;
      armedDrag = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startScrollLeft = el.scrollLeft;
      cancelBounce();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!armedDrag || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        el.classList.add("is-dragging");
        try { el.setPointerCapture(pointerId); } catch {}
      }
      // Drag-following with overscroll headroom on both ends.
      const want = startScrollLeft - dx;
      const lo = -OVERSCROLL_PX;
      const hi = maxScroll() + OVERSCROLL_PX;
      el.scrollLeft = Math.max(lo, Math.min(hi, want));
      e.preventDefault();
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (!armedDrag || e.pointerId !== pointerId) return;
      const wasDragging = dragging;
      armedDrag = false;
      dragging = false;
      pointerId = -1;
      el.classList.remove("is-dragging");
      try { el.releasePointerCapture(e.pointerId); } catch {}
      if (wasDragging) {
        // Snap any overscroll back to the bounded range.
        const cur = el.scrollLeft;
        const bound = Math.max(0, Math.min(maxScroll(), cur));
        if (Math.abs(cur - bound) > 0.5) animateBounceTo(bound);
      }
    };
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerEnd);
    el.addEventListener("pointercancel", onPointerEnd);

    // Suppress text selection that would otherwise highlight count /
    // mod / button labels during a drag. CSS `user-select: none` on
    // the list handles the visual; this `selectstart` no-op blocks
    // the native selection on pointermove pre-threshold.
    const onSelectStart = (e: Event) => {
      if (armedDrag || dragging) e.preventDefault();
    };
    el.addEventListener("selectstart", onSelectStart);

    return () => {
      cancelBounce();
      el.removeEventListener("wheel", onWheel, { capture: true } as any);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerEnd);
      el.removeEventListener("pointercancel", onPointerEnd);
      el.removeEventListener("selectstart", onSelectStart);
    };
    // `expanded` matters here too — collapsing the panel renders the
    // pill (which doesn't include InitiativeList), so the .initiative-
    // list element unmounts and `listElRef.current` goes null. On
    // re-expand a NEW element is mounted; without `expanded` in this
    // deps array the effect wouldn't re-run, leaving the new element
    // with no listeners attached. Result was that wheel + drag worked
    // on the default-expanded panel but went dead after a single
    // collapse/expand cycle.
  }, [expanded, items.length, combatState.inCombat, combatState.preparing]);

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
    // Player side: clicking the "?" placeholder must not animate the
    // camera to the hidden token's position. DM still focuses locally so
    // they can find the character they hid.
    if (!isGM) {
      const target = items.find((i) => i.id === itemId);
      if (target?.invisible) return;
    }
    focusItem(itemId);
  }, [focusItem, items, isGM]);

  const stateClass = combatState.preparing ? "state-preparing"
    : combatState.inCombat ? "state-combat" : "";

  // Drag grip — present in both expanded and collapsed states. Uses a
  // ref + useEffect because the actual DOM node swaps when expand
  // toggles (different JSX subtree). bindPanelDrag installs
  // pointerdown/move/up listeners; release broadcasts to background
  // initiative module which re-issues OBR.popover.open().
  const dragHandleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dragHandleRef.current;
    if (!el) return;
    return bindPanelDrag(el, PANEL_IDS.initiative);
  }, [expanded]);

  const dragHandleSvg = (
    <svg viewBox="0 0 12 18" aria-hidden="true">
      <circle cx="3" cy="3" r="1.2" fill="currentColor" />
      <circle cx="9" cy="3" r="1.2" fill="currentColor" />
      <circle cx="3" cy="9" r="1.2" fill="currentColor" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" />
      <circle cx="3" cy="15" r="1.2" fill="currentColor" />
      <circle cx="9" cy="15" r="1.2" fill="currentColor" />
    </svg>
  );

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
        <div ref={dragHandleRef} className="drag-handle" title="拖动 / Drag" aria-label="拖动面板">
          {dragHandleSvg}
        </div>
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

            {/* Display-mode toggle: raw d20 ↔ final count+modifier value. */}
            <button
              className={`display-mode-toggle ${displayMode === "final" ? "on" : ""}`}
              onClick={toggleDisplayMode}
              title={
                displayMode === "raw"
                  ? (lang === "zh" ? "切换为显示最终值（d20+加值）" : "Switch to final value (d20 + mod)")
                  : (lang === "zh" ? "切换为显示骰值（d20 原值）" : "Switch to raw d20 value")
              }
              aria-label={lang === "zh" ? "切换显示模式" : "Toggle display mode"}
            >
              {displayMode === "final"
                ? (lang === "zh" ? "最终值" : "Final")
                : (lang === "zh" ? "骰值" : "Raw")}
            </button>

            {isGM && (
              <CombatControls
                combatState={combatState}
                hasItems={items.length > 0}
                dragInAuto={dragInAuto}
                onToggleDragInAuto={toggleDragInAuto}
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

            {/* Drag grip — last child of the cluster so it sits at the
                visual far-right of the controls row, opposite the
                collapse-btn on the left. */}
            <div ref={dragHandleRef} className="drag-handle" title="拖动 / Drag" aria-label="拖动面板">
              {dragHandleSvg}
            </div>
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
            displayMode={displayMode}
            resolveHpRatio={resolveHpRatio}
            listRef={listElRef}
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
