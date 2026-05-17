import { render } from "preact";
import { useEffect, useState, useCallback, useRef } from "preact/compat";
import OBR from "@owlbear-rodeo/sdk";
import { installDebugOverlay } from "../../utils/debugOverlay";
import { installPanelZoom } from "../../utils/panelZoom";
import { ParsedMonster, MonsterEdition } from "./types";
import { loadAllMonsters, searchMonsters, getRawMonster, makeSlug } from "./data";
import { spawnMonster } from "./spawn";
import { t } from "../../i18n";
import { getLocalLang, onLangChange, startSceneSync, refreshFromScene, getState, setState, onStateChange } from "../../state";
import { bindPanelDrag } from "../../utils/panelDrag";
import { PANEL_IDS } from "../../utils/panelLayout";
import "./styles.css";

// Drag-spawn broadcast IDs. Mirrored in:
//   src/monster-drag-preview.ts (modal sends DROP/CANCEL)
//   src/modules/bestiary/index.ts (background opens/closes modal)
const BC_MONSTER_DRAG_START = "com.obr-suite/bestiary-drag-start";
const BC_MONSTER_DROP = "com.obr-suite/bestiary-drop";
const DRAG_THRESHOLD_PX = 3;

let _lang = getLocalLang();
const _tt = (k: Parameters<typeof t>[1]) => t(_lang, k);

// Bubbles + initiative metadata keys — same constants as spawn.ts. The
// picker mode (?pickerForItemId=…) writes to these so the bound token
// gets the chosen monster's HP / AC / DEX-mod alongside the slug
// reference.
const BUBBLES_META = "com.obr-suite/bubbles/data";
const BUBBLES_NAME = "com.owlbear-rodeo-bubbles-extension/name";
const INITIATIVE_MODKEY = "com.initiative-tracker/dexMod";
const BESTIARY_SLUG_KEY = "com.bestiary/slug";
const BESTIARY_DATA_KEY = "com.bestiary/monsters";
const PICKER_MODAL_ID = "com.obr-suite/bestiary-picker";

// Read once at module load; the modal's URL is set by the caller.
// Two URL conventions:
//   • pickerForItemId=<id>           — single-token bind (legacy)
//   • pickerForItemIds=<id1,id2,...> — bulk bind / overwrite (new
//                                       group-bind context menu)
// The handler treats the singular form as a 1-element list so the
// downstream code is uniform.
const URL_PARAMS = new URLSearchParams(location.search);
const PICKER_TARGET_ITEM_IDS: string[] = (() => {
  const single = URL_PARAMS.get("pickerForItemId");
  if (single) return [single];
  const multi = URL_PARAMS.get("pickerForItemIds");
  if (multi) return multi.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
})();
const PICKER_TARGET_ITEM = PICKER_TARGET_ITEM_IDS[0] || null;
const PICKER_IS_GROUP = PICKER_TARGET_ITEM_IDS.length > 1;

async function ensureSharedMonsterData(slug: string, raw: any): Promise<void> {
  if (!raw) return;
  try {
    const meta = await OBR.scene.getMetadata();
    const table = (meta[BESTIARY_DATA_KEY] as Record<string, any>) || {};
    // 2026-05-10 — was `if (table[slug]) return; // already populated`,
    // which meant a re-uploaded local JSON could never refresh the
    // scene-meta copy of a previously-bound monster. Now we ALWAYS
    // overwrite when called. The cost is one extra setMetadata per
    // bind, which is rare and harmless. Pair fix in
    // refreshSharedMonsterTableFromLocal() — that walks every bound
    // token after BC_LOCAL_CONTENT_CHANGED so the user doesn't have
    // to re-bind manually for the popover to pick up new data.
    table[slug] = raw;
    await OBR.scene.setMetadata({ [BESTIARY_DATA_KEY]: table });
  } catch (e) {
    console.error("[bestiary] ensureSharedMonsterData failed", e);
  }
}

