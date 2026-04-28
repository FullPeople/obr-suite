import OBR from "@owlbear-rodeo/sdk";
import {
  startSceneSync,
  getState,
  onStateChange,
  setState,
  ModuleId,
  DataVersion,
  Language,
  getLocalLang,
  setLocalLang,
  onLangChange,
} from "./state";
import { applyLangAttr } from "./i18n";
import { ICONS } from "./icons";

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
      <a class="support-btn kofi" href="${KOFI_URL}" target="_blank" rel="noopener"><span class="ic">${ICONS.coffee}</span> Support on Ko-fi</a>
      <a class="support-btn afdian" href="${AFDIAN_URL}" target="_blank" rel="noopener"><span class="ic">${ICONS.heart}</span> 前往爱发电</a>
    </div>
    <h3>${ICONS.mail} 反馈</h3>
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
      <a class="support-btn kofi" href="${KOFI_URL}" target="_blank" rel="noopener"><span class="ic">${ICONS.coffee}</span> Support on Ko-fi</a>
      <a class="support-btn afdian" href="${AFDIAN_URL}" target="_blank" rel="noopener"><span class="ic">${ICONS.heart}</span> Afdian (Chinese Patreon)</a>
    </div>
    <h3>${ICONS.mail} Feedback</h3>
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
    <h3>${ICONS.user} 如何为玩家设置 Owner</h3>
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
    <h3>${ICONS.user} Setting up Owner permissions for players</h3>
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
  en: `<p><b>${ICONS.warning} This module is currently designed for the Chinese D&amp;D community's xlsx character sheet format (悲灵 v1.0.12). It will not parse generic English character sheets.</b></p>
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
const DICE_DESC: BilingualHtml = {
  zh: `<p>完整的骰子系统：表达式 / 多目标 / 历史 / 回放 / 音效。点击屏幕左上角的 OBR 动作按钮（d20 图标）打开主面板。</p>

<p><b>表达式</b>（在面板里输入或保存为组合）：</p>
<ul>
  <li><code>2d6 + 1d20 + 5</code> — 标准混合表达式</li>
  <li><code>adv(1d20)</code> / <code>dis(1d20)</code> — 优势 / 劣势（败方虚化淡出）</li>
  <li><code>adv(1d20, 2)</code> — 精灵之准（投 3 组取最高）</li>
  <li><code>max(1d20, 10)</code> / <code>min(1d20, 15)</code> — 保底 / 封顶</li>
  <li><code>reset(1d20, 12)</code> — 投到 12 时重投一次</li>
  <li><code>burst(2d6)</code> — 术法爆发：每个最大点追加一颗，最多链 5 次</li>
  <li><code>same(2d20)</code> — 重复值高亮（玩家色对比色）</li>
  <li><code>repeat(3, 1d20+5)</code> — 重复 3 次，每行独立显示总和</li>
  <li>支持嵌套：<code>adv(max(1d20, 10) + 5)</code> 等。中文括号 / 逗号自动识别</li>
  <li><kbd>Enter</kbd> 直接发送；输入 <code>(</code> 自动补 <code>)</code></li>
</ul>

<p><b>多目标 / 集体掷骰</b></p>
<ul>
  <li>多选 token 后投掷 → 自动给每个 token 各掷一次（独立的骰子值），摄像头框选所有目标的包围盒</li>
  <li>历史里集体骰合并为一行，绿色"集体 N"标签</li>
  <li>玩家只选 1 个或没选时：自动用其唯一拥有的角色 token；DM 必须显式选中</li>
</ul>

<p><b>暗骰</b>（DM 专属）</p>
<ul>
  <li>面板下方紫色"暗骰"按钮 / 怪物面板左键 / 组合卡的暗骰</li>
  <li>仅 DM 自己的客户端可见；玩家不接收任何信号</li>
  <li>无选中 token 时也可投，结果飘在屏幕中央，DM 自己的历史记录会显示"暗"标签</li>
</ul>

