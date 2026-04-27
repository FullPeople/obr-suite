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
import { getStoredLang } from "../utils/i18n";

export type RollType = "disadvantage" | "normal" | "advantage";
export type EffectType = "prepare" | "ambush" | "combat";

function diceNotation(type: RollType): string {
  switch (type) {
    case "disadvantage": return "2d20kl1";
    case "advantage": return "2d20kh1";
    default: return "1d20";
  }
}

function localRoll(type: RollType): number {
  const r1 = Math.floor(Math.random() * 20) + 1;
  const r2 = Math.floor(Math.random() * 20) + 1;
  switch (type) {
    case "disadvantage": return Math.min(r1, r2);
    case "advantage": return Math.max(r1, r2);
    default: return r1;
  }
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

  const items = useMemo(
    () => allItems.filter((i) => i.visible),
    [allItems]
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

    const unsubStart = OBR.broadcast.onMessage(
      BROADCAST_COMBAT_START,
      (event) => {
        const lang = (event.data as any)?.lang || "en";
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
        const data = event.data as any;
        const lang = data?.lang || "en";
        const effectType = data?.effectType || "prepare";
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

    const unsubOpenPanel = OBR.broadcast.onMessage(BROADCAST_OPEN_PANEL, () => {
      try { OBR.action.open(); } catch {}
    });

    const unsubClosePanel = OBR.broadcast.onMessage(BROADCAST_CLOSE_PANEL, () => {
      try { OBR.action.close(); } catch {}
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

        setDiceRolling(false);
      }
    );

    const unsubDiceError = OBR.broadcast.onMessage(
      DICE_PLUS_ROLL_ERROR,
      async (event) => {
        const data = event.data as any;
        if (!data?.rollId) return;
        OBR.notification.show(`Dice+ error: ${data.error || "unknown"}`);
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
      OBR.notification.show("只有角色的拥有者或 DM 可以修改");
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
    const roll = localRoll(type);
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      for (const d of drafts) {
        const existing = d.metadata[METADATA_KEY] as any;
        d.metadata[METADATA_KEY] = { ...existing, count: roll };
      }
    });
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
    const lang = getStoredLang();
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
    await writeCombatState({ preparing: true, inCombat: false, round: 0 });
    fireBroadcast(BROADCAST_COMBAT_PREPARE, { lang, effectType });
    fireBroadcast(BROADCAST_OPEN_PANEL, {});
  }, [writeCombatState]);

  const startCombat = useCallback(async () => {
    const all = allItemsRef.current;
    const visible = all.filter((i) => i.visible);
    if (visible.length === 0) return;

    const firstId = visible[0].id;
    const lang = getStoredLang();
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
    fireBroadcast(BROADCAST_COMBAT_START, { lang });
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
