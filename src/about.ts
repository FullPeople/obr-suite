import OBR from "@owlbear-rodeo/sdk";
import { startSceneSync, getState, onStateChange, Language } from "./state";
import { applyLangAttr } from "./i18n";

// The About modal is fully self-contained — content is bilingual and toggled
// in-iframe via the top-right CN/EN switcher. Tabs default to "support".

interface TabContent { zh: string; en: string; }
interface TabDef { id: string; titleZh: string; titleEn: string; content: TabContent; }

const KOFI_URL = "https://ko-fi.com/fullpeople";
const AFDIAN_URL = "https://ifdian.net/a/fullpeople";
const EMAIL = "1763086701@qq.com";
const GITHUB_URL = "https://github.com/FullPeople";

const SUPPORT_HTML_ZH = `
<h2>💖 支持作者 & 反馈</h2>
<p>这套插件由 <b>FullPeople（枭熊）</b> 利用业余时间维护，所有代码开源于 GitHub。如果它对你的跑团有帮助，欢迎以下方式支持作者：</p>

<div class="support-row">
  <a class="support-btn kofi" href="${KOFI_URL}" target="_blank" rel="noopener">
    <span class="ic">☕</span> Support on Ko-fi
  </a>
  <a class="support-btn afdian" href="${AFDIAN_URL}" target="_blank" rel="noopener">
    <span class="ic">♥</span> 前往爱发电
  </a>
</div>

<h3>📮 反馈</h3>
<div class="contact-box">
  <p>遇到 bug、想加新功能、想交流插件开发，欢迎邮件联系：</p>
  <p>邮箱：<a href="mailto:${EMAIL}"><code>${EMAIL}</code></a></p>
  <p>GitHub：<a href="${GITHUB_URL}" target="_blank">${GITHUB_URL}</a></p>
</div>

<h3>🛠 关于</h3>
<p>这套插件目前自托管在作者自己的服务器（<code>obr.dnd.center</code>），每月有服务器费用在跑。作者也会时不时更新/优化（或不小心加进去几个 bug 让大家一起找找）。</p>

<div class="note">
  插件代码以 <a href="https://polyformproject.org/licenses/noncommercial/1.0.0/" target="_blank">PolyForm Noncommercial 1.0.0</a> 协议发布 —— 可自由查看、修改、二次创作、非商用分发；商业使用禁止。
</div>
`;

const SUPPORT_HTML_EN = `
<h2>💖 Support & Feedback</h2>
<p>This plugin suite is built and maintained by <b>FullPeople</b> in spare time, with all code open-sourced on GitHub. If you find it useful for your campaigns, here are ways to support the author:</p>

<div class="support-row">
  <a class="support-btn kofi" href="${KOFI_URL}" target="_blank" rel="noopener">
    <span class="ic">☕</span> Support on Ko-fi
  </a>
  <a class="support-btn afdian" href="${AFDIAN_URL}" target="_blank" rel="noopener">
    <span class="ic">♥</span> Afdian (Chinese Patreon)
  </a>
</div>

<h3>📮 Feedback</h3>
<div class="contact-box">
  <p>Found a bug, want a feature, or want to chat about plugin dev — please reach out:</p>
  <p>Email: <a href="mailto:${EMAIL}"><code>${EMAIL}</code></a></p>
  <p>GitHub: <a href="${GITHUB_URL}" target="_blank">${GITHUB_URL}</a></p>
</div>

<h3>🛠 About</h3>
<p>The suite is self-hosted on the author's server (<code>obr.dnd.center</code>) at personal expense. Updates and bug fixes ship continuously.</p>

<div class="note">
  Source code is licensed under <a href="https://polyformproject.org/licenses/noncommercial/1.0.0/" target="_blank">PolyForm Noncommercial 1.0.0</a> — view / modify / fork / distribute freely for noncommercial use; commercial use is prohibited.
</div>
`;