<p><b>历史浮窗</b>（左下角，集群"投骰记录"开关控制）</p>
<ul>
  <li>每个玩家一行，显示其最后一次投骰</li>
  <li>点击行 → 平滑滑入该玩家的全部历史；返回按钮回主列表</li>
  <li>详情里点条目 → 在所有相关 token 头顶显示气泡（骰子图标 + 总和 + 标签 + 投骰人颜色）；点空白处关闭气泡</li>
  <li>暗骰条目只在 DM 自己客户端可见</li>
</ul>

<p><b>5etools 联动 / 角色卡联动</b></p>
<ul>
  <li>搜索 / 怪物图鉴里的所有 <code>{@dice}</code>、<code>{@damage}</code>、<code>{@hit}</code> 等标签都可点击直接投</li>
  <li>角色卡六维的属性缩写 = 豁免，修正 = 检定；技能和武器整行都可点</li>
  <li>怪物面板：左键暗骰 / 右键明骰</li>
  <li>玩家小卡底部的"特性 / 专长 / 法术"小盒 → 点击自动填入搜索框</li>
</ul>

<p><b>音效</b>：用 Web Audio API 实时合成（无需下载素材）。 抛物线 / 缩放冲击 / 数字飞行 / 旋转 / 爆炸 / 同值钟铃 / 大成功大失败闪光 / 同步视野 / 切换回合"登"声。可在 <b>基础设置</b> 里关闭，本地保存（每个玩家独立）。</p>

<p style="font-size:11px;color:#9aa0b3;margin-top:10px">骰子图标来源：<a href="https://www.flaticon.com/" target="_blank" rel="noopener">flaticon</a> · 作者 <a href="https://www.flaticon.com/authors/freepik" target="_blank" rel="noopener">Freepik</a></p>`,
  en: `<p>Full dice system: expressions / multi-target / history / replay / SFX. Click the OBR action button at the top-left (d20 icon) to open the main panel.</p>

