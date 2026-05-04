import { useState, useEffect, useCallback, useMemo, useRef } from "preact/compat";
import OBR from "@owlbear-rodeo/sdk";
import { InitiativeItem, CombatState } from "../types";
import {
  METADATA_KEY,
  COMBAT_STATE_KEY,
  BROADCAST_COMBAT_START,
  BROADCAST_COMBAT_END,
  BROADCAST_COMBAT_PREPARE,
  BROADCAST_FOCUS,
  BROADCAST_OPEN_PANEL,
  BROADCAST_CLOSE_PANEL,
  BROADCAST_END_TURN_REQUEST,
  COMBAT_EFFECT_MODAL_ID,
  PLUGIN_ID,
  DICE_PLUS_ROLL_REQUEST,
  DICE_PLUS_ROLL_RESULT,
  DICE_PLUS_ROLL_ERROR,
} from "../utils/constants";
import { itemToInitiativeItem, getCombatState } from "../utils/metadata";
import { getLocalLang } from "../../../state";
import { broadcastDiceRoll } from "../../dice";

export type RollType = "disadvantage" | "normal" | "advantage";
export type EffectType = "prepare" | "ambush" | "combat";

function diceNotation(type: RollType): string {
  switch (type) {
    case "disadvantage": return "2d20kl1";
    case "advantage": return "2d20kh1";
    default: return "1d20";
  }
}

interface LocalRoll {
  rolls: number[];   // every die actually rolled (advantage/disadvantage rolls 2)
  winnerIdx: number; // which one is the kept value
  finalValue: number;
}

function localRoll(type: RollType): LocalRoll {
  const r1 = Math.floor(Math.random() * 20) + 1;
  if (type === "normal") {
    return { rolls: [r1], winnerIdx: 0, finalValue: r1 };
  }
  const r2 = Math.floor(Math.random() * 20) + 1;
  if (type === "advantage") {
    const winnerIdx = r1 >= r2 ? 0 : 1;
    return { rolls: [r1, r2], winnerIdx, finalValue: Math.max(r1, r2) };
  }
  // disadvantage
  const winnerIdx = r1 <= r2 ? 0 : 1;
  return { rolls: [r1, r2], winnerIdx, finalValue: Math.min(r1, r2) };
}

// Stable tiebreak: 1% precision random, stored as decimal
function genTiebreak(): number {
  // Random in [0, 0.9999)
  return Math.random();
}

// Sort: count+modifier DESC, then modifier DESC, then tiebreak ASC (stable)
function sortInitiative(a: InitiativeItem, b: InitiativeItem): number {
  const totalA = a.count + a.modifier;
  const totalB = b.count + b.modifier;
  if (totalA !== totalB) return totalB - totalA;
  if (a.modifier !== b.modifier) return b.modifier - a.modifier;
  // ascending tiebreak — doesn't matter, just stable
  return a.tiebreak - b.tiebreak;
}

let rollCounter = 0;