const TABS: TabDef[] = [
  {
    id: "support",
    titleZh: "💖 支持 & 反馈",
    titleEn: "💖 Support & Feedback",
    content: { zh: SUPPORT_HTML_ZH, en: SUPPORT_HTML_EN },
  },
  {
    id: "timeStop",
    titleZh: "时停模式",
    titleEn: "Time Stop",
    content: {
      zh: `<h2>⏸ 时停模式</h2>
<p>右键空白处或角色 → "开启时停"。开启后：</p>
<ul>
  <li>屏幕上下出现电影黑边淡入，营造叙事氛围</li>
  <li>玩家无法进行任何画布操作（拖角色、删 token 等）</li>
  <li>DM 仍可正常操作地图和角色</li>
  <li>玩家在时停期间加入也会自动进入时停状态</li>
</ul>
<h3>用途</h3>
<p>需要叙事剧情、转场、暂停画布让玩家专心听剧情时使用。再次右键 → "关闭时停" 退出。</p>`,
      en: `<h2>⏸ Time Stop</h2>
<p>Right-click an empty area or token → "Start Time Stop". When active:</p>
<ul>
  <li>Top and bottom of screen fade in cinema black bars</li>
  <li>Players cannot interact with the canvas (no token drag, no deletes)</li>
  <li>The DM retains full control of the map</li>
  <li>Players who join during time stop get the same view automatically</li>
</ul>
<h3>Use Cases</h3>
<p>Useful for narrative interludes, scene transitions, or just freezing the canvas while you describe something. Right-click again → "Stop Time Stop" to release.</p>`,
    },
  },
  {
    id: "focus",
    titleZh: "同步视口",
    titleEn: "Sync Viewport",
    content: {
      zh: `<h2>🎯 同步视口</h2>
<p>右键画布任意位置 / 角色 → "全员聚焦到此处"，所有玩家的摄像头会立刻拉到指定位置，保持与 DM 一致的缩放。</p>
<h3>用途</h3>
<ul>
  <li>战斗开始把所有人聚焦到战场中央</li>
  <li>探索时对玩家展示某个房间或机关</li>
  <li>叙事转场时同步所有人的视野</li>
</ul>`,
      en: `<h2>🎯 Sync Viewport</h2>
<p>Right-click anywhere on the canvas (or on a token) → "Focus everyone here". All players' cameras instantly pan to the target position, matching the DM's zoom level.</p>
<h3>Use Cases</h3>
<ul>
  <li>Snap everyone to the battlefield center as combat begins</li>
  <li>Reveal a room or trap during exploration</li>
  <li>Sync everyone's view during narrative transitions</li>
</ul>`,
    },
  },
  {
    id: "bestiary",
    titleZh: "怪物图鉴",
    titleEn: "Bestiary",
    content: {
      zh: `<h2>🐉 怪物图鉴（DM 专用）</h2>
<p>来自 5etools 的全 D&amp;D 5E 怪物库，搜索 + 一键召唤到场景。</p>
<ul>
  <li>左侧 tool 栏图标启动，右侧出现搜索面板</li>
  <li>支持中英文搜索、CR 排序、分版本筛选（设置中切换 2014 / 2024 / 全部）</li>
  <li>点击怪物 → 一键拖入场景中心，自动设置 HP / AC / 先攻 / DEX 修正</li>
  <li>悬浮窗：选中已召唤的怪物时顶部弹出完整数据卡（六维、特性、动作、传奇动作、施法等）</li>
  <li>支持 5etools 的 _copy 继承解析（不会丢字段）</li>
</ul>`,
      en: `<h2>🐉 Bestiary (DM only)</h2>
<p>D&amp;D 5E monster library powered by 5etools. Search and one-click spawn to scene.</p>
<ul>
  <li>Tool icon on the left rail; click to open the side panel</li>
  <li>CN/EN search, CR sort, edition filter (2014 / 2024 / All in settings)</li>
  <li>Click a monster → spawned at scene center, HP/AC/initiative/DEX bonus auto-set</li>
  <li>Auto-popup: selecting a spawned monster shows the full stat block at the top (abilities, traits, actions, legendary actions, spellcasting...)</li>
  <li>5etools <code>_copy</code> inheritance fully resolved (no missing fields)</li>
</ul>`,
    },
  },
  {
    id: "characterCards",
    titleZh: "角色卡",
    titleEn: "Character Cards",
    content: {
      zh: `<h2>📇 角色卡</h2>
<p>导入 xlsx 格式的角色卡（DnD 中文社区悲灵 v1.0.12 模板），自动解析为可查阅的网页。</p>
<ul>
  <li>点击「角色卡界面」打开浮窗 / 全屏面板</li>
  <li>把 xlsx 拖到右侧侧栏即可上传，自动渲染六维、技能、武器、法术等</li>
  <li>悬浮窗：选中绑定角色 token 时浮出小信息框（HP/AC/DC/速度 + 武器 + 法术）</li>
  <li>右键角色 token 可绑定 / 解绑卡片</li>
  <li>支持下载官方模板</li>
</ul>`,
      en: `<h2>📇 Character Cards</h2>
<p><b>⚠️ This module is currently designed for the Chinese D&amp;D community's xlsx character sheet format (悲灵 v1.0.12). It will not parse generic English character sheets unless you create a matching template.</b></p>
<ul>
  <li>Click "Character Card Panel" to open the floating / fullscreen view</li>
  <li>Drag an xlsx file onto the side panel to upload — abilities/skills/weapons/spells parsed automatically</li>
  <li>Auto-popup: selecting a bound token shows a small info panel above the main button (HP/AC/DC/speed + weapons + spells)</li>
  <li>Right-click a token to bind/unbind a card</li>
  <li>Template available for download from the panel</li>
</ul>`,
    },
  },
  {
    id: "initiative",
    titleZh: "先攻追踪",
    titleEn: "Initiative Tracker",
    content: {
      zh: `<h2>⚔ 先攻追踪</h2>
<p>顶部居中的横向先攻条，覆盖完整 D&amp;D 战斗流程。</p>
<ul>
  <li>右键角色 → 加入先攻；支持框选多个</li>
  <li>蓝色小框显示先攻加值，任何人可改</li>
  <li>玩家端联动 Dice+ 投骰（无 Dice+ 则本地骰），DM 端始终本地骰</li>
  <li>准备阶段所有玩家各自投先攻 → 战斗阶段按总值降序排列</li>
  <li>切换回合时所有人摄像头自动聚焦到当前角色</li>
  <li>右键空白处 → 集结先攻角色（螺旋排列）</li>
  <li>角色被隐藏时自动从先攻列表跳过</li>
  <li>玩家有 owner 权限时：可投自己的先攻、改加值、点绿色按钮结束自己回合</li>
</ul>`,
      en: `<h2>⚔ Initiative Tracker</h2>
<p>Top-center horizontal initiative strip, full D&amp;D combat flow.</p>
<ul>
  <li>Right-click a token → "Add to initiative"; works on box-selected groups too</li>
  <li>Tiny blue chip shows initiative bonus — any player can edit</li>
  <li>Players roll via Dice+ if installed (falls back to local roll), DM always rolls locally</li>
  <li>Prep phase: every player rolls their own → combat begins, sorted by total descending</li>
  <li>Camera auto-focus on the active token at every turn change</li>
  <li>Right-click empty space → "Gather here" arranges initiative tokens in a spiral</li>
  <li>Hidden tokens auto-skip during combat</li>
  <li>Owner-players can roll their own initiative, edit values, and click a green "End Turn" button when active</li>
</ul>`,
    },
  },
  {
    id: "search",
    titleZh: "全局搜索",
    titleEn: "Global Search",
    content: {
      zh: `<h2>🔍 全局搜索</h2>
<p>顶部右侧浮动搜索框，5etools 全数据联想搜索。</p>
<ul>
  <li>点输入框直接打字，下拉显示前 50 条匹配（中英文都搜）</li>
  <li>覆盖 5etools 全部分类：怪物 / 法术 / 物品 / 职业 / 子职业 / 种族 / 背景 / 专长 / 灵能 / 状态 / 神祇 / 整本书 / ...</li>
  <li>悬停词条 → 右侧浮出完整内容（怪物含完整 stat block，法术含成分/距离/施法）</li>
  <li>点击词条 → 钉住预览面板，可滚动阅读</li>
  <li>↑↓ 选择 · Enter 打开 · Esc 关闭</li>
  <li>失焦自动收起（保留输入内容）· 再次点击输入框瞬间恢复</li>
  <li>设置中可控制：版本筛选（仅影响 PHB / XPHB） · 是否允许玩家查询怪物（DM 设置，玩家只读）</li>
</ul>
<p style="font-size:11px;color:#888">语言为中文时使用 5e.kiwee.top（中文镜像），英文时使用 5etools 官方站。</p>`,
      en: `<h2>🔍 Global Search</h2>
<p>Floating search bar at the top right, type-ahead search across all 5etools data.</p>
<ul>
  <li>Click the input and type — top 50 matches appear in the dropdown (CN/EN both searched)</li>
  <li>Covers every 5etools category: monsters / spells / items / classes / subclasses / races / backgrounds / feats / psionics / conditions / deities / books / ...</li>
  <li>Hover an entry → right pane shows full content (monsters with full stat block; spells with components / range / casting time)</li>
  <li>Click an entry → pin the preview, scroll freely</li>
  <li>↑↓ select · Enter open · Esc close</li>
  <li>Auto-collapses on blur (keeps your query) · clicking the input restores instantly</li>
  <li>Settings control: edition filter (PHB / XPHB only) · whether players can search monsters (DM-controlled, player read-only)</li>
</ul>
<p style="font-size:11px;color:#888">When language = CN, the suite uses 5e.kiwee.top (Chinese mirror); when EN, it uses 5etools official.</p>`,
    },
  },
];