<p><b>Expressions</b> (type into the panel or save as combos):</p>
<ul>
  <li><code>2d6 + 1d20 + 5</code> — standard mixed expression</li>
  <li><code>adv(1d20)</code> / <code>dis(1d20)</code> — advantage / disadvantage (loser dice fade out)</li>
  <li><code>adv(1d20, 2)</code> — Elven Accuracy (roll 3 sets, take highest)</li>
  <li><code>max(1d20, 10)</code> / <code>min(1d20, 15)</code> — floor / ceiling</li>
  <li><code>reset(1d20, 12)</code> — reroll once when result equals 12</li>
  <li><code>burst(2d6)</code> — spell-burst (each max face adds another die, chain up to 5)</li>
  <li><code>same(2d20)</code> — duplicate-value highlight (player conflict color)</li>
  <li><code>repeat(3, 1d20+5)</code> — N independent rows, each with its own total</li>
  <li>Nests freely: <code>adv(max(1d20, 10) + 5)</code> etc. CN parens / commas auto-recognized</li>
  <li><kbd>Enter</kbd> rolls; <code>(</code> auto-closes to <code>()</code> with caret in the middle</li>
</ul>

<p><b>Multi-target / collective rolls</b></p>
<ul>
  <li>Select multiple tokens, then roll → each token gets its own independent dice values; camera fits a bounding box around all targets</li>
  <li>History collapses the batch into one row tagged "集体 N" (Collective N)</li>
  <li>Player auto-fallback: when nothing is selected and the player owns exactly one visible token, that token is used. DM must always explicitly select.</li>
</ul>

<p><b>Dark roll</b> (DM only)</p>
<ul>
  <li>Purple 暗骰 button at the panel bottom / left-click on monster panel / dark-roll button on combo cards</li>
  <li>Only the DM's own client receives — players see nothing</li>
  <li>Works without a selected token (dice float at viewport center). DM's history shows the 暗 tag</li>
</ul>

<p><b>History popover</b> (bottom-left, toggled via the cluster's "投骰记录" button)</p>
<ul>
  <li>One row per player, showing their most recent roll</li>
  <li>Click row → slide-in detail of that player's full history; back button returns</li>
  <li>Click an entry inside detail → speech-bubbles appear above every involved token (dice icons + total + label + roller's color); click empty area to dismiss</li>
  <li>Dark-roll entries appear only in the DM's local view</li>
</ul>

<p><b>5etools / character card integration</b></p>
<ul>
  <li>All <code>{@dice}</code> / <code>{@damage}</code> / <code>{@hit}</code> tags in search results + bestiary entries are click-to-roll</li>
  <li>Character card abilities: ability abbr = save, modifier = check; skill + weapon rows fully clickable</li>
  <li>Monster panel: left-click = dark roll / right-click = open roll</li>
  <li>Card bottom's "Features / Feats / Spells" chips → click fills the cluster search input</li>
</ul>

<p><b>Sound effects</b>: synthesized live via Web Audio API (no asset downloads). Parabola / scale punch / number fly / spin / burst / same chime / crit-fail flashes / sync-viewport / next-turn 登. Toggle in <b>Basics</b> tab; saved locally (per-player).</p>

<p style="font-size:11px;color:#9aa0b3;margin-top:10px">Dice icon: <a href="https://www.flaticon.com/" target="_blank" rel="noopener">flaticon</a> · by <a href="https://www.flaticon.com/authors/freepik" target="_blank" rel="noopener">Freepik</a></p>`,
};
const PORTALS_DESC: BilingualHtml = {
  zh: `<p><b style="color:#f5a623">⚠ 仍在开发中 · 默认关闭</b> —— 已知问题：跨场景传送、权限模型、移动设备触摸支持都未完全实现。需手动开启来体验当前已实现的功能。</p>
<p>左侧栏的「传送门」工具用于创建场景内的传送门区域。</p>
<ul>
  <li>选中工具后，在地图上<b>按住拖拽画圆</b> —— 松手即创建一个传送门，圆心放置 SVG 标记，半径为触发范围</li>
  <li>松手后弹出命名面板：可设置「名字」（一楼/二楼/地下室…）和「标签」（001/002…）；下方预设可点击套用，可自由增删</li>
  <li><b>同标签的传送门互联</b> —— 玩家把 token 拖入任一传送门范围时，弹出选项让其选择同标签的目的地；多选时所有选中单位一起以六边形方式集结到目的地</li>
  <li>DM 单击已存在的传送门 → 弹出命名面板可快速修改 / 删除</li>
  <li>把传送门设为<b>不可见</b>（OBR 自带的 visible=false） → 玩家看不见，无法从这里进入；但<b>仍可作为目的地</b>。可用于做单向传送</li>
</ul>`,
  en: `<p><b style="color:#f5a623">⚠ Under development · Default OFF</b> — known gaps: cross-scene portals, permission model, mobile touch support. Enable manually to try the currently-implemented bits.</p>
<p>The "Portal" tool on the left rail creates teleport zones in the scene.</p>
<ul>
  <li>Activate the tool, then <b>click-drag to draw a circle</b> on the map — release to create a portal, with an SVG marker at the center and the drag distance as trigger radius</li>
  <li>An edit panel opens on release: set "Name" (1F / 2F / Basement…) and "Tag" (001 / 002…). Preset chips below are click-to-fill and freely editable</li>
  <li><b>Portals with the same tag are linked</b> — when a token is dragged into a visible portal, a prompt offers same-tag destinations; with multiple tokens selected, all of them gather around the destination in a hex spiral</li>
  <li>DM clicking an existing portal → edit panel pops up to rename / retag / delete</li>
  <li>Set a portal to <b>invisible</b> (OBR's built-in visibility) → players can't see it nor enter from it, but it can <b>still be a destination</b>. Useful for one-way teleporters</li>
</ul>`,
};
const SEARCH_DESC: BilingualHtml = {
  zh: `<p><b style="color:#f5a623">⚠ 仍在修复中 · 默认关闭</b> —— 弹窗布局 / 键盘导航 / 集群面板交互还在打磨。需手动开启。</p>
<p>集群面板内嵌搜索框 + 5etools 全数据联想搜索（弹出在集群下方）。</p>
<ul>
  <li>点输入框直接打字，下拉显示前 50 条匹配</li>
  <li>覆盖怪物 / 法术 / 物品 / 职业 / 子职业 / 种族 / 背景 / 专长 / 灵能 / 状态 / 神祇 / 整本书 / 表格 / ... 全部 5etools 分类</li>
  <li>悬停词条 → 右侧浮出完整内容；点击词条钉住</li>
  <li>受当前数据版本过滤，玩家是否能查询怪物在下方设置</li>
  <li>角色卡 / 怪物面板的特性 / 法术名都可以点击 → 自动填入此搜索框</li>
</ul>`,
  en: `<p><b style="color:#f5a623">⚠ Under bug-fix · Default OFF</b> — popover layout, keyboard nav, and cluster integration still being polished. Enable manually.</p>
<p>Inline search input inside the cluster popover + dropdown popover for 5etools data (renders below the cluster).</p>
<ul>
  <li>Click the input and type — top 50 matches in the dropdown</li>
  <li>Covers all 5etools categories: monsters, spells, items, classes/subclasses, races, backgrounds, feats, psionics, conditions, deities, books, tables, ...</li>
  <li>Hover an entry → right pane shows full content; click to pin</li>
  <li>Filtered by current data-version; player monster-search controlled below</li>
  <li>Character-card / monster-panel feature names + spells are click-to-search → auto-fill this input</li>
</ul>`,
};

const TABS: TabDef[] = [
  {
    id: "support",
    zh: `${ICONS.heartSpark} 支持作者 / 反馈`,
    en: `${ICONS.heartSpark} Support / Feedback`,
    body: SUPPORT,
  },
  {
    id: "important",
    zh: `${ICONS.pin} 重要说明`,
    en: `${ICONS.pin} Important Notes`,
    body: IMPORTANT_NOTES,
  },
  {
    id: "version",
    zh: `${ICONS.library} 基础设置`,
    en: `${ICONS.library} Basics`,
    dynamicBody: (lang) => {
      const s = getState();
      const seg = (val: DataVersion, label: string) =>
        `<button data-dv="${val}" class="${
          s.dataVersion === val ? "on" : ""
        }" type="button" ${isGM ? "" : "disabled"}>${label}</button>`;
      // Local-only sound toggle (per-client, NOT synced to scene
      // metadata — different players can have different preferences).
      const soundOn = (() => {
        try { return localStorage.getItem("obr-suite/sfx-on") !== "0"; }
        catch { return true; }
      })();
      return `
        <div class="basics-block">
          <div class="basics-h">${lang === "zh" ? "数据版本" : "Data version"}</div>
          <div class="seg">
            ${seg("2014", "2014")}
            ${seg("2024", "2024")}
            ${seg("all", "2014+2024")}
          </div>
          <p style="margin-top:6px">${
            lang === "zh"
              ? "决定怪物图鉴和搜索框显示的数据范围。2014 = 仅 PHB+MM；2024 = 仅 XPHB+XMM；2014+2024 = 全部。"
              : "Controls the data range shown in Bestiary and Global Search. 2014 = PHB+MM only; 2024 = XPHB+XMM only; 2014+2024 = everything."
          }</p>
          ${!isGM ? `<p class="role-notice">${lang === "zh" ? "玩家端只读 · 由 DM 设置" : "Read-only · Set by DM"}</p>` : ""}
        </div>

        <div class="basics-block" style="margin-top:14px">
          <div class="basics-h">${lang === "zh" ? "音效" : "Sound effects"}</div>
          <label class="basics-toggle">
            <input type="checkbox" id="sfxToggle" ${soundOn ? "checked" : ""}>
            <span>${lang === "zh" ? "启用骰子动画与界面音效" : "Enable dice + UI sound effects"}</span>
          </label>
          <p style="margin-top:6px;color:#9ab;font-size:11px">${
            lang === "zh"
              ? "本地保存（不同步到场景）。每个玩家可独立选择是否听到音效。"
              : "Saved locally (NOT synced). Each player can opt in/out independently."
          }</p>
        </div>
      `;
    },
    afterRender: (root) => {
      root.querySelectorAll<HTMLButtonElement>(".seg button[data-dv]").forEach((b) => {
        b.addEventListener("click", async () => {
          if (!isGM) return;
          await setState({ dataVersion: b.dataset.dv as DataVersion });
        });
      });
      const toggle = root.querySelector<HTMLInputElement>("#sfxToggle");
      if (toggle) {
        toggle.addEventListener("change", () => {
          try {
            localStorage.setItem("obr-suite/sfx-on", toggle.checked ? "1" : "0");
            // Notify any open iframes (effect, replay, etc.) that the
            // pref changed. Local-only — this is per-client.
            OBR.broadcast.sendMessage(
              "com.obr-suite/sfx-toggled",
              { on: toggle.checked },
              { destination: "LOCAL" },
            ).catch(() => {});
          } catch {}
        });
      }
    },
  },
  { id: "timeStop", zh: `${ICONS.clockPause} 时停模式`, en: `${ICONS.clockPause} Time Stop`, moduleId: "timeStop", body: TIMESTOP_DESC },
  { id: "focus", zh: `${ICONS.crosshair} 同步视口`, en: `${ICONS.crosshair} Sync Viewport`, moduleId: "focus", body: FOCUS_DESC },
  {
    id: "bestiary",
    zh: `${ICONS.dragon} 怪物图鉴`,
    en: `${ICONS.dragon} Bestiary`,
    moduleId: "bestiary",
    body: BESTIARY_DESC,
  },
  {
    id: "characterCards",
    zh: `${ICONS.idCard} 角色卡`,
    en: `${ICONS.idCard} Character Cards`,
    moduleId: "characterCards",
    dynamicBody: (lang) => {
      const desc = lang === "zh" ? CHARCARD_DESC.zh : CHARCARD_DESC.en;
      const btn = lang === "zh"
        ? `<a class="dl-btn" href="https://obr.dnd.center/suite/template-belling-v1.0.12.xlsx"
              download="DND5.5E人物卡-悲灵v1.0.12.xlsx" target="_blank" rel="noopener">
              ⬇ 下载角色卡 xlsx 模板（悲灵 v1.0.12）
            </a>`
        : `<a class="dl-btn" href="https://obr.dnd.center/suite/template-belling-v1.0.12.xlsx"
              download="DND5.5E-Character-Sheet-v1.0.12.xlsx" target="_blank" rel="noopener">
              ⬇ Download character sheet xlsx template (悲灵 v1.0.12, Chinese only)
            </a>`;
      return `${desc}${btn}`;
    },
  },
  {
    id: "initiative",
    zh: `${ICONS.swords} 先攻追踪`,
    en: `${ICONS.swords} Initiative Tracker`,
    moduleId: "initiative",
    body: INITIATIVE_DESC,
  },
  {
    id: "dice",
    zh: `${ICONS.d20} 骰子动效`,
    en: `${ICONS.d20} Dice Roll Effect`,
    moduleId: "dice",
    body: DICE_DESC,
  },
  {
    id: "portals",
    zh: `${ICONS.portal} 传送门`,
    en: `${ICONS.portal} Portals`,
    moduleId: "portals",
    body: PORTALS_DESC,
  },
  {
    id: "search",
    zh: `${ICONS.search} 全局搜索`,
    en: `${ICONS.search} Global Search`,
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
    case "dice": return lang === "zh" ? "骰子动效" : "Dice Roll Effect";
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

// Language is per-client (localStorage). Either GM or player picks their
// own UI language; nothing is written to scene metadata.
langZhEl.addEventListener("click", () => {
  setLocalLang("zh");
  setLang("zh");
});
langEnEl.addEventListener("click", () => {
  setLocalLang("en");
  setLang("en");
});

OBR.onReady(async () => {
  try { isGM = (await OBR.player.getRole()) === "GM"; } catch {}
  startSceneSync();
  // Re-render content (including the per-tab toggles + dynamic body) on
  // any suite state change. Language changes are handled separately so the
  // panel reflects another iframe (e.g. cluster) toggling lang.
  onStateChange(() => renderContent());
  onLangChange((l) => setLang(l));
  setLang(getLocalLang());
});
