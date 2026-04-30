import OBR from "@owlbear-rodeo/sdk";
import {
  startSceneSync,
  getState,
  onStateChange,
  setState,
  ModuleId,
  DataVersion,
  Language,
  LibraryConfig,
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

// Backers credited in the support tab. Edit this array to add new
// supporter names — keep order roughly chronological for fairness.
const SUPPORTERS: string[] = [
  "fu读机", "折云", "咸鱼", "呸呸", "Ejectam719",
  "皓天", "莫西斯", "艾迪", "诺雁",
  "愛睡眠（好崩溃睡不着ver）", "这只冒险小队没有人类了",
  "奶牛饭", "DK", "黄烟", "盲人过北极", "1234",
  "浩然正气","青灯栖凰","深白色(●—●)","白辰","瀞聆","滑而不稽则罔","Aisle","PB27",
  "蚀星ErosionStar","消炎药","SiriusTGT","悠悠向青山","小舟","孤月映寒","Joe","武御",
  "Misaka Mikoto","森海飞霞🐿","每日 1/? Fen","北省"
];

function supportersHtml(lang: Language): string {
  const list = SUPPORTERS.map(
    (n) => `<span class="backer">${n}</span>`,
  ).join("");
  return lang === "zh"
    ? `<h3>${ICONS.heart} 鸣谢</h3>
       <div class="backers-box">
         <p>感谢以下用户在爱发电上的支持：</p>
         <div class="backers">${list}</div>
         <p class="backers-extra">以及其他默认名字爱发电用户（大家摁可以取个名字） — 你们让我有能力继续维持服务器费用和开发该插件，泪目</p>
       </div>`
    : `<h3>${ICONS.heart} Thanks</h3>
       <div class="backers-box">
         <p>Thanks to the following supporters on Afdian:</p>
         <div class="backers">${list}</div>
         <p class="backers-extra">…and to every default-named Afdian backer (you can pick a name too!) — you let me keep paying the server bills and shipping new features. *tearing up*</p>
       </div>`;
}

const SUPPORT: BilingualHtml = {
  zh: `
    <p>这套插件由 <b>弗人 FullPeople</b> 利用业余时间维护，所有代码开源于 GitHub。如果它对你的跑团有帮助，欢迎以下方式支持作者：</p>
    <div class="support-row">
      <a class="support-btn kofi" href="${KOFI_URL}" target="_blank" rel="noopener"><span class="ic">${ICONS.coffee}</span> Support on Ko-fi</a>
      <a class="support-btn afdian" href="${AFDIAN_URL}" target="_blank" rel="noopener"><span class="ic">${ICONS.heart}</span> 前往爱发电</a>
    </div>
    ${supportersHtml("zh")}
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
    ${supportersHtml("en")}
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
  <li>支持中英文搜索、CR 排序，按当前数据版本过滤（在基础设置切换）</li>
  <li>点击怪物 → 一键拖入场景，自动设置 HP/AC/DEX 修正；先攻是否自动加入由下方开关控制</li>
  <li>选中已召唤怪物时顶部弹出完整 stat block（受悬浮窗开关控制）</li>
  <li>右键 token：未绑定的会出现「绑定怪物图鉴」；已绑定的会出现「更换 / 移除怪物图鉴绑定」，bubbles HP/AC/名字会随之更新</li>
  <li>怪物面板左键明骰；右键弹菜单（投掷 / 暗骰 / 优势 / 劣势 / 添加到骰盘）</li>
</ul>`,
  en: `<p>D&amp;D 5E monster library powered by 5etools. Search and one-click spawn to scene. DM only.</p>
<ul>
  <li>Tool icon on the left rail; click to open the side panel</li>
  <li>CN/EN search, CR sort, filtered by the current data-version (set in the Basics tab)</li>
  <li>Click a monster → spawned at scene center, HP/AC/DEX bonus auto-set; initiative auto-join is controlled by the toggle below</li>
  <li>Selecting a spawned monster shows the full stat block at the top (controlled by the auto-popup toggle)</li>
  <li>Right-click a token: unbound tokens show "Bind Monster"; bound ones show "Replace / Unbind", with bubbles HP/AC/name updated automatically</li>
  <li>Monster panel: left-click rolls open; right-click opens a context menu (Roll / Dark Roll / Advantage / Disadvantage / Add to Tray)</li>
</ul>`,
};
const CHARCARD_DESC: BilingualHtml = {
  zh: `<p>导入 xlsx 格式的角色卡（DnD 中文社区悲灵 v1.0.12 模板），自动解析为可查阅的网页。</p>
<ul>
  <li>cluster 的「角色卡界面」按钮直接打开全屏面板</li>
  <li>把 xlsx 拖到右侧侧栏即可上传，或点「📁 选择文件」用浏览器选择器上传</li>
  <li>每张卡片旁的 <b>↻</b> 按钮可重新选择 xlsx 覆盖更新（在 Excel 里改完保存→点刷新即可）</li>
  <li>选中绑定角色 token 时浮出小信息框（受悬浮窗开关控制）</li>
  <li>右键角色 token 可绑定 / 解绑卡片</li>
  <li>角色卡可点击元素：六维字母 = 豁免（自动应用熟练加值），修正 = 检定；武器命中 + 伤害骰均可点；底部「特性 / 专长 / 法术」chip 点击即填入全局搜索</li>
</ul>
<p style="color:#f5c876;font-size:11.5px;margin-top:8px"><b>📱 手机端</b>：全屏面板按钮被隐藏（在小屏幕上不可用，且会显著占用内存）。手机玩家可通过被绑定 token 浮出的小信息框查看角色卡。</p>`,
  en: `<p><b>${ICONS.warning} This module is currently designed for the Chinese D&amp;D community's xlsx character sheet format (悲灵 v1.0.12). It will not parse generic English character sheets.</b></p>
<ul>
  <li>The cluster's "Character Card Panel" button opens the fullscreen view</li>
  <li>Drag an xlsx onto the side panel to upload, or click "📁 Select File" to use the native file picker</li>
  <li>Each card row has a <b>↻</b> button — re-pick the xlsx (e.g. after editing in Excel) and it overwrites in place</li>
  <li>Selecting a bound token shows a small info popup (subject to the auto-popup toggle)</li>
  <li>Right-click a token to bind/unbind a card</li>
  <li>Clickable: ability letters = saving throws (with proficiency); modifiers = ability checks; weapon attack + damage; bottom "Traits / Feats / Spells" chips fill the global search input</li>
</ul>
<p style="color:#f5c876;font-size:11.5px;margin-top:8px"><b>📱 Mobile</b>: the fullscreen panel button is hidden (not usable on small screens + significant memory cost). Mobile players can still see card info via the auto-popup info card on selected tokens.</p>`,
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

<p style="font-size:11px;color:#9aa0b3;margin-top:10px">骰子图标来源：<a href="https://www.flaticon.com/" target="_blank" rel="noopener">flaticon</a> · 作者 <a href="https://www.flaticon.com/authors/freepik" target="_blank" rel="noopener">Freepik</a></p>
<p style="font-size:11px;color:#9aa0b3;margin-top:4px">骰子音效：Sound Effect by <a href="https://pixabay.com/users/freesound_community-46691455/" target="_blank" rel="noopener">freesound_community</a> and ksjsbwuil from <a href="https://pixabay.com/" target="_blank" rel="noopener">Pixabay</a></p>`,
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

<p style="font-size:11px;color:#9aa0b3;margin-top:10px">Dice icon: <a href="https://www.flaticon.com/" target="_blank" rel="noopener">flaticon</a> · by <a href="https://www.flaticon.com/authors/freepik" target="_blank" rel="noopener">Freepik</a></p>
<p style="font-size:11px;color:#9aa0b3;margin-top:4px">Dice SFX: Sound Effect by <a href="https://pixabay.com/users/freesound_community-46691455/" target="_blank" rel="noopener">freesound_community</a> and ksjsbwuil from <a href="https://pixabay.com/" target="_blank" rel="noopener">Pixabay</a></p>`,
};
const PORTALS_DESC: BilingualHtml = {
  zh: `<p>左侧栏的「传送门」工具用于创建场景内的传送门区域。</p>
<ul>
  <li>选中工具后，在地图上<b>按住拖拽画圆</b> —— 松手即创建一个传送门，圆心放置 SVG 标记，半径为触发范围</li>
  <li>松手后弹出命名面板：可设置「名字」（一楼/二楼/地下室…）和「标签」（001/002…）；下方预设可点击套用，可自由增删</li>
  <li><b>同标签的传送门互联</b> —— 玩家把 token 拖入任一传送门范围时，弹出选项让其选择同标签的目的地；多选时所有选中单位一起以六边形方式集结到目的地</li>
  <li>DM 单击已存在的传送门 → 弹出命名面板可快速修改 / 删除</li>
  <li>把传送门设为<b>不可见</b>（OBR 自带的 visible=false） → 玩家看不见，无法从这里进入；但<b>仍可作为目的地</b>。可用于做单向传送</li>
</ul>`,
  en: `<p>The "Portal" tool on the left rail creates teleport zones in the scene.</p>
<ul>
  <li>Activate the tool, then <b>click-drag to draw a circle</b> on the map — release to create a portal, with an SVG marker at the center and the drag distance as trigger radius</li>
  <li>An edit panel opens on release: set "Name" (1F / 2F / Basement…) and "Tag" (001 / 002…). Preset chips below are click-to-fill and freely editable</li>
  <li><b>Portals with the same tag are linked</b> — when a token is dragged into a visible portal, a prompt offers same-tag destinations; with multiple tokens selected, all of them gather around the destination in a hex spiral</li>
  <li>DM clicking an existing portal → edit panel pops up to rename / retag / delete</li>
  <li>Set a portal to <b>invisible</b> (OBR's built-in visibility) → players can't see it nor enter from it, but it can <b>still be a destination</b>. Useful for one-way teleporters</li>
</ul>`,
};
const SEARCH_DESC: BilingualHtml = {
  zh: `<p>顶部右上的搜索框 + 5etools 全数据联想搜索。</p>
<ul>
  <li>点输入框直接打字，下拉显示前 50 条匹配</li>
  <li>覆盖怪物 / 法术 / 物品 / 职业 / 子职业 / 种族 / 背景 / 专长 / 灵能 / 状态 / 神祇 / 整本书 / 表格 / ... 全部 5etools 分类</li>
  <li>悬停词条 → 右侧浮出完整内容；点击词条钉住</li>
  <li>受当前数据版本过滤，玩家是否能查询怪物在下方设置</li>
  <li>角色卡 / 怪物面板的特性 / 法术名都可以点击 → 自动填入此搜索框</li>
</ul>
<p style="color:#f5c876;font-size:11.5px;margin-top:8px"><b>📱 手机端</b>：搜索框完全不注册（5etools 全量索引在手机内存里太重）。需要查询的玩家请在桌面 / 平板上操作。</p>`,
  en: `<p>Top-right search input + 5etools full-data autocomplete dropdown.</p>
<ul>
  <li>Click the input and type — top 50 matches in the dropdown</li>
  <li>Covers all 5etools categories: monsters, spells, items, classes/subclasses, races, backgrounds, feats, psionics, conditions, deities, books, tables, ...</li>
  <li>Hover an entry → right pane shows full content; click to pin</li>
  <li>Filtered by current data-version; player monster-search controlled below</li>
  <li>Character-card / monster-panel feature names + spells are click-to-search → auto-fill this input</li>
</ul>
<p style="color:#f5c876;font-size:11.5px;margin-top:8px"><b>📱 Mobile</b>: the search input isn't registered at all (the 5etools dataset is too memory-heavy on phones). Use a desktop / tablet client for lookups.</p>`,
};

// =====================================================================
// Libraries tab
// =====================================================================
//
// Multi-library support — the user can register additional 5etools-like
// data hosts beyond the default kiwee.top mirror. Custom libraries MUST
// expose the same JSON shape (search/index.json + data/*.json with
// matching keys). The tutorial below + AI prompt template walks the user
// through writing a homebrew library and feeding it to an LLM.

const AI_PROMPT_TEMPLATE = `你是一个 D&D 5E 数据格式工程师。请把我下面提供的怪物 / 法术 / 物品资料，转换为符合 5etools 数据规范的 JSON。

输出要求：
1. 按以下顶层结构产出 JSON 文件：
   - 怪物：{ "monster": [ {...}, {...} ] }
   - 法术：{ "spell":   [ {...}, {...} ] }
   - 物品：{ "item":    [ {...}, {...} ] }
2. 每个条目至少包含字段：
   - "name": 中文名称
   - "ENG_name": 英文名称（无英文则用拼音）
   - "source": 来源缩写（自定义即可，例如 "HOMEBREW"）
   - "page": 页码（无则填 0）
3. 怪物条目额外需要：size, type, alignment, ac (数组), hp ({average, formula}), speed (对象 / 数字), str/dex/con/int/wis/cha 六个能力值, cr, trait/action/legendary 等数组（可选）。description 等行文统一放到 entries: ["...","..."]，可使用 5etools 行内标签如 {@dice 1d6}, {@damage 2d6+3}, {@hit 5}, {@dc 14}。
4. 法术条目额外需要：level, school (A/C/D/E/I/N/T/V), time, range, components ({v, s, m}), duration, classes, entries。
5. 物品条目额外需要：type, weight, value, rarity, entries；武器再加 dmg1, dmgType, property。
6. 每条数据后追加 entry index 项，格式：
   { "id": <自增整数>, "c": <类别号>, "n": "ENG_name", "cn": "name", "s": "<source>", "u": "<英文 url-slug>" }
   类别号：怪物=1，法术=2，物品=4 / 56 / 57，背景=3，专长=7 等。

请严格按上述格式输出 JSON 代码块（不要解释、不要其他文本）。下面是我的资料：

`;

function libraryRowHtml(lib: LibraryConfig, lang: Language, isGM: boolean): string {
  const builtinLock = lib.builtin
    ? `<span class="lib-tag">${lang === "zh" ? "内置" : "BUILT-IN"}</span>`
    : "";
  const disable = isGM ? "" : "disabled";
  const editable = isGM && !lib.builtin;
  return `
    <div class="lib-row" data-lib-id="${escapeAttr(lib.id)}">
      <div class="lib-row-head">
        <input class="lib-name" data-field="name" type="text" value="${escapeAttr(lib.name)}" ${editable ? "" : "readonly"} ${disable}>
        ${builtinLock}
        <button class="tog ${lib.enabled ? "on" : ""}" data-field="enabled" type="button" ${disable}
          aria-pressed="${lib.enabled}" title="${lang === "zh" ? "启用 / 禁用此库" : "Enable / disable"}"></button>
        ${
          !lib.builtin
            ? `<button class="lib-del-btn" type="button" ${disable} title="${lang === "zh" ? "删除此库" : "Delete"}">✕</button>`
            : ""
        }
      </div>
      <div class="lib-row-url">
        <span class="lib-row-label">URL:</span>
        <input class="lib-url" data-field="baseUrl" type="text" value="${escapeAttr(lib.baseUrl)}" ${editable ? "" : "readonly"} ${disable}
          placeholder="https://example.com">
      </div>
    </div>
  `;
}

function escapeAttr(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function renderLibrariesBody(lang: Language): string {
  const s = getState();
  const libs = s.libraries ?? [];
  const head = lang === "zh"
    ? `
      <div class="lib-warn">
        ⚠ <b>数据格式按 5etools 规范适配。</b>当前内置库为 kiwee.top（5etools 中文镜像）。你可以添加自己的库（自托管 / 公开 URL）。库必须提供与 5etools 相同的 JSON 结构（<code>search/index.json</code> + <code>data/&lt;file&gt;.json</code>）。所有启用的库会在搜索/图鉴里合并显示。
      </div>
    `
    : `
      <div class="lib-warn">
        ⚠ <b>Library data must follow the 5etools JSON schema.</b> The default built-in is kiwee.top (Chinese mirror). You can add custom libraries (self-hosted or public URLs) that expose the same shape (<code>search/index.json</code> + <code>data/&lt;file&gt;.json</code>). All enabled libraries are merged in search / bestiary results.
      </div>
    `;
  const list = libs.map((l) => libraryRowHtml(l, lang, isGM)).join("");
  const addBtn = isGM
    ? `<button class="lib-add-btn" type="button">${lang === "zh" ? "+ 添加库" : "+ Add library"}</button>`
    : `<p class="role-notice">${lang === "zh" ? "玩家端只读 · 由 DM 设置" : "Read-only · Set by DM"}</p>`;

  const tutorial = lang === "zh" ? `
    <details class="lib-tut">
      <summary>${ICONS.book ?? ""} 如何编写自己的库（含 AI 提示词）</summary>
      <div class="lib-tut-body">
        <h4>1. 数据托管</h4>
        <p>把数据 JSON 放到任意 HTTPS 静态站（GitHub Pages / 服务器 / 对象存储等），保证支持 CORS。基础目录结构：</p>
        <pre><code>your-host.com/
  search/
    index.json        ← 总索引：每个条目的 ENG_name + source + 类别号
  data/
    bestiary/
      bestiary-HOMEBREW.json   ← 怪物（按来源分文件）
    spells/
      spells-HOMEBREW.json     ← 法术
    items.json
    feats.json
    ...</code></pre>

        <h4>2. 索引文件 (search/index.json)</h4>
        <pre><code>{
  "x": [
    { "id": 1, "c": 1, "n": "Frost Wisp", "cn": "霜灵精怪", "s": "HOMEBREW", "u": "frost-wisp" },
    { "id": 2, "c": 2, "n": "Ember Seed", "cn": "余烬种子", "s": "HOMEBREW", "u": "ember-seed" }
  ],
  "m": { "s": { "HOMEBREW": 99 } }
}</code></pre>
        <p>类别号：怪物=1，法术=2，物品=4，背景=3，专长=7，能力=8，种族=10。</p>

        <h4>3. 数据文件 (例：bestiary-HOMEBREW.json)</h4>
        <pre><code>{
  "monster": [
    {
      "name": "霜灵精怪",
      "ENG_name": "Frost Wisp",
      "source": "HOMEBREW",
      "page": 1,
      "size": "T",
      "type": "elemental",
      "alignment": ["N"],
      "ac": [{"ac": 14, "from": ["natural armor"]}],
      "hp": {"average": 22, "formula": "5d4 + 10"},
      "speed": {"fly": 30, "hover": true},
      "str": 6, "dex": 16, "con": 14,
      "int": 8, "wis": 12, "cha": 10,
      "cr": "1/2",
      "trait": [
        { "name": "Cold Aura", "entries": [
          "Any creature within 5 ft. takes {@damage 1d4} cold damage at the start of its turn."
        ]}
      ],
      "action": [
        { "name": "Frost Touch", "entries": [
          "{@atk ms} {@hit 5}, reach 5 ft., one target. {@h}{@damage 2d6+3} cold damage."
        ]}
      ]
    }
  ]
}</code></pre>

        <h4>4. AI 提示词（直接复制给任意大模型）</h4>
        <p>把下面这段文字 + 你想录入的资料粘贴给 ChatGPT / Claude / 通义千问 / DeepSeek 等大模型，模型会输出符合本插件解析格式的 JSON。粘贴在第二行的 <code>"我的资料"</code> 后面就行。</p>
        <textarea class="lib-prompt" readonly>${escapeAttr(AI_PROMPT_TEMPLATE)}</textarea>
        <button class="lib-prompt-copy" type="button">复制提示词</button>

        <h4>5. 验证 + 添加</h4>
        <ol>
          <li>把 JSON 文件放到 HTTPS 站点上，确保浏览器能直接打开 <code>https://your-host.com/search/index.json</code>。</li>
          <li>在上面的 <b>+ 添加库</b> 里填入名称（任意） + 基础 URL（不带末尾斜杠）。</li>
          <li>勾选启用，然后到搜索框 / 怪物图鉴搜一下，新条目会出现在结果里。</li>
        </ol>
        <p style="color:#9ab;font-size:11px;margin-top:8px">遇到加载失败时打开浏览器 DevTools 看 Network 面板，多半是 CORS / 404 / JSON 格式错误。</p>
      </div>
    </details>
  ` : `
    <details class="lib-tut">
      <summary>How to write your own library (with AI prompt)</summary>
      <div class="lib-tut-body">
        <h4>1. Hosting</h4>
        <p>Put your JSON data on any HTTPS static host (GitHub Pages, S3, your own server) with CORS enabled. Base layout:</p>
        <pre><code>your-host.com/
  search/
    index.json
  data/
    bestiary/
      bestiary-HOMEBREW.json
    spells/
      spells-HOMEBREW.json
    items.json
    ...</code></pre>

        <h4>2. Index format</h4>
        <pre><code>{
  "x": [
    { "id": 1, "c": 1, "n": "Frost Wisp", "cn": "霜灵精怪", "s": "HOMEBREW", "u": "frost-wisp" }
  ],
  "m": { "s": { "HOMEBREW": 99 } }
}</code></pre>
        <p>Categories: 1=monster, 2=spell, 4=item, 3=background, 7=feat, 8=optional feature, 10=race.</p>

        <h4>3. AI prompt (copy and paste)</h4>
        <textarea class="lib-prompt" readonly>${escapeAttr(AI_PROMPT_TEMPLATE)}</textarea>
        <button class="lib-prompt-copy" type="button">Copy prompt</button>

        <h4>4. Verify + add</h4>
        <ol>
          <li>Confirm <code>https://your-host.com/search/index.json</code> opens in a browser.</li>
          <li>Use <b>+ Add library</b> above, enter a display name + base URL (no trailing slash).</li>
          <li>Toggle ON, then search to see merged results.</li>
        </ol>
      </div>
    </details>
  `;

  return `
    ${head}
    <div class="lib-list" id="libList">${list}</div>
    <div class="lib-actions">${addBtn}</div>
    ${tutorial}
  `;
}

function wireLibrariesBody(root: HTMLElement): void {
  const list = root.querySelector<HTMLDivElement>("#libList");
  if (!list) return;

  // Per-row edits
  list.querySelectorAll<HTMLDivElement>(".lib-row").forEach((row) => {
    const id = row.dataset.libId ?? "";
    const nameInp = row.querySelector<HTMLInputElement>('input[data-field="name"]');
    const urlInp = row.querySelector<HTMLInputElement>('input[data-field="baseUrl"]');
    const enableBtn = row.querySelector<HTMLButtonElement>('button[data-field="enabled"]');
    const delBtn = row.querySelector<HTMLButtonElement>(".lib-del-btn");

    const commit = async (patch: Partial<LibraryConfig>) => {
      if (!isGM) return;
      const next = (getState().libraries ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l));
      await setState({ libraries: next });
    };
    nameInp?.addEventListener("change", () => commit({ name: nameInp.value.trim() || id }));
    urlInp?.addEventListener("change", () =>
      commit({ baseUrl: urlInp.value.trim().replace(/\/+$/, "") })
    );
    enableBtn?.addEventListener("click", async () => {
      if (!isGM) return;
      const cur = getState().libraries.find((l) => l.id === id);
      await commit({ enabled: !cur?.enabled });
    });
    delBtn?.addEventListener("click", async () => {
      if (!isGM) return;
      if (!confirm("删除此库？这不会影响数据本身，只会从设置里移除。")) return;
      const next = (getState().libraries ?? []).filter((l) => l.id !== id);
      await setState({ libraries: next });
    });
  });

  // Add new library
  root.querySelector<HTMLButtonElement>(".lib-add-btn")?.addEventListener("click", async () => {
    if (!isGM) return;
    const name = window.prompt("新库名称（任意）：", "我的自定义库");
    if (!name) return;
    const baseUrl = window.prompt("基础 URL（不带末尾 /）：", "https://example.com");
    if (!baseUrl) return;
    const id = `custom-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const cur = getState().libraries ?? [];
    const next: LibraryConfig[] = [
      ...cur,
      {
        id,
        name: name.trim(),
        baseUrl: baseUrl.trim().replace(/\/+$/, ""),
        enabled: true,
        builtin: false,
      },
    ];
    await setState({ libraries: next });
  });

  // Copy prompt
  root.querySelector<HTMLButtonElement>(".lib-prompt-copy")?.addEventListener("click", () => {
    const ta = root.querySelector<HTMLTextAreaElement>(".lib-prompt");
    if (!ta) return;
    ta.select();
    try {
      navigator.clipboard.writeText(ta.value).catch(() => document.execCommand("copy"));
    } catch {
      document.execCommand("copy");
    }
    const btn = root.querySelector<HTMLButtonElement>(".lib-prompt-copy");
    if (btn) {
      const old = btn.textContent;
      btn.textContent = "已复制 ✓";
      setTimeout(() => { btn.textContent = old; }, 1200);
    }
  });
}

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
      const syncSet = !!s.crossSceneSyncSettings;
      const syncCards = !!s.crossSceneSyncCards;
      return `
        <div class="basics-block">
          <div class="basics-h">${lang === "zh" ? "数据版本" : "Data version"}</div>
          <div class="seg">
            ${seg("2014", "2014")}
            ${seg("2024", "2024")}
            ${seg("all", "2014+2024")}
          </div>
          <p style="margin-top:6px;line-height:1.7">${
            lang === "zh"
              ? "决定怪物图鉴和搜索框显示的数据范围：<br>· 2014 = 仅 PHB + MM<br>· 2024 = 仅 XPHB + XMM<br>· 2014+2024 = 全部"
              : "Controls the data range shown in Bestiary and Global Search:<br>· 2014 = PHB + MM only<br>· 2024 = XPHB + XMM only<br>· 2014+2024 = everything"
          }</p>
          ${!isGM ? `<p class="role-notice">${lang === "zh" ? "玩家端只读 · 由 DM 设置" : "Read-only · Set by DM"}</p>` : ""}
        </div>

        <div class="basics-block" style="margin-top:14px">
          <div class="basics-h">${lang === "zh" ? "跨场景同步" : "Cross-scene sync"}</div>
          <div class="row">
            <div class="lbl">
              ${lang === "zh" ? "同步插件设置" : "Sync suite settings"}
              <div class="desc"><em>${
                lang === "zh"
                  ? "开启后，房间里所有场景共享同一份插件设置（数据版本、模块开关、库列表等）。开启时会询问是否以当前场景为基准。"
                  : "When ON, every scene in the room shares one set of suite settings (data version, module toggles, libraries...). Enabling prompts whether to use the current scene as the source."
              }</em></div>
            </div>
            <button class="tog ${syncSet ? "on" : ""}" data-key="crossSceneSyncSettings" type="button" ${
              isGM ? "" : "disabled"
            } aria-pressed="${syncSet}"></button>
          </div>
          <div class="row">
            <div class="lbl">
              ${lang === "zh" ? "同步角色卡列表" : "Sync character-card list"}
              <div class="desc"><em>${
                lang === "zh"
                  ? "开启后，房间里所有场景共享同一份角色卡列表。开启时会询问是否以当前场景为基准。卡片实际数据本来就以房间 ID 存在服务器上，所以同步只是同步「哪些卡可见」。"
                  : "When ON, every scene in the room shares one character-card list. Enabling prompts whether to use the current scene as the source. Card content itself is already keyed by room ID server-side; this only syncs WHICH cards each scene shows."
              }</em></div>
            </div>
            <button class="tog ${syncCards ? "on" : ""}" data-key="crossSceneSyncCards" type="button" ${
              isGM ? "" : "disabled"
            } aria-pressed="${syncCards}"></button>
          </div>
          ${!isGM ? `<p class="role-notice">${lang === "zh" ? "玩家端只读 · 由 DM 设置" : "Read-only · Set by DM"}</p>` : ""}
        </div>
      `;
      // Sound-effect toggle moved out of 基础设置 — each module
      // (骰子动效 / 先攻追踪) now owns its own SFX switch under the
      // localStorage keys obr-suite/sfx-dice and
      // obr-suite/sfx-initiative respectively. See sfx.ts for the
      // per-channel gating + legacy fallback.
    },
    afterRender: (root) => {
      root.querySelectorAll<HTMLButtonElement>(".seg button[data-dv]").forEach((b) => {
        b.addEventListener("click", async () => {
          if (!isGM) return;
          await setState({ dataVersion: b.dataset.dv as DataVersion });
        });
      });
      root
        .querySelector<HTMLButtonElement>('.tog[data-key="crossSceneSyncSettings"]')
        ?.addEventListener("click", async () => {
          if (!isGM) return;
          const cur = !!getState().crossSceneSyncSettings;
          if (!cur) {
            // Off → ON: confirm before propagating current scene's
            // settings to every other scene in the room.
            const ok = window.confirm(
              getLocalLang() === "zh"
                ? "需要以当前场景的设置为基准，同步到本房间所有场景吗？\n\n（其他场景之前的独立设置会被覆盖。）"
                : "Sync the current scene's settings as the source-of-truth across every scene in this room?\n\n(Other scenes' previously-independent settings will be overwritten.)"
            );
            if (!ok) return;
          }
          await setState({ crossSceneSyncSettings: !cur });
        });
      root
        .querySelector<HTMLButtonElement>('.tog[data-key="crossSceneSyncCards"]')
        ?.addEventListener("click", async () => {
          if (!isGM) return;
          const cur = !!getState().crossSceneSyncCards;
          if (!cur) {
            const ok = window.confirm(
              getLocalLang() === "zh"
                ? "需要以当前场景的角色卡列表为基准，同步到本房间所有场景吗？\n\n（其他场景之前独立的卡列表会被覆盖。）"
                : "Sync the current scene's character-card list as the source-of-truth across every scene in this room?\n\n(Other scenes' previously-independent lists will be overwritten.)"
            );
            if (!ok) return;
            // Seed the room mirror with the current scene's cards
            // BEFORE flipping the flag, so the moment other scenes
            // hydrate they'll see the correct list.
            try {
              const m = await import("./modules/cross-scene-cards");
              await m.seedRoomCardsFromCurrentScene();
            } catch (e) { console.warn("[obr-suite/settings] seed cards failed", e); }
          } else {
            // ON → off: clear the room mirror so other scenes stop
            // hydrating from a stale list.
            try {
              const m = await import("./modules/cross-scene-cards");
              await m.clearRoomCardsMirror();
            } catch (e) { console.warn("[obr-suite/settings] clear cards mirror failed", e); }
          }
          await setState({ crossSceneSyncCards: !cur });
        });
    },
  },
  {
    id: "libraries",
    zh: `${ICONS.library} 库设置`,
    en: `${ICONS.library} Libraries`,
    dynamicBody: (lang) => renderLibrariesBody(lang),
    afterRender: (root) => wireLibrariesBody(root),
  },
  { id: "timeStop", zh: `${ICONS.clockPause} 时停模式`, en: `${ICONS.clockPause} Time Stop`, moduleId: "timeStop", body: TIMESTOP_DESC },
  { id: "focus", zh: `${ICONS.crosshair} 同步视口`, en: `${ICONS.crosshair} Sync Viewport`, moduleId: "focus", body: FOCUS_DESC },
  {
    id: "bestiary",
    zh: `${ICONS.dragon} 怪物图鉴`,
    en: `${ICONS.dragon} Bestiary`,
    moduleId: "bestiary",
    dynamicBody: (lang) => {
      const s = getState();
      const autoOn = s.bestiaryAutoInitiative !== false;
      return `
        ${BESTIARY_DESC[lang]}
        <h3>${lang === "zh" ? "选项" : "Options"}</h3>
        <div class="row">
          <div class="lbl">
            ${lang === "zh" ? "加入场景时自动加入先攻" : "Auto-add to initiative on spawn"}
            <div class="desc"><em>${
              lang === "zh"
                ? "一般用于备团时在场景中预制 token / 在战斗中临时加入敌人。"
                : "Useful when pre-staging tokens during prep, or adding enemies mid-combat."
            }</em></div>
          </div>
          <button class="tog ${
            autoOn ? "on" : ""
          }" data-key="bestiaryAutoInitiative" type="button" ${
            isGM ? "" : "disabled"
          } aria-pressed="${autoOn}"></button>
        </div>
        ${!isGM ? `<p class="role-notice">${lang === "zh" ? "玩家端只读 · 由 DM 设置" : "Read-only · Set by DM"}</p>` : ""}
      `;
    },
    afterRender: (root) => {
      root
        .querySelector<HTMLButtonElement>('.tog[data-key="bestiaryAutoInitiative"]')
        ?.addEventListener("click", async () => {
          if (!isGM) return;
          const cur = getState().bestiaryAutoInitiative !== false;
          await setState({ bestiaryAutoInitiative: !cur });
        });
    },
  },
  {
    id: "characterCards",
    zh: `${ICONS.idCard} 角色卡`,
    en: `${ICONS.idCard} Character Cards`,
    moduleId: "characterCards",
    dynamicBody: (lang) => {
      const desc = lang === "zh" ? CHARCARD_DESC.zh : CHARCARD_DESC.en;
      // Two templates side-by-side — both share the same xlsx layout
      // (parsed by the same rules), only the D&D edition differs.
      // 2014 = traditional 5e; 2024 = the revised "One D&D" rules.
      const btns = lang === "zh"
        ? `<div class="dl-row">
             <a class="dl-btn" href="https://obr.dnd.center/suite/template-belling-2014-v3.5.9.xlsx"
                download="DND5E人物卡_悲灵v3.5.9 (2014).xlsx" target="_blank" rel="noopener">
               ⬇ 5E2014 模板（传统 5e · 悲灵 v3.5.9）
             </a>
             <a class="dl-btn" href="https://obr.dnd.center/suite/template-belling-v1.0.12.xlsx"
                download="DND5.5E人物卡-悲灵v1.0.12 (2024).xlsx" target="_blank" rel="noopener">
               ⬇ 5E2024 模板（5e 修订 · 悲灵 v1.0.12）
             </a>
           </div>`
        : `<div class="dl-row">
             <a class="dl-btn" href="https://obr.dnd.center/suite/template-belling-2014-v3.5.9.xlsx"
                download="DND5E-Character-Sheet-v3.5.9 (2014).xlsx" target="_blank" rel="noopener">
               ⬇ 5E2014 sheet (legacy 5e · 悲灵 v3.5.9)
             </a>
             <a class="dl-btn" href="https://obr.dnd.center/suite/template-belling-v1.0.12.xlsx"
                download="DND5.5E-Character-Sheet-v1.0.12 (2024).xlsx" target="_blank" rel="noopener">
               ⬇ 5E2024 sheet (revised 5e · 悲灵 v1.0.12)
             </a>
           </div>`;
      return `${desc}${btns}`;
    },
  },
  {
    id: "initiative",
    zh: `${ICONS.swords} 先攻追踪`,
    en: `${ICONS.swords} Initiative Tracker`,
    moduleId: "initiative",
    dynamicBody: (lang) => {
      const s = getState();
      const focusOn = s.initiativeFocusOnTurnChange !== false;
      const autoSnap = !!s.initiativeAutoSnapOnPrep;
      const sfxOn = (() => {
        try {
          const v = localStorage.getItem("obr-suite/sfx-initiative");
          if (v === "0") return false;
          if (v === "1") return true;
          return localStorage.getItem("obr-suite/sfx-on") !== "0";
        } catch { return true; }
      })();
      return `
        ${INITIATIVE_DESC[lang]}
        <h3>${lang === "zh" ? "选项" : "Options"}</h3>
        <div class="row">
          <div class="lbl">
            ${lang === "zh" ? "轮换时聚焦当前角色" : "Focus current character on turn change"}
            <div class="desc"><em>${
              lang === "zh"
                ? "下一回合时，所有客户端的镜头自动平移到当前行动角色身上。"
                : "When the turn advances, every client's camera pans to the active character."
            }</em></div>
          </div>
          <button class="tog ${
            focusOn ? "on" : ""
          }" data-key="initiativeFocusOnTurnChange" type="button" ${
            isGM ? "" : "disabled"
          } aria-pressed="${focusOn}"></button>
        </div>
        <div class="row">
          <div class="lbl">
            ${lang === "zh" ? "战斗准备阶段自动对齐网格中心" : "Auto-snap to grid centre on combat prep"}
            <div class="desc"><em>${
              lang === "zh"
                ? "进入「战斗准备」时，把所有先攻条目里的 token 吸附到最近的网格格子中心。"
                : "When combat preparation starts, every initiative token snaps to the centre of its nearest grid cell."
            }</em></div>
          </div>
          <button class="tog ${
            autoSnap ? "on" : ""
          }" data-key="initiativeAutoSnapOnPrep" type="button" ${
            isGM ? "" : "disabled"
          } aria-pressed="${autoSnap}"></button>
        </div>
        <div class="row">
          <div class="lbl">
            ${lang === "zh" ? "启用先攻 / 同步视口音效" : "Enable initiative + sync-viewport SFX"}
            <div class="desc"><em>${
              lang === "zh"
                ? "回合切换提示音、同步视口提示音。本地保存，只影响你自己的客户端。"
                : "Turn-change chime + sync-viewport chime. Saved locally — only affects your own client."
            }</em></div>
          </div>
          <button class="tog ${sfxOn ? "on" : ""}" data-key="sfxInitiative" type="button" aria-pressed="${sfxOn}"></button>
        </div>
        ${!isGM ? `<p class="role-notice">${lang === "zh" ? "玩家端只读 · 由 DM 设置（音效开关除外）" : "Read-only · Set by DM (except SFX toggle)"}</p>` : ""}
      `;
    },
    afterRender: (root) => {
      root
        .querySelector<HTMLButtonElement>('.tog[data-key="initiativeFocusOnTurnChange"]')
        ?.addEventListener("click", async () => {
          if (!isGM) return;
          const cur = getState().initiativeFocusOnTurnChange !== false;
          await setState({ initiativeFocusOnTurnChange: !cur });
        });
      root
        .querySelector<HTMLButtonElement>('.tog[data-key="initiativeAutoSnapOnPrep"]')
        ?.addEventListener("click", async () => {
          if (!isGM) return;
          const cur = !!getState().initiativeAutoSnapOnPrep;
          await setState({ initiativeAutoSnapOnPrep: !cur });
        });
      root
        .querySelector<HTMLButtonElement>('.tog[data-key="sfxInitiative"]')
        ?.addEventListener("click", (e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          const wasOn = btn.classList.contains("on");
          const next = !wasOn;
          try {
            localStorage.setItem("obr-suite/sfx-initiative", next ? "1" : "0");
            const diceOn = (() => {
              const v = localStorage.getItem("obr-suite/sfx-dice");
              if (v === "0") return false;
              if (v === "1") return true;
              return localStorage.getItem("obr-suite/sfx-on") !== "0";
            })();
            if (next === diceOn) {
              localStorage.setItem("obr-suite/sfx-on", next ? "1" : "0");
            }
          } catch {}
          btn.classList.toggle("on", next);
          btn.setAttribute("aria-pressed", String(next));
        });
    },
  },
  {
    id: "dice",
    zh: `${ICONS.d20} 骰子动效`,
    en: `${ICONS.d20} Dice Roll Effect`,
    moduleId: "dice",
    dynamicBody: (lang) => {
      // Per-client dice SFX gate. Reads / writes
      // localStorage["obr-suite/sfx-dice"]; defaults to the legacy
      // "obr-suite/sfx-on" value if the per-module pref isn't set.
      const sfxOn = (() => {
        try {
          const v = localStorage.getItem("obr-suite/sfx-dice");
          if (v === "0") return false;
          if (v === "1") return true;
          return localStorage.getItem("obr-suite/sfx-on") !== "0";
        } catch { return true; }
      })();
      return `
        ${DICE_DESC[lang]}
        <h3>${lang === "zh" ? "选项" : "Options"}</h3>
        <div class="row">
          <div class="lbl">
            ${lang === "zh" ? "启用骰子音效" : "Enable dice SFX"}
            <div class="desc"><em>${
              lang === "zh"
                ? "骰子翻滚、爆炸、命中音效。本地保存，只影响你自己的客户端。"
                : "Tumble, burst, crit/fail tones. Saved locally — only affects your own client."
            }</em></div>
          </div>
          <button class="tog ${sfxOn ? "on" : ""}" data-key="sfxDice" type="button" aria-pressed="${sfxOn}"></button>
        </div>
      `;
    },
    afterRender: (root) => {
      root.querySelector<HTMLButtonElement>('.tog[data-key="sfxDice"]')
        ?.addEventListener("click", (e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          const wasOn = btn.classList.contains("on");
          const next = !wasOn;
          try {
            localStorage.setItem("obr-suite/sfx-dice", next ? "1" : "0");
            // Mirror the user's intent into the legacy master key
            // when both per-module toggles agree, so future fallback
            // reads stay consistent.
            const initOn = (() => {
              const v = localStorage.getItem("obr-suite/sfx-initiative");
              if (v === "0") return false;
              if (v === "1") return true;
              return localStorage.getItem("obr-suite/sfx-on") !== "0";
            })();
            if (next === initOn) {
              localStorage.setItem("obr-suite/sfx-on", next ? "1" : "0");
            }
          } catch {}
          btn.classList.toggle("on", next);
          btn.setAttribute("aria-pressed", String(next));
        });
    },
  },
  {
    id: "portals",
    zh: `${ICONS.portal} 传送门`,
    en: `${ICONS.portal} Portals`,
    moduleId: "portals",
    dynamicBody: (lang) => {
      // Per-client localStorage; mirrors com.obr-suite/portals/blink-enabled.
      const blinkOn = (() => {
        try {
          const v = localStorage.getItem("com.obr-suite/portals/blink-enabled");
          if (v === "0") return false;
          if (v === "1") return true;
        } catch {}
        return true;
      })();
      const lbl = lang === "zh" ? "传送眨眼特效" : "Teleport Blink Effect";
      const desc = lang === "zh"
        ? "本机偏好。开启后传送瞬间播放闭眼/睁眼动画，闭眼时刻执行实际传送，因此略慢；关闭则直接平滑过场。"
        : "Per-client preference. When on, picking a destination plays a close-eye / open-eye animation with the actual teleport happening at the closed moment — slightly slower. Off = immediate smooth pan.";
      return `
        ${PORTALS_DESC[lang]}
        <h3>${lang === "zh" ? "选项" : "Options"}</h3>
        <div class="row">
          <div class="lbl">
            ${lbl}
            <div class="desc"><em>${desc}</em></div>
          </div>
          <button class="tog ${
            blinkOn ? "on" : ""
          }" data-key="portalBlinkEnabled" type="button" aria-pressed="${blinkOn}"></button>
        </div>
      `;
    },
    afterRender: (root) => {
      root
        .querySelector<HTMLButtonElement>('.tog[data-key="portalBlinkEnabled"]')
        ?.addEventListener("click", (e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          const wasOn = btn.classList.contains("on");
          const next = !wasOn;
          try {
            localStorage.setItem(
              "com.obr-suite/portals/blink-enabled",
              next ? "1" : "0",
            );
          } catch {}
          btn.classList.toggle("on", next);
          btn.setAttribute("aria-pressed", String(next));
        });
    },
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
