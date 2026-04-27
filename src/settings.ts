import OBR from "@owlbear-rodeo/sdk";
import {
  startSceneSync,
  getState,
  onStateChange,
  setState,
  ModuleId,
  DataVersion,
  Language,
} from "./state";
import { applyLangAttr } from "./i18n";

// Merged Settings + About panel.
//
// Layout:
//   ┌────────────────────────────────────────────────────────┐
//   │ Title                                       [CN][EN]   │  ← head
//   ├──────────┬─────────────────────────────────────────────┤
//   │ tabs     │  ┌────────── top-bar ──────────┐ [toggle]   │
//   │ Support  │  │ Section title                            │
//   │ Version  │  ├──────────────────────────────────────────┤
//   │ ─────    │  │ Content / per-plugin description         │
//   │ TimeStop │  │ + plugin-specific options                │
//   │ Focus    │  │                                          │
//   │ Bestiary │  │                                          │
//   │ ...      │  └──────────────────────────────────────────┘
//   └──────────┴─────────────────────────────────────────────┘
//
// Per-plugin tabs each show:
//   - top-bar: tab title + module enable toggle (DM-only writable)
//   - body: bilingual description + module-specific options
// Support / Version / Language tabs have no enable toggle (no module flag).

const POPOVER_ID = "com.obr-suite/settings";
const KOFI_URL = "https://ko-fi.com/fullpeople";
const AFDIAN_URL = "https://ifdian.net/a/fullpeople";
const EMAIL = "1763086701@qq.com";
const GITHUB_URL = "https://github.com/FullPeople";

interface BilingualHtml { zh: string; en: string; }
interface TabDef {
  id: string;
  zh: string;
  en: string;
  /** Plugin module id this tab represents (enables top-bar toggle). */
  moduleId?: ModuleId;
  /** Optional per-tab body content. */
  body?: BilingualHtml;
  /** Optional dynamic body — receives current state, can render options. */
  dynamicBody?: (lang: Language, isGM: boolean) => string;
  /** Optional after-render hook to wire interactive controls. */
  afterRender?: (root: HTMLElement, isGM: boolean) => void;
}

let activeTab = "support";
let isGM = false;

const SUPPORT: BilingualHtml = {
  zh: `
    <p>这套插件由 <b>弗人 FullPeople</b> 利用业余时间维护，所有代码开源于 GitHub。如果它对你的跑团有帮助，欢迎以下方式支持作者：</p>
    <div class="support-row">
      <a class="support-btn kofi" href="${KOFI_URL}" target="_blank" rel="noopener"><span class="ic">☕</span> Support on Ko-fi</a>
      <a class="support-btn afdian" href="${AFDIAN_URL}" target="_blank" rel="noopener"><span class="ic">♥</span> 前往爱发电</a>
    </div>
    <h3>📮 反馈</h3>
    <div class="contact-box">
      <p>遇到 bug、想加新功能、想交流插件开发，欢迎邮件联系：</p>
      <p>邮箱：<a href="mailto:${EMAIL}"><code>${EMAIL}</code></a></p>
      <p>GitHub：<a href="${GITHUB_URL}" target="_blank">${GITHUB_URL}</a></p>
    </div>
    <div class="note">
      插件目前自托管在作者的服务器上，每月都有服务器费用在跑。作者也会时不时更新优化、修 bug、加新功能，请大家见谅 (｀・ω・´)ゞ。代码以 <a href="https://polyformproject.org/licenses/noncommercial/1.0.0/" target="_blank">PolyForm Noncommercial 1.0.0</a> 协议发布 —— 可自由查看 / 修改 / 二次创作 / 非商用分发；商业使用禁止。
    </div>
  `,
  en: `
    <p>This plugin suite is built and maintained by <b>弗人 FullPeople</b> in spare time, with all code open-sourced on GitHub. If you find it useful for your campaigns, here are ways to support the author:</p>
    <div class="support-row">
      <a class="support-btn kofi" href="${KOFI_URL}" target="_blank" rel="noopener"><span class="ic">☕</span> Support on Ko-fi</a>
      <a class="support-btn afdian" href="${AFDIAN_URL}" target="_blank" rel="noopener"><span class="ic">♥</span> Afdian (Chinese Patreon)</a>
    </div>
    <h3>📮 Feedback</h3>
    <div class="contact-box">
      <p>Found a bug, want a feature, or want to chat about plugin dev — please reach out:</p>
      <p>Email: <a href="mailto:${EMAIL}"><code>${EMAIL}</code></a></p>
      <p>GitHub: <a href="${GITHUB_URL}" target="_blank">${GITHUB_URL}</a></p>
    </div>
    <div class="note">
      The plugin is self-hosted by the author at their own monthly cost, with continuous updates and bug fixes. Source under <a href="https://polyformproject.org/licenses/noncommercial/1.0.0/" target="_blank">PolyForm Noncommercial 1.0.0</a> — view / modify / fork / distribute freely for noncommercial use; commercial use prohibited.
    </div>
  `,
};

