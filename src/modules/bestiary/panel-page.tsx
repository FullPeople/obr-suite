import { render } from "preact";
import { useEffect, useState, useCallback, useRef } from "preact/compat";
import OBR from "@owlbear-rodeo/sdk";
import { ParsedMonster, MonsterEdition } from "./types";
import { loadAllMonsters, searchMonsters, getRawMonster, makeSlug } from "./data";
import { spawnMonster } from "./spawn";
import { t } from "../../i18n";
import { getLocalLang, onLangChange } from "../../state";
import "./styles.css";

let _lang = getLocalLang();
const _tt = (k: Parameters<typeof t>[1]) => t(_lang, k);

// Bubbles + initiative metadata keys — same constants as spawn.ts. The
// picker mode (?pickerForItemId=…) writes to these so the bound token
// gets the chosen monster's HP / AC / DEX-mod alongside the slug
// reference.
const BUBBLES_META = "com.owlbear-rodeo-bubbles-extension/metadata";
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
    if (table[slug]) return; // already populated
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
async function bindMonsterToTokens(mon: ParsedMonster, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  const slug = makeSlug(mon.source, mon.engName);
  await ensureSharedMonsterData(slug, getRawMonster(slug));
  try {
    await OBR.scene.items.updateItems(itemIds, (drafts) => {
      for (const d of drafts) {
        d.metadata[BESTIARY_SLUG_KEY] = slug;
        d.metadata[BUBBLES_META] = {
          health: mon.hp,
          "max health": mon.hp,
          "temporary health": 0,
          "armor class": mon.ac,
          hide: true,
        };
        d.metadata[BUBBLES_NAME] = mon.name;
        d.metadata[INITIATIVE_MODKEY] = mon.dexMod;
        d.name = mon.name;
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
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"GM" | "PLAYER">("PLAYER");
  // Edition gate now flows from suite scene metadata (via dataVersion).
  const [dataVersion, setDataVersion] = useState<SuiteDataVersion>("all");
  const [lang, setLang] = useState(_lang);
  const inputRef = useRef<HTMLInputElement>(null);

  // Per-client language: re-render when the user flips the suite-level
  // language toggle so labels/placeholders update without a popover reopen.
  useEffect(() => {
    const unsub = onLangChange((next) => { _lang = next; setLang(next); });
    return unsub;
  }, []);

  useEffect(() => {
    OBR.player.getRole().then(setRole);
    readSuiteDataVersion().then(setDataVersion);
    const unsub = OBR.scene.onMetadataChange(() => {
      readSuiteDataVersion().then(setDataVersion);
    });

    loadAllMonsters().then((all) => {
      setMonsters(all);
      setLoading(false);
    });
    return unsub;
  }, []);

  const editions = dvToEditionSet(dataVersion);

  // Re-filter when the data version changes (suite settings flipped).
  useEffect(() => {
    if (monsters.length === 0) return;
    setFiltered(searchMonsters(monsters, query, sortDesc, dvToEditionSet(dataVersion)));
  }, [dataVersion, monsters]);

  const doSearch = useCallback(
    (q: string, desc: boolean, eds: Set<MonsterEdition>) => {
      setFiltered(searchMonsters(monsters, q, desc, eds));
    },
    [monsters]
  );

  const handleSearch = useCallback(
    (e: Event) => {
      const val = (e.target as HTMLInputElement).value;
      setQuery(val);
      writeLS("query", val);
      doSearch(val, sortDesc, editions);
    },
    [doSearch, sortDesc, editions]
  );

  const toggleSort = useCallback(() => {
    const newDesc = !sortDesc;
    setSortDesc(newDesc);
    writeLS("sortDesc", newDesc ? "1" : "0");
    doSearch(query, newDesc, editions);
  }, [sortDesc, query, doSearch, editions]);

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
    doSearch("", sortDesc, editions);
    inputRef.current?.focus();
  }, [doSearch, sortDesc, editions]);

  // "About" button removed — the suite About panel covers all modules.

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
          <input
            ref={inputRef}
            type="text"
            class="search"
            placeholder={t(lang, "bestiarySearchPh")}
            value={query}
            onInput={handleSearch}
          />
          <button
            class="close-btn"
            onClick={handleClearSearch}
            title={t(lang, "bestiaryClearSearch")}
            disabled={!query}
            aria-label={t(lang, "bestiaryClearSearch")}
          >
            ✕
          </button>
        </div>
        <div class="header-row">
          <span class="count">
            {loading ? t(lang, "bestiaryLoading") : `${filtered.length} / ${monsters.length}`}
          </span>
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

function MonsterCard({
  monster,
  onSpawn,
}: {
  monster: ParsedMonster;
  onSpawn: (m: ParsedMonster) => void;
}) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <div class="card" onClick={() => onSpawn(monster)}>
      <div class="card-left">
        {!imgErr && monster.tokenUrl ? (
          <img
            src={monster.tokenUrl}
            alt=""
            class="token"
            loading="lazy"
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
    OBR.onReady(() => setReady(true));
  }, []);

  if (!ready) return <div class="app"><div class="empty">{_tt("bestiaryLoading")}</div></div>;
  return <App />;
}

render(<PluginGate />, document.getElementById("root")!);