// Apply one monster to one OR many tokens. Single updateItems call
// keeps the write atomic — for bulk bind, ALL selected tokens get
// the new slug, bubbles, name, and dex mod in a single broadcast,
// avoiding a flicker where some tokens have updated and others
// haven't.
//
// 2026-05-10 — when the token already carries a character-card
// binding (`com.character-cards/boundCardId`), skip the init-mod
// override. The CC-bound character has its own initiative modifier
// derived from the player's sheet (CC DEX + proficiency), and the
// user reported that bestiary-binding a CC-attached token (e.g. to
// surface the monster info popover for a humanoid that's also a
// player character) was clobbering that with the monster's dexMod.
// HP / AC / name still apply because those are the data the user
// is opting into when they pick the bestiary entry; only the
// init mod is left alone.
const CC_BIND_KEY = "com.character-cards/boundCardId";
async function bindMonsterToTokens(mon: ParsedMonster, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  const slug = makeSlug(mon.source, mon.engName);
  await ensureSharedMonsterData(slug, getRawMonster(slug));
  try {
    await OBR.scene.items.updateItems(itemIds, (drafts) => {
      for (const d of drafts) {
        const hasCcBinding =
          typeof (d.metadata as any)[CC_BIND_KEY] === "string"
          && !!(d.metadata as any)[CC_BIND_KEY];
        d.metadata[BESTIARY_SLUG_KEY] = slug;
        // 2026-05-12 — user request #13: when binding a bestiary
        // monster to a token that ALREADY HAS A CHARACTER CARD
        // BINDING, leave the bubbles/HP/AC alone. The character
        // card is the source of truth for that token's stats; the
        // bestiary entry is just a reference (e.g. "this PC is a
        // wereraven — show me the wereraven monster stats" for the
        // DM). Overwriting HP/AC/name would clobber the player
        // character.
        //
        // For non-CC-bound tokens (plain monster tokens), bestiary
        // binding still writes stats + name as before.
        if (!hasCcBinding) {
          d.metadata[BUBBLES_META] = {
            health: mon.hp,
            "max health": mon.hp,
            "temporary health": 0,
            "armor class": mon.ac,
            hide: false,
            locked: true,
          };
          d.metadata[BUBBLES_NAME] = mon.name;
          d.metadata[INITIATIVE_MODKEY] = mon.dexMod;
          d.name = mon.name;
        }
      }
    });
  } catch (e) {
    console.error("[bestiary] bindMonsterToTokens failed", e);
  }
  try { await OBR.modal.close(PICKER_MODAL_ID); } catch {}
}

// Backwards-compat single-token wrapper retained for any external
// callers; new code should use bindMonsterToTokens.
async function bindMonsterToToken(mon: ParsedMonster, itemId: string): Promise<void> {
  return bindMonsterToTokens(mon, [itemId]);
}

// 2026-05-10: heal-pass for the scene-meta `monsters` table. Walks
// every scene token whose metadata carries a bestiary slug; for any
// slug missing from the table, looks up the raw record via
// getRawMonster(slug) (rawBySlug must already be hydrated by
// loadAllMonsters) and adds it. One batched setMetadata call per
// pass — early-out when nothing's missing.
async function healSceneMonsterTable(): Promise<void> {
  let items: any[] = [];
  let table: Record<string, any> = {};
  try {
    const [meta, all] = await Promise.all([
      OBR.scene.getMetadata(),
      OBR.scene.items.getItems(),
    ]);
    items = all;
    table = (meta[BESTIARY_DATA_KEY] as Record<string, any>) || {};
  } catch (e) {
    console.warn("[bestiary] heal: read failed", e);
    return;
  }
  // Collect unique missing slugs from items.
  const missing = new Set<string>();
  for (const it of items) {
    const slug = (it.metadata as any)?.[BESTIARY_SLUG_KEY];
    if (typeof slug !== "string" || !slug) continue;
    if (table[slug]) continue;
    missing.add(slug);
  }
  if (missing.size === 0) return;
  const additions: Record<string, any> = {};
  for (const slug of missing) {
    const raw = getRawMonster(slug);
    if (raw) additions[slug] = raw;
  }
  const addCount = Object.keys(additions).length;
  if (addCount === 0) {
    // Slugs exist but rawBySlug doesn't have them — likely the source
    // library is disabled or a homebrew slug points to data that's no
    // longer reachable. Log + give up; a re-bind through the picker
    // will fix it next time the user notices.
    console.warn(
      `[bestiary] heal: ${missing.size} token(s) reference missing monster data; ` +
      `re-bind to refresh: ${[...missing].slice(0, 5).join(", ")}${missing.size > 5 ? "…" : ""}`,
    );
    return;
  }
  try {
    const next = { ...table, ...additions };
    await OBR.scene.setMetadata({ [BESTIARY_DATA_KEY]: next });
    console.info(`[bestiary] heal: filled ${addCount} missing monsters in scene-meta table`);
  } catch (e) {
    console.warn("[bestiary] heal: setMetadata failed", e);
  }
}


