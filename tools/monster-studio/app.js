// Monster Studio — editor logic.
//
// Page 1 of the studio: import / edit / export the suite's custom
// monster format (5etools-shape objects). The raw JSON textarea is
// the source of truth; the quick-edit form and section rows are
// convenience views that mutate the same objects. The right pane
// re-renders the stat-block on every change (replicates the OBR
// bestiary monster-info popover).

import { renderStatBlock, flattenEntries } from "./statblock.js";

// ---- constants -------------------------------------------------------------
const ABIL_ORDER = ["str", "dex", "con", "int", "wis", "cha"];
const ABIL_CN = { str: "力量", dex: "敏捷", con: "体质", int: "智力", wis: "感知", cha: "魅力" };
const ARRAY_FIELDS = ["senses", "languages", "resist", "immune", "vulnerable", "conditionImmune"];
const SECTIONS = [
  { key: "trait",     label: "✦ 特性 trait",        cls: "trait" },
  { key: "action",    label: "⚔ 动作 action",       cls: "action" },
  { key: "bonus",     label: "⚡ 附赠动作 bonus",    cls: "bonus" },
  { key: "reaction",  label: "🛡 反应 reaction",     cls: "reaction" },
  { key: "legendary", label: "★ 传说动作 legendary", cls: "legendary" },
];

// ---- DOM refs --------------------------------------------------------------
const fileInput     = document.getElementById("fileInput");
const importBtn     = document.getElementById("importBtn");
const exportBtn     = document.getElementById("exportBtn");
const newBtn        = document.getElementById("newBtn");
const sampleBtn     = document.getElementById("sampleBtn");
const monsterPicker = document.getElementById("monsterPicker");
const monsterSelect = document.getElementById("monsterSelect");
const statusEl      = document.getElementById("status");
const formCard      = document.getElementById("formCard");
const abilGrid      = document.getElementById("abilGrid");
const sectionsCard  = document.getElementById("sectionsCard");
const sectionsHost  = document.getElementById("sectionsHost");
const rawCard       = document.getElementById("rawCard");
const rawDetails    = document.getElementById("rawDetails");
const jsonArea      = document.getElementById("jsonArea");
const previewMount  = document.getElementById("previewMount");

// ---- state -----------------------------------------------------------------
// doc      — the parsed top-level value (wrapped {monster:[]} / bare [] / single {})
// kind     — "wrapped" | "array" | "single"; decides export shape
// monsters — array of monster objects, references INTO doc
const state = { doc: null, kind: "single", monsters: [], activeIndex: 0 };

const activeMonster = () => state.monsters[state.activeIndex];

// ---- small helpers ---------------------------------------------------------
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function abilMod(score) { return Math.floor((Number(score) - 10) / 2); }
function fmtMod(n) { return n >= 0 ? `+${n}` : `${n}`; }
function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = "toolbar-status" + (cls ? " " + cls : "");
}

// ---- doc parse / serialize -------------------------------------------------
function parseDoc(text) {
  const data = JSON.parse(text);
  if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.monster)) {
    if (data.monster.length === 0) throw new Error("monster 数组为空");
    return { kind: "wrapped", doc: data, monsters: data.monster };
  }
  if (Array.isArray(data)) {
    if (data.length === 0) throw new Error("数组为空");
    return { kind: "array", doc: data, monsters: data };
  }
  if (data && typeof data === "object") {
    return { kind: "single", doc: data, monsters: [data] };
  }
  throw new Error("无法识别的 JSON 结构");
}
function serializeDoc() {
  return JSON.stringify(state.doc, null, 2);
}