// --- DOM wiring ---
const tabsEl = document.getElementById("tabs") as HTMLElement;
const contentEl = document.getElementById("content") as HTMLElement;
const langZhEl = document.getElementById("langZh") as HTMLButtonElement;
const langEnEl = document.getElementById("langEn") as HTMLButtonElement;
const titleEl = document.getElementById("title") as HTMLHeadingElement;

let activeTab = "support";
let lang: Language = "zh";

function renderTabs() {
  tabsEl.innerHTML = TABS.map(
    (t) =>
      `<button class="tab ${
        activeTab === t.id ? "on" : ""
      }" data-tab="${t.id}" type="button">${
        lang === "zh" ? t.titleZh : t.titleEn
      }</button>`
  ).join("");
  tabsEl.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab!;
      renderTabs();
      renderContent();
    });
  });
}

function renderContent() {
  const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0];
  contentEl.innerHTML = lang === "zh" ? tab.content.zh : tab.content.en;
  applyLangAttr(lang);
  titleEl.textContent = lang === "zh" ? "关于" : "About";
}

function setLang(l: Language) {
  lang = l;
  langZhEl.classList.toggle("on", l === "zh");
  langEnEl.classList.toggle("on", l === "en");
  renderTabs();
  renderContent();
  // Don't write to scene state from About — only Settings does that. The
  // CN/EN buttons here are purely for previewing about content.
}

langZhEl.addEventListener("click", () => setLang("zh"));
langEnEl.addEventListener("click", () => setLang("en"));

OBR.onReady(async () => {
  startSceneSync();
  // Default lang from current suite state.
  const s = getState();
  setLang(s.language);
  onStateChange((s) => {
    if (s.language !== lang) setLang(s.language);
  });
});