// Persisted UI state (keys are shared across panel opens / reloads).
const LS_PREFIX = "bestiary/";
const readLS = (k: string, d: string) => {
  try { return localStorage.getItem(LS_PREFIX + k) ?? d; } catch { return d; }
};
const writeLS = (k: string, v: string) => {
  try { localStorage.setItem(LS_PREFIX + k, v); } catch {}
};

// Suite state lives in scene metadata under "com.obr-suite/state". When the
// suite is installed, its Settings panel writes dataVersion ("2014" / "2024"
// / "all"), and we mirror that into the bestiary's edition filter. If the
// suite isn't installed, this scene metadata never appears and we fall back
// to "all" so the bestiary stays useful standalone.
const SUITE_STATE_KEY = "com.obr-suite/state";
type SuiteDataVersion = "2014" | "2024" | "all";

async function readSuiteDataVersion(): Promise<SuiteDataVersion> {
  try {
    const meta = await OBR.scene.getMetadata();
    const s = meta[SUITE_STATE_KEY] as any;
    const dv = s?.dataVersion;
    if (dv === "2014" || dv === "2024" || dv === "all") return dv;
  } catch {}
  return "all";
}

function dvToEditionSet(dv: SuiteDataVersion): Set<MonsterEdition> {
  // "all" includes every source (2014 cores, 2024 cores, and all extensions
  // like TCE/XGE/MTF/MPMM/BGG which are tagged "other").
  if (dv === "all") return new Set<MonsterEdition>(["2014", "2024", "other"]);
  if (dv === "2014") return new Set<MonsterEdition>(["2014"]);
  if (dv === "2024") return new Set<MonsterEdition>(["2024"]);
  return new Set<MonsterEdition>(["2014", "2024", "other"]);
}