const IMPORTANT_NOTES: BilingualHtml = {
  zh: `
    <h3>👤 如何为玩家设置 Owner</h3>
    <p>在 OBR 中把角色卡的 Owner 指派给玩家后，<b>玩家端就能在先攻插件里：</b></p>
    <ul class="benefit-list">
      <li><span class="benefit-tag">投骰</span>在准备阶段为<b>自己拥有的角色</b>投先攻骰</li>
      <li><span class="benefit-tag">改值</span>编辑自己角色的<b>先攻值</b>和<b>加值</b></li>
      <li><span class="benefit-tag">回合</span>轮到自己时，点角色卡下方<b>绿色「结束回合」</b>按钮</li>
    </ul>
    <p style="font-size:11.5px;color:#9aa0b3">不设置也能玩，由 DM 一手操作即可。但开放后玩家可以更自主地推进自己的回合。</p>

    <div class="step">
      <div class="step-title">第 1 步：开启 Character「Owner Only」权限</div>
      <p>左侧 Players 面板中，点 <b>盾牌图标</b>（Player Permissions）。</p>
      <img src="/suite/owner-step1.png" alt="Players 面板的盾牌按钮">
      <p>展开 Map → <b>Character</b> 行，在下拉里勾上 <b>Owner Only</b>，然后 SAVE。</p>
      <img src="/suite/owner-step2.png" alt="勾选 Owner Only">
      <p class="tip-line">含义：被指派为某角色 Owner 的玩家，才能修改/操作那个角色（DM 仍可操作所有角色）。</p>
    </div>

    <div class="step">
      <div class="step-title">第 2 步：把角色 Owner 指派给玩家</div>
      <p>在地图上<b>左键点选</b>一个角色 Token，悬浮工具栏里点 <b>人形图标</b>（Set Owner），从列表里选玩家即可。</p>
      <img src="/suite/owner-step3.png" alt="角色工具栏的 Set Owner 按钮">
      <p class="tip-line">每个 Token 单独指派；一个玩家可以拥有多个角色（PC + 召唤物等）。</p>
    </div>

    <div class="note">
      <b>提示：</b>设置完成后，在先攻面板里那位玩家的角色卡<b>加值/先攻值</b>会变成可点编辑（蓝色描边），战斗中轮到他时会出现<b>绿色「结束回合」</b>按钮。其他人的卡对他来说是只读的。
    </div>
  `,
  en: `
    <h3>👤 Setting up Owner permissions for players</h3>
    <p>Once you assign a token's Owner to a player in OBR, <b>they gain extra abilities in the Initiative module:</b></p>
    <ul class="benefit-list">
      <li><span class="benefit-tag">Roll</span>Roll initiative for <b>their own characters</b> during prep phase</li>
      <li><span class="benefit-tag">Edit</span>Edit their character's <b>initiative</b> and <b>modifier</b></li>
      <li><span class="benefit-tag">End Turn</span>Click the <b>green "End Turn"</b> button under their card when it's their turn</li>
    </ul>
    <p style="font-size:11.5px;color:#9aa0b3">Optional — you can also run everything DM-side. But owner-delegation lets players drive their own turns.</p>

    <div class="step">
      <div class="step-title">Step 1: Enable Character "Owner Only" permission</div>
      <p>In the left Players panel, click the <b>shield icon</b> (Player Permissions).</p>
      <img src="/suite/owner-step1.png" alt="Shield button in Players panel">
      <p>Expand Map → <b>Character</b> row, select <b>Owner Only</b> in the dropdown, then SAVE.</p>
      <img src="/suite/owner-step2.png" alt="Select Owner Only">
      <p class="tip-line">This means: only the player assigned as a token's Owner can edit/move it (DM still has full control).</p>
    </div>

    <div class="step">
      <div class="step-title">Step 2: Assign Owner to a player</div>
      <p>On the map, <b>left-click</b> a token, then click the <b>person icon</b> (Set Owner) in the floating toolbar and pick a player.</p>
      <img src="/suite/owner-step3.png" alt="Set Owner button on token toolbar">
      <p class="tip-line">Per-token assignment; one player can own multiple tokens (PC + summons, etc.).</p>
    </div>

    <div class="note">
      <b>After setup:</b> in the initiative panel, that player's card will have <b>editable initiative/modifier</b> (blue outline), and a <b>green "End Turn"</b> button appears when it's their turn. Other players' cards are read-only to them.
    </div>
  `,
};

