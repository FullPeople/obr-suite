import { render, createContext } from "preact";
import { useEffect, useState, useMemo, useCallback, useContext } from "preact/hooks";
import OBR from "@owlbear-rodeo/sdk";
import { fireQuickRoll } from "../dice/tags";
import { subscribeToSfx } from "../dice/sfx-broadcast";
import { patchBubbles } from "../../utils/statEdit";
import { normalizeCombatGearFlags, readBooleanFlag } from "./data-normalize";
import { reconcileUploadedCardShieldState } from "./xlsx-shield-state";

// Token-binding metadata key — must mirror modules/characterCards/index.ts
// so we can locate every token in the scene that's bound to the
// currently-open card. Used by the StatsBanner edit handlers to push
// HP / AC changes through to the bubbles plugin.
const BIND_META_KEY = "com.character-cards/boundCardId";

// 2026-05-14 (#14 f2) — inline SVG glyphs for the 复制 / 粘贴 micro
// sub-buttons. `currentColor` so they inherit the button text colour
// (white/ink in the modernized palette). 13×13 viewport, 2px stroke
// — reads cleanly at the button's small size without an emoji's
// platform-dependent rendering.
const ICON_COPY =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
  '</svg>';
const ICON_PASTE =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>' +
  '<rect x="8" y="2" width="8" height="4" rx="1"/>' +
  '</svg>';

// Click a spell / feature / feat name → fire BC_SEARCH_QUERY so the
// global-search popover opens with that name pre-filled and auto-pins
// the first hit. LOCAL only — sending REMOTE causes every receiving
// client to also open their own search.
function fireNameSearch(q: string): void {
  const trimmed = (q || "").trim();
  if (!trimmed) return;
  try {
    OBR.broadcast.sendMessage(
      "com.obr-suite/search-query",
      { q: trimmed, autoPin: true },
      { destination: "LOCAL" },
    );
  } catch {}
}

// ============================================================
// Full-screen character card v2 — data-driven Preact renderer
// ============================================================
//
// Replaces the legacy server-rendered Jinja2 HTML iframe (which was
// hard to wire to live data). This component:
//
//   1. Reads /characters/<roomId>/<cardId>/data.json directly.
//   2. Renders every section the parser produces — identity, stats,
//      abilities + skills, defenses, combat (weapons/armor),
//      spellcasting (slots + spells with tooltip details), features
//      (class/race/feats/special abilities/wondrous items), background
//      story blocks, inventory (currency + encumbrance + items).
//   3. Inline-edits HP/temp HP/AC via local in-memory state and a
//      future-friendly onPatch hook (server PUT path is hooked but
//      stubbed for tonight's iteration).
//   4. Export → downloads the current data.json. Import → uploads a
//      JSON file and replaces the local cache (server persistence
//      pending a /api/character/<room>/<card>/data PUT endpoint).
//
// Palette matches the rest of the suite (cluster, settings, dice
// panel) — dark navy charcoal canvas, signature amber #f5a623 for
// character names + section headers, warm gold for stat values,
// soft red for HP, muted teal for saves, sky blue for clickable
// affordances (used sparingly). Reads as "more suite", not a
// third-party widget.

const SERVER_ORIGIN = "https://obr.dnd.center";

// Broadcast id mirrored from panel-page.ts. When any client uploads,
// refreshes, or imports a card data.json, it sends BC_CARD_UPDATED so
// every other client viewing the same cardId can re-fetch and stay in
// sync without a manual refresh.
const BC_CARD_UPDATED = "com.obr-suite/cc-card-updated";

// ===== Types ================================================
interface CharacterData {
  schema_version?: string;
  meta?: any;
  identity?: any;
  classes?: any[];
  total_level?: number;
  abilities?: Record<string, any>;
  core_stats?: any;
  defenses?: any;
  skills?: any[];
  combat?: any;
  spellcasting?: any;
  features?: any;
  background?: any;
  inventory?: any;
  exports?: any;
}

// ===== Const tables ==========================================
const ABL_ORDER = ["str", "dex", "con", "int", "wis", "cha"] as const;
const ABL_LABEL: Record<string, string> = {
  str: "力量", dex: "敏捷", con: "体质", int: "智力", wis: "感知", cha: "魅力",
};
const ABL_ABBR: Record<string, string> = {
  str: "力", dex: "敏", con: "体", int: "智", wis: "感", cha: "魅",
};

// 2026-05-14 (#14 follow-up) — tab structure reduced to 4 per user
// request. 战斗 (CombatSection) and 装备 (InventorySection) now live
// inside the 概览 tab below 防御 — overview becomes the
// "everything-at-a-glance" home, and only the long-form sections
// (法术 / 特性 / 背景) get their own dedicated tabs.
type TabKey = "overview" | "spells" | "features" | "background";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview",   label: "概览" },
  { key: "spells",     label: "法术" },
  { key: "features",   label: "特性" },
  { key: "background", label: "背景" },
];

// ===== Helpers ===============================================
function fmtMod(n: unknown): string {
  if (typeof n !== "number") return "?";
  return n >= 0 ? `+${n}` : `${n}`;
}
function getQS(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}
// ============================================================
// 2026-05-14 — Edit-mode infrastructure (#14)
// ============================================================
//
// When the user toggles 编辑 in the header, every section component
// switches to its "editable" variant: numeric fields become inputs,
// text blocks become textareas, and list-shaped sections (features,
// weapons, spells, inventory, defense tags) sprout + / × buttons.
//
// Approach: a single context exposes { editing, data, onPatch } so
// section components don't have to thread edit state through 4 prop
// layers. onPatch accepts a deep partial; mergePatch recurses into
// nested objects so callers can write e.g. { core_stats: { ac: 16 } }
// without clobbering the rest of core_stats.

interface EditState {
  editing: boolean;
  data: CharacterData;
  onPatch: (patch: Partial<CharacterData>) => void;
}
const EditCtx = createContext<EditState | null>(null);
function useEdit(): EditState {
  const ctx = useContext(EditCtx);
  if (!ctx) {
    // Defensive default — when a section is used outside the provider
    // (currently never, but cheap insurance) it falls through to
    // "read-only" mode with a no-op patcher.
    return { editing: false, data: {} as CharacterData, onPatch: () => {} };
  }
  return ctx;
}

// Helper: small numeric input bound to a path on data. The caller
// builds the patch for the path themselves — this just renders an
// input or a static span depending on editing.
function EditNum({
  value, onSet, fallback = "?", className = "", suffix = "",
}: {
  value: number | null | undefined;
  onSet: (n: number) => void;
  fallback?: string;
  className?: string;
  suffix?: string;
}) {
  const { editing } = useEdit();
  if (editing) {
    return (
      <input
        class={`cc-edit-num ${className}`}
        type="number"
        value={value ?? ""}
        onInput={(e: any) => {
          const v = e.target.value;
          if (v === "") return;
          const n = parseFloat(v);
          if (Number.isFinite(n)) onSet(n);
        }}
      />
    );
  }
  return <span class={className}>{value ?? fallback}{suffix}</span>;
}

// 2026-05-14 (#14 f2) — smooth-scroll a freshly-added row into view.
// Called from "+ add" handlers: after Preact commits the new DOM
// node (we wait two rAFs), the LAST matching row inside the add
// button's enclosing `.sec` is scrolled to centre. Lets the user
// keep their place when they add an entry far below the fold.
function smoothScrollToNewRow(ev: Event | undefined, rowSelector: string): void {
  const host = (ev?.currentTarget as HTMLElement | null)?.closest(".sec") as HTMLElement | null;
  if (!host) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const rows = host.querySelectorAll(rowSelector);
      const last = rows[rows.length - 1] as HTMLElement | undefined;
      last?.scrollIntoView({ behavior: "smooth", block: "center" });
    }),
  );
}