function App() {
  const [monsters, setMonsters] = useState<ParsedMonster[]>([]);
  const [filtered, setFiltered] = useState<ParsedMonster[]>([]);
  const [query, setQuery] = useState(() => readLS("query", ""));
  const [sortDesc, setSortDesc] = useState(() => readLS("sortDesc", "0") === "1");
  // Source-code filter (e.g. "PHB", "MYHB", "kiwee"). Free-text;
  // case-insensitive substring match on each monster's `source`.
  // Persisted per-client so a homebrew GM doesn't re-type their tag
  // every panel reopen.
  const [sourceFilter, setSourceFilter] = useState(() => readLS("sourceFilter", ""));
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"GM" | "PLAYER">("PLAYER");
  // Edition gate now flows from suite scene metadata (via dataVersion).
  const [dataVersion, setDataVersion] = useState<SuiteDataVersion>("all");
  const [lang, setLang] = useState(_lang);
  // Auto-add-to-initiative toggle — moved from Settings → 怪物图鉴 into
  // this popover so the GM can flip it inline while spawning. Mirrors
  // suite state via startSceneSync; the spawn pipeline reads from
  // scene metadata so a state change propagates immediately.
  const [autoInit, setAutoInit] = useState<boolean>(() =>
    getState().bestiaryAutoInitiative !== false,
  );
  // Auto-hide toggle — when ON, freshly spawned monsters get
  // `visible:false` so the DM can stage them off-screen before the
  // big reveal. Default ON. Mirrors suite state via startSceneSync;
  // spawn.ts reads from scene metadata so changes take effect on
  // the next spawn without a panel reopen.
  const [autoHide, setAutoHide] = useState<boolean>(() =>
    getState().bestiaryAutoHide !== false,
  );
  // Auto-name toggle — when ON, freshly spawned monsters write their
  // display name into the OBR-native plainText label (the small text
  // under the token). Default OFF; the DM can opt in when they want
  // labels to appear automatically without click-syncing per token.
  const [autoName, setAutoName] = useState<boolean>(() =>
    getState().bestiaryAutoName === true,
  );
  useEffect(() => {
    const unsub = onStateChange(() => {
      setAutoInit(getState().bestiaryAutoInitiative !== false);
      setAutoHide(getState().bestiaryAutoHide !== false);
      setAutoName(getState().bestiaryAutoName === true);
    });
    return unsub;
  }, []);

  // Refetch monster data when the library configuration changes
  // (add / delete / edit URL / enable / disable). Without this the
  // panel keeps showing the old set even though `index.ts` has
  // already invalidated the underlying cache. Per user spec:
  // "删除和修改库时也要删除数据" — the panel reflects deletion
  // immediately rather than the next time the panel reopens.
  useEffect(() => {
    let lastLibSig = JSON.stringify(
      (getState().libraries || []).map((l) => `${l.id}|${l.enabled}|${l.baseUrl}`),
    );
    const unsub = onStateChange(() => {
      const sig = JSON.stringify(
        (getState().libraries || []).map((l) => `${l.id}|${l.enabled}|${l.baseUrl}`),
      );
      if (sig === lastLibSig) return;
      lastLibSig = sig;
      setLoading(true);
      loadAllMonsters()
        .then((all) => {
          setMonsters(all);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    });
    return unsub;
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  // Mirror of `monsters` for closures that need the latest list (e.g.
  // the BC_MONSTER_DROP handler — it can't use the state value
  // directly because the handler closure is created once on mount).
  const monstersRef = useRef<ParsedMonster[]>([]);
  useEffect(() => { monstersRef.current = monsters; }, [monsters]);

  // Per-client language: re-render when the user flips the suite-level
  // language toggle so labels/placeholders update without a popover reopen.
  useEffect(() => {
    const unsub = onLangChange((next) => { _lang = next; setLang(next); });
    return unsub;
  }, []);

  useEffect(() => {
    OBR.player.getRole().then(setRole);
    readSuiteDataVersion().then(setDataVersion);
    const unsub = onStateChange((s) => setDataVersion(s.dataVersion));

    // Pull suite state (scene metadata → suite cache) BEFORE
    // loadAllMonsters so getEnabledLibraryBases() inside data.ts
    // sees the user's custom library list. Without this prime the
    // panel iframe reads DEFAULT_STATE (just kiwee) and homebrew
    // monsters from URL libraries silently disappear.
    startSceneSync();
    refreshFromScene()
      .catch(() => undefined)
      .then(() => loadAllMonsters())
      .then((all) => {
        setMonsters(all);
        setLoading(false);
        // 2026-05-10: heal-pass for the scene-meta `monsters` table.
        // Past versions of the bestiary spawn / bind paths could
        // leave a token with a `slug` metadata reference whose entry
        // never made it into the scene-shared `monsters` table —
        // typically because `getRawMonster(slug)` returned null at
        // spawn time (rawBySlug not yet hydrated) so
        // `ensureSharedMonsterData` early-returned. Symptom: group
        // saves / group initiative skips that token because
        // `buildSelectedMonster` requires `table[slug]` to exist.
        //
        // Now that loadAllMonsters has resolved, rawBySlug is full.
        // Walk every scene token with a bestiary slug, look up its
        // raw record locally, and fill any missing table entries in
        // a single batched setMetadata write.
        void healSceneMonsterTable();
      });
    return unsub;
  }, []);

  const editions = dvToEditionSet(dataVersion);

  // Re-filter when the data version changes (suite settings flipped).
  useEffect(() => {
    if (monsters.length === 0) return;
    setFiltered(searchMonsters(monsters, query, sortDesc, dvToEditionSet(dataVersion), sourceFilter));
  }, [dataVersion, monsters, sourceFilter]);

  const doSearch = useCallback(
    (q: string, desc: boolean, eds: Set<MonsterEdition>, src: string) => {
      setFiltered(searchMonsters(monsters, q, desc, eds, src));
    },
    [monsters]
  );

  const handleSearch = useCallback(
    (e: Event) => {
      const val = (e.target as HTMLInputElement).value;
      setQuery(val);
      writeLS("query", val);
      doSearch(val, sortDesc, editions, sourceFilter);
    },
    [doSearch, sortDesc, editions, sourceFilter]
  );

  const handleSourceChange = useCallback(
    (e: Event) => {
      const val = (e.target as HTMLInputElement).value;
      setSourceFilter(val);
      writeLS("sourceFilter", val);
      doSearch(query, sortDesc, editions, val);
    },
    [doSearch, query, sortDesc, editions],
  );

  const clearSourceFilter = useCallback(() => {
    setSourceFilter("");
    writeLS("sourceFilter", "");
    doSearch(query, sortDesc, editions, "");
  }, [doSearch, query, sortDesc, editions]);

  const toggleSort = useCallback(() => {
    const newDesc = !sortDesc;
    setSortDesc(newDesc);
    writeLS("sortDesc", newDesc ? "1" : "0");
    doSearch(query, newDesc, editions, sourceFilter);
  }, [sortDesc, query, doSearch, editions, sourceFilter]);

  // 2014/2024 toggle buttons removed — versioning is centrally controlled
  // from the suite Settings panel (dataVersion in scene metadata).

  const handleSpawn = useCallback(async (mon: ParsedMonster) => {
    if (PICKER_TARGET_ITEM_IDS.length > 0) {
      // Both single-bind and group-bind paths come through here. The
      // group-bind URL ships >1 id and we apply the chosen monster to
      // every one in a single atomic updateItems call.
      await bindMonsterToTokens(mon, PICKER_TARGET_ITEM_IDS);
    } else {
      await spawnMonster(mon);
    }
  }, []);

  // Drag-spawn DROP handler. The monster-drag-preview modal broadcasts
  // BC_MONSTER_DROP with the slug + scene-coord drop position; we
  // look up the monster from our loaded list and spawn there. Picker
  // mode (cc-bind etc.) doesn't accept drag-spawn — only the regular
  // bestiary panel does.
  useEffect(() => {
    if (PICKER_TARGET_ITEM_IDS.length > 0) return;
    const unsub = OBR.broadcast.onMessage(BC_MONSTER_DROP, async (event) => {
      const data = event.data as
        | { slug?: string; sceneX?: number; sceneY?: number }
        | undefined;
      if (!data?.slug || typeof data.sceneX !== "number" || typeof data.sceneY !== "number") return;
      const mon = monstersRef.current.find(
        (m) => makeSlug(m.source, m.engName) === data.slug,
      );
      if (!mon) {
        console.warn("[bestiary] drop target slug not in current list", data.slug);
        return;
      }
      try {
        await spawnMonster(mon, { x: data.sceneX, y: data.sceneY });
      } catch (e) {
        console.error("[bestiary] drag-drop spawn failed", e);
      }
    });
    return unsub;
  }, []);

  // Dynamic height — the suite hosts this as a popover, so resize via the
  // popover API instead of the legacy action API.
  const POPOVER_ID = "com.obr-suite/bestiary-panel";
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = Math.min(entry.contentRect.height + 2, 700);
        OBR.popover.setHeight(POPOVER_ID, Math.max(h, 100)).catch(() => {});
      }
    });
    const root = document.getElementById("root");
    if (root) observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Shift+A inside the bestiary panel. OBR's tool-action shortcut only
  // fires when keyboard focus is on OBR's main window — once the user
  // clicks into our panel, Shift+A here just goes nowhere. So we
  // capture it ourselves and broadcast.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "A" || e.key === "a")) {
        e.preventDefault();
        try {
          OBR.broadcast.sendMessage(
            "com.obr-suite/bestiary-shortcut-toggle",
            {},
            { destination: "LOCAL" }
          );
        } catch {}
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (role !== "GM") {
    return (
      <div class="app">
        <div class="empty">{t(lang, "bestiaryPanelOnlyDM")}</div>
      </div>
    );
  }

  const handleClearSearch = useCallback(() => {
    setQuery("");
    writeLS("query", "");
    doSearch("", sortDesc, editions, sourceFilter);
    inputRef.current?.focus();
  }, [doSearch, sortDesc, editions, sourceFilter]);

  // "About" button removed — the suite About panel covers all modules.

  // Drag grip — sits inline inside .header-top before the search input.
  // Skipped while in picker mode (popover is a transient single-shot,
  // no value to drag).
  const dragHandleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dragHandleRef.current;
    if (!el || PICKER_TARGET_ITEM) return;
    return bindPanelDrag(el, PANEL_IDS.bestiaryPanel);
  }, []);

  return (
    <div class="app">
      {PICKER_TARGET_ITEM && (
        <div
          style="background:rgba(93,173,226,0.18);border-bottom:1px solid rgba(93,173,226,0.40);padding:8px 14px;font-size:12px;color:#7ec8f0;font-weight:600;text-align:center;"
        >
          {t(lang, "bestiaryPanelHint")}
          {PICKER_IS_GROUP && (
            <span style="display:block;margin-top:2px;font-size:11px;font-weight:500;opacity:0.85">
              {lang === "zh"
                ? `（群体绑定 · ${PICKER_TARGET_ITEM_IDS.length} 个 token）`
                : `(group bind · ${PICKER_TARGET_ITEM_IDS.length} tokens)`}
            </span>
          )}
        </div>
      )}
      <div class="header">
        <div class="header-top">
          {!PICKER_TARGET_ITEM && (
            <div
              ref={dragHandleRef}
              class="drag-handle"
              title="拖动 / Drag"
              aria-label="拖动面板"
            >
              <svg viewBox="0 0 12 18" aria-hidden="true">
                <circle cx="3" cy="3" r="1.2" fill="currentColor" />
                <circle cx="9" cy="3" r="1.2" fill="currentColor" />
                <circle cx="3" cy="9" r="1.2" fill="currentColor" />
                <circle cx="9" cy="9" r="1.2" fill="currentColor" />
                <circle cx="3" cy="15" r="1.2" fill="currentColor" />
                <circle cx="9" cy="15" r="1.2" fill="currentColor" />
              </svg>
            </div>
          )}
          {/* Search bar only renders when there's actually data to
              search through. With no enabled libraries (or all
              libraries disabled / empty), monsters.length === 0 and
              the bar would just be a no-op input. Per user spec:
              "有新数据时搜索框也要启用，无数据时搜索框也要消失". */}
          {monsters.length > 0 && (
            <div class="search-wrap">
              <input
                ref={inputRef}
                type="text"
                class="search"
                placeholder={t(lang, "bestiarySearchPh")}
                value={query}
                onInput={handleSearch}
              />
              {query && (
                <button
                  class="search-clear"
                  onClick={handleClearSearch}
                  title={t(lang, "bestiaryClearSearch")}
                  aria-label={t(lang, "bestiaryClearSearch")}
                  type="button"
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>
        <div class="header-row">
          <span class="count">
            {loading ? t(lang, "bestiaryLoading") : `${filtered.length} / ${monsters.length}`}
          </span>
          {monsters.length > 0 && (
          <div class="source-filter-wrap">
            <input
              type="text"
              class="source-filter"
              placeholder={lang === "zh" ? "来源筛选" : "Source"}
              value={sourceFilter}
              onInput={handleSourceChange}
              title={lang === "zh"
                ? "按来源代码筛选（如 PHB / kiwee / 你的本子英文名）"
                : "Filter by source code (e.g. PHB / kiwee / your homebrew tag)"}
            />
            {sourceFilter && (
              <button
                class="source-filter-clear"
                onClick={clearSourceFilter}
                title={lang === "zh" ? "清空来源筛选" : "Clear source filter"}
                aria-label={lang === "zh" ? "清空来源筛选" : "Clear source filter"}
              >
                ✕
              </button>
            )}
          </div>
          )}
          {role === "GM" && (
            <button
              class={`auto-init-toggle ${autoHide ? "on" : "off"}`}
              onClick={async () => {
                await setState({ bestiaryAutoHide: !autoHide });
              }}
              title={lang === "zh"
                ? "加入场景时自动隐藏新生成的怪物（仅 DM 可见，方便先布阵再揭面）"
                : "Auto-hide spawned monsters (DM-only until manually revealed)"}
              aria-pressed={autoHide}
            >
              {lang === "zh" ? "自动隐藏" : "Auto-hide"}
            </button>
          )}
          {role === "GM" && (
            <button
              class={`auto-init-toggle ${autoInit ? "on" : "off"}`}
              onClick={async () => {
                await setState({ bestiaryAutoInitiative: !autoInit });
              }}
              title={lang === "zh"
                ? "加入场景时自动加入先攻"
                : "Auto-add spawned tokens to initiative"}
              aria-pressed={autoInit}
            >
              {lang === "zh" ? "自动先攻" : "Auto-init"}
            </button>
          )}
          {role === "GM" && (
            <button
              class={`auto-init-toggle ${autoName ? "on" : "off"}`}
              onClick={async () => {
                await setState({ bestiaryAutoName: !autoName });
              }}
              title={lang === "zh"
                ? "加入场景时自动把怪物名字写到 token 的 plainText（OBR 原生显示在 token 下方的小字标签）"
                : "Auto-fill the token's native plainText label with the monster name"}
              aria-pressed={autoName}
            >
              {lang === "zh" ? "自动命名" : "Auto-name"}
            </button>
          )}
          <button class="sort-btn" onClick={toggleSort} title={t(lang, "bestiarySortByCR")}>
            CR {sortDesc ? "↓" : "↑"}
          </button>
        </div>
      </div>
      <div class="list">
        {filtered.map((mon) => (
          <MonsterCard key={`${mon.source}-${mon.engName}`} monster={mon} onSpawn={handleSpawn} />
        ))}
        {!loading && filtered.length === 0 && (
          <div class="empty">{t(lang, "bestiaryNoMatch")}</div>
        )}
      </div>
    </div>
  );
}

// Monster size → grid-cell scale factor for the drag-preview ghost.
// Mirrors the D&D size category convention (Large = 2 cells per side,
// Huge = 3, Gargantuan = 4). Tiny renders smaller, but still visible.
const SIZE_CELL_SCALE: Record<string, number> = {
  T: 0.5,
  S: 1,
  M: 1,
  L: 2,
  H: 3,
  G: 4,
};

async function startMonsterDrag(monster: ParsedMonster, e: PointerEvent): Promise<void> {
  // Compute the ghost preview size so the user sees roughly what the
  // spawned token will look like at the current zoom.
  let ghostSize = 80;
  try {
    const [dpi, vpScale] = await Promise.all([
      OBR.scene.grid.getDpi().catch(() => 150),
      OBR.viewport.getScale().catch(() => 1),
    ]);
    const sz = (monster.size || "M").toUpperCase();
    const cellScale = SIZE_CELL_SCALE[sz] ?? 1;
    ghostSize = Math.max(36, Math.min(360, dpi * vpScale * cellScale));
  } catch {}
  try {
    OBR.broadcast.sendMessage(
      BC_MONSTER_DRAG_START,
      {
        slug: makeSlug(monster.source, monster.engName),
        name: monster.name,
        tokenUrl: monster.tokenUrl || "",
        startScreenX: e.screenX,
        startScreenY: e.screenY,
        ghostSize,
      },
      { destination: "LOCAL" },
    );
  } catch {}
}

function MonsterCard({
  monster,
  onSpawn,
}: {
  monster: ParsedMonster;
  onSpawn: (m: ParsedMonster) => void;
}) {
  const [imgErr, setImgErr] = useState(false);

  // Drag-spawn: pointerdown arms a watcher that fires the START
  // broadcast once the cursor moves past the threshold. The card calls
  // setPointerCapture so we get every pointermove BEFORE threshold
  // crossing — then releases capture once the modal opens, letting
  // the modal pick up subsequent moves and render the ghost following
  // the cursor in real time. Without the explicit capture/release
  // dance, the browser would establish implicit capture on the card
  // and the modal's pointermove listener wouldn't fire until release
  // (the original bug — preview only appeared on drop).
  //
  // No drag (release before threshold): existing onClick path runs as
  // before → spawn at viewport center. Drag past threshold: we
  // suppress the trailing click so we don't double-spawn.
  const onPointerDown = useCallback((e: PointerEvent) => {
    if (e.button !== 0) return;
    const cardEl = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    try { cardEl.setPointerCapture(pointerId); } catch {}

    const sx = e.screenX;
    const sy = e.screenY;
    let dragStarted = false;
    let cleanedUp = false;

    const onMove = (ev: PointerEvent) => {
      if (dragStarted || ev.pointerId !== pointerId) return;
      const dx = ev.screenX - sx;
      const dy = ev.screenY - sy;
      if (Math.abs(dx) >= DRAG_THRESHOLD_PX || Math.abs(dy) >= DRAG_THRESHOLD_PX) {
        dragStarted = true;
        // Hand the pointer to the modal — without this, the card
        // keeps implicit/explicit capture and the modal never gets
        // pointermove events until release.
        try { cardEl.releasePointerCapture(pointerId); } catch {}
        void startMonsterDrag(monster, e);
        // Stop tracking on the card; modal's document.pointermove /
        // pointerup take over from here.
        cleanup();
      }
    };
    const onUp = (ev: PointerEvent) => {
      if (cleanedUp || ev.pointerId !== pointerId) return;
      cleanup();
      if (dragStarted) {
        // Drag was started but pointerup arrived back at the card
        // before the modal mounted (rare — happens on very fast
        // drags + slow modal load). Suppress the trailing click so
        // we don't double-spawn at viewport centre.
        const swallowClick = (cev: Event) => {
          cev.stopPropagation();
          cev.preventDefault();
          document.removeEventListener("click", swallowClick, true);
        };
        document.addEventListener("click", swallowClick, true);
        setTimeout(() => {
          document.removeEventListener("click", swallowClick, true);
        }, 50);
      }
    };
    const cleanup = () => {
      cleanedUp = true;
      cardEl.removeEventListener("pointermove", onMove);
      cardEl.removeEventListener("pointerup", onUp);
      cardEl.removeEventListener("pointercancel", onUp);
      try { cardEl.releasePointerCapture(pointerId); } catch {}
    };
    cardEl.addEventListener("pointermove", onMove);
    cardEl.addEventListener("pointerup", onUp);
    cardEl.addEventListener("pointercancel", onUp);
  }, [monster]);

  return (
    <div class="card" onPointerDown={onPointerDown} onClick={() => onSpawn(monster)}>
      <div class="card-left">
        {!imgErr && monster.tokenUrl ? (
          <img
            src={monster.tokenUrl}
            alt=""
            class="token"
            loading="lazy"
            draggable={false}
            onError={() => setImgErr(true)}
          />
        ) : (
          <div class="token-placeholder">
            {monster.name.charAt(0)}
          </div>
        )}
      </div>
      <div class="card-info">
        <div class="card-name">{monster.name}</div>
        <div class="card-sub">{monster.engName}</div>
        <div class="card-tags">
          <span class="tag">{monster.size}</span>
          <span class="tag">{monster.type}</span>
          <span class="tag">CR {monster.cr}</span>
        </div>
      </div>
      <div class="card-stats">
        <div class="stat">
          <span class="stat-val hp">{monster.hp}</span>
          <span class="stat-label">HP</span>
        </div>
        <div class="stat">
          <span class="stat-val ac">{monster.ac}</span>
          <span class="stat-label">AC</span>
        </div>
        <div class="stat">
          <span class="stat-val dex">{monster.dexMod >= 0 ? `+${monster.dexMod}` : monster.dexMod}</span>
          <span class="stat-label">DEX</span>
        </div>
      </div>
    </div>
  );
}

function PluginGate() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    OBR.onReady(() => {
      installDebugOverlay();
      // 2026-05-16 — content-scale with the panel size. Baseline =
      // POPOVER_WIDTH × POPOVER_HEIGHT from bestiary/index.ts.
      // Target = document.documentElement so the whole iframe scales
      // (the panel's root container is the React-managed #root which
      // can't easily host the zoom variable on the auto-generated
      // wrapper).
      installPanelZoom({ baseWidth: 350, baseHeight: 600 });
      setReady(true);
    });
  }, []);

  if (!ready) return <div class="app"><div class="empty">{_tt("bestiaryLoading")}</div></div>;
  return <App />;
}

render(<PluginGate />, document.getElementById("root")!);
