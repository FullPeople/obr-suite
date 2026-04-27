import { render } from "preact";
import { useEffect, useState, useCallback, useRef } from "preact/compat";
import OBR from "@owlbear-rodeo/sdk";
import { ParsedMonster, MonsterEdition } from "./types";
import { loadAllMonsters, searchMonsters } from "./data";
import { spawnMonster } from "./spawn";
import "./styles.css";

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
  const inputRef = useRef<HTMLInputElement>(null);

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
    await spawnMonster(mon);
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
        <div class="empty">仅 DM 可用</div>
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
      <div class="header">
        <div class="header-top">
          <input
            ref={inputRef}
            type="text"
            class="search"
            placeholder="搜索怪物名称/类型/CR..."
            value={query}
            onInput={handleSearch}
          />
          <button
            class="close-btn"
            onClick={handleClearSearch}
            title="清空搜索"
            disabled={!query}
            aria-label="清空搜索"
          >
            ✕
          </button>
        </div>
        <div class="header-row">
          <span class="count">
            {loading ? "加载中..." : `${filtered.length} / ${monsters.length}`}
          </span>
          <button class="sort-btn" onClick={toggleSort} title="按CR排序">
            CR {sortDesc ? "↓" : "↑"}
          </button>
        </div>
      </div>
      <div class="list">
        {filtered.map((mon) => (
          <MonsterCard key={`${mon.source}-${mon.engName}`} monster={mon} onSpawn={handleSpawn} />
        ))}
        {!loading && filtered.length === 0 && (
          <div class="empty">未找到匹配的怪物</div>
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

  if (!ready) return <div class="app"><div class="empty">加载中...</div></div>;
  return <App />;
}

render(<PluginGate />, document.getElementById("root")!);