// 2026-05-14 (#14 f3) — spell-name lookup for the SpellPickModal.
// Pulls the suite's library search index(es) and extracts every
// category-2 (spell) entry. The kiwee index stores BOTH names:
//   n  = English name   ("Fireball")
//   cn = Chinese name    ("火球术")
// We keep both: `label` (cn preferred, en fallback) is what the
// modal shows + what gets written onto the card; `en` is kept so
// search can match English typing too. Cached module-wide after the
// first successful load. Falls back to the kiwee base when no
// library is configured.
interface SpellEntry { label: string; en: string }
let _spellNamesCache: SpellEntry[] | null = null;
async function loadSpellNames(): Promise<SpellEntry[]> {
  if (_spellNamesCache) return _spellNamesCache;
  let bases: string[] = [];
  try {
    const { getState } = await import("../../state");
    const libs = ((getState() as any).libraries || []) as any[];
    bases = libs
      .filter((l) => l && l.enabled && typeof l.baseUrl === "string" && l.baseUrl.trim())
      .map((l) => String(l.baseUrl).replace(/\/+$/, ""));
  } catch {}
  if (bases.length === 0) bases = ["https://5e.kiwee.top"];
  // label -> en. Map de-dups across libraries by display label.
  const byLabel = new Map<string, string>();
  await Promise.all(
    bases.map(async (base) => {
      try {
        const res = await fetch(`${base}/search/index.json`, { cache: "force-cache" });
        if (!res.ok) return;
        const idx = await res.json();
        const arr = Array.isArray(idx?.x) ? idx.x : [];
        for (const e of arr) {
          // c === 2 is the spell category in the suite search index.
          if (!e || e.c !== 2) continue;
          const en = typeof e.n === "string" ? e.n.trim() : "";
          const cn = typeof e.cn === "string" ? e.cn.trim() : "";
          const label = cn || en;
          if (label && !byLabel.has(label)) byLabel.set(label, en);
        }
      } catch {
        /* one library failing is non-fatal — others may still load */
      }
    }),
  );
  _spellNamesCache = [...byLabel.entries()]
    .map(([label, en]) => ({ label, en }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh"));
  return _spellNamesCache;
}

// Helper: text input bound to a path on data. Static span when !editing.
function EditText({
  value, onSet, fallback = "—", placeholder = "", className = "",
}: {
  value: string | null | undefined;
  onSet: (s: string) => void;
  fallback?: string;
  placeholder?: string;
  className?: string;
}) {
  const { editing } = useEdit();
  if (editing) {
    return (
      <input
        class={`cc-edit-text ${className}`}
        type="text"
        value={value ?? ""}
        placeholder={placeholder}
        onInput={(e: any) => onSet(e.target.value)}
      />
    );
  }
  return <span class={className}>{value || fallback}</span>;
}

function downloadJson(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ===== Subcomponents =========================================
function Header({
  data, onExport, onCopyJson, onImport, onPasteJson, onRefresh, editing, onToggleEditing, onSaveEdits, savingEdits,
}: {
  data: CharacterData;
  onExport: () => void;
  onCopyJson: () => void;
  onImport: () => void;
  onPasteJson: () => void;
  onRefresh: () => void;
  editing: boolean;
  onToggleEditing: () => void;
  onSaveEdits: () => void;
  savingEdits: boolean;
}) {
  const id = data.identity || {};
  const cs = data.core_stats || {};
  const name = id.display_name || id.character_name || "未命名";
  const englishName = id.character_name && id.display_name && id.character_name !== id.display_name
    ? id.character_name : null;

  const cls = (data.classes || [])
    .filter((c) => c?.name)
    .map((c) => `${c.name}${c.subclass ? `（${c.subclass}）` : ""}${c.level ? ` Lv${c.level}` : ""}`)
    .join(" / ") || "—";

  const race = [id.race?.name, id.race?.subrace].filter(Boolean).join("·") || "—";
  const totalLv = data.total_level != null ? data.total_level : "?";

  return (
    <div class="cc-head">
      <div class="cc-head-left">
        <div class="cc-head-name">
          {name}
          {englishName && <span class="en">{englishName}</span>}
        </div>
        <div class="cc-head-meta">
          <span class="pip"><b>{race}</b></span>
          <span class="pip"><b>{cls}</b></span>
          <span class="pip">总等级 <b>{totalLv}</b></span>
          {id.alignment && <span class="pip">阵营 <b>{id.alignment}</b></span>}
          {cs.size && <span class="pip">体型 <b>{cs.size}</b></span>}
          {id.faith && <span class="pip">信仰 <b>{id.faith}</b></span>}
        </div>
      </div>
      <div class="cc-head-right">
        {/* 2026-05-14 (#14) — edit-mode toggle. When ON, every section
            below renders its editable variant: stat cells become inputs,
            list sections sprout + / × buttons, text blocks become
            textareas. Saved live through the same onPatch pipeline
            that already handles inline HP/AC edits. */}
        <button
          class={`cc-btn ${editing ? "primary" : ""}`}
          onClick={onToggleEditing}
          title={editing
            ? "退出编辑模式（再次切换回只读视图）"
            : "进入编辑模式：自由修改属性、添加词条、法术、特性、装备、背景"}>
          <span class="ic">{editing ? "✎" : "🔧"}</span>{editing ? "编辑中" : "编辑"}
        </button>
        {/* Save button — only visible in edit mode. Persists the
            current local data to the server via the same PUT endpoint
            JSON import uses, then broadcasts BC_CARD_UPDATED so bound
            tokens + other clients refresh. */}
        {editing && (
          <button
            class="cc-btn primary"
            onClick={onSaveEdits}
            disabled={savingEdits}
            title="把当前所有改动保存到服务器（不退出编辑模式）">
            <span class="ic">💾</span>{savingEdits ? "保存中…" : "保存"}
          </button>
        )}
        <button class="cc-btn" onClick={onRefresh} title="重新拉取服务器上的最新数据">
          刷新
        </button>
        {/* 2026-05-14 (#14 f2) — 导出 JSON + 仅复制 fused into one
            button group. 复制 is now a borderless icon-only sub-button
            seamlessly joined to the right edge of 导出 JSON (shared
            border, no gap). SVG icon, no emoji / text. */}
        <div class="cc-btn-group">
          <button class="cc-btn" onClick={onExport} title="把当前角色卡数据导出为 JSON 文件">
            导出 JSON
          </button>
          <button class="cc-btn cc-btn-sub" onClick={onCopyJson} title="仅复制：把当前角色卡 JSON 复制到剪贴板（不下载文件）">
            <span class="ic" dangerouslySetInnerHTML={{ __html: ICON_COPY }} />
          </button>
        </div>
        {/* 导入 JSON + 仅粘贴 fused the same way. */}
        <div class="cc-btn-group">
          <button class="cc-btn" onClick={onImport} title="从 JSON 文件加载角色卡">
            导入 JSON
          </button>
          <button class="cc-btn cc-btn-sub" onClick={onPasteJson} title="仅粘贴：弹窗输入 JSON 文本，识别后应用为当前角色卡数据">
            <span class="ic" dangerouslySetInnerHTML={{ __html: ICON_PASTE }} />
          </button>
        </div>
      </div>
    </div>
  );
}

// 2026-05-14 — paste-JSON modal. Opened from the header's 「仅粘贴」
// button. Textarea + Apply / Cancel buttons. The Apply callback
// returns a status string (null = success, close the modal; non-null
// = error/warning, keep modal open and show inline). Designed to live
// inside the fullscreen panel (which is itself an OBR.modal full-
// screen iframe) — we render an absolute-positioned overlay rather
// than nest another OBR.modal which would compete with the parent.
function PasteJsonModal({
  onCancel,
  onApply,
}: {
  onCancel: () => void;
  onApply: (text: string) => Promise<string | null>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (busy) return;
    if (!text.trim()) {
      setStatus("✕ 文本框为空，请粘贴角色卡 JSON");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await onApply(text);
      if (result) setStatus(result);
    } finally {
      setBusy(false);
    }
  }, [text, busy, onApply]);

  // Esc to cancel, Ctrl+Enter to apply — keyboard shortcuts that match
  // common "paste then confirm" muscle memory.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void submit();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel, submit]);

  // Inline styles keep this modal self-contained (we don't want to
  // wire CSS into the global cc-fullscreen.html for a transient
  // dialog). The backdrop click cancels; clicks inside the dialog
  // stop propagation so the user can drag-select text without
  // dismissing.
  return (
    <div
      style={{
        position: "fixed",
        inset: "0",
        background: "rgba(0,0,0,0.55)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "var(--surface-2, #1e1d1a)",
          border: "1px solid var(--border-strong, #4a4640)",
          borderRadius: "8px",
          padding: "16px 18px",
          width: "min(720px, 92vw)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: "15px", color: "var(--gold, #d4a056)" }}>粘贴角色卡 JSON</h3>
          <span style={{ fontSize: "11px", color: "var(--ink-dim, #8a8479)" }}>Ctrl+Enter 应用 · Esc 取消</span>
        </div>
        <textarea
          autofocus
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          placeholder='直接粘贴 JSON 文本，例如 {"identity": {...}, "abilities": {...}, "core_stats": {...}}'
          spellcheck={false}
          style={{
            flex: "1 1 auto",
            minHeight: "260px",
            maxHeight: "60vh",
            resize: "vertical",
            background: "var(--bg, #161513)",
            color: "var(--ink, #e8e3d8)",
            border: "1px solid var(--border, #3a352f)",
            borderRadius: "4px",
            padding: "8px 10px",
            fontFamily: "'Cascadia Code', 'Consolas', monospace",
            fontSize: "12px",
            lineHeight: "1.45",
            outline: "none",
          }}
        />
        {status && (
          <div style={{
            fontSize: "12px",
            padding: "8px 10px",
            background: status.startsWith("✓") ? "rgba(80,180,80,0.12)" : "rgba(220,90,80,0.12)",
            border: `1px solid ${status.startsWith("✓") ? "rgba(80,180,80,0.4)" : "rgba(220,90,80,0.4)"}`,
            borderRadius: "4px",
            whiteSpace: "pre-wrap",
            color: "var(--ink, #e8e3d8)",
          }}>
            {status}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button class="cc-btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button class="cc-btn primary" onClick={submit} disabled={busy || !text.trim()}>
            {busy ? "应用中…" : "应用"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 2026-05-14 (#14 f2) — spell pick modal. Replaces the old
// window.prompt() with a proper in-panel dialog: a name input that
// live-filters the suite library's spell list, plus a "直接添加" row
// for arbitrary names not in any enabled library. Per user spec,
// spell DETAIL (description / components / range / etc.) is NOT
// stored on the card any more — the cc card just records the spell's
// name + level and leaves the lookup to the library. Picking a spell
// returns its name; SpellsSection assigns the level.
function SpellPickModal({
  title, onCancel, onPick,
}: {
  title: string;
  onCancel: () => void;
  onPick: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [spells, setSpells] = useState<SpellEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await loadSpellNames();
        if (!cancelled) { setSpells(list); setLoading(false); }
      } catch {
        if (!cancelled) { setLoadError(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onCancel]);

  // Match against BOTH the Chinese label and the English name so the
  // user can type either. Display is always the label (cn preferred).
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return spells.slice(0, 60);
    return spells
      .filter((s) => s.label.toLowerCase().includes(q) || s.en.toLowerCase().includes(q))
      .slice(0, 60);
  }, [query, spells]);

  return (
    <div class="cc-modal-backdrop" onClick={onCancel}>
      <div class="cc-modal" onClick={(e) => e.stopPropagation()}>
        <div class="cc-modal-h">
          <h3>{title}</h3>
          <span class="cc-modal-hint">输入中文 / 英文名筛选 · Esc 取消</span>
        </div>
        <input
          class="cc-edit-text"
          autofocus
          style={{ width: "100%", marginBottom: "8px", padding: "7px 10px", fontSize: "13px" }}
          placeholder="法术名（中 / 英，留空浏览全部）"
          value={query}
          onInput={(e: any) => setQuery(e.target.value)}
        />
        <div class="cc-modal-list">
          {query.trim() && (
            <button
              class="cc-modal-row cc-modal-row-free"
              onClick={() => onPick(query.trim())}>
              ＋ 直接添加「{query.trim()}」
            </button>
          )}
          {loading && <div class="cc-modal-msg">加载法术库…</div>}
          {loadError && (
            <div class="cc-modal-msg">法术库加载失败 — 上方"直接添加"仍可用</div>
          )}
          {!loading && matches.map((s) => (
            <button class="cc-modal-row" onClick={() => onPick(s.label)}>
              <span>{s.label}</span>
              {s.en && s.en !== s.label && (
                <span class="cc-modal-row-en">{s.en}</span>
              )}
            </button>
          ))}
          {!loading && !loadError && matches.length === 0 && query.trim() && (
            <div class="cc-modal-msg">库内没有匹配项 — 可用上方"直接添加"</div>
          )}
        </div>
        <div class="cc-modal-foot">
          <button class="cc-btn" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}

function StatsBanner({
  data, onPatch,
}: {
  data: CharacterData;
  onPatch: (patch: Partial<CharacterData>) => void;
}) {
  const { editing } = useEdit();
  const cs = data.core_stats || {};
  const hp = cs.hp || {};
  const hd = cs.hit_dice || {};

  const setHp = (which: "current" | "max" | "temp", val: string) => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) return;
    const next = { ...hp, [which]: n };
    onPatch({ core_stats: { ...cs, hp: next } });
  };
  const setAc = (val: string) => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) return;
    onPatch({ core_stats: { ...cs, ac: n } });
  };
  const setHdCur = (val: string) => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) return;
    onPatch({ core_stats: { ...cs, hit_dice: { ...hd, current: n } } });
  };
  // 2026-05-14 (#14) — edit-mode helpers for the remaining stat cells
  // (initiative / speed / passive perception / proficiency / hit-dice
  // max + die-size). All single-field patches on core_stats.
  const setCs = (patch: Record<string, any>) => onPatch({ core_stats: { ...cs, ...patch } });
  const setHd = (patch: Record<string, any>) => onPatch({ core_stats: { ...cs, hit_dice: { ...hd, ...patch } } });

  return (
    <div class="cc-stats">
      <div class="stat-cell hp">
        <div class="stat-cell-label">HP</div>
        <div class="stat-cell-val">
          <input class="stat-input big"
            value={hp.current ?? 0}
            onChange={(e: any) => setHp("current", e.target.value)} />
          <span class="slash">/</span>
          <input class="stat-input small"
            value={hp.max ?? 0}
            onChange={(e: any) => setHp("max", e.target.value)} />
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">临时</div>
        <div class="stat-cell-val">
          <input class="stat-input big"
            value={hp.temp ?? 0}
            onChange={(e: any) => setHp("temp", e.target.value)} />
        </div>
      </div>
      <div class="stat-cell ac">
        <div class="stat-cell-label">AC</div>
        <div class="stat-cell-val">
          <input class="stat-input big"
            value={cs.ac ?? 10}
            onChange={(e: any) => setAc(e.target.value)} />
        </div>
      </div>
      <div class="stat-cell init">
        <div class="stat-cell-label">先攻</div>
        <div class="stat-cell-val">
          {editing ? (
            <input class="stat-input big" type="number"
              value={cs.initiative ?? 0}
              onInput={(e: any) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setCs({ initiative: n });
              }} />
          ) : (
            <span class="big">{fmtMod(cs.initiative)}</span>
          )}
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">速度</div>
        <div class="stat-cell-val">
          {editing ? (
            <input class="stat-input big" type="number"
              value={cs.speed ?? 0}
              onInput={(e: any) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setCs({ speed: n });
              }} />
          ) : (
            <span class="big">{cs.speed ?? "?"}</span>
          )}
          <span class="unit">尺</span>
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">被察</div>
        <div class="stat-cell-val">
          {editing ? (
            <input class="stat-input big" type="number"
              value={cs.passive_perception ?? 0}
              onInput={(e: any) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setCs({ passive_perception: n });
              }} />
          ) : (
            <span class="big">{cs.passive_perception ?? "?"}</span>
          )}
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">熟练</div>
        <div class="stat-cell-val">
          {editing ? (
            <input class="stat-input big" type="number"
              value={cs.proficiency_bonus ?? 0}
              onInput={(e: any) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setCs({ proficiency_bonus: n });
              }} />
          ) : (
            <span class="big">{fmtMod(cs.proficiency_bonus)}</span>
          )}
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">生命骰</div>
        <div class="stat-cell-val">
          <input class="stat-input big" value={hd.current ?? 0}
            onChange={(e: any) => setHdCur(e.target.value)} />
          <span class="slash">/</span>
          {editing ? (
            <>
              <input class="stat-input small" type="number"
                value={hd.max ?? 0}
                onInput={(e: any) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) setHd({ max: n });
                }} />
              <input class="stat-input small" type="text"
                style={{ width: "44px" }}
                placeholder="d8"
                value={hd.die_size ?? ""}
                onInput={(e: any) => setHd({ die_size: e.target.value })} />
            </>
          ) : (
            <span class="small">{hd.max ?? "?"}{hd.die_size ?? ""}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function rollExpr(label: string, expr: string, advMode?: "adv" | "dis") {
  if (!expr) return;
  fireQuickRoll({ expression: expr, label, advMode });
}

function AbilitiesAndSkills({ data }: { data: CharacterData }) {
  const { editing, onPatch } = useEdit();
  const ab = data.abilities || {};
  const cs = data.core_stats || {};
  const skills = Array.isArray(data.skills) ? data.skills : [];
  const skBy: Record<string, any[]> = {};
  for (const s of skills) (skBy[s.ability] ??= []).push(s);

  // 2026-05-14 (#14 / f3) — edit helpers. We mutate the ability or
  // skill in place via spread + index replacement, then push the
  // whole abilities / skills slice back through onPatch.
  //
  // Proficiency math (#14 f3 fix): toggling a save / skill proficiency
  // dot now RECOMPUTES the bonus / total, not just flips the flag:
  //   save bonus  = ability_mod + (proficient ? prof_bonus : 0)
  //   skill total = ability_mod + prof_bonus × {none:0, prof:1, exp:2}
  //                 (+ any misc_bonus the parser captured)
  // The user can still hand-override the number afterwards via the
  // input — the toggle just sets a correct baseline.
  const profBonus = cs.proficiency_bonus ?? 0;

  const setAbilityScore = (k: string, score: number) => {
    const cur = ab[k] || {};
    const newMod = Math.floor((score - 10) / 2);
    // Re-derive the save bonus too — it's modifier-relative, so a
    // score change should ripple into the save unless the user has
    // hand-set it. We recompute from proficiency state to keep things
    // coherent (matches the toggle behaviour below).
    const save = cur.save || {};
    const newSaveBonus = newMod + (save.proficient ? profBonus : 0);
    onPatch({
      abilities: {
        ...ab,
        [k]: {
          ...cur,
          total: score,
          modifier: newMod,
          save: { ...save, bonus: newSaveBonus },
        },
      },
    });
  };
  const toggleSaveProf = (k: string) => {
    const cur = ab[k] || {};
    const save = cur.save || {};
    const willBeProf = !save.proficient;
    const mod = typeof cur.modifier === "number" ? cur.modifier : 0;
    onPatch({
      abilities: {
        ...ab,
        [k]: {
          ...cur,
          save: {
            ...save,
            proficient: willBeProf,
            bonus: mod + (willBeProf ? profBonus : 0),
          },
        },
      },
    });
  };
  const setSaveBonus = (k: string, bonus: number) => {
    const cur = ab[k] || {};
    const save = cur.save || {};
    onPatch({
      abilities: { ...ab, [k]: { ...cur, save: { ...save, bonus } } },
    });
  };
  const setSkillTotal = (idx: number, total: number) => {
    const next = [...skills];
    next[idx] = { ...next[idx], total };
    onPatch({ skills: next });
  };
  const cycleSkillProf = (idx: number) => {
    // none → proficient → expertise → none
    const order = ["none", "proficient", "expertise"];
    const sk = skills[idx];
    if (!sk) return;
    const cur = sk.proficiency || "none";
    const nextProf = order[(order.indexOf(cur) + 1) % order.length];
    // Recompute total from the skill's ability modifier + proficiency
    // multiplier. mult: none=0, proficient=1, expertise=2.
    const abil = ab[sk.ability] || {};
    const abilMod = typeof abil.modifier === "number" ? abil.modifier : 0;
    const mult = nextProf === "expertise" ? 2 : nextProf === "proficient" ? 1 : 0;
    const misc = typeof sk.misc_bonus === "number" ? sk.misc_bonus : 0;
    const total = abilMod + profBonus * mult + misc;
    const next = [...skills];
    next[idx] = { ...next[idx], proficiency: nextProf, total };
    onPatch({ skills: next });
  };

  return (
    <div class="sec">
      <div class="sec-h">
        <span class="sec-h-title">属性 · 豁免 · 技能{editing ? "（编辑中 — 点击 ●/○/★ 切换熟练）" : ""}</span>
      </div>
      <div class="sec-body">
        <div class="abl-grid">
          {ABL_ORDER.map((k) => {
            const a = ab[k] || {};
            const mod = typeof a.modifier === "number" ? a.modifier : 0;
            const profBonus = cs.proficiency_bonus ?? 0;
            const saveBonus = typeof a.save?.bonus === "number"
              ? a.save.bonus
              : (a.save?.proficient ? mod + profBonus : mod);
            const aExpr = `1d20${mod >= 0 ? "+" : ""}${mod}`;
            const sExpr = `1d20${saveBonus >= 0 ? "+" : ""}${saveBonus}`;
            if (editing) {
              return (
                <div class="abl">
                  <div class="abl-name">{ABL_LABEL[k]}</div>
                  <input class="abl-total cc-edit-num" type="number"
                    value={a.total ?? 10}
                    onInput={(e: any) => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isFinite(n)) setAbilityScore(k, n);
                    }} />
                  <div class="abl-mod" title="自动从属性值推算">{fmtMod(a.modifier)}</div>
                  {/* 2026-05-14 (#14 f2) — `abl-save-edit` is a DISTINCT
                      class from `abl-save`, so the CSS ::before that
                      auto-draws a ●/○ on `.abl-save` never fires here.
                      The explicit clickable span below is the ONLY
                      proficiency dot in edit mode — earlier the :has()
                      override didn't take in OBR's iframe runtime, so
                      both the pseudo AND the span rendered (two
                      circles). A separate class is bulletproof. */}
                  <div class={`abl-save-edit ${a.save?.proficient ? "is-prof" : ""}`}>
                    <span class="abl-save-dot"
                          onClick={() => toggleSaveProf(k)}
                          title="点击切换豁免熟练">{a.save?.proficient ? "●" : "○"}</span>
                    <input class="cc-edit-num" type="number"
                      style={{ width: "44px" }}
                      value={a.save?.bonus ?? saveBonus}
                      onInput={(e: any) => {
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n)) setSaveBonus(k, n);
                      }} />
                  </div>
                </div>
              );
            }
            return (
              <div class="abl">
                <div class="abl-name">{ABL_LABEL[k]}</div>
                <div class="abl-total">{a.total ?? "?"}</div>
                <div class="abl-mod"
                  onClick={() => rollExpr(`${ABL_LABEL[k]}检定`, aExpr)}
                  onContextMenu={(e: any) => { e.preventDefault(); rollExpr(`${ABL_LABEL[k]}检定（优势）`, aExpr, "adv"); }}
                  title={`${ABL_LABEL[k]}检定 ${aExpr}\n（左键投，右键优势）`}>
                  {fmtMod(a.modifier)}
                </div>
                <div class={`abl-save ${a.save?.proficient ? "is-prof" : ""}`}
                  onClick={() => rollExpr(`${ABL_LABEL[k]}豁免`, sExpr)}
                  title={`${ABL_LABEL[k]}豁免 ${sExpr}`}>
                  豁免 <b>{fmtMod(saveBonus)}</b>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: "12px" }}>
          <div class="sk-list">
            {ABL_ORDER.flatMap((k) => {
              const list = skBy[k] || [];
              return list.map((s) => {
                const idx = skills.indexOf(s);
                const total = typeof s.total === "number" ? s.total : 0;
                const expr = `1d20${total >= 0 ? "+" : ""}${total}`;
                const cls = s.proficiency === "expertise" ? "exp" : s.proficiency === "proficient" ? "prof" : "";
                if (editing) {
                  return (
                    <div class={`sk ${cls}`} style={{ cursor: "default" }}>
                      <span class="sk-prof"
                            style={{ cursor: "pointer" }}
                            onClick={() => cycleSkillProf(idx)}
                            title="点击循环切换：无 → 熟练 → 专精 → 无">
                        {cls === "exp" ? "★" : cls === "prof" ? "●" : "○"}
                      </span>
                      <span class="sk-name">{s.name}</span>
                      <span class="sk-abil">{ABL_ABBR[s.ability] || ""}</span>
                      <input class="cc-edit-num sk-val" type="number"
                        style={{ width: "48px" }}
                        value={s.total ?? 0}
                        onInput={(e: any) => {
                          const n = parseInt(e.target.value, 10);
                          if (Number.isFinite(n)) setSkillTotal(idx, n);
                        }} />
                    </div>
                  );
                }
                return (
                  <div class={`sk ${cls}`}
                    onClick={() => rollExpr(`${s.name}检定`, expr)}
                    onContextMenu={(e: any) => { e.preventDefault(); rollExpr(`${s.name}检定（优势）`, expr, "adv"); }}
                    title={`${s.name}检定 ${expr}\n（左键投，右键优势）`}>
                    <span class="sk-prof">{cls === "exp" ? "★" : cls === "prof" ? "●" : "○"}</span>
                    <span class="sk-name">{s.name}</span>
                    <span class="sk-abil">{ABL_ABBR[s.ability] || ""}</span>
                    <span class="sk-val">{fmtMod(s.total)}</span>
                  </div>
                );
              });
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Defenses({ data }: { data: CharacterData }) {
  const { editing, onPatch } = useEdit();
  const d = data.defenses || {};
  const id = data.identity || {};
  const langs: string[] = Array.isArray(id.languages) ? id.languages : [];
  const tools: string[] = Array.isArray(id.tool_proficiencies) ? id.tool_proficiencies : [];

  const empty = !d.resistances?.length && !d.immunities?.length && !d.advantages?.length && !d.disadvantages?.length;
  // In edit mode we always render the section (so the user can ADD
  // first entries to empty categories); in view mode we hide it
  // entirely when there's nothing to show.
  if (!editing && empty && !langs.length && !tools.length) return null;

  // 2026-05-14 (#14) — small add/remove helpers per tag category.
  const addTag = (cat: "resistances" | "immunities" | "advantages" | "disadvantages") => {
    const v = (window.prompt(`添加${labelOf(cat)}（用逗号分隔可一次添加多条）`, "") || "").trim();
    if (!v) return;
    const items = v.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) return;
    const cur = Array.isArray((d as any)[cat]) ? (d as any)[cat] : [];
    onPatch({ defenses: { ...d, [cat]: [...cur, ...items] } });
  };
  const removeTag = (cat: "resistances" | "immunities" | "advantages" | "disadvantages", value: string) => {
    const cur = Array.isArray((d as any)[cat]) ? (d as any)[cat] : [];
    onPatch({ defenses: { ...d, [cat]: cur.filter((x: string) => x !== value) } });
  };
  const addLangTool = (which: "languages" | "tool_proficiencies") => {
    const v = (window.prompt(`添加${which === "languages" ? "语言" : "工具"}`, "") || "").trim();
    if (!v) return;
    const items = v.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) return;
    const cur = Array.isArray((id as any)[which]) ? (id as any)[which] : [];
    onPatch({ identity: { ...id, [which]: [...cur, ...items] } });
  };
  const removeLangTool = (which: "languages" | "tool_proficiencies", value: string) => {
    const cur = Array.isArray((id as any)[which]) ? (id as any)[which] : [];
    onPatch({ identity: { ...id, [which]: cur.filter((x: string) => x !== value) } });
  };
  function labelOf(cat: string): string {
    return { resistances: "抗性", immunities: "免疫", advantages: "优势", disadvantages: "劣势" }[cat] || cat;
  }

  const renderRow = (
    label: string,
    cat: "resistances" | "immunities" | "advantages" | "disadvantages",
    css: string,
  ) => {
    const list = Array.isArray((d as any)[cat]) ? (d as any)[cat] : [];
    if (!editing && list.length === 0) return null;
    return (
      <div class="def-row">
        <span class="def-label">{label}</span>
        {list.map((x: string) => (
          <span class={`def-tag ${css}`}>
            {x}
            {editing && (
              <button class="cc-tag-x" onClick={() => removeTag(cat, x)} title="移除">×</button>
            )}
          </span>
        ))}
        {editing && (
          <button class="cc-add-tag" onClick={() => addTag(cat)} title={`添加${label}`}>+</button>
        )}
      </div>
    );
  };

  return (
    <div class="sec">
      <div class="sec-h"><span class="sec-h-title">防御 · 语言 · 工具</span></div>
      <div class="sec-body">
        {renderRow("抗性", "resistances", "res")}
        {renderRow("免疫", "immunities", "imm")}
        {renderRow("优势", "advantages", "adv")}
        {renderRow("劣势", "disadvantages", "dis")}
        {(editing || langs.length > 0) && (
          <div class="def-row">
            <span class="def-label">语言</span>
            {langs.map((x) => (
              <span class="def-tag">
                {x}
                {editing && (
                  <button class="cc-tag-x" onClick={() => removeLangTool("languages", x)} title="移除">×</button>
                )}
              </span>
            ))}
            {editing && (
              <button class="cc-add-tag" onClick={() => addLangTool("languages")} title="添加语言">+</button>
            )}
          </div>
        )}
        {(editing || tools.length > 0) && (
          <div class="def-row">
            <span class="def-label">工具</span>
            {tools.map((x) => (
              <span class="def-tag">
                {x}
                {editing && (
                  <button class="cc-tag-x" onClick={() => removeLangTool("tool_proficiencies", x)} title="移除">×</button>
                )}
              </span>
            ))}
            {editing && (
              <button class="cc-add-tag" onClick={() => addLangTool("tool_proficiencies")} title="添加工具">+</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CombatSection({ data }: { data: CharacterData }) {
  const { editing, onPatch } = useEdit();
  const cb = data.combat || {};
  const armor = cb.armor || {};
  const shield = cb.shield || {};
  const weapons: any[] = Array.isArray(cb.weapons) ? cb.weapons : [];
  const armorEquipped = readBooleanFlag(armor.equipped);
  const armorAttuned = readBooleanFlag(armor.attuned);
  const shieldEquipped = readBooleanFlag(shield.equipped);
  const shieldAttuned = readBooleanFlag(shield.attuned);

  // 2026-05-14 (#14) — weapon edit helpers. Each weapon is a plain
  // object with name / attack_bonus / damage / damage_type / properties
  // fields. We mutate the array via spread + index replacement.
  const updateWeapon = (idx: number, patch: Record<string, any>) => {
    const next = [...weapons];
    next[idx] = { ...next[idx], ...patch };
    onPatch({ combat: { ...cb, weapons: next } });
  };
  const removeWeapon = (idx: number) => {
    if (!window.confirm(`删除武器「${weapons[idx]?.name || "未命名"}」？`)) return;
    const next = weapons.filter((_, i) => i !== idx);
    onPatch({ combat: { ...cb, weapons: next } });
  };
  const addWeapon = (ev?: Event) => {
    const next = [...weapons, { name: "新武器", attack_bonus: "+0", damage: "1d6", damage_type: "" }];
    onPatch({ combat: { ...cb, weapons: next } });
    smoothScrollToNewRow(ev, ".weap");
  };
  // 2026-05-14 (#14) — armor/shield edit affordances are NOT exposed
  // in this pass. The schema (ac_base / dex_bonus_cap / weight /
  // equipped / attuned / damage_resistances...) is dense and rarely
  // changes mid-session compared to weapons. For now the user edits
  // these via the paste-JSON modal or the source xlsx.

  return (
    <div class="sec">
      <div class="sec-h">
        <span class="sec-h-title">战斗 · 武器 · 护甲</span>
        {editing && (
          <button class="cc-add-tag" style={{ marginLeft: "auto" }} onClick={(e: any) => addWeapon(e)} title="新增武器">+ 武器</button>
        )}
      </div>
      <div class="sec-body dense">
        {(armor.name || armor.ac_base != null) && (
          <div class="weap" style={{ background: "rgba(138,111,63,0.06)" }}>
            <div class="weap-name">
              🛡 {armor.name || "护甲"}
              {armorEquipped && <span class="weap-prof">已装备</span>}
              {armorAttuned && <span class="weap-prof">同调</span>}
            </div>
            <div class="weap-atk" title="基础 AC + 敏捷上限">
              AC {armor.ac_base ?? "?"}
              {typeof armor.dex_bonus_cap === "number" && ` (+敏≤${armor.dex_bonus_cap})`}
            </div>
            <div class="weap-dmg" style={{ visibility: "hidden" }}>—</div>
            {armor.weight != null && (
              <div class="weap-props">重量 {armor.weight} 磅</div>
            )}
          </div>
        )}
        {shield.ac_bonus != null && (
          <div class="weap" style={{ background: "rgba(138,111,63,0.06)" }}>
            <div class="weap-name">⛨ 盾牌
              <span class={`weap-prof${shieldEquipped ? "" : " is-off"}`}>{shieldEquipped ? "已装备" : "未装备"}</span>
              {shieldAttuned && <span class="weap-prof">同调</span>}
            </div>
            <div class="weap-atk">+{shield.ac_bonus} AC</div>
            <div class="weap-dmg" style={{ visibility: "hidden" }}>—</div>
          </div>
        )}
        {weapons.length === 0 && !armor.name && !shield.ac_bonus && (
          <div style={{ color: "var(--ink-mute)", fontStyle: "italic", padding: "8px" }}>
            暂未配置武器或护甲
          </div>
        )}
        {weapons.map((w, idx) => {
          const atkMatch = /([+-]?\d+)/.exec(String(w.attack_bonus ?? ""));
          const atkBn = atkMatch ? parseInt(atkMatch[1], 10) : 0;
          const atkExpr = `1d20${atkBn >= 0 ? "+" : ""}${atkBn}`;
          const dmgRaw = String(w.damage ?? "").replace(/\s+/g, "");
          const dmgMatch = /\d*d\d+([+-]\d+)?/.exec(dmgRaw);
          const dmgExpr = dmgMatch ? dmgMatch[0] : dmgRaw;
          if (editing) {
            return (
              <div class="weap" style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 1fr 1fr auto", gap: "6px", alignItems: "center" }}>
                <input class="cc-edit-text" type="text"
                  value={w.name ?? ""}
                  placeholder="武器名"
                  onInput={(e: any) => updateWeapon(idx, { name: e.target.value })} />
                <input class="cc-edit-text" type="text"
                  value={w.attack_bonus ?? ""}
                  placeholder="+5"
                  onInput={(e: any) => updateWeapon(idx, { attack_bonus: e.target.value })} />
                <input class="cc-edit-text" type="text"
                  value={w.damage ?? ""}
                  placeholder="1d8+3"
                  onInput={(e: any) => updateWeapon(idx, { damage: e.target.value })} />
                <input class="cc-edit-text" type="text"
                  value={w.damage_type ?? ""}
                  placeholder="挥砍 / 穿刺 / …"
                  onInput={(e: any) => updateWeapon(idx, { damage_type: e.target.value })} />
                <button class="cc-tag-x" onClick={() => removeWeapon(idx)} title="删除武器">×</button>
              </div>
            );
          }
          return (
            <div class="weap">
              <div class="weap-name">
                ⚔ {w.name || "?"}
                {w.proficient && <span class="weap-prof">熟</span>}
              </div>
              <div class="weap-atk"
                onClick={() => rollExpr(`${w.name} 命中`, atkExpr)}
                onContextMenu={(e: any) => { e.preventDefault(); rollExpr(`${w.name} 命中（优势）`, atkExpr, "adv"); }}
                title={`左键投，右键优势 · ${atkExpr}`}>
                {w.attack_bonus || `${fmtMod(atkBn)}`}
              </div>
              <div class="weap-dmg"
                onClick={() => rollExpr(`${w.name} 伤害${w.damage_type ? `(${w.damage_type})` : ""}`, dmgExpr)}
                title={`${w.damage} ${w.damage_type ?? ""}`}>
                {w.damage ?? "—"} {w.damage_type ? <span style={{ opacity: 0.7, fontSize: "10px" }}>{w.damage_type}</span> : ""}
              </div>
              {w.extra_damage && (
                <div class="weap-dmg weap-dmg-extra"
                  onClick={(e: any) => {
                    e.stopPropagation();
                    rollExpr(
                      `${w.name} 附加伤害${w.extra_damage_type ? `(${w.extra_damage_type})` : ""}`,
                      String(w.extra_damage).replace(/\s+/g, ""),
                    );
                  }}
                  title={`附加伤害骰 ${w.extra_damage}${w.extra_damage_type ? ` · ${w.extra_damage_type}` : ""}`}>
                  +{w.extra_damage} {w.extra_damage_type ? <span style={{ opacity: 0.7, fontSize: "10px" }}>{w.extra_damage_type}</span> : ""}
                </div>
              )}
              {(w.properties || w.weight != null || w.ammo_type) && (
                <div class="weap-props">
                  {[
                    w.properties,
                    w.weight != null ? `${w.weight}磅` : null,
                    w.ammo_type ? `弹药:${w.ammo_type}` : null,
                  ].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SpellsSection({ data }: { data: CharacterData }) {
  const { editing, onPatch } = useEdit();
  const sp = data.spellcasting || {};
  const cs = data.core_stats || {};
  const slots = sp.spell_slots || {};
  const cantrips: any[] = Array.isArray(sp.cantrips_known) ? sp.cantrips_known : [];
  const always: any[] = Array.isArray(sp.always_known) ? sp.always_known : [];
  const prepared: any[] = Array.isArray(sp.prepared) ? sp.prepared : [];

  const [openSpell, setOpenSpell] = useState<string | null>(null);
  // 2026-05-14 (#14 f2) — which list + level the SpellPickModal is
  // currently adding into. null = modal closed.
  const [pickFor, setPickFor] = useState<
    { slot: "cantrips_known" | "always_known" | "prepared"; level: number; ev?: Event } | null
  >(null);

  // 2026-05-14 (#14 follow-up / f2) — edit helpers. SpellsSection has
  // three parallel lists (cantrips_known / always_known / prepared);
  // each uses the same add/remove/patch shape so we factor them via a
  // slot key. The "+" buttons open the SpellPickModal (replaces the
  // old window.prompt). Per user spec, spells store only { name,
  // level } now — detailed text lives in the library, not on the card.
  const openSpellPicker = (
    slot: "cantrips_known" | "always_known" | "prepared",
    level: number,
    ev?: Event,
  ) => {
    setPickFor({ slot, level, ev });
  };
  const commitSpellPick = (name: string) => {
    if (!pickFor) return;
    const { slot, level, ev } = pickFor;
    const cur = Array.isArray((sp as any)[slot]) ? (sp as any)[slot] : [];
    onPatch({ spellcasting: { ...sp, [slot]: [...cur, { name, level }] } });
    setPickFor(null);
    smoothScrollToNewRow(ev, ".spell");
  };
  const removeSpell = (slot: "cantrips_known" | "always_known" | "prepared", idx: number) => {
    const cur = Array.isArray((sp as any)[slot]) ? (sp as any)[slot] : [];
    if (!window.confirm(`删除「${cur[idx]?.name || "未命名"}」？`)) return;
    onPatch({ spellcasting: { ...sp, [slot]: cur.filter((_: any, i: number) => i !== idx) } });
  };
  const patchSpell = (slot: "cantrips_known" | "always_known" | "prepared", idx: number, patch: Record<string, any>) => {
    const cur = Array.isArray((sp as any)[slot]) ? (sp as any)[slot] : [];
    const next = [...cur];
    next[idx] = { ...next[idx], ...patch };
    onPatch({ spellcasting: { ...sp, [slot]: next } });
  };
  const setSlot = (lv: number, which: "current" | "max", v: number) => {
    const cur = (slots as any)[String(lv)] || {};
    onPatch({
      spellcasting: { ...sp, spell_slots: { ...(slots || {}), [String(lv)]: { ...cur, [which]: v } } },
    });
  };

  if (!editing && !cantrips.length && !always.length && !prepared.length && !sp.attack_bonus && !sp.save_dc) {
    return null;
  }

  // Group prepared by group number (1/2/3) — falls back to single
  // group when group field absent.
  const groups: Record<string, any[]> = {};
  for (const s of prepared) {
    const g = String(s.group ?? "1");
    (groups[g] ??= []).push(s);
  }

  const renderSpell = (s: any, idx: number, prefix: string, slot?: "cantrips_known" | "always_known" | "prepared") => {
    const key = `${prefix}-${idx}`;
    const isOpen = openSpell === key;
    // 2026-05-14 (#14 f3) — edit-mode spell row. Per user spec spells
    // store ONLY { name, level } now — no description (the library is
    // the source of truth for spell text). Row has: level input ·
    // name input · × delete. The per-row 🔍 button was removed — it
    // broadcast to the global search popover, but the cc panel is a
    // fullScreen modal that covers it, so the user never saw the
    // result. Spell lookup happens at ADD time via SpellPickModal,
    // which searches the library inline.
    if (editing && slot) {
      return (
        <div class="spell" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <input class="cc-edit-num" type="number"
            style={{ width: "48px", textAlign: "center" }}
            value={s.level ?? 0}
            onInput={(e: any) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) patchSpell(slot, idx, { level: n });
            }}
            title="环阶（0 = 戏法）" />
          <input class="cc-edit-text" type="text"
            style={{ flex: "1" }}
            value={s.name ?? ""}
            placeholder="法术名"
            onInput={(e: any) => patchSpell(slot, idx, { name: e.target.value })} />
          <button class="cc-tag-x"
            onClick={() => removeSpell(slot, idx)}
            title="删除">×</button>
        </div>
      );
    }
    return (
      <>
        <div class="spell"
          onClick={() => setOpenSpell(isOpen ? null : key)}
          title="点击展开法术详情">
          <span class={`spell-lv ${(s.level ?? 0) === 0 ? "cantrip" : ""}`}>
            {(s.level ?? 0) === 0 ? "戏" : `${s.level}环`}
          </span>
          {/* 2026-05-15 — the spell-name used to be its own clickable
              search trigger (`onClick → fireNameSearch + stopPropagation`).
              User reported the name was blocking the row's detail toggle
              and the search alone wasn't useful enough to justify it.
              Removed the inner onClick so clicks anywhere on the row
              (including the name) open the detail panel. Players who
              still want to search can use the global search bar. */}
          <span class="spell-name">{s.name}</span>
          {s.meta?.concentration && <span class="spell-tag conc">专注</span>}
          {s.meta?.ritual && <span class="spell-tag ritual">仪式</span>}
        </div>
        {isOpen && s.description && (
          <div class="spell-detail">
            {s.meta && (
              <div class="meta">
                {s.meta.school && <span>{s.meta.school}</span>}
                {s.meta.casting_time && <span>施法 {s.meta.casting_time}</span>}
                {s.meta.range && <span>距离 {s.meta.range}</span>}
                {s.meta.components && <span>{s.meta.components}</span>}
                {s.meta.duration && <span>持续 {s.meta.duration}</span>}
                {s.meta.source && <span>《{s.meta.source}》</span>}
              </div>
            )}
            {s.description}
          </div>
        )}
      </>
    );
  };

  return (
    <div class="sec">
      <div class="sec-h">
        <span class="sec-h-title">法术</span>
        {(sp.spellcasting_ability || sp.save_dc) && (
          <span class="sec-h-meta">
            {sp.spellcasting_ability && `关键属性: ${sp.spellcasting_ability}`}
            {sp.save_dc != null && `  ·  豁免DC: ${sp.save_dc}`}
            {sp.attack_bonus && `  ·  攻击: ${sp.attack_bonus}`}
            {sp.max_prepared != null && `  ·  最大准备: ${sp.max_prepared}`}
          </span>
        )}
      </div>
      <div class="sec-body">
        {/* Spell slots */}
        <div class="spell-slots">
          {[1,2,3,4,5,6,7,8,9].map((lv) => {
            const s = slots[String(lv)];
            const has = s && (s.max ?? 0) > 0;
            if (editing) {
              // 2026-05-14 (#14 follow-up) — slot edit. Two tiny inputs
              // (current / max). Setting max=0 effectively retires the
              // level so the panel hides it in view mode again.
              return (
                <div class={`slot ${has ? "has-slots" : ""}`}>
                  <div class="slot-lv">{lv}环</div>
                  <input class="cc-edit-num" type="number"
                    style={{ width: "100%", textAlign: "center", fontSize: "13px" }}
                    value={s?.current ?? 0}
                    onInput={(e: any) => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isFinite(n)) setSlot(lv, "current", n);
                    }} />
                  <input class="cc-edit-num" type="number"
                    style={{ width: "100%", textAlign: "center", fontSize: "11px", opacity: 0.8 }}
                    value={s?.max ?? 0}
                    onInput={(e: any) => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isFinite(n)) setSlot(lv, "max", n);
                    }} />
                </div>
              );
            }
            return (
              <div class={`slot ${has ? "has-slots" : ""}`}>
                <div class="slot-lv">{lv}环</div>
                <div class="slot-cur">{has ? (s.current ?? 0) : "—"}</div>
                <div class="slot-max">{has ? `/${s.max}` : ""}</div>
              </div>
            );
          })}
        </div>

        {/* 2026-05-15 — Sorcery points block removed per user spec
            ("术法点 not used in our table"). Field stays parsed on
            the server side in case anyone wants it back later. */}

        {/* Cantrips */}
        {(editing || !!cantrips.length) && (
          <div class="spell-group">
            <div class="spell-group-h" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span>戏法</span>
              {editing && (
                <button class="cc-add-tag"
                  onClick={(e: any) => openSpellPicker("cantrips_known", 0, e)}
                  title="从法术库挑选戏法加入">+</button>
              )}
            </div>
            {cantrips.map((s, i) => renderSpell(s, i, "cantrip", editing ? "cantrips_known" : undefined))}
          </div>
        )}

        {/* Always known */}
        {(editing || !!always.length) && (
          <div class="spell-group">
            <div class="spell-group-h" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span>始终准备</span>
              {editing && (
                <button class="cc-add-tag"
                  onClick={(e: any) => openSpellPicker("always_known", 1, e)}
                  title="从法术库挑选始终准备法术加入">+</button>
              )}
            </div>
            {always.map((s, i) => renderSpell(s, i, "always", editing ? "always_known" : undefined))}
          </div>
        )}

        {/* Prepared — single "准备" header. Original grouping by `group`
            field is preserved for read-only view (multi-group decks);
            in edit mode we flatten into one list to keep the add/remove
            UX simple. The group field can still be set manually via the
            paste-JSON path. */}
        {(editing || Object.keys(groups).length > 0) && (
          editing ? (
            <div class="spell-group">
              <div class="spell-group-h" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span>准备法术</span>
                <button class="cc-add-tag"
                  onClick={(e: any) => openSpellPicker("prepared", 1, e)}
                  title="从法术库挑选准备法术加入">+</button>
              </div>
              {prepared.map((s, i) => renderSpell(s, i, "p", "prepared"))}
            </div>
          ) : (
            Object.entries(groups).map(([g, list]) => (
              <div class="spell-group">
                <div class="spell-group-h">准备法术 · 组 {g}</div>
                {list.map((s, i) => renderSpell(s, i, `g${g}`))}
              </div>
            ))
          )
        )}
      </div>
      {pickFor && (
        <SpellPickModal
          title={
            pickFor.slot === "cantrips_known" ? "添加戏法"
              : pickFor.slot === "always_known" ? "添加始终准备法术"
              : "添加准备法术"
          }
          onCancel={() => setPickFor(null)}
          onPick={commitSpellPick}
        />
      )}
    </div>
  );
}

function FeatureBlock({
  title, items, slot, onAdd, onRemove, onPatchItem,
}: {
  title: string;
  items: any[];
  // 2026-05-14 (#14) — when slot is provided, edit-mode actions
  // (+ append / × remove / inline name+description edit) become
  // available. The slot key is the data.features field name (e.g.
  // "class_features"); FeaturesSection plumbs each block's slot
  // separately so the patches target the right list.
  slot?: string;
  onAdd?: (slot: string, ev?: Event) => void;
  onRemove?: (slot: string, idx: number) => void;
  onPatchItem?: (slot: string, idx: number, patch: Record<string, any>) => void;
}) {
  const { editing } = useEdit();
  // 2026-05-15 — feature details default-expanded. User reported having
  // to click each feature row to read its description was tedious;
  // they almost always want to see them all at once. `closedIdx` flips
  // the previous "openIdx" semantic: items are open by default, click
  // the row to collapse a specific one.
  const [closedIdx, setClosedIdx] = useState<Set<number>>(new Set());
  if (!editing && !items?.length) return null;
  return (
    <div style={{ marginBottom: "10px" }}>
      <div class="spell-group-h" style={{ marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
        <span>{title}</span>
        {editing && slot && (
          <button class="cc-add-tag" onClick={(e: any) => onAdd?.(slot, e)} title={`新增${title}`}>+</button>
        )}
      </div>
      {items.map((f, i) => {
        const isOpen = editing || !closedIdx.has(i);
        if (editing && slot) {
          return (
            <div class="feat is-open" style={{ marginBottom: "6px" }}>
              <div class="feat-h" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input class="cc-edit-text" type="text"
                  style={{ flex: "1" }}
                  value={f.name ?? ""}
                  placeholder="名称"
                  onInput={(e: any) => onPatchItem?.(slot, i, { name: e.target.value })} />
                <input class="cc-edit-num" type="number"
                  style={{ width: "54px" }}
                  value={f.level ?? ""}
                  placeholder="Lv"
                  onInput={(e: any) => {
                    const v = e.target.value;
                    const n = v === "" ? null : parseInt(v, 10);
                    onPatchItem?.(slot, i, { level: n });
                  }} />
                <button class="cc-tag-x" onClick={() => onRemove?.(slot, i)} title="删除">×</button>
              </div>
              <textarea class="cc-edit-text"
                style={{ width: "100%", minHeight: "60px", marginTop: "4px", fontFamily: "inherit", fontSize: "12px" }}
                value={f.description ?? ""}
                placeholder="描述（点击展开 · 此处编辑全文）"
                onInput={(e: any) => onPatchItem?.(slot, i, { description: e.target.value })} />
            </div>
          );
        }
        return (
          <div class={`feat ${isOpen ? "is-open" : ""}`}>
            <div
              class="feat-h"
              onClick={() => {
                // Toggle: open by default, click to collapse, click
                // again to re-open.
                setClosedIdx((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i); else next.add(i);
                  return next;
                });
              }}
              title="点击折叠 / 展开"
            >
              <span class="feat-name">
                {/* 2026-05-15 — dropped the inner "search by name"
                    onClick (same change as the spell rows). Clicking
                    anywhere on the header now collapses/expands. */}
                <span class="srch-name">{f.name}</span>
                {f.level != null && <span class="lv">Lv{f.level}</span>}
                {f.category && <span class="lv" style={{ borderColor: "var(--teal-soft)", color: "var(--teal)" }}>{f.category}</span>}
              </span>
              <span class="feat-toggle">▼</span>
            </div>
            {isOpen && f.description && <div class="feat-body">{f.description}</div>}
          </div>
        );
      })}
    </div>
  );
}

function FeaturesSection({ data }: { data: CharacterData }) {
  const { editing, onPatch } = useEdit();
  const f = data.features || {};
  const cls: any[] = Array.isArray(f.class_features) ? f.class_features : [];
  const race: any[] = Array.isArray(f.race_features) ? f.race_features : [];
  const feats: any[] = Array.isArray(f.feats) ? f.feats : [];
  // New schema fields (v0.3+, may not exist in older data):
  const fightingStyle: any[] = Array.isArray(f.fighting_style_feats) ? f.fighting_style_feats : [];
  const special: any[] = Array.isArray(f.special_abilities) ? f.special_abilities : [];

  // 2026-05-14 (#14) — edit hooks. Each block targets a different
  // slot in data.features. We expose a single add / remove / patch
  // triad that the FeatureBlock components call with their slot key.
  const addItem = (slot: string, ev?: Event) => {
    const cur = Array.isArray((f as any)[slot]) ? (f as any)[slot] : [];
    onPatch({ features: { ...f, [slot]: [...cur, { name: "新条目", description: "" }] } });
    smoothScrollToNewRow(ev, ".feat");
  };
  const removeItem = (slot: string, idx: number) => {
    const cur = Array.isArray((f as any)[slot]) ? (f as any)[slot] : [];
    const name = cur[idx]?.name || "未命名";
    if (!window.confirm(`删除「${name}」？`)) return;
    onPatch({ features: { ...f, [slot]: cur.filter((_: any, i: number) => i !== idx) } });
  };
  const patchItem = (slot: string, idx: number, patch: Record<string, any>) => {
    const cur = Array.isArray((f as any)[slot]) ? (f as any)[slot] : [];
    const next = [...cur];
    next[idx] = { ...next[idx], ...patch };
    onPatch({ features: { ...f, [slot]: next } });
  };

  if (!editing && !cls.length && !race.length && !feats.length && !fightingStyle.length && !special.length) {
    return null;
  }

  return (
    <div class="sec">
      <div class="sec-h"><span class="sec-h-title">特性 · 专长</span></div>
      <div class="sec-body">
        <FeatureBlock title="职业特性" items={cls}
          slot="class_features" onAdd={addItem} onRemove={removeItem} onPatchItem={patchItem} />
        <FeatureBlock title="种族特性" items={race}
          slot="race_features" onAdd={addItem} onRemove={removeItem} onPatchItem={patchItem} />
        <FeatureBlock title="战斗风格" items={fightingStyle}
          slot="fighting_style_feats" onAdd={addItem} onRemove={removeItem} onPatchItem={patchItem} />
        <FeatureBlock title="特殊能力" items={special}
          slot="special_abilities" onAdd={addItem} onRemove={removeItem} onPatchItem={patchItem} />
        <FeatureBlock title="专长" items={feats}
          slot="feats" onAdd={addItem} onRemove={removeItem} onPatchItem={patchItem} />
      </div>
    </div>
  );
}

function BackgroundSection({ data }: { data: CharacterData }) {
  const { editing, onPatch } = useEdit();
  const bg = data.background || {};
  const id = data.identity || {};
  // 2026-05-14 (#14) — block keys (`appearance` / `personality` /
  // ...) live on data.background. Identity-level fields (玩家 / 性别
  // / 年龄 / ...) live on data.identity. We expose both with inline
  // edits in edit mode.
  type Block = { label: string; key: string; body: any };
  const blocks: Block[] = [
    { label: "外貌", key: "appearance", body: bg.appearance },
    { label: "性格", key: "personality", body: bg.personality },
    { label: "特质", key: "traits", body: bg.traits },
    { label: "理念", key: "ideals", body: bg.ideals },
    { label: "羁绊", key: "bonds", body: bg.bonds },
    { label: "缺陷", key: "flaws", body: bg.flaws },
    { label: "故事", key: "story", body: bg.story },
    { label: "其他", key: "description", body: bg.description },
  ];
  const setBg = (k: string, v: any) => onPatch({ background: { ...bg, [k]: v } });
  const setId = (k: string, v: any) => onPatch({ identity: { ...id, [k]: v } });

  const visibleBlocks = editing ? blocks : blocks.filter((b) => b.body);

  return (
    <div class="sec">
      <div class="sec-h">
        <span class="sec-h-title">背景 · 个人</span>
        {!editing && bg.background_name && <span class="sec-h-meta">背景：{bg.background_name}</span>}
      </div>
      <div class="sec-body">
        {editing && (
          <div class="def-row" style={{ marginBottom: "10px" }}>
            <span class="def-label">背景名</span>
            <input class="cc-edit-text" type="text" style={{ flex: "1" }}
              value={bg.background_name ?? ""}
              placeholder="如：哲人 / 罪犯 / 海上水手 ..."
              onInput={(e: any) => setBg("background_name", e.target.value)} />
          </div>
        )}
        <dl class="kv" style={{ marginBottom: "12px" }}>
          {(editing || id.player) && (<><dt>玩家</dt><dd>{editing
            ? <input class="cc-edit-text" type="text" value={id.player ?? ""} onInput={(e: any) => setId("player", e.target.value)} />
            : id.player}</dd></>)}
          {(editing || id.gender) && (<><dt>性别</dt><dd>{editing
            ? <input class="cc-edit-text" type="text" value={id.gender ?? ""} onInput={(e: any) => setId("gender", e.target.value)} />
            : id.gender}</dd></>)}
          {(editing || id.age != null) && (<><dt>年龄</dt><dd>{editing
            ? <input class="cc-edit-num" type="number" value={id.age ?? ""} onInput={(e: any) => {
                const v = e.target.value;
                setId("age", v === "" ? null : parseInt(v, 10));
              }} />
            : id.age}</dd></>)}
          {(editing || id.height) && (<><dt>身高</dt><dd>{editing
            ? <input class="cc-edit-text" type="text" value={id.height ?? ""} onInput={(e: any) => setId("height", e.target.value)} />
            : id.height}</dd></>)}
          {(editing || id.weight) && (<><dt>体重</dt><dd>{editing
            ? <input class="cc-edit-text" type="text" value={id.weight ?? ""} onInput={(e: any) => setId("weight", e.target.value)} />
            : id.weight}</dd></>)}
          {(editing || id.hometown) && (<><dt>家乡</dt><dd>{editing
            ? <input class="cc-edit-text" type="text" value={id.hometown ?? ""} onInput={(e: any) => setId("hometown", e.target.value)} />
            : id.hometown}</dd></>)}
        </dl>
        {!!visibleBlocks.length && (
          <div class="bio-grid">
            {visibleBlocks.map((b) => (
              <div class="bio-block">
                <div class="bio-block-h">{b.label}</div>
                <div class="bio-block-body">
                  {editing ? (
                    <textarea class="cc-edit-text"
                      style={{ width: "100%", minHeight: "72px", fontFamily: "inherit", fontSize: "12px" }}
                      value={b.body ?? ""}
                      placeholder={`${b.label}…`}
                      onInput={(e: any) => setBg(b.key, e.target.value)} />
                  ) : (
                    b.body
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {!editing && !visibleBlocks.length && (
          <div style={{ color: "var(--ink-mute)", fontStyle: "italic" }}>暂无背景信息</div>
        )}
      </div>
    </div>
  );
}

function InventorySection({ data }: { data: CharacterData }) {
  const { editing, onPatch } = useEdit();
  const inv = data.inventory || {};
  const w = inv.currency?.wallet || {};
  const enc = inv.encumbrance || {};
  const items: any[] = Array.isArray(inv.items) ? inv.items : [];
  // Wondrous items (奇物) — new schema field, ships when present.
  const wondrous: any[] = Array.isArray(inv.wondrous_items) ? inv.wondrous_items : [];

  // 2026-05-14 (#14) — inventory edit helpers.
  const setWallet = (k: "pp" | "gp" | "ep" | "sp" | "cp", v: number) => {
    const currency = inv.currency || {};
    const wallet = { ...(currency.wallet || {}), [k]: v };
    onPatch({ inventory: { ...inv, currency: { ...currency, wallet } } });
  };
  const updateItem = (idx: number, patch: Record<string, any>) => {
    const next = [...items];
    next[idx] = { ...next[idx], ...patch };
    onPatch({ inventory: { ...inv, items: next } });
  };
  const removeItem = (idx: number) => {
    if (!window.confirm(`删除「${items[idx]?.name || "未命名"}」？`)) return;
    const next = items.filter((_, i) => i !== idx);
    onPatch({ inventory: { ...inv, items: next } });
  };
  const addItem = (ev?: Event) => {
    const next = [...items, { name: "新物品", weight: null, location: "", description: "" }];
    onPatch({ inventory: { ...inv, items: next } });
    smoothScrollToNewRow(ev, ".weap");
  };
  // Wondrous items reuse the FeatureBlock add/remove pattern via the
  // same data shape (name + description). Slot is on inv directly.
  const addWondrous = (_slot?: string, ev?: Event) => {
    const next = [...wondrous, { name: "新奇物", description: "" }];
    onPatch({ inventory: { ...inv, wondrous_items: next } });
    smoothScrollToNewRow(ev, ".feat");
  };
  const removeWondrous = (_slot: string, idx: number) => {
    if (!window.confirm(`删除「${wondrous[idx]?.name || "未命名"}」？`)) return;
    const next = wondrous.filter((_, i) => i !== idx);
    onPatch({ inventory: { ...inv, wondrous_items: next } });
  };
  const patchWondrous = (_slot: string, idx: number, patch: Record<string, any>) => {
    const next = [...wondrous];
    next[idx] = { ...next[idx], ...patch };
    onPatch({ inventory: { ...inv, wondrous_items: next } });
  };

  const editNum = (label: string, key: "pp" | "gp" | "ep" | "sp" | "cp", cls: string) => (
    <div class={`coin ${cls}`}>
      <div class="coin-name">{label}</div>
      <div class="coin-val">
        {editing ? (
          <input class="cc-edit-num" type="number"
            style={{ width: "60px", textAlign: "center" }}
            value={(w as any)[key] ?? 0}
            onInput={(e: any) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) setWallet(key, n);
            }} />
        ) : (
          (w as any)[key] ?? 0
        )}
      </div>
    </div>
  );

  return (
    <div class="sec">
      <div class="sec-h">
        <span class="sec-h-title">装备 · 货币 · 负重</span>
        {!editing && inv.currency?.total_gp_raw && <span class="sec-h-meta">总值 {inv.currency.total_gp_raw}</span>}
        {editing && (
          <button class="cc-add-tag" style={{ marginLeft: "auto" }} onClick={(e: any) => addItem(e)} title="新增物品">+ 物品</button>
        )}
      </div>
      <div class="sec-body">
        <div class="coin-row">
          {editNum("铂PP", "pp", "pp")}
          {editNum("金GP", "gp", "gp")}
          {editNum("银EP", "ep", "ep")}
          {editNum("铜SP", "sp", "sp")}
          {editNum("铜CP", "cp", "cp")}
        </div>

        {(enc.equipment_weight != null || enc.total_weight != null) && (
          <div style={{ marginBottom: "10px" }}>
            <div class="bio-block-h" style={{ marginBottom: "5px" }}>负重</div>
            <div class="enc-bar">
              <div class="enc-cell">装备 <div class="v">{enc.equipment_weight ?? 0}</div></div>
              <div class="enc-cell">背包 <div class="v">{(enc.pack1_weight ?? 0) + (enc.pack2_weight ?? 0)}</div></div>
              <div class="enc-cell">总计 <div class="v">{enc.total_weight ?? 0}</div></div>
              <div class="enc-cell">上限 <div class="v">{enc.max_capacity ?? "?"}</div></div>
            </div>
          </div>
        )}

        {(editing || !!wondrous.length) && (
          <FeatureBlock
            title="奇物 / 魔法物品"
            items={wondrous}
            slot={editing ? "wondrous_items" : undefined}
            onAdd={editing ? addWondrous : undefined}
            onRemove={editing ? removeWondrous : undefined}
            onPatchItem={editing ? patchWondrous : undefined} />
        )}

        {!editing && items.length === 0 && !wondrous.length && (
          <div style={{ color: "var(--ink-mute)", fontStyle: "italic", padding: "6px 0" }}>
            （暂无背包细目，可在 xlsx 角色卡 "背包1/2" 表更新）
          </div>
        )}
        {(editing || !!items.length) && (
          <div style={{ marginTop: "8px" }}>
            <div class="bio-block-h" style={{ marginBottom: "5px" }}>背包</div>
            {items.map((it: any, idx: number) => {
              if (editing) {
                return (
                  <div class="weap" style={{ display: "grid", gridTemplateColumns: "1.4fr 0.6fr 0.8fr auto", gap: "6px", alignItems: "center" }}>
                    <input class="cc-edit-text" type="text"
                      value={it.name ?? ""}
                      placeholder="物品名"
                      onInput={(e: any) => updateItem(idx, { name: e.target.value })} />
                    <input class="cc-edit-text" type="text"
                      value={it.weight ?? ""}
                      placeholder="重量"
                      onInput={(e: any) => {
                        const v = e.target.value;
                        updateItem(idx, { weight: v === "" ? null : parseFloat(v) });
                      }} />
                    <input class="cc-edit-text" type="text"
                      value={it.location ?? ""}
                      placeholder="位置"
                      onInput={(e: any) => updateItem(idx, { location: e.target.value })} />
                    <button class="cc-tag-x" onClick={() => removeItem(idx)} title="删除">×</button>
                  </div>
                );
              }
              return (
                <div class="weap">
                  <div class="weap-name">{it.name || "?"}</div>
                  <div class="weap-atk" style={{ visibility: "hidden" }}>—</div>
                  <div class="weap-dmg" style={{ background: "transparent", border: "0", color: "var(--ink-dim)" }}>
                    {it.weight != null ? `${it.weight} 磅` : ""} {it.location ? `· ${it.location}` : ""}
                  </div>
                  {it.description && <div class="weap-props">{it.description}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Main app ==============================================
function App() {
  const [data, setData] = useState<CharacterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  // 2026-05-15 — split-pane secondary tab. Null = single-pane mode.
  // On wide viewports (>= 1400 px), the "⇆ 并排" toggle in the tab
  // strip opens a second pane next to the primary, each showing a
  // different tab and scrolling independently. Below 1400 px the
  // resize listener forces this back to null + CSS hides the toggle,
  // so narrow screens always see a single pane.
  const [tab2, setTab2] = useState<TabKey | null>(null);
  const [isWide, setIsWide] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 1400px)").matches,
  );
  // 2026-05-14 (#14) — edit-mode flag, toggled from the header.
  const [editing, setEditing] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
  const roomId = getQS("room") || "";
  const cardId = getQS("card") || "";

  const loadData = useCallback(async () => {
    if (!roomId || !cardId) {
      setError("URL 缺少 room 或 card 参数");
      return;
    }
    setError(null);
    try {
      const res = await fetch(
        `${SERVER_ORIGIN}/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data.json`,
        { cache: "no-cache" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(normalizeCombatGearFlags(json));
    } catch (e: any) {
      setError(`加载失败：${e?.message || String(e)}`);
    }
  }, [roomId, cardId]);

  useEffect(() => { void loadData(); }, [loadData]);

  // 2026-05-15 — wide-screen tracker for split-pane mode. Below the
  // 1400 px breakpoint the secondary pane is forcibly closed so the
  // narrow CSS path (single column, full-width tab strip) stays clean
  // even if the user happened to have tab2 set on a previously-wider
  // window. Removed on unmount so the listener doesn't leak across
  // hot-module-replacement reloads in dev.
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1400px)");
    const handler = (e: MediaQueryListEvent) => {
      setIsWide(e.matches);
      if (!e.matches) setTab2(null);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Multi-client sync — when another client imports / refreshes this
  // same card, BC_CARD_UPDATED arrives on REMOTE; we re-fetch
  // data.json so the open fullscreen panel reflects the change live
  // (no manual refresh button click).
  useEffect(() => {
    if (!cardId) return;
    const unsub = OBR.broadcast.onMessage(BC_CARD_UPDATED, (event) => {
      const payload = event.data as { cardId?: string } | undefined;
      if (payload?.cardId !== cardId) return;
      void loadData();
    });
    return unsub;
  }, [cardId, loadData]);

  // Patch handler — updates local state AND propagates HP / AC edits
  // to the bound token(s)' bubbles metadata so the HP-bar overlay on
  // canvas reflects the change in real time.
  //
  // 2026-05-10 fix: previously the fullscreen edit path only updated
  // local in-iframe state, so the bubbles plugin (which reads OBR
  // scene metadata) showed stale data — user reported "血条数据错了，
  // 还在使用 Stat Bubbles 的元数据". The propagation step finds every
  // token in the scene whose `com.character-cards/boundCardId` equals
  // this card's id and calls `patchBubbles` for each, which writes
  // through the upstream-compat key (`health` / `max health` / etc.)
  // that the bubbles renderer already listens to.
  const onPatch = useCallback((patch: Partial<CharacterData>) => {
    setData((prev) => prev ? normalizeCombatGearFlags({ ...prev, ...patch }) : prev);
    // Translate `core_stats.hp.* / .ac` deltas into the bubbles patch
    // shape and push to OBR. Nothing to do if the patch doesn't touch
    // core_stats — saves a scene-items query on every keystroke that
    // edits unrelated fields.
    const cs = (patch as any)?.core_stats;
    if (!cs || typeof cs !== "object") return;
    const bubblesPatch: Record<string, unknown> = {};
    if (cs.hp && typeof cs.hp === "object") {
      if (typeof cs.hp.current === "number") bubblesPatch["health"] = cs.hp.current;
      if (typeof cs.hp.max === "number")     bubblesPatch["max health"] = cs.hp.max;
      if (typeof cs.hp.temp === "number")    bubblesPatch["temporary health"] = cs.hp.temp;
    }
    if (typeof cs.ac === "number") bubblesPatch["armor class"] = cs.ac;
    if (Object.keys(bubblesPatch).length === 0) return;
    void (async () => {
      try {
        const items = await OBR.scene.items.getItems(
          (it: any) =>
            (it.metadata as Record<string, unknown> | undefined)?.[BIND_META_KEY] === cardId,
        );
        await Promise.all(items.map((it) => patchBubbles(it.id, bubblesPatch)));
      } catch (e) {
        console.warn("[cc-fullscreen] bubbles propagate failed", e);
      }
    })();
  }, [cardId]);

  const onExport = useCallback(() => {
    if (!data) return;
    const id = data.identity || {};
    const name = id.display_name || id.character_name || "character";
    downloadJson(`${name}-${cardId.slice(0,6)}.json`, data);
  }, [data, cardId]);

  // 2026-05-15 — refresh handler. ALSO broadcasts BC_CARD_UPDATED so
  // the small cc-info popover (on this client AND every other client
  // in the room) drops its cache and re-fetches. Without the
  // broadcast, the user reported "刷新只刷新大面板，小面板还是旧数据"
  // — the small panel doesn't know fresh data.json is available.
  const onRefresh = useCallback(async () => {
    await loadData();
    try {
      if (cardId) {
        const updatedPayload = {
          cardId,
          url: `${SERVER_ORIGIN}/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/`,
        };
        OBR.broadcast.sendMessage(BC_CARD_UPDATED, updatedPayload, { destination: "LOCAL" });
        OBR.broadcast.sendMessage(BC_CARD_UPDATED, updatedPayload, { destination: "REMOTE" });
      }
    } catch (e) {
      console.warn("[cc-fullscreen] refresh broadcast failed", e);
    }
  }, [loadData, roomId, cardId]);


  // 2026-05-14 — copy-to-clipboard variant of export. Same JSON shape
  // as the file download, just lands in the clipboard so the user can
  // paste it directly into the paste-import modal on another card /
  // session / xlsx 主要!AV1 formula etc. Falls back to a
  // hidden-textarea + document.execCommand path on browsers that
  // don't expose navigator.clipboard inside an iframe.
  const onCopyJson = useCallback(async () => {
    if (!data) return;
    const text = JSON.stringify(data, null, 2);
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {}
    if (!ok) {
      // Fallback: legacy execCommand. Requires a focused element so we
      // attach a textarea to the DOM briefly.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { ok = document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    // Lightweight toast — reuses the existing alert pattern from
    // processImportFiles. Could be upgraded to an inline banner.
    if (ok) {
      window.alert(`已复制角色卡 JSON 到剪贴板（${text.length} 字符）。可粘贴到另一张卡的「粘贴 JSON」或 xlsx 主要!AV1 公式里。`);
    } else {
      window.alert("复制到剪贴板失败 — 请用「导出 JSON」下载文件后手动打开复制。");
    }
  }, [data]);

  const onImport = useCallback(() => {
    const inp = document.getElementById("ccFileInput") as HTMLInputElement | null;
    if (!inp) return;
    inp.value = "";
    inp.onchange = async () => {
      const files = inp.files ? Array.from(inp.files) : [];
      if (files.length === 0) return;
      await processImportFiles(files);
    };
    inp.click();
  }, [roomId, cardId]);

  // 2026-05-14 — paste-import dialog state. The header's 粘贴 JSON
  // button toggles `pasteOpen`; the modal contains a textarea and an
  // Apply button. Apply parses the text, validates the shape, and
  // routes through the SAME server PUT / broadcast pipeline that
  // file-import uses (so bound tokens get the new stats propagated
  // automatically via BC_CARD_UPDATED).
  const [pasteOpen, setPasteOpen] = useState(false);
  const onPasteJson = useCallback(() => { setPasteOpen(true); }, []);

  // Shared apply path — called by both the file import and the
  // paste-text modal. `source` is for the result alert message.
  const applyJsonObject = useCallback(async (parsed: any, source: string): Promise<string> => {
    if (!parsed || typeof parsed !== "object" || !("abilities" in parsed || "identity" in parsed)) {
      return `✕ ${source} (不像角色卡 JSON，缺少 identity / abilities 字段)`;
    }
    setData(normalizeCombatGearFlags(parsed));
    try {
      const url = `${SERVER_ORIGIN}/api/character/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        const body = await res.text();
        return `⚠ ${source} (本地预览，服务器保存失败 HTTP ${res.status}: ${body.slice(0, 120)})`;
      }
      const result = await res.json();
      try {
        const updatedPayload = {
          cardId,
          url: `${SERVER_ORIGIN}/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/`,
        };
        OBR.broadcast.sendMessage(BC_CARD_UPDATED, updatedPayload, { destination: "LOCAL" });
        OBR.broadcast.sendMessage(BC_CARD_UPDATED, updatedPayload, { destination: "REMOTE" });
      } catch {}
      let msg = `✓ ${source} → ${result.name || "current card"}`;
      if (result.render_warning) msg += `\n  (旧版 HTML 渲染告警：${result.render_warning})`;
      return msg;
    } catch (e: any) {
      return `⚠ ${source} (服务器保存失败: ${e?.message || String(e)})`;
    }
  }, [roomId, cardId]);

  // 2026-05-10: multi-file import. Each file is dispatched by
  // extension:
  //   .json   → PUT to /data on a card. The FIRST json updates the
  //             current card (matches the legacy single-import flow);
  //             subsequent jsons need a destination, so we surface
  //             them in the summary as "skipped — already imported
  //             current card".
  //   .xlsx   → POST to /upload (creates a new card with the room).
  //             Multiple xlsx → multiple new cards, sequentially.
  // The summary alert at the end reports per-file outcomes.
  const processImportFiles = useCallback(async (files: File[]) => {
    const summary: string[] = [];
    let currentJsonImported = false;

    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith(".json")) {
        if (currentJsonImported) {
          summary.push(`⏭ ${f.name} (跳过 — 已导入当前卡，多个 JSON 无法批量替换)`);
          continue;
        }
        try {
          const text = await f.text();
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== "object" || !("abilities" in parsed || "identity" in parsed)) {
            summary.push(`✕ ${f.name} (不像角色卡 JSON，缺少 identity / abilities 字段)`);
            continue;
          }
          setData(normalizeCombatGearFlags(parsed));
          try {
            const url = `${SERVER_ORIGIN}/api/character/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data`;
            const res = await fetch(url, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(parsed),
            });
            if (!res.ok) {
              const body = await res.text();
              summary.push(`⚠ ${f.name} (本地预览，服务器保存失败 HTTP ${res.status}: ${body.slice(0, 120)})`);
            } else {
              const result = await res.json();
              try {
                // 2026-05-14 — also broadcast LOCAL so the SAME client's
                // background module catches this and propagates to bound
                // tokens (max HP / AC / dex-mod). Without LOCAL, only
                // remote clients see the stat propagation; the importing
                // user would still need to re-bind to apply.
                const updatedPayload = {
                  cardId,
                  url: `${SERVER_ORIGIN}/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/`,
                };
                OBR.broadcast.sendMessage(BC_CARD_UPDATED, updatedPayload, { destination: "LOCAL" });
                OBR.broadcast.sendMessage(BC_CARD_UPDATED, updatedPayload, { destination: "REMOTE" });
              } catch {}
              summary.push(`✓ ${f.name} → ${result.name || "current card"}`);
              if (result.render_warning) {
                summary.push(`  (旧版 HTML 渲染告警：${result.render_warning})`);
              }
            }
          } catch (e: any) {
            summary.push(`⚠ ${f.name} (服务器保存失败: ${e?.message || String(e)})`);
          }
          currentJsonImported = true;
        } catch (e: any) {
          summary.push(`✕ ${f.name} (JSON 解析失败: ${e?.message || String(e)})`);
        }
      } else if (lower.endsWith(".xlsx")) {
        // POST /upload — same endpoint as cc-panel's xlsx upload
        // path. Creates a new card. We don't have the player name
        // here (it lives in cc-panel state), so use "fullscreen-import"
        // as the uploader label.
        try {
          const fd = new FormData();
          fd.append("file", f);
          const u = encodeURIComponent("fullscreen-import");
          const r = await fetch(
            `${SERVER_ORIGIN}/api/character/upload?room=${encodeURIComponent(roomId)}&uploader=${u}`,
            { method: "POST", body: fd },
          );
          if (!r.ok) {
            const body = await r.text();
            summary.push(`✕ ${f.name} (xlsx 上传失败 HTTP ${r.status}: ${body.slice(0, 120)})`);
          } else {
            const entry = await r.json();
            try {
              const corrected = await reconcileUploadedCardShieldState({
                apiBase: `${SERVER_ORIGIN}/api/character`,
                roomId,
                cardId: entry.id,
                xlsx: f,
              });
              if (corrected) {
                try {
                  const reconcilePayload = {
                    cardId: entry.id,
                    url: `${SERVER_ORIGIN}/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(entry.id)}/`,
                  };
                  OBR.broadcast.sendMessage(BC_CARD_UPDATED, reconcilePayload, { destination: "LOCAL" });
                  OBR.broadcast.sendMessage(BC_CARD_UPDATED, reconcilePayload, { destination: "REMOTE" });
                } catch {}
              }
            } catch (e: any) {
              summary.push(`⚠ ${f.name} (盾牌着装纠偏失败: ${e?.message || String(e)})`);
            }
            summary.push(`✓ ${f.name} → 新卡 "${entry.name}"`);
          }
        } catch (e: any) {
          summary.push(`✕ ${f.name} (xlsx 上传失败: ${e?.message || String(e)})`);
        }
      } else {
        summary.push(`✕ ${f.name} (不支持的扩展名 — 仅支持 .json / .xlsx)`);
      }
    }

    window.alert(
      `导入结果（${files.length} 个文件）：\n\n${summary.join("\n")}` +
      `\n\n（其他客户端会自动刷新已存在的卡片；新建的卡片需要他们刷新一下面板列表。）`,
    );
  }, [roomId, cardId]);

  // 2026-05-10: drag-drop multi-file import. Drop anywhere on the
  // fullscreen view to trigger processImportFiles. dragOver suppresses
  // the default "open file in browser" behaviour.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = async (e: DragEvent) => {
      const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
      if (files.length === 0) return;
      e.preventDefault();
      await processImportFiles(files);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [processImportFiles]);

  // 2026-05-14 (#14 f2) — the no-card states (error / loading) render
  // a translucent navy panel instead of the solid one, so the OBR
  // canvas reads through behind it. `cc-translucent` on the surface
  // div + the body staying transparent (see CSS) achieves the
  // "same blue, more see-through" look the user asked for. The
  // loaded panel keeps its solid background for sheet legibility.
  if (error) {
    return <div class="cc-error cc-translucent">{error}</div>;
  }
  if (!data) {
    return <div class="cc-loading cc-translucent">加载角色卡…</div>;
  }

  return (
    <EditCtx.Provider value={{ editing, data, onPatch }}>
      <Header
        data={data}
        onExport={onExport}
        onCopyJson={onCopyJson}
        onImport={onImport}
        onPasteJson={onPasteJson}
        onRefresh={onRefresh}
        editing={editing}
        onToggleEditing={() => setEditing((v) => !v)}
        savingEdits={savingEdits}
        onSaveEdits={async () => {
          if (savingEdits || !data) return;
          setSavingEdits(true);
          try {
            const result = await applyJsonObject(data, "已保存的编辑");
            if (!result.startsWith("✓")) {
              window.alert(result);
            }
          } finally {
            setSavingEdits(false);
          }
        }}
      />
      {pasteOpen && (
        <PasteJsonModal
          onCancel={() => setPasteOpen(false)}
          onApply={async (text) => {
            // Try parse first; abort the modal close on parse failure so
            // the user can fix without retyping.
            let parsed: any;
            try {
              parsed = JSON.parse(text);
            } catch (e: any) {
              return `✕ JSON 解析失败：${e?.message || String(e)}`;
            }
            const result = await applyJsonObject(parsed, "粘贴文本");
            // Close on success, keep open on warning/error so user sees msg.
            if (result.startsWith("✓")) {
              setPasteOpen(false);
              window.alert(result);
              return null;
            }
            return result;
          }}
        />
      )}
      <StatsBanner data={data} onPatch={onPatch} />
      <div class="cc-tabs">
        {TABS.map((t) => (
          <button
            class={`cc-tab ${tab === t.key ? "is-on" : ""} ${tab2 === t.key ? "is-on-2" : ""}`}
            onClick={(e: any) => {
              // 2026-05-15 — split-pane interaction model:
              //   Shift+click on wide screen → open as secondary (or
              //   if it IS the secondary, close it).
              //   Plain click → always becomes primary; if it was
              //   the secondary, also clear the secondary so the
              //   two panes don't end up showing the same tab.
              if (isWide && e.shiftKey) {
                setTab2((cur) => (cur === t.key ? null : t.key));
                return;
              }
              setTab(t.key);
              if (tab2 === t.key) setTab2(null);
            }}
            title={isWide ? `${t.label}（Shift+点击 = 并排打开为第二面板）` : t.label}>
            {t.label}
          </button>
        ))}
        {isWide && (
          <button
            class={`cc-tab-split-toggle ${tab2 ? "is-on" : ""}`}
            onClick={() => {
              if (tab2) { setTab2(null); return; }
              // Open the NEXT tab in the strip as the secondary — a
              // sensible default for one-click "show me two tabs".
              const idx = TABS.findIndex((t) => t.key === tab);
              const next = TABS[(idx + 1) % TABS.length].key;
              setTab2(next);
            }}
            title={tab2 ? "关闭并排显示" : "并排显示两个标签 — 也可 Shift+点击任意标签"}>
            ⇆ 并排
          </button>
        )}
      </div>
      <div class={`cc-body ${tab2 ? "is-split" : ""}`}>
        <div class="cc-pane">
          {tab2 && (
            <div class="cc-pane-label">
              <span class="cc-pane-dot"></span>
              {TABS.find((t) => t.key === tab)?.label}
            </div>
          )}
          {renderTabSection(tab, data)}
        </div>
        {tab2 && (
          <div class="cc-pane cc-pane-2">
            <div class="cc-pane-label">
              <span class="cc-pane-dot"></span>
              {TABS.find((t) => t.key === tab2)?.label}
              <button class="cc-pane-close" onClick={() => setTab2(null)}
                title="关闭第二面板">×</button>
            </div>
            {renderTabSection(tab2, data)}
          </div>
        )}
      </div>
    </EditCtx.Provider>
  );
}

// 2026-05-15 — section dispatch helper. Extracted so both the primary
// and secondary panes can share the same switch without duplicating
// JSX between them.
function renderTabSection(key: TabKey, data: CharacterData) {
  switch (key) {
    case "overview":
      // 2026-05-14 (#14 f3) — overview layout per user spec:
      //   left column  : 属性·豁免·技能 (tall)
      //   right column : 防御·语言·工具 + 战斗·武器·护甲 (stacked)
      //   full width   : 装备·货币·负重
      return (
        <>
          <div class="cc-grid">
            <AbilitiesAndSkills data={data} />
            <div>
              <Defenses data={data} />
              <CombatSection data={data} />
            </div>
          </div>
          <InventorySection data={data} />
        </>
      );
    case "spells":     return <SpellsSection data={data} />;
    case "features":   return <FeaturesSection data={data} />;
    case "background": return <BackgroundSection data={data} />;
  }
}

const appEl = document.getElementById("app");
if (appEl) {
  // Subscribe to dice SFX broadcasts so click-to-roll plays sound
  // even though this iframe normally doesn't have audio context warmed.
  try { subscribeToSfx(); } catch {}
  render(<App />, appEl);
}