export function useInitiative() {
  const [allItems, setAllItems] = useState<InitiativeItem[]>([]);
  const [combatState, setCombatStateLocal] = useState<CombatState>({
    inCombat: false,
    preparing: false,
    round: 0,
  });
  const [diceRolling, setDiceRolling] = useState(false);
  const [playerId, setPlayerId] = useState("");
  const [isGM, setIsGM] = useState(false);
  // null = probing, true = installed, false = not installed.
  // Used to hide dice buttons for non-GMs who don't have Dice+ (their roll
  // requests would never get a response and the buttons just confuse them).
  const [dicePlusAvailable, setDicePlusAvailable] = useState<boolean | null>(null);

  // Player view: invisibility flag hides items from the panel except on
  // their own active turn, where the entry is rendered as a `?` placeholder
  // (no real name / image leaked). GM view: pass everything through; the
  // shader overlay on the canvas + a small badge in the panel will
  // indicate the stealth state instead.
  const items = useMemo(
    () => {
      const visible = allItems.filter((i) => i.visible);
      if (isGM) return visible;
      return visible
        .filter((i) => !i.invisible || i.active)
        .map((i) =>
          i.invisible
            ? { ...i, name: "?", imageUrl: "" }
            : i
        );
    },
    [allItems, isGM]
  );

  const prevActiveId = useRef<string | null>(null);
  const prevVisibleIds = useRef<string[]>([]);
  const autoActivateLocked = useRef(false);

  // Mirrors state as refs so stable (empty-deps) callbacks can read latest
  // values without forcing a re-create chain on every state change.
  const combatStateRef = useRef<CombatState>({
    inCombat: false, preparing: false, round: 0,
  });
  const isGMRef = useRef(false);
  const allItemsRef = useRef<InitiativeItem[]>([]);
  const playerIdRef = useRef("");
  // Optimistic active-id: updated eagerly when the GM clicks next/prev so
  // rapid clicks chain correctly even before the scene refresh arrives.
  const optimisticActiveIdRef = useRef<string | null>(null);
  // Serial write queue for turn changes: rapid clicks queue onto this chain
  // instead of racing / dropping. Each iteration reads the latest target
  // from the optimistic ref, so queued writes always aim at the latest state.
  const turnWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  // Last id we told the server is active. Used as `prev` for the next write
  // so the 2-item updateItems correctly flips only the two that changed.
  const lastWrittenActiveIdRef = useRef<string | null>(null);
  // Wrapper ref for advanceTurn so the broadcast listener (defined before
  // advanceTurn) can invoke the latest closure.
  const advanceTurnRef = useRef<(dir: 1 | -1) => void>(() => {});

  // Cache player info
  useEffect(() => {
    OBR.player.getId().then((id) => { setPlayerId(id); playerIdRef.current = id; });
    OBR.player.getRole().then((r) => {
      const gm = r === "GM";
      setIsGM(gm);
      isGMRef.current = gm;
    });
    const unsub = OBR.player.onChange((p) => {
      const gm = p.role === "GM";
      setIsGM(gm);
      isGMRef.current = gm;
    });
    return unsub;
  }, []);

  // Keep allItemsRef synced with allItems so stable callbacks read latest.
  useEffect(() => {
    allItemsRef.current = allItems;
  }, [allItems]);

  // Probe Dice+ presence on mount. We send a minimal silent roll request
  // and wait for either a result or an error broadcast back. If nothing
  // returns within 1.5s we assume Dice+ isn't installed.
  useEffect(() => {
    const probeId = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let resolved = false;
    const settle = (v: boolean) => {
      if (resolved) return;
      resolved = true;
      setDicePlusAvailable(v);
    };

    const onResponse = (event: any) => {
      if (event?.data?.rollId === probeId) settle(true);
    };
    const unsubResult = OBR.broadcast.onMessage(DICE_PLUS_ROLL_RESULT, onResponse);
    const unsubError = OBR.broadcast.onMessage(DICE_PLUS_ROLL_ERROR, onResponse);

    OBR.broadcast
      .sendMessage(
        DICE_PLUS_ROLL_REQUEST,
        {
          rollId: probeId,
          diceNotation: "1d1",
          rollTarget: "self",
          source: PLUGIN_ID,
          showResults: false,
          timestamp: Date.now(),
        },
        { destination: "LOCAL" }
      )
      .catch(() => {});

    const timer = setTimeout(() => settle(false), 1500);

    return () => {
      clearTimeout(timer);
      unsubResult();
      unsubError();
    };
  }, []);

  const refreshItems = useCallback(async () => {
    const sceneItems = await OBR.scene.items.getItems(
      (item) => item.metadata[METADATA_KEY] !== undefined
    );
    const mapped = sceneItems
      .map(itemToInitiativeItem)
      .filter((x): x is InitiativeItem => x !== null)
      .sort(sortInitiative);

    // Ensure every item has a stable tiebreak (assign on first sight)
    const missingTb = mapped.filter((i) => i.tiebreak === 0);
    if (missingTb.length > 0) {
      try {
        await OBR.scene.items.updateItems(
          missingTb.map((i) => i.id),
          (drafts) => {
            for (const d of drafts) {
              const ex = d.metadata[METADATA_KEY] as any;
              if (ex && (!ex.tiebreak || ex.tiebreak === 0)) {
                d.metadata[METADATA_KEY] = { ...ex, tiebreak: genTiebreak() };
              }
            }
          }
        );
        // Next onChange will trigger another refresh with tiebreaks set
        return;
      } catch {}
    }

    const visible = mapped.filter((i) => i.visible);
    const activeItem = visible.find((i) => i.active);

    // Auto-activate: active item was removed during combat. GM-only; players
    // shouldn't mutate item metadata from a passive refresh — it'd also
    // race. Using the local ref avoids an extra scene-metadata round-trip.
    if (isGMRef.current && !autoActivateLocked.current) {
      const inCombat = combatStateRef.current.inCombat;

      if (inCombat && visible.length > 0 && !activeItem) {
        const prev = prevActiveId.current;
        if (prev) {
          autoActivateLocked.current = true;
          const oldIds = prevVisibleIds.current;
          const prevIdx = oldIds.indexOf(prev);
          const targetIdx = Math.min(
            prevIdx >= 0 ? prevIdx : 0,
            visible.length - 1
          );
          const nextId = visible[targetIdx].id;
          const visibleIds = visible.map((i) => i.id);
          try {
            await OBR.scene.items.updateItems(visibleIds, (drafts) => {
              for (const d of drafts) {
                const ex = d.metadata[METADATA_KEY] as any;
                if (ex) d.metadata[METADATA_KEY] = { ...ex, active: d.id === nextId };
              }
            });
            prevActiveId.current = nextId;
          } catch {}
          setTimeout(() => { autoActivateLocked.current = false; }, 300);
          return;
        }
      }
    }

    if (activeItem) prevActiveId.current = activeItem.id;
    prevVisibleIds.current = visible.map((i) => i.id);
    setAllItems(mapped);
  }, []);

  const refreshCombat = useCallback(async () => {
    const state = await getCombatState();
    combatStateRef.current = state;
    setCombatStateLocal(state);
  }, []);

  // Fast-path write: merge into local ref (always latest) and push directly.
  // Using a ref instead of the state value avoids the extra read round-trip
  // AND keeps this callback stable across renders, so the six combat-flow
  // callbacks that depend on it don't re-create every state change.
  const writeCombatState = useCallback(
    (patch: Partial<CombatState>) => {
      const next = { ...combatStateRef.current, ...patch };
      combatStateRef.current = next; // eagerly mirror so a follow-up call uses the fresh value
      return OBR.scene.setMetadata({ [COMBAT_STATE_KEY]: next });
    },
    []
  );

  useEffect(() => {
    refreshItems();
    refreshCombat();

    const unsubItems = OBR.scene.items.onChange(() => refreshItems());
    const unsubMeta = OBR.scene.onMetadataChange(() => refreshCombat());

    // Receiver picks its own language. The DM's broadcast no longer carries
    // a `lang` field — each client (DM + every player) reads its local
    // localStorage preference so the overlay text matches their UI choice.
    const unsubStart = OBR.broadcast.onMessage(
      BROADCAST_COMBAT_START,
      () => {
        const lang = getLocalLang();
        OBR.modal.open({
          id: COMBAT_EFFECT_MODAL_ID,
          url: `${import.meta.env.BASE_URL}initiative-combat-effect.html?lang=${lang}&type=combat`,
          width: 600,
          height: 400,
          fullScreen: true,
          hidePaper: true,
        });
      }
    );

    const unsubPrepare = OBR.broadcast.onMessage(
      BROADCAST_COMBAT_PREPARE,
      (event) => {
        const lang = getLocalLang();
        const effectType = (event.data as any)?.effectType || "prepare";
        OBR.modal.open({
          id: COMBAT_EFFECT_MODAL_ID,
          url: `${import.meta.env.BASE_URL}initiative-combat-effect.html?lang=${lang}&type=${effectType}`,
          width: 600,
          height: 400,
          fullScreen: true,
          hidePaper: true,
        });
      }
    );

    const unsubEnd = OBR.broadcast.onMessage(BROADCAST_COMBAT_END, () => {
      refreshCombat();
      refreshItems();
    });

    const unsubFocus = OBR.broadcast.onMessage(
      BROADCAST_FOCUS,
      async (event) => {
        const itemId = (event.data as any)?.itemId;
        if (!itemId) return;

        const [targetItems, vpWidth, vpHeight, currentScale] = await Promise.all([
          OBR.scene.items.getItems([itemId]),
          OBR.viewport.getWidth(),
          OBR.viewport.getHeight(),
          OBR.viewport.getScale(),
        ]);
        if (targetItems.length === 0) return;

        const pos = targetItems[0].position;
        OBR.viewport.animateTo({
          position: {
            x: -pos.x * currentScale + vpWidth / 2,
            y: -pos.y * currentScale + vpHeight / 2,
          },
          scale: currentScale,
        });
      }
    );

    // OBR.action is now bound to the dice panel (per manifest action
    // block). Initiative's panel is its own popover and shouldn't
    // hijack the dice button — these listeners are intentionally
    // no-op. The constants stay in case a future flow wires them
    // to the actual initiative-panel popover.
    const unsubOpenPanel = OBR.broadcast.onMessage(BROADCAST_OPEN_PANEL, () => {
      // intentionally empty
    });

    const unsubClosePanel = OBR.broadcast.onMessage(BROADCAST_CLOSE_PANEL, () => {
      // intentionally empty
    });

    const unsubDiceResult = OBR.broadcast.onMessage(
      DICE_PLUS_ROLL_RESULT,
      async (event) => {
        const data = event.data as any;
        if (!data?.rollId) return;

        const rollId = data.rollId as string;
        if (!rollId.startsWith("init-")) return;
        const withoutPrefix = rollId.slice(5);
        const lastDash = withoutPrefix.lastIndexOf("-");
        const itemId = lastDash > 0 ? withoutPrefix.slice(0, lastDash) : withoutPrefix;
        const totalValue = data.result?.totalValue;
        if (typeof totalValue !== "number" || !itemId) return;

        await OBR.scene.items.updateItems([itemId], (drafts) => {
          for (const d of drafts) {
            const existing = d.metadata[METADATA_KEY] as any;
            if (existing) {
              d.metadata[METADATA_KEY] = { ...existing, count: totalValue };
            }
          }
        });

        // Mirror the local-roll flow: show the dice animation above the
        // token using the d20-portion of the Dice+ result. Clamp into
        // 1..20 — Dice+ may return >20 on advantage etc., but for the
        // visual we want the raw die face. Dice+ doesn't expose
        // individual rolls in its broadcast payload, so we render a
        // single die with the kept value as both the roll and winner.
        const visual = Math.max(1, Math.min(20, Math.round(totalValue)));
        try {
          const [rollerId, rollerName] = await Promise.all([
            OBR.player.getId(),
            OBR.player.getName(),
          ]);
          await broadcastDiceRoll({
            itemId,
            dice: [{ type: "d20" as const, value: visual }],
            winnerIdx: 0,
            modifier: 0,
            label: "先攻 / Initiative",
            rollerId,
            rollerName,
          });
        } catch {}

        setDiceRolling(false);
      }
    );

    const unsubDiceError = OBR.broadcast.onMessage(
      DICE_PLUS_ROLL_ERROR,
      async (event) => {
        const data = event.data as any;
        if (!data?.rollId) return;
        // Toast removed — error is logged for debugging only.
        console.warn("[obr-suite/initiative] Dice+ error:", data.error || "unknown");
        setDiceRolling(false);
      }
    );

    // End-turn request from a player: only the GM client actually advances
    // so there's never two writers racing for the same write.
    const unsubEndReq = OBR.broadcast.onMessage(
      BROADCAST_END_TURN_REQUEST,
      (event) => {
        if (!isGMRef.current) return;
        const reqActive = (event.data as any)?.activeId as string | undefined;
        // Sanity check: only advance if the player thought they were active.
        // Prevents a stale request from skipping a turn after the GM already
        // moved on via their own controls.
        const curActive = allItemsRef.current.find((i) => i.active)?.id;
        if (reqActive && curActive && reqActive !== curActive) return;
        advanceTurnRef.current(1);
      }
    );

    return () => {
      unsubItems();
      unsubMeta();
      unsubStart();
      unsubPrepare();
      unsubEnd();
      unsubFocus();
      unsubOpenPanel();
      unsubClosePanel();
      unsubDiceResult();
      unsubDiceError();
      unsubEndReq();
    };
  }, [refreshItems, refreshCombat]);

  const focusItem = useCallback(async (itemId: string) => {
    const [targetItems, vpWidth, vpHeight, currentScale] = await Promise.all([
      OBR.scene.items.getItems([itemId]),
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
      OBR.viewport.getScale(),
    ]);
    if (targetItems.length === 0) return;

    const pos = targetItems[0].position;
    OBR.viewport.animateTo({
      position: {
        x: -pos.x * currentScale + vpWidth / 2,
        y: -pos.y * currentScale + vpHeight / 2,
      },
      scale: currentScale,
    });
  }, []);

  const broadcastFocus = useCallback(async (itemId: string) => {
    // Suite-level "focus on turn change" gate. Read at call time so
    // the user can toggle it mid-combat and have it take effect for
    // the next turn without restarting. Falls back to true when the
    // suite isn't installed (legacy behaviour).
    let focusEnabled = true;
    try {
      const meta = await OBR.scene.getMetadata();
      const s: any = (meta as any)["com.obr-suite/state"];
      if (s && typeof s.initiativeFocusOnTurnChange === "boolean") {
        focusEnabled = s.initiativeFocusOnTurnChange;
      }
    } catch {}
    if (!focusEnabled) return;
    // Invisible target: DM still gets a local focus so they can manage the
    // hidden character, but skip the broadcast so player cameras don't move
    // (and therefore don't reveal a hidden token's location).
    const target = allItemsRef.current.find((i) => i.id === itemId);
    if (target?.invisible) {
      focusItem(itemId);
      return;
    }
    OBR.broadcast.sendMessage(BROADCAST_FOCUS, { itemId });
    focusItem(itemId);
  }, [focusItem]);

  // Can current player edit this item's count? GM or owner only.
  const canEdit = useCallback((item: InitiativeItem): boolean => {
    if (isGM) return true;
    return !!playerId && item.ownerId === playerId;
  }, [isGM, playerId]);

  const updateCount = useCallback(async (itemId: string, count: number) => {
    const item = allItemsRef.current.find((i) => i.id === itemId);
    if (!item) return;
    const pid = playerIdRef.current;
    if (!isGMRef.current && (!pid || item.ownerId !== pid)) {
      // Toast removed — UI already disables the inputs for non-owner players.
      return;
    }
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      for (const d of drafts) {
        const existing = d.metadata[METADATA_KEY] as any;
        d.metadata[METADATA_KEY] = { ...existing, count };
      }
    });
  }, []);

  const updateModifier = useCallback(async (itemId: string, mod: number) => {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      for (const d of drafts) {
        d.metadata["com.initiative-tracker/dexMod"] = mod;
      }
    });
  }, []);

  const rollInitiativeLocal = useCallback(async (itemId: string, type: RollType) => {
    const { rolls, winnerIdx, finalValue } = localRoll(type);

    // Read this token's stored DEX modifier AND invisibility flag so the
    // dice animation can SHOW the bonus alongside the d20 and route to
    // a dark roll for stealth characters. The stored count remains the
    // RAW d20 (the panel adds the modifier when displaying) — but the
    // metadata write is deferred to the climax so the value visually
    // "lands" in the initiative column at the moment the dice modal
    // shows the final number (per spec).
    let dexMod = 0;
    let isInvisible = false;
    try {
      const items = await OBR.scene.items.getItems([itemId]);
      const tokenMeta = (items[0] as any)?.metadata ?? {};
      const m = tokenMeta["com.initiative-tracker/dexMod"];
      if (typeof m === "number") dexMod = m;
      const initData = tokenMeta[METADATA_KEY];
      if (initData && typeof initData === "object") {
        isInvisible = !!(initData as any).invisible;
      }
    } catch {}

    // Spawn the dice animation above the token. The broadcast carries:
    //   - dice: every d20 rolled. For advantage / disadvantage the
    //     non-winner die is flagged loser:true so the visual treats it
    //     as adv/dis (faded, doesn't add to the rush total) — without
    //     this flag the modal was rendering it as a flat 2d20 with
    //     both summed.
    //   - modifier: dexMod, so the displayed running total = winner +
    //     dexMod (animation shows d20+mod, scene metadata stores just
    //     the raw d20 — panel applies +mod at display time).
    //   - autoDismiss: the modal self-closes after the climax so the
    //     dice don't linger on the canvas after the result is shown.
    //
    // Pre-subscribe to BC_DICE_FADE_START with a deterministic rollId
    // so the metadata write fires at the exact moment of the climax
    // (single-die zoom OR final scale-pop after the rush sequence) —
    // not the previous time-based PUNCH_DELAY_MS approximation, which
    // landed too early for the rush path (multi-die or +modifier).
    const rollId = `init-${itemId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const BC_DICE_FADE_START = "com.obr-suite/dice-fade-start";
    let writeDone = false;
    const writeFinalValue = () => {
      if (writeDone) return;
      writeDone = true;
      OBR.scene.items.updateItems([itemId], (drafts) => {
        for (const d of drafts) {
          const existing = d.metadata[METADATA_KEY] as any;
          d.metadata[METADATA_KEY] = { ...existing, count: finalValue };
        }
      }).catch((e) => {
        console.error("[obr-suite/initiative] deferred count write failed", e);
      });
    };
    const unsub = OBR.broadcast.onMessage(BC_DICE_FADE_START, (event) => {
      const data = event.data as { rollId?: string } | undefined;
      if (data?.rollId !== rollId) return;
      writeFinalValue();
      try { unsub(); } catch {}
    });
    // Safety net: if the climax broadcast somehow doesn't arrive (bad
    // network, modal crash, etc.) write the value after a generous
    // timeout so the initiative column doesn't stay stale forever.
    setTimeout(() => {
      writeFinalValue();
      try { unsub(); } catch {}
    }, 6000);

    try {
      const [rollerId, rollerName] = await Promise.all([
        OBR.player.getId(),
        OBR.player.getName(),
      ]);
      await broadcastDiceRoll({
        itemId,
        dice: rolls.map((v, i) => {
          const die: { type: "d20"; value: number; loser?: boolean } = {
            type: "d20",
            value: v,
          };
          if (rolls.length > 1 && i !== winnerIdx) die.loser = true;
          return die;
        }),
        winnerIdx,
        modifier: dexMod,
        label: "先攻 / Initiative",
        rollerId,
        rollerName,
        rollId,
        autoDismiss: true,
        // Stealth tokens roll dark — only the DM's own client receives
        // the dice broadcast (LOCAL only inside broadcastDiceRoll), so
        // players never see the dice animation above the hidden token.
        hidden: isInvisible,
      });
    } catch {}
  }, []);

  const diceRollingRef = useRef(false);
  useEffect(() => { diceRollingRef.current = diceRolling; }, [diceRolling]);

  const rollInitiativeDicePlus = useCallback(async (itemId: string, type: RollType) => {
    const item = allItemsRef.current.find((i) => i.id === itemId);
    // Allow re-rolls during preparing — only block while a roll is mid-flight
    // (Dice+ result hasn't come back yet) so we don't fire concurrent rolls.
    if (!item || diceRollingRef.current) return;

    const notation = diceNotation(type);

    setDiceRolling(true);
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      for (const d of drafts) {
        const existing = d.metadata[METADATA_KEY] as any;
        if (existing) {
          d.metadata[METADATA_KEY] = { ...existing, rolled: true };
        }
      }
    });

    const [pid, playerName] = await Promise.all([
      OBR.player.getId(),
      OBR.player.getName(),
    ]);

    rollCounter++;
    await OBR.broadcast.sendMessage(DICE_PLUS_ROLL_REQUEST, {
      rollId: `init-${itemId}-${rollCounter}`,
      playerId: pid,
      playerName,
      diceNotation: notation,
      rollTarget: "everyone",
      source: PLUGIN_ID,
      showResults: true,
      timestamp: Date.now(),
    }, { destination: "LOCAL" });
  }, []);

  // setActiveItemFromIds: explicit prev + next so rapid clicks chain correctly
  // without reading possibly-stale allItems to re-derive prev. Reads via ref
  // as a fallback when prev isn't known.
  const setActiveItemFromIds = useCallback(
    async (activeId: string, prevId: string | null) => {
      const ids: string[] = [activeId];
      const actualPrev = prevId
        ?? allItemsRef.current.find((i) => i.active)?.id
        ?? null;
      if (actualPrev && actualPrev !== activeId) ids.push(actualPrev);
      await OBR.scene.items.updateItems(ids, (drafts) => {
        for (const d of drafts) {
          const existing = d.metadata[METADATA_KEY] as any;
          if (existing) {
            d.metadata[METADATA_KEY] = { ...existing, active: d.id === activeId };
          }
        }
      });
    },
    []
  );

  const fireBroadcast = (msg: string, data: any) => {
    OBR.broadcast.sendMessage(msg, data).catch(() => {});
  };

  // All flow handlers below read state via refs and carry stable deps so
  // their identity never changes — CombatControls re-renders only when its
  // own props change, not on every items/combatState tick. Rapid clicks also
  // use an optimistic ref + in-flight lock so they can't fire concurrent
  // writes that crash OBR.

  const startPreparation = useCallback(async (effectType: EffectType = "prepare") => {
    const all = allItemsRef.current;
    if (all.filter((i) => i.visible).length === 0) return;
    setDiceRolling(false);
    optimisticActiveIdRef.current = null;
    lastWrittenActiveIdRef.current = null;

    const allIds = all.map((i) => i.id);
    if (allIds.length > 0) {
      await OBR.scene.items.updateItems(allIds, (drafts) => {
        for (const d of drafts) {
          const existing = d.metadata[METADATA_KEY] as any;
          if (existing) {
            d.metadata[METADATA_KEY] = {
              ...existing, active: false, rolled: false, count: 0,
            };
          }
        }
      });
    }
    // Optional: snap every initiative token to the centre of its grid
    // cell so the turn order looks tidy at the start of combat. Read
    // the toggle from suite scene metadata; fall back to off when the
    // suite isn't installed (legacy behaviour).
    let autoSnap = false;
    try {
      const meta = await OBR.scene.getMetadata();
      const s: any = (meta as any)["com.obr-suite/state"];
      if (s && typeof s.initiativeAutoSnapOnPrep === "boolean") {
        autoSnap = s.initiativeAutoSnapOnPrep;
      }
    } catch {}
    if (autoSnap && allIds.length > 0) {
      try {
        const dpi = await OBR.scene.grid.getDpi().catch(() => 150);
        const half = dpi / 2;
        // Snap to the *centre* of the nearest grid cell (not the
        // corner). For square grids cell centres are at (n*dpi +
        // dpi/2, m*dpi + dpi/2). The (pos - half) / dpi → round →
        // * dpi + half formula works whether the token's position
        // currently represents a corner or already a centre — both
        // cases fall onto the closest centre. Hex grids would need
        // axial-coord math; out of scope for this toggle.
        await OBR.scene.items.updateItems(allIds, (drafts) => {
          for (const d of drafts) {
            d.position = {
              x: Math.round((d.position.x - half) / dpi) * dpi + half,
              y: Math.round((d.position.y - half) / dpi) * dpi + half,
            };
          }
        });
      } catch (e) {
        console.warn("[obr-suite/initiative] auto-snap on prep failed", e);
      }
    }
    await writeCombatState({ preparing: true, inCombat: false, round: 0 });
    fireBroadcast(BROADCAST_COMBAT_PREPARE, { effectType });
    fireBroadcast(BROADCAST_OPEN_PANEL, {});
  }, [writeCombatState]);

  const startCombat = useCallback(async () => {
    const all = allItemsRef.current;
    const visible = all.filter((i) => i.visible);
    if (visible.length === 0) return;

    const firstId = visible[0].id;
    optimisticActiveIdRef.current = firstId;
    lastWrittenActiveIdRef.current = firstId;

    const allIds = all.map((i) => i.id);
    await OBR.scene.items.updateItems(allIds, (drafts) => {
      for (const d of drafts) {
        const existing = d.metadata[METADATA_KEY] as any;
        if (existing) {
          d.metadata[METADATA_KEY] = {
            ...existing, rolled: false, active: d.id === firstId,
          };
        }
      }
    });
    await writeCombatState({ preparing: false, inCombat: true, round: 1 });
    fireBroadcast(BROADCAST_COMBAT_START, {});
    fireBroadcast(BROADCAST_OPEN_PANEL, {});
    broadcastFocus(firstId).catch(() => {});
  }, [broadcastFocus, writeCombatState]);

  const cancelPreparation = useCallback(async () => {
    setDiceRolling(false);
    optimisticActiveIdRef.current = null;
    lastWrittenActiveIdRef.current = null;

    const allIds = allItemsRef.current.map((i) => i.id);
    if (allIds.length > 0) {
      await OBR.scene.items.updateItems(allIds, (drafts) => {
        for (const d of drafts) {
          const existing = d.metadata[METADATA_KEY] as any;
          if (existing) {
            d.metadata[METADATA_KEY] = { ...existing, active: false, rolled: false };
          }
        }
      });
    }
    await writeCombatState({ preparing: false, inCombat: false, round: 0 });
  }, [writeCombatState]);

  // Shared turn advance. Each click is queued onto a serial promise chain so
  // rapid clicks don't race (we used to drop concurrent clicks; now every
  // click's write runs in order). No optimistic UI — the list highlight and
  // camera move together when the scene write returns. `optimisticActiveIdRef`
  // is still used between clicks (updated eagerly at compute time) so queued
  // clicks target the correct next item even while earlier writes are in
  // flight, and `lastWrittenActiveIdRef` lets each write use a 2-item
  // updateItems instead of N.
  const advanceTurn = useCallback((dir: 1 | -1) => {
    const visible = allItemsRef.current.filter((i) => i.visible);
    if (visible.length === 0) return;
    // "登" — short turn-advance confirmation tone. Plays only on the
    // client that triggers the advance (other clients receive a
    // separate sync-viewport sound when their camera follows the
    // active token).
    import("../../dice/sfx-broadcast").then((m) => m.sfxNextTurn()).catch(() => {});

    const currentId =
      optimisticActiveIdRef.current ?? visible.find((i) => i.active)?.id ?? null;
    const currentIndex = currentId
      ? visible.findIndex((i) => i.id === currentId)
      : -1;
    const len = visible.length;
    const nextIndex = dir === 1
      ? (currentIndex + 1 + len) % len
      : (currentIndex <= 0 ? len - 1 : currentIndex - 1);
    const nextId = visible[nextIndex].id;

    let nextRound: number | null = null;
    const round = combatStateRef.current.round;
    if (dir === 1 && nextIndex === 0) nextRound = round + 1;
    if (dir === -1 && nextIndex === len - 1 && currentIndex === 0 && round > 1) {
      nextRound = round - 1;
    }

    // Advance the "what queued clicks will see" pointer eagerly.
    optimisticActiveIdRef.current = nextId;

    // Queue scene write onto chain — runs serially, never drops.
    turnWriteChainRef.current = turnWriteChainRef.current.then(async () => {
      try {
        const prev =
          lastWrittenActiveIdRef.current
          ?? allItemsRef.current.find((i) => i.active)?.id
          ?? null;
        if (nextRound !== null) {
          await writeCombatState({ round: nextRound });
        }
        await setActiveItemFromIds(nextId, prev);
        lastWrittenActiveIdRef.current = nextId;
        broadcastFocus(nextId).catch(() => {});
      } catch {}
    });
    return turnWriteChainRef.current;
  }, [broadcastFocus, setActiveItemFromIds, writeCombatState]);

  const nextTurn = useCallback(() => advanceTurn(1), [advanceTurn]);
  const prevTurn = useCallback(() => advanceTurn(-1), [advanceTurn]);

  // Keep ref in sync so the broadcast listener above can invoke the latest
  // advanceTurn closure (it captures the writeCombatState that was current at
  // listener-setup time otherwise).
  useEffect(() => { advanceTurnRef.current = advanceTurn; }, [advanceTurn]);

  // Player-facing end-turn — never writes directly. Broadcasts to the GM
  // client, which will advance via the listener above. GM clients call
  // nextTurn directly (no broadcast needed).
  const requestEndTurn = useCallback(() => {
    if (isGMRef.current) {
      advanceTurn(1);
      return;
    }
    const activeId = allItemsRef.current.find((i) => i.active)?.id;
    OBR.broadcast
      .sendMessage(BROADCAST_END_TURN_REQUEST, { activeId })
      .catch(() => {});
  }, [advanceTurn]);

  const endCombat = useCallback(async () => {
    prevActiveId.current = null;
    optimisticActiveIdRef.current = null;
    lastWrittenActiveIdRef.current = null;

    const allIds = allItemsRef.current.map((i) => i.id);
    if (allIds.length > 0) {
      await OBR.scene.items.updateItems(allIds, (drafts) => {
        for (const d of drafts) {
          const existing = d.metadata[METADATA_KEY] as any;
          if (existing) {
            d.metadata[METADATA_KEY] = { ...existing, active: false, rolled: false };
          }
        }
      });
    }
    await writeCombatState({ inCombat: false, preparing: false, round: 0 });
    fireBroadcast(BROADCAST_COMBAT_END, {});
    fireBroadcast(BROADCAST_CLOSE_PANEL, {});
  }, [writeCombatState]);

  return {
    items,
    combatState,
    diceRolling,
    playerId,
    isGM,
    canEdit,
    dicePlusAvailable,
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
  };
}