const TIMESTOP_DESC: BilingualHtml = {
  zh: `<p>右键空白处或角色 → "开启时停"。开启后：</p>
<ul>
  <li>屏幕上下出现电影黑边淡入</li>
  <li>玩家无法进行任何画布操作（拖角色、删 token 等）</li>
  <li>DM 仍可正常操作地图和角色</li>
  <li>玩家在时停期间加入也会自动进入时停状态</li>
</ul>`,
  en: `<p>Right-click an empty area or token → "Start Time Stop". When active:</p>
<ul>
  <li>Top and bottom of screen fade in cinema black bars</li>
  <li>Players cannot interact with the canvas</li>
  <li>The DM retains full control of the map</li>
  <li>Players who join during time stop get the same view automatically</li>
</ul>`,
};
const FOCUS_DESC: BilingualHtml = {
  zh: `<p>右键画布任意位置 / 角色 → "全员聚焦到此处"，所有玩家的摄像头会立刻拉到指定位置。</p>
<p>右下角 cluster 的「同步视口」按钮也能触发：聚焦当前选中的 token，否则聚焦视口中心。</p>`,
  en: `<p>Right-click anywhere on the canvas → "Focus everyone here". All players' cameras instantly pan to the target position.</p>
<p>The cluster's "Sync Viewport" button also triggers it: focuses the currently selected token, or the viewport center if none.</p>`,
};
const BESTIARY_DESC: BilingualHtml = {
  zh: `<p>来自 5etools 的全 D&amp;D 5E 怪物库，搜索 + 一键召唤到场景。仅 DM 可见。</p>
<ul>
  <li>左侧 tool 栏图标启动，右侧出现搜索面板</li>
  <li>支持中英文搜索、CR 排序，按当前数据版本过滤（在版本数据 tab 切换）</li>
  <li>点击怪物 → 一键拖入场景，自动设置 HP/AC/先攻/DEX 修正</li>
  <li>选中已召唤怪物时顶部弹出完整 stat block（受悬浮窗开关控制）</li>
</ul>`,
  en: `<p>D&amp;D 5E monster library powered by 5etools. Search and one-click spawn to scene. DM only.</p>
<ul>
  <li>Tool icon on the left rail; click to open the side panel</li>
  <li>CN/EN search, CR sort, filtered by the current data-version (set in the Data Version tab)</li>
  <li>Click a monster → spawned at scene center, HP/AC/initiative/DEX bonus auto-set</li>
  <li>Selecting a spawned monster shows the full stat block at the top (controlled by the auto-popup toggle)</li>
</ul>`,
};
const CHARCARD_DESC: BilingualHtml = {
  zh: `<p>导入 xlsx 格式的角色卡（DnD 中文社区悲灵 v1.0.12 模板），自动解析为可查阅的网页。</p>
<ul>
  <li>cluster 的「角色卡界面」按钮直接打开全屏面板（旧版的圆形蓝色浮动按钮已合并到这里）</li>
  <li>把 xlsx 拖到右侧侧栏即可上传</li>
  <li>选中绑定角色 token 时浮出小信息框（受悬浮窗开关控制）</li>
  <li>右键角色 token 可绑定 / 解绑卡片</li>
</ul>`,
  en: `<p><b>⚠️ This module is currently designed for the Chinese D&amp;D community's xlsx character sheet format (悲灵 v1.0.12). It will not parse generic English character sheets.</b></p>
<ul>
  <li>The cluster's "Character Card Panel" button opens the fullscreen view (the old circular blue floating button has been merged into this)</li>
  <li>Drag an xlsx onto the side panel to upload</li>
  <li>Selecting a bound token shows a small info popup (subject to the auto-popup toggle)</li>
  <li>Right-click a token to bind/unbind a card</li>
</ul>`,
};
const INITIATIVE_DESC: BilingualHtml = {
  zh: `<p>顶部居中的横向先攻条，覆盖完整 D&amp;D 战斗流程。</p>
<ul>
  <li>右键角色 → 加入先攻；支持框选多个</li>
  <li>玩家端联动 Dice+ 投骰（无 Dice+ 则本地骰），DM 端始终本地骰</li>
  <li>切换回合时所有人摄像头自动聚焦到当前角色</li>
  <li>右键空白处 → 集结先攻角色（螺旋排列）</li>
  <li>玩家有 owner 权限时：可投自己的先攻、改加值、点绿色按钮结束自己回合</li>
</ul>`,
  en: `<p>Top-center horizontal initiative strip, full D&amp;D combat flow.</p>
<ul>
  <li>Right-click a token → "Add to initiative"; supports box-selection</li>
  <li>Players roll via Dice+ if installed (falls back to local roll); DM always local</li>
  <li>Camera auto-focus on the active token at every turn change</li>
  <li>Right-click empty space → "Gather here" arranges initiative tokens in a spiral</li>
  <li>Owner-players can roll their own initiative and click "End Turn" when active</li>
</ul>`,
};
const SEARCH_DESC: BilingualHtml = {
  zh: `<p>顶部右侧浮动搜索框，5etools 全数据联想搜索。</p>
<ul>
  <li>点输入框直接打字，下拉显示前 50 条匹配</li>
  <li>覆盖怪物 / 法术 / 物品 / 职业 / 子职业 / 种族 / 背景 / 专长 / 灵能 / 状态 / 神祇 / 整本书 / ... 全部 5etools 分类</li>
  <li>悬停词条 → 右侧浮出完整内容</li>
  <li>受当前数据版本过滤，玩家是否能查询怪物在下方设置</li>
</ul>`,
  en: `<p>Floating search bar at the top right, type-ahead search across all 5etools data.</p>
<ul>
  <li>Click the input and type — top 50 matches in the dropdown</li>
  <li>Covers all 5etools categories</li>
  <li>Hover an entry → right pane shows full content</li>
  <li>Filtered by current data-version; player monster-search controlled below</li>
</ul>`,
};