// ---- value <-> input string converters ------------------------------------
function acToInput(ac) {
  if (ac == null) return "";
  if (typeof ac === "number") return String(ac);
  if (Array.isArray(ac) && ac.length) {
    const f = ac[0];
    if (typeof f === "number") return String(f);
    if (f && typeof f === "object" && "ac" in f) {
      const from = Array.isArray(f.from) && f.from.length ? `（${f.from.join("、")}）` : "";
      return `${f.ac}${from}`;
    }
  }
  return "";
}
function parseAcInput(str) {
  str = String(str).trim();
  if (/^\d+$/.test(str)) return Number(str);
  const m = /^(\d+)\s*[（(]\s*(.+?)\s*[）)]\s*$/.exec(str);
  if (m) return [{ ac: Number(m[1]), from: m[2].split(/[、,，]/).map((s) => s.trim()).filter(Boolean) }];
  const n = /(\d+)/.exec(str);
  if (n) return [{ ac: Number(n[1]) }];
  return str;
}
function hpToInput(hp) {
  if (hp == null) return "";
  if (typeof hp === "number") return String(hp);
  if (typeof hp === "object") {
    if (typeof hp.average === "number") return hp.formula ? `${hp.average}, ${hp.formula}` : String(hp.average);
    if (hp.special != null) return String(hp.special);
  }
  return "";
}
function parseHpInput(str) {
  str = String(str).trim();
  if (/^\d+$/.test(str)) return { average: Number(str) };
  const m = /^(\d+)\s*[,，（(]\s*(.+?)\s*[）)]?\s*$/.exec(str);
  if (m) return { average: Number(m[1]), formula: m[2].trim() };
  const n = /(\d+)/.exec(str);
  if (n) return { average: Number(n[1]) };
  return { special: str };
}
function skillToInput(skill) {
  if (!skill || typeof skill !== "object") return "";
  return Object.entries(skill).map(([k, v]) => `${k}:${v}`).join(", ");
}
function parseSkillInput(raw) {
  const obj = {};
  for (const part of String(raw).split(/[,，]/)) {
    const t = part.trim();
    if (!t) continue;
    const m = /^(.+?)\s*[:：]\s*(.+)$/.exec(t);
    if (m) obj[m[1].trim()] = m[2].trim();
  }
  return obj;
}
function dmgFlat(x) {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    const inner = x.resist || x.immune || x.vulnerable;
    if (Array.isArray(inner)) {
      const note = x.note ? ` ${x.note}` : "";
      return inner.map(dmgFlat).join("、") + note;
    }
  }
  return "";
}
function listToInput(arr) {
  if (!Array.isArray(arr)) return "";
  return arr.map(dmgFlat).filter(Boolean).join("、");
}
function splitList(raw) {
  return String(raw).split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
}
// Array-of-strings round-trips via newlines; nested entries flatten (lossy —
// raw JSON is the escape hatch for complex {entries:[{type:...}]} shapes).
function entriesToText(entries) {
  if (Array.isArray(entries) && entries.every((e) => typeof e === "string")) {
    return entries.join("\n");
  }
  return flattenEntries(entries);
}
function textToEntries(value) {
  return String(value).split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

// ---- field read (state -> form input) -------------------------------------
function fieldToInput(f, m) {
  if (f.startsWith("speed.")) {
    const key = f.slice(6);
    const sp = m.speed;
    if (sp == null) return "";
    if (typeof sp === "number") return key === "walk" ? String(sp) : "";
    if (typeof sp !== "object") return "";
    const v = sp[key];
    if (v == null) return "";
    return typeof v === "object" ? String(v.number ?? "") : String(v);
  }
  if (f === "ac") return acToInput(m.ac);
  if (f === "hp") return hpToInput(m.hp);
  if (f === "cr") {
    const cr = m.cr;
    if (cr == null) return "";
    return typeof cr === "object" ? String(cr.cr ?? "") : String(cr);
  }
  if (f === "size") {
    if (Array.isArray(m.size)) return m.size[0] || "";
    return m.size || "";
  }
  if (f === "type") {
    const t = m.type;
    if (t == null) return "";
    return typeof t === "object" ? String(t.type ?? "") : String(t);
  }
  if (f === "passive") return m.passive == null ? "" : String(m.passive);
  if (f === "skill") return skillToInput(m.skill);
  if (ARRAY_FIELDS.includes(f)) return listToInput(m[f]);
  return m[f] == null ? "" : String(m[f]);
}

// ---- field write (form input -> state) ------------------------------------
function applyField(f, raw) {
  const m = activeMonster();
  if (!m) return;
  const trimmed = String(raw).trim();
  if (f.startsWith("speed.")) {
    const key = f.slice(6);
    if (!m.speed || typeof m.speed !== "object") m.speed = {};
    if (trimmed === "") delete m.speed[key];
    else m.speed[key] = Number(trimmed);
    if (Object.keys(m.speed).length === 0) delete m.speed;
  } else if (f === "ac") {
    if (trimmed === "") delete m.ac; else m.ac = parseAcInput(raw);
  } else if (f === "hp") {
    if (trimmed === "") delete m.hp; else m.hp = parseHpInput(raw);
  } else if (f === "cr") {
    if (trimmed === "") delete m.cr; else m.cr = trimmed;
  } else if (f === "size") {
    if (trimmed === "") delete m.size; else m.size = trimmed;
  } else if (f === "type") {
    if (trimmed === "") delete m.type; else m.type = trimmed;
  } else if (f === "passive") {
    if (trimmed === "") delete m.passive; else m.passive = Number(trimmed);
  } else if (f === "skill") {
    const obj = parseSkillInput(raw);
    if (Object.keys(obj).length) m.skill = obj; else delete m.skill;
  } else if (ARRAY_FIELDS.includes(f)) {
    const arr = splitList(raw);
    if (arr.length) m[f] = arr; else delete m[f];
  } else {
    if (trimmed === "") delete m[f]; else m[f] = raw;
  }
  renderJson();
  renderPreview();
}
function applyScore(abil, raw) {
  const m = activeMonster();
  if (!m) return;
  m[abil] = raw === "" ? 10 : Number(raw);
  const modEl = abilGrid.querySelector(`[data-mod="${abil}"]`);
  if (modEl) modEl.textContent = fmtMod(abilMod(m[abil]));
  renderJson();
  renderPreview();
}
function applySave(abil, raw) {
  const m = activeMonster();
  if (!m) return;
  if (!m.save || typeof m.save !== "object") m.save = {};
  if (String(raw).trim() === "") delete m.save[abil];
  else m.save[abil] = String(raw).trim();
  if (Object.keys(m.save).length === 0) delete m.save;
  renderJson();
  renderPreview();
}

// ---- renderers -------------------------------------------------------------
function showEditor() {
  formCard.hidden = false;
  sectionsCard.hidden = false;
  rawCard.hidden = false;
}
function renderPicker() {
  if (state.monsters.length > 1) {
    monsterPicker.hidden = false;
    monsterSelect.innerHTML = state.monsters
      .map((m, i) => `<option value="${i}">${i + 1}. ${esc(m.name || m.ENG_name || "未命名")}</option>`)
      .join("");
    monsterSelect.value = String(state.activeIndex);
  } else {
    monsterPicker.hidden = true;
  }
}
function renderForm() {
  const m = activeMonster() || {};
  for (const el of formCard.querySelectorAll("[data-field]")) {
    el.value = fieldToInput(el.dataset.field, m);
  }
  syncSizeChips();
  renderAbilGrid();
}
// 体型 is a chip selector (single-select), not a <select>.
function syncSizeChips() {
  const cur = fieldToInput("size", activeMonster() || {});
  for (const chip of formCard.querySelectorAll("[data-size-chip]")) {
    chip.classList.toggle("on", chip.dataset.sizeChip === cur);
  }
}
function renderAbilGrid() {
  const m = activeMonster() || {};
  abilGrid.innerHTML = ABIL_ORDER.map((k) => {
    const score = typeof m[k] === "number" ? m[k] : 10;
    const saveRaw = m.save && m.save[k] != null ? m.save[k] : "";
    return `<div class="abil-cell">
      <span class="ac-k">${ABIL_CN[k]}</span>
      <div class="ac-row score-row">
        <input type="number" data-abil="${k}" value="${esc(score)}">
        <span class="ac-mod" data-mod="${k}">${fmtMod(abilMod(score))}</span>
      </div>
      <div class="ac-row save-row">
        <span class="ac-tag">豁免</span>
        <input type="text" data-save="${k}" value="${esc(saveRaw)}" placeholder="—">
      </div>
    </div>`;
  }).join("");
}
function renderSections() {
  const m = activeMonster() || {};
  sectionsHost.innerHTML = SECTIONS.map((s) => {
    const list = Array.isArray(m[s.key]) ? m[s.key] : [];
    const rows = list.map((entry, i) => {
      const name = entry && entry.name ? entry.name : "";
      const text = entriesToText(entry && entry.entries);
      return `<div class="sect-row" data-sect="${s.key}" data-idx="${i}">
        <div class="sect-row-top">
          <input class="sr-name" type="text" value="${esc(name)}" placeholder="名称">
          <button class="sr-del" title="删除" aria-label="删除">✕</button>
        </div>
        <textarea class="sr-text" placeholder="描述（每段一行；保留 {@tag ...} 写法）">${esc(text)}</textarea>
      </div>`;
    }).join("");
    return `<div class="sect-block">
      <div class="sect-block-head">
        <span class="sect-block-title ${s.cls}">${s.label}</span>
        <span class="sect-block-count">${list.length} 条</span>
      </div>
      <div class="sect-rows">${rows}</div>
      <button class="sect-add" data-add="${s.key}">+ 添加条目</button>
    </div>`;
  }).join("");
}
function renderJson() {
  jsonArea.value = serializeDoc();
  jsonArea.classList.remove("err");
}
function renderPreview() {
  const m = activeMonster();
  previewMount.innerHTML = m
    ? renderStatBlock(m)
    : `<div class="sb"><div class="sb-empty">导入或粘贴怪物 JSON 后<br>这里会实时渲染怪物面板。</div></div>`;
}

// ---- load / export ---------------------------------------------------------
function loadDoc(text, { skipJsonArea = false } = {}) {
  let parsed;
  try {
    parsed = parseDoc(text);
  } catch (e) {
    setStatus("JSON 解析失败：" + e.message, "err");
    jsonArea.classList.add("err");
    return false;
  }
  state.kind = parsed.kind;
  state.doc = parsed.doc;
  state.monsters = parsed.monsters;
  if (state.activeIndex >= state.monsters.length) state.activeIndex = 0;
  if (state.activeIndex < 0) state.activeIndex = 0;
  showEditor();
  renderPicker();
  renderForm();
  renderSections();
  if (!skipJsonArea) renderJson();
  renderPreview();
  const kindLabel = parsed.kind === "wrapped" ? "{monster:[…]}"
    : parsed.kind === "array" ? "[…]" : "单个对象";
  setStatus(`已加载 ${state.monsters.length} 个怪物（${kindLabel}）。`, "ok");
  return true;
}
function doExport() {
  if (!state.doc) {
    setStatus("还没有可导出的数据。", "err");
    return;
  }
  const text = serializeDoc();
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const m = activeMonster();
  const nm = (m && (m.ENG_name || m.name)) || "monster";
  a.href = url;
  a.download = `${String(nm).replace(/[\\/:*?"<>|]/g, "_")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("已导出 JSON 文件。", "ok");
}

// ---- blank / sample data ---------------------------------------------------
function blankMonster() {
  return {
    name: "新怪物",
    ENG_name: "",
    source: "",
    size: "M",
    type: "humanoid",
    alignment: "",
    ac: 10,
    hp: { average: 10 },
    speed: { walk: 30 },
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: "0",
    trait: [], action: [], bonus: [], reaction: [], legendary: [],
  };
}
function sampleDoc() {
  return {
    monster: [{
      name: "哥布林头目",
      ENG_name: "Goblin Boss",
      source: "MM",
      size: ["S"],
      type: { type: "humanoid", tags: ["goblinoid"] },
      alignment: "中立邪恶",
      ac: [{ ac: 17, from: ["链甲", "盾牌"] }],
      hp: { average: 21, formula: "6d6" },
      speed: { walk: 30 },
      str: 10, dex: 14, con: 10, int: 10, wis: 8, cha: 10,
      save: { dex: "+4" },
      skill: { stealth: "+6" },
      senses: ["黑暗视觉 60 尺"],
      passive: 9,
      languages: ["通用语", "地精语"],
      cr: "1",
      trait: [
        { name: "鬼祟逃窜", entries: ["哥布林头目可以在每个回合用附赠动作脱离或躲藏。"] },
      ],
      action: [
        { name: "多重攻击", entries: ["哥布林头目发动两次弯刀攻击，第二次攻击带有劣势。"] },
        { name: "弯刀", entries: ["近战武器攻击：{@hit 4} 命中，触及 5 尺，单一目标。命中：{@damage 1d6+2} 点挥砍伤害。"] },
        { name: "标枪", entries: ["武器攻击：{@hit 4} 命中，触及 5 尺或射程 30/120 尺，单一目标。命中：{@damage 1d6+2} 点穿刺伤害。"] },
      ],
      bonus: [],
      reaction: [
        { name: "顶替", entries: ["当一个 5 尺内的非头目盟友被攻击时，哥布林头目可让该盟友与自己交换位置并代其受击。"] },
      ],
      legendary: [],
    }],
  };
}

// ---- wiring ----------------------------------------------------------------
importBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const text = await file.text();
  jsonArea.value = text;
  state.activeIndex = 0;
  loadDoc(text);
  fileInput.value = "";
});
exportBtn.addEventListener("click", doExport);
newBtn.addEventListener("click", () => {
  const text = JSON.stringify({ monster: [blankMonster()] }, null, 2);
  jsonArea.value = text;
  state.activeIndex = 0;
  if (loadDoc(text)) rawDetails.open = false;
});
sampleBtn.addEventListener("click", () => {
  const text = JSON.stringify(sampleDoc(), null, 2);
  jsonArea.value = text;
  state.activeIndex = 0;
  if (loadDoc(text)) rawDetails.open = false;
});
monsterSelect.addEventListener("change", () => {
  state.activeIndex = Number(monsterSelect.value) || 0;
  renderForm();
  renderSections();
  renderPreview();
});

// Quick-edit form — event delegation (covers data-field inputs AND the
// dynamically-rebuilt ability grid's data-abil / data-save inputs).
formCard.addEventListener("input", (e) => {
  const el = e.target;
  if (!el || !el.dataset) return;
  if (el.dataset.field) applyField(el.dataset.field, el.value);
  else if (el.dataset.abil) applyScore(el.dataset.abil, el.value);
  else if (el.dataset.save) applySave(el.dataset.save, el.value);
});
// 体型 chip selector — single-select.
formCard.addEventListener("click", (e) => {
  const chip = e.target.closest && e.target.closest("[data-size-chip]");
  if (!chip) return;
  applyField("size", chip.dataset.sizeChip);
  for (const c of formCard.querySelectorAll("[data-size-chip]")) {
    c.classList.toggle("on", c === chip);
  }
});

// Section rows — text edits mutate in place (no re-render, keeps focus);
// add / delete rebuild the section list.
sectionsHost.addEventListener("input", (e) => {
  const row = e.target.closest && e.target.closest(".sect-row");
  if (!row) return;
  const m = activeMonster();
  if (!m) return;
  const sect = row.dataset.sect;
  const idx = Number(row.dataset.idx);
  if (!Array.isArray(m[sect]) || !m[sect][idx]) return;
  if (e.target.classList.contains("sr-name")) {
    m[sect][idx].name = e.target.value;
  } else if (e.target.classList.contains("sr-text")) {
    m[sect][idx].entries = textToEntries(e.target.value);
  }
  renderJson();
  renderPreview();
});
sectionsHost.addEventListener("click", (e) => {
  const m = activeMonster();
  if (!m) return;
  const addKey = e.target.dataset && e.target.dataset.add;
  if (addKey) {
    if (!Array.isArray(m[addKey])) m[addKey] = [];
    m[addKey].push({ name: "新条目", entries: [] });
    renderSections();
    renderJson();
    renderPreview();
    return;
  }
  if (e.target.classList.contains("sr-del")) {
    const row = e.target.closest(".sect-row");
    if (!row) return;
    const sect = row.dataset.sect;
    const idx = Number(row.dataset.idx);
    if (Array.isArray(m[sect])) {
      m[sect].splice(idx, 1);
      renderSections();
      renderJson();
      renderPreview();
    }
  }
});

// Raw JSON textarea — debounced re-parse; on success rebuild everything
// EXCEPT the textarea itself (so the caret isn't clobbered mid-edit).
let jsonTimer = 0;
jsonArea.addEventListener("input", () => {
  clearTimeout(jsonTimer);
  jsonTimer = window.setTimeout(() => {
    loadDoc(jsonArea.value, { skipJsonArea: true });
  }, 350);
});

// Drag a .json file anywhere onto the window to load it.
window.addEventListener("dragover", (e) => { e.preventDefault(); });
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  const text = await file.text();
  jsonArea.value = text;
  state.activeIndex = 0;
  loadDoc(text);
});

// Initial empty preview.
renderPreview();