const TABS: TabDef[] = [
  {
    id: "support",
    zh: "💖 支持作者 / 反馈",
    en: "💖 Support / Feedback",
    body: SUPPORT,
  },
  {
    id: "important",
    zh: "📌 重要说明",
    en: "📌 Important Notes",
    body: IMPORTANT_NOTES,
  },
  {
    id: "version",
    zh: "📚 版本数据",
    en: "📚 Data Version",
    dynamicBody: (lang) => {
      const s = getState();
      const seg = (val: DataVersion, label: string) =>
        `<button data-dv="${val}" class="${
          s.dataVersion === val ? "on" : ""
        }" type="button" ${isGM ? "" : "disabled"}>${label}</button>`;
      return `
        <div class="seg">
          ${seg("2014", "2014")}
          ${seg("2024", "2024")}
          ${seg("all", "2014+2024")}
        </div>
        <p style="margin-top:10px">${
          lang === "zh"
            ? "决定怪物图鉴和搜索框显示的数据范围。2014 = 仅 PHB+MM；2024 = 仅 XPHB+XMM；2014+2024 = 全部。"
            : "Controls the data range shown in Bestiary and Global Search. 2014 = PHB+MM only; 2024 = XPHB+XMM only; 2014+2024 = everything."
        }</p>
        ${!isGM ? `<p class="role-notice">${lang === "zh" ? "玩家端只读 · 由 DM 设置" : "Read-only · Set by DM"}</p>` : ""}
      `;
    },
    afterRender: (root) => {
      root.querySelectorAll<HTMLButtonElement>(".seg button[data-dv]").forEach((b) => {
        b.addEventListener("click", async () => {
          if (!isGM) return;
          await setState({ dataVersion: b.dataset.dv as DataVersion });
        });
      });
    },
  },
  { id: "timeStop", zh: "⏸ 时停模式", en: "⏸ Time Stop", moduleId: "timeStop", body: TIMESTOP_DESC },
  { id: "focus", zh: "🎯 同步视口", en: "🎯 Sync Viewport", moduleId: "focus", body: FOCUS_DESC },
  {
    id: "bestiary",
    zh: "🐉 怪物图鉴",
    en: "🐉 Bestiary",
    moduleId: "bestiary",
    body: BESTIARY_DESC,
  },
  {
    id: "characterCards",
    zh: "📇 角色卡",
    en: "📇 Character Cards",
    moduleId: "characterCards",
    body: CHARCARD_DESC,
  },
  {
    id: "initiative",
    zh: "⚔ 先攻追踪",
    en: "⚔ Initiative Tracker",
    moduleId: "initiative",
    body: INITIATIVE_DESC,
  },
  {
    id: "search",
    zh: "🔍 全局搜索",
    en: "🔍 Global Search",
    moduleId: "search",
    body: SEARCH_DESC,
    dynamicBody: (lang) => {
      const s = getState();
      return `
        ${SEARCH_DESC[lang]}
        <h3>${lang === "zh" ? "选项" : "Options"}</h3>
        <div class="row">
          <div class="lbl">
            ${lang === "zh" ? "允许玩家查询怪物" : "Players Can Search Monsters"}
            <div class="desc">${
              lang === "zh"
                ? "默认关闭。仅 DM 可设。开启后玩家也能在搜索结果中看到怪物条目。"
                : "Off by default. DM-only setting. When on, players can also see monster entries in search results."
            }</div>
          </div>
          <button class="tog ${
            s.allowPlayerMonsters ? "on" : ""
          }" data-key="allowPlayerMonsters" type="button" ${isGM ? "" : "disabled"} aria-pressed="${
        s.allowPlayerMonsters
      }"></button>
        </div>
        ${!isGM ? `<p class="role-notice">${lang === "zh" ? "玩家端只读 · 由 DM 设置" : "Read-only · Set by DM"}</p>` : ""}
      `;
    },
    afterRender: (root) => {
      root
        .querySelector<HTMLButtonElement>('.tog[data-key="allowPlayerMonsters"]')
        ?.addEventListener("click", async () => {
          if (!isGM) return;
          await setState({ allowPlayerMonsters: !getState().allowPlayerMonsters });
        });
    },
  },
];

// --- DOM refs ---
const titleEl = document.getElementById("title") as HTMLHeadingElement;
const tabsEl = document.getElementById("tabs") as HTMLElement;
const topBarEl = document.getElementById("topBar") as HTMLElement;
const contentEl = document.getElementById("content") as HTMLElement;
const langZhEl = document.getElementById("langZh") as HTMLButtonElement;
const langEnEl = document.getElementById("langEn") as HTMLButtonElement;

let lang: Language = "zh";

function findTab(id: string): TabDef {
  return TABS.find((t) => t.id === id) ?? TABS[0];
}

function moduleLabelKey(id: ModuleId): string {
  switch (id) {
    case "timeStop": return lang === "zh" ? "时停模式" : "Time Stop";
    case "focus": return lang === "zh" ? "同步视口" : "Sync Viewport";
    case "bestiary": return lang === "zh" ? "怪物图鉴" : "Bestiary";
    case "characterCards": return lang === "zh" ? "角色卡" : "Character Cards";
    case "initiative": return lang === "zh" ? "先攻追踪" : "Initiative Tracker";
    case "search": return lang === "zh" ? "全局搜索" : "Global Search";
  }
}

function renderTabs() {
  tabsEl.innerHTML = TABS.map((tab) => {
    const text = lang === "zh" ? tab.zh : tab.en;
    return `<button class="tab ${
      activeTab === tab.id ? "on" : ""
    }" data-tab="${tab.id}" type="button">${text}</button>`;
  }).join("");
  tabsEl.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab!;
      renderTabs();
      renderContent();
    });
  });
}

function renderContent() {
  const tab = findTab(activeTab);
  const s = getState();

  // ---- Top bar (title + per-plugin toggle if applicable) ----
  let topBar = `<h2>${lang === "zh" ? tab.zh : tab.en}</h2>`;
  if (tab.moduleId) {
    const on = !!s.enabled[tab.moduleId];
    topBar += `<button class="tog ${
      on ? "on" : ""
    }" data-mod="${tab.moduleId}" type="button" ${
      isGM ? "" : "disabled"
    } title="${lang === "zh" ? "启用 / 关闭此功能" : "Enable / disable this module"}"></button>`;
  } else {
    topBar += `<span class="meta">${
      lang === "zh" ? "" : ""
    }</span>`;
  }
  topBarEl.innerHTML = topBar;
  topBarEl
    .querySelector<HTMLButtonElement>(".tog[data-mod]")
    ?.addEventListener("click", async () => {
      if (!isGM) return;
      const id = tab.moduleId as ModuleId;
      const cur = getState().enabled[id];
      await setState({ enabled: { [id]: !cur } as any });
    });

  // ---- Body ----
  let body = "";
  if (tab.dynamicBody) body = tab.dynamicBody(lang, isGM);
  else if (tab.body) body = tab.body[lang];
  contentEl.innerHTML = body;
  if (tab.afterRender) tab.afterRender(contentEl, isGM);
}

function setLang(l: Language) {
  lang = l;
  applyLangAttr(l);
  langZhEl.classList.toggle("on", l === "zh");
  langEnEl.classList.toggle("on", l === "en");
  titleEl.textContent = l === "zh" ? "设置 / 关于" : "Settings / About";
  renderTabs();
  renderContent();
}

langZhEl.addEventListener("click", async () => {
  setLang("zh");
  if (isGM) { try { await setState({ language: "zh" }); } catch {} }
});
langEnEl.addEventListener("click", async () => {
  setLang("en");
  if (isGM) { try { await setState({ language: "en" }); } catch {} }
});

OBR.onReady(async () => {
  try { isGM = (await OBR.player.getRole()) === "GM"; } catch {}
  startSceneSync();
  onStateChange(() => renderContent());
  setLang(getState().language);
});
