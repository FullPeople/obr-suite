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
import {
  exportScene,
  downloadBlob,
  type ExportProgress,
} from "./modules/worldPack/exporter";
import {
  importPackFromBlob,
  type ImportProgress,
} from "./modules/worldPack/importer";
import { ICONS } from "./icons";
import { assetUrl } from "./asset-base";
import { STABLE_HIDES } from "./feature-flags";
import {
  importLocalJson,
  importLocalMd,
  removeLocalFile,
  getLocalFiles,
  BC_LOCAL_CONTENT_CHANGED,
  type LocalFileMeta,
} from "./utils/localContent";

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
  "Misaka Mikoto","森海飞霞🐿","每日 1/? Fen²","北省","得君所见","蜗","鱼喵",
  "52Hertz","咩","饭盒是阿玛利斯靴子","白烏鴉","不周","喵呜嗷","咖啡","FyingFuji",
  "过路的蔚星","cc","豹式装甲启动","浮生若梦，为欢几何","守矢豆","星锑的TV","蠕行的漆黑","姜川安.",
  "机智大狐"
];

function supportersHtml(lang: Language): string {
  const list = SUPPORTERS.map(
    (n) => `<span class="backer">${n}</span>`,
  ).join("");
  return lang === "zh"
    ? `<h3>${ICONS.heart} 鸣谢</h3>
       <div class="backers-box">
         <p>感谢以下支持过作者的小伙伴：</p>
         <div class="backers">${list}</div>
         <p class="backers-extra">还有其他没留下名字的支持者们 — 你们让我能继续维持服务器费用和开发这个插件，泪目（如果想被列上来，赞助时备注一下昵称就行）。</p>
       </div>`
    : `<h3>${ICONS.heart} Thanks</h3>
       <div class="backers-box">
         <p>Thanks to everyone who's chipped in to keep this project alive:</p>
         <div class="backers">${list}</div>
         <p class="backers-extra">…and to every supporter who didn't leave a name — you let me keep paying the server bills and shipping new features. *tearing up* (Drop a nickname in your tip note if you'd like to be listed.)</p>
       </div>`;
}

const SUPPORT: BilingualHtml = {
  zh: `
    <p>这套插件由 <b>弗人 FullPeople</b> 利用业余时间维护，所有代码开源于 GitHub。如果它对你的跑团有帮助，欢迎以下方式支持作者：</p>
    <div class="support-row">
      <a class="support-btn kofi" href="${KOFI_URL}" target="_blank" rel="noopener"><span class="ic">${ICONS.coffee}</span> Support on Ko-fi</a>
      <a class="support-btn afdian" href="${AFDIAN_URL}" target="_blank" rel="noopener"><span class="ic">${ICONS.heart}</span> 前往爱发电</a>
      <span class="qr-pair" title="微信 / 支付宝">
        <img class="qr-thumb" src="${assetUrl("wx.png")}" alt="微信" loading="lazy">
        <img class="qr-thumb" src="${assetUrl("zfb.jpg")}" alt="支付宝" loading="lazy">
      </span>
    </div>
    <p style="font-size:11px;color:#9aa0b3;margin-top:-2px">微信 / 支付宝扫码也可以，备注里留个昵称就能上鸣谢墙。</p>
    ${supportersHtml("zh")}
    <h3>${ICONS.mail} 反馈</h3>
    <div class="contact-box">
      <p>遇到 bug、想加新功能、想交流插件开发，欢迎邮件联系：</p>
      <p>邮箱：<a href="mailto:${EMAIL}"><code>${EMAIL}</code></a></p>
      <p>GitHub：<a href="${GITHUB_URL}" target="_blank">${GITHUB_URL}</a></p>
    </div>
    <div class="note">
      插件目前自托管在作者的服务器上，每月都有服务器费用在跑。作者也会时不时更新优化、修 bug、加新功能，请大家见谅 (｀・ω・´)ゞ。代码以 <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank">GNU GPL-3.0</a> 协议发布 —— 可自由查看 / 修改 / 再分发（含商业），衍生作品需保持 GPL-3.0 并附带源码。
    </div>
  `,
  en: `
    <p>This plugin suite is built and maintained by <b>弗人 FullPeople</b> in spare time, with all code open-sourced on GitHub. If you find it useful for your campaigns, here are ways to support the author:</p>
    <div class="support-row">
      <a class="support-btn kofi" href="${KOFI_URL}" target="_blank" rel="noopener"><span class="ic">${ICONS.coffee}</span> Support on Ko-fi</a>
      <a class="support-btn afdian" href="${AFDIAN_URL}" target="_blank" rel="noopener"><span class="ic">${ICONS.heart}</span> Afdian (Chinese Patreon)</a>
      <span class="qr-pair" title="WeChat / Alipay (CN)">
        <img class="qr-thumb" src="${assetUrl("wx.png")}" alt="WeChat Pay" loading="lazy">
        <img class="qr-thumb" src="${assetUrl("zfb.jpg")}" alt="Alipay" loading="lazy">
      </span>
    </div>
    <p style="font-size:11px;color:#9aa0b3;margin-top:-2px">WeChat / Alipay also works for CN supporters — leave a nickname in the tip note to get listed in the wall below.</p>
    ${supportersHtml("en")}
    <h3>${ICONS.mail} Feedback</h3>
    <div class="contact-box">
      <p>Found a bug, want a feature, or want to chat about plugin dev — please reach out:</p>
      <p>Email: <a href="mailto:${EMAIL}"><code>${EMAIL}</code></a></p>
      <p>GitHub: <a href="${GITHUB_URL}" target="_blank">${GITHUB_URL}</a></p>
    </div>
    <div class="note">
      The plugin is self-hosted by the author at their own monthly cost, with continuous updates and bug fixes. Source under <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank">GNU GPL-3.0</a> — view, modify, redistribute (including commercially); derivative works must keep GPL-3.0 and ship source.
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
  zh: `<p><b>用法</b>：右键画布或角色 → <em>开启时停</em>。</p>
<ul>
  <li>屏幕上下淡入<b>电影黑边</b>，提醒玩家暂停</li>
  <li>玩家<b>无法操作画布</b>（拖动 / 删除 / 选中）</li>
  <li><b>DM 不受影响</b>，可继续摆放怪物 / 修改地图</li>
  <li>时停期间加入的玩家也自动进入时停状态</li>
</ul>`,
  en: `<p><b>Usage</b>: right-click canvas or token → <em>Start Time Stop</em>.</p>
<ul>
  <li><b>Cinema black bars</b> fade in top and bottom</li>
  <li>Players <b>can't interact</b> with the canvas</li>
  <li><b>DM keeps full control</b> — keep editing the map freely</li>
  <li>Players who join mid-stop also see the frozen state</li>
</ul>`,
};
const FOCUS_DESC: BilingualHtml = {
  zh: `<p><b>用法</b>：右键画布 → <em>全员聚焦到此处</em>，或点 cluster 的「<b>同步视口</b>」。</p>
<ul>
  <li><b>所有玩家</b>的摄像头瞬移到指定位置</li>
  <li>cluster 按钮：选中 token 时聚焦该 token，未选中时聚焦<b>当前视口中心</b></li>
</ul>`,
  en: `<p><b>Usage</b>: right-click canvas → <em>Focus everyone here</em>, or press cluster's <b>Sync Viewport</b>.</p>
<ul>
  <li>Every player's camera pans to the target instantly</li>
  <li>Cluster button: focuses the selected token, falling back to <b>current viewport centre</b></li>
</ul>`,
};
const BESTIARY_DESC: BilingualHtml = {
  zh: `<p>来自 5etools 的<b>全 D&amp;D 5E 怪物库</b>，搜索 + 拖动召唤。<b>仅 DM 可见</b>。</p>
<ul>
  <li>左侧 tool 栏 <b>${ICONS.dragon}</b> 图标 / 快捷键 <kbd>Shift+A</kbd> 打开</li>
  <li><b>中英文搜索</b> + CR 排序；筛选受<em>基础设置 → 数据版本</em>控制</li>
  <li><b>拖动</b>怪物卡到场景 = 召唤；自动配 HP/AC/DEX；面板顶部「<em>自动先攻</em>」按钮决定是否加入先攻</li>
  <li>选中已召唤怪物 → 顶部弹出完整 stat block（受悬浮窗开关控制）</li>
  <li>右键 token：未绑定 → <em>绑定怪物图鉴</em>；已绑定 → <em>更换 / 移除绑定</em>。bubbles HP/AC/名字会跟着更新</li>
  <li>怪物面板：<b>左键明骰</b>；<b>右键</b>弹菜单（投掷 / 暗骰 / 优势 / 劣势 / 添加到骰盘）</li>
</ul>`,
  en: `<p>Full <b>D&amp;D 5E monster library</b> from 5etools — search + drag-to-spawn. <b>DM only</b>.</p>
<ul>
  <li>Open via the left-rail <b>${ICONS.dragon}</b> tool icon, or shortcut <kbd>Shift+A</kbd></li>
  <li><b>CN/EN search</b> + CR sort; filtered by <em>Basics → Data version</em></li>
  <li><b>Drag</b> a monster card onto the scene to spawn — HP/AC/DEX auto-set; the <em>Auto-init</em> toggle on the panel header decides whether spawned tokens join initiative</li>
  <li>Selecting a spawned monster shows the full stat block on top (gated by the auto-popup toggle)</li>
  <li>Right-click a token: unbound → <em>Bind Monster</em>; bound → <em>Replace / Unbind</em>. Bubbles HP/AC/name update automatically</li>
  <li>Monster panel: <b>left-click rolls open</b>; <b>right-click</b> opens the menu (Roll / Dark Roll / Advantage / Disadvantage / Add to Tray)</li>
</ul>`,
};
const CHARCARD_DESC: BilingualHtml = {
  zh: `<p>导入 <b>xlsx 角色卡</b>（D&amp;D 中文社区悲灵 v1.0.12 模板），自动渲染成可查阅的卡片。</p>
<ul>
  <li>cluster「<b>角色卡界面</b>」/ <kbd>CapsLock</kbd> 打开全屏面板</li>
  <li><b>拖入 xlsx</b>到侧栏 / 点 📁 选择文件上传</li>
  <li>卡旁 <b>↻</b> = 用新 xlsx 覆盖更新（Excel 改完保存→点刷新）</li>
  <li>选中绑定 token 时浮出<b>小信息框</b>（受悬浮窗开关控制）</li>
  <li>右键 token <b>绑定 / 解绑</b>角色卡</li>
  <li><b>可点击元素</b>：六维字母 = 豁免（含熟练）/ 修正 = 检定；武器命中 + 伤害骰；底部 <em>特性 / 专长 / 法术</em> chip → 填入全局搜索</li>
  <li><b>武器属性</b>（轻型 / 灵巧 / 精通词条）也可点击 → 直接查搜索定义</li>
</ul>
<p style="color:#f5c876;font-size:11.5px;margin-top:8px"><b>📱 手机端</b>：全屏面板按钮被隐藏（小屏不可用 + 内存吃紧）。手机玩家仍可通过绑定 token 的小信息框查看。</p>`,
  en: `<p><b>${ICONS.warning} Designed for the Chinese D&amp;D community's xlsx sheet (悲灵 v1.0.12). Generic English sheets will not parse.</b></p>
<ul>
  <li>cluster's <b>Character Card Panel</b> / <kbd>CapsLock</kbd> opens the fullscreen view</li>
  <li><b>Drag</b> an xlsx onto the side panel / click 📁 to upload</li>
  <li>Each card's <b>↻</b> button = re-pick xlsx to overwrite in place</li>
  <li>Selecting a bound token shows a <b>small info popup</b> (auto-popup toggle)</li>
  <li>Right-click a token to <b>bind / unbind</b> a card</li>
  <li><b>Clickable</b>: ability letters = saves (with proficiency) / modifiers = checks; weapon attack + damage; bottom <em>Traits / Feats / Spells</em> chips fill the global search</li>
  <li><b>Weapon properties</b> (light / finesse / mastery tags) are also clickable → opens the rule definition in search</li>
</ul>
<p style="color:#f5c876;font-size:11.5px;margin-top:8px"><b>📱 Mobile</b>: fullscreen panel button hidden (not usable on small screens + memory cost). Mobile players still see card info via the bound-token popup.</p>`,
};
const INITIATIVE_DESC: BilingualHtml = {
  zh: `<p>顶部居中的横向先攻条，覆盖完整 D&amp;D 战斗流程。</p>
<ul>
  <li><b>加入</b>：右键角色 → <em>加入先攻</em>（支持框选多个）</li>
  <li><b>投骰</b>：每张卡下方<b>三色括号</b>= 劣势 / 普通 / 优势；玩家有 Dice+ 则联动，否则本地骰；DM 始终本地</li>
  <li><b>切换回合</b>：所有人摄像头自动聚焦到当前角色</li>
  <li><b>集结</b>：右键空白处 → <em>集结先攻角色</em>（螺旋排列）</li>
  <li><b>owner 玩家</b>可投自己的先攻、改加值、点结束按钮自动进入下一回合</li>
  <li>卡片<b>顶部</b>显示血条遮罩（与 bubbles 一致），底部数字 = 骰值 / 最终值 双模切换</li>
</ul>`,
  en: `<p>Top-center horizontal initiative strip — full D&amp;D combat flow.</p>
<ul>
  <li><b>Add</b>: right-click a token → <em>Add to initiative</em> (box-select supported)</li>
  <li><b>Roll</b>: three colored brackets under each slot = Disadv / Normal / Adv. Players use Dice+ if available, fallback to local; DM always local</li>
  <li><b>Turn change</b>: every camera auto-focuses on the active token</li>
  <li><b>Gather</b>: right-click empty space → <em>Gather initiative tokens</em> (spiral layout)</li>
  <li><b>Owner-players</b> can roll their own initiative, edit modifier, and end their own turn</li>
  <li>Each card has an <b>HP fill bar</b> on top (matches bubbles) + raw / final-value toggle for the count footer</li>
</ul>`,
};
const DICE_DESC: BilingualHtml = {
  zh: `<p>完整的骰子系统：表达式 / 多目标 / 历史 / 回放 / 音效。点击屏幕左上角的 OBR 动作按钮（<b>d20 图标</b>）打开主面板。</p>

<details class="rules-collapse">
  <summary><b>表达式语法</b>（点击展开 · 在面板里输入或保存为组合）</summary>
  <ul>
    <li><code>2d6 + 1d20 + 5</code> — 标准混合表达式</li>
    <li><code>1d20-1d6</code> — 减骰（被减项半透明显示，仍参与动画）</li>
    <li><code>adv(1d20)</code> / <code>dis(1d20)</code> — 优势 / 劣势（败方淡出）</li>
    <li><code>adv(1d20, 2)</code> — 精灵之准（投 3 组取最高）</li>
    <li><code>max(1d20, 10)</code> / <code>min(1d20, 15)</code> — 保底 / 封顶</li>
    <li><code>reset(1d20, 12)</code> — 等于 12 时重投一次</li>
    <li><code>resetmin(1d20, 5)</code> — ≤5 时重投一次</li>
    <li><code>resetmax(1d20, 18)</code> — ≥18 时重投一次</li>
    <li><code>burst(2d6)</code> — 术法爆发：每个最大点追加一颗，链长上限 5</li>
    <li><code>same(2d20)</code> — 重复值高亮</li>
    <li><code>repeat(3, 1d20+5)</code> — 重复 3 次，每行独立总和</li>
    <li>嵌套自由：<code>adv(max(1d20, 10) + 5)</code>。中文括号/逗号自动识别</li>
    <li><kbd>Enter</kbd> 直接发送；输入 <code>(</code> 自动补 <code>)</code></li>
  </ul>
</details>

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
  en: `<p>Full tactical-dice system: expressions / multi-target / history / replay / SFX. Click the OBR action button at the top-left (<b>d20 icon</b>) to open the main panel.</p>

<details class="rules-collapse">
  <summary><b>Expression syntax</b> (click to expand · type into the panel or save as combos)</summary>
  <ul>
    <li><code>2d6 + 1d20 + 5</code> — standard mixed expression</li>
    <li><code>1d20-1d6</code> — subtraction dice (subtracted die rendered semi-transparent)</li>
    <li><code>adv(1d20)</code> / <code>dis(1d20)</code> — advantage / disadvantage</li>
    <li><code>adv(1d20, 2)</code> — Elven Accuracy (roll 3 sets, take highest)</li>
    <li><code>max(1d20, 10)</code> / <code>min(1d20, 15)</code> — floor / ceiling</li>
    <li><code>reset(1d20, 12)</code> — reroll once when result equals 12</li>
    <li><code>resetmin(1d20, 5)</code> — reroll once when value ≤ 5</li>
    <li><code>resetmax(1d20, 18)</code> — reroll once when value ≥ 18</li>
    <li><code>burst(2d6)</code> — spell-burst (each max face adds another die, chain ≤ 5)</li>
    <li><code>same(2d20)</code> — duplicate-value highlight</li>
    <li><code>repeat(3, 1d20+5)</code> — N independent rows, each with its own total</li>
    <li>Nests freely: <code>adv(max(1d20, 10) + 5)</code>. CN parens / commas auto-recognized</li>
    <li><kbd>Enter</kbd> rolls; <code>(</code> auto-closes to <code>()</code></li>
  </ul>
</details>

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
  zh: `<p>左侧 tool 栏的「<b>传送门</b>」用于在场景里画出可触发的传送圆。</p>
<ul>
  <li><b>新建</b>：选中工具，地图上<b>拖拽画圆</b> → 松手即建。圆心放 SVG 标记，半径为触发范围</li>
  <li><b>命名</b>：松手弹编辑面板。「名字」和「标签」均带预设；点 <em>+ 添加当前</em> 把当前输入存为预设</li>
  <li>面板<b>关闭即保存</b>，<em>取消</em>则还原原值</li>
  <li><b>同标签互联</b>：玩家拖 token 进入任一传送门 → 弹选项选同标签目的地；多选时所有 token 以六边形<b>集结</b>到目的地</li>
  <li>DM 点击已有传送门 → 编辑面板可改名 / 改标签（删除请用 OBR 自带的删除）</li>
  <li>把传送门设为<b>不可见</b>（OBR visible=false）→ 玩家看不见也无法触发，但<b>仍能作为目的地</b>，做单向传送很合用</li>
</ul>`,
  en: `<p>The <b>Portal</b> tool on the left rail draws teleport circles in your scene.</p>
<ul>
  <li><b>Create</b>: activate the tool, <b>click-drag a circle</b> on the map → release to commit. SVG marker at the centre, drag distance = trigger radius</li>
  <li><b>Name</b>: edit panel pops on release. Both "Name" and "Tag" support presets; click <em>+ Add current</em> to save the current input as a preset</li>
  <li>Panel <b>auto-saves on close</b>; <em>Cancel</em> reverts</li>
  <li><b>Same-tag portals link</b>: dragging a token into any visible portal lets the player pick a same-tag destination; multi-select gathers everyone in a hex spiral</li>
  <li>DM clicks an existing portal → edit panel rename / re-tag (use OBR's native delete to remove)</li>
  <li>Set a portal to <b>invisible</b> (OBR visible=false) → players can't see or enter it, but it <b>still works as a destination</b>. Perfect for one-way teleports</li>
</ul>`,
};
const SEARCH_DESC: BilingualHtml = {
  zh: `<p>右上角搜索栏，<b>5etools 全分类</b>联想。</p>
<ul>
  <li><b>位置</b>：搜索栏在屏幕<em>哪一侧</em>就向反方向展开；上半屏详情向下，下半屏详情向上</li>
  <li><b>覆盖</b>：怪物 / 法术 / 物品 / 职业 / 子职业 / 子职能力 / 种族 / 子种族 / 背景 / 专长 / 灵能 / 状态 / 神祇 / 表格 / 整本书 …</li>
  <li><b>悬停</b>词条 → 右侧浮出详情；<b>点击</b>词条钉住</li>
  <li>结果受<em>基础设置 → 数据版本</em>过滤；玩家能否查怪物由本页下方开关控制</li>
  <li>角色卡 / 怪物面板的特性、法术、武器属性 chip 都能点击 → 自动填入本搜索栏</li>
</ul>
<p style="color:#f5c876;font-size:11.5px;margin-top:8px"><b>📱 手机端</b>：搜索栏不注册（5etools 全索引太占内存）。手机玩家请在桌面/平板上查。</p>`,
  en: `<p>Top-right search bar + <b>full 5etools</b> autocomplete.</p>
<ul>
  <li><b>Position</b>: the bar expands AWAY from whichever screen edge it sits on; top half pushes detail down, bottom half pushes it up</li>
  <li><b>Covers</b>: monsters / spells / items / classes / subclasses / subclass-features / races / subraces / backgrounds / feats / psionics / conditions / deities / tables / books …</li>
  <li><b>Hover</b> an entry → right pane shows details; <b>click</b> to pin</li>
  <li>Filtered by <em>Basics → Data version</em>; player monster-search gated by the toggle below</li>
  <li>Card / monster-panel feature, spell, and weapon-property chips are all click-to-search</li>
</ul>
<p style="color:#f5c876;font-size:11.5px;margin-top:8px"><b>📱 Mobile</b>: the search bar isn't registered (the 5etools dataset is too memory-heavy on phones). Use a desktop / tablet for lookups.</p>`,
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

const AI_PROMPT_TEMPLATE = `你是一个 D&D 5E 数据格式工程师。请把我下面提供的怪物 / 法术 / 物品资料，转换为符合 5etools 数据规范的 JSON 文件，可直接通过"📁 本地内容"导入到枭熊插件（无需托管）。

输出要求：
1. 按以下顶层结构产出 JSON 文件（整个文件就是一个 JSON 对象，顶层只有一个键）：
   - 怪物：{ "monster": [ {...}, {...} ] }
   - 法术：{ "spell":   [ {...}, {...} ] }
   - 物品：{ "item":    [ {...}, {...} ] }
2. 每个条目至少包含字段：
   - "name": 中文名称
   - "ENG_name": 英文名称（无英文则用拼音）
   - "source": 来源缩写（自定义即可，例如 "HOMEBREW"）
   - "page": 页码（无则填 0）
3. 怪物条目额外需要：size (T/S/M/L/H/G), type, alignment, ac (数组，例 [{"ac":18,"from":["plate armor"]}]), hp ({"average":63,"formula":"7d10 + 21"}), speed (对象 例 {"walk":40,"fly":30}), str/dex/con/int/wis/cha 六个能力值（整数）, cr (字符串，例 "1/2"、"4"), trait/action/reaction/legendary 等数组（可选）。每条 trait/action 形如 {"name":"...","entries":["..."]}。entries 里可使用 5etools 行内标签如 {@dice 1d6}, {@damage 2d6+3}, {@hit 5}, {@dc 14}, {@atk mw}, {@h}。
4. 法术条目额外需要：level (整数), school (A/C/D/E/I/N/T/V), time, range, components ({v, s, m}), duration, classes, entries。
5. 物品条目额外需要：type, weight, value, rarity, entries；武器再加 dmg1, dmgType, property。
6. **不要**追加 search/index.json 那种 entry index 项 —— 本地导入会从顶层数组自动生成索引。
7. **不要**输出说明文字、Markdown 围栏或任何解释 —— 整个回复就是一个有效的 JSON 对象。

下面是我的资料：

`;

const AI_PROMPT_MD_TEMPLATE = `你是一个 D&D 5E 数据格式工程师。请把我下面提供的怪物资料，转换为枭熊插件支持的 Markdown 格式（可直接通过"📁 本地内容 → 导入 MD 文件"导入，每个文件包含一个怪物）。

输出格式严格如下：

---
name: 中文名称
ENG_name: English Name
source: HOMEBREW
page: 0
size: M
type: monstrosity
alignment: U
ac: 14 (natural armor)
hp: 22 (5d4 + 10)
speed: walk 40, fly 30, hover
str: 6
dex: 16
con: 14
int: 8
wis: 12
cha: 10
cr: "1/2"
senses: darkvision 60 ft., passive Perception 13
languages: Common
---

## Traits
### 特性名 / Feature Name
特性描述。可用 {@damage 1d4} 等 5etools 行内标签。

## Actions
### 动作名 / Action Name
{@atk mw} {@hit 5} to hit, reach 5 ft., one target. {@h}{@damage 2d6+3} damage.

## Reactions
### 反应名（可选）
反应描述。

## Legendary Actions
### 传奇动作名（可选）
传奇动作描述。

要求：
1. frontmatter 在顶部 \`---\` 之间，用 YAML 风格的 \`key: value\`。cr 用字符串（"1/2" / "4" / "12"）。
2. ac 写成 "数字 (来源)" 或 "数字"。hp 写成 "average (formula)" 或 "average"。speed 用逗号分隔多种移动模式。
3. \`## Traits\` / \`## Actions\` / \`## Reactions\` / \`## Legendary Actions\` 是固定标题（中英文都可识别），下面用 \`### 名字\` 子标题分别描述每条特性 / 动作。
4. 不要输出额外解释文字 —— 整个回复就是这一个 .md 文件。

下面是我的资料：

`;

// =====================================================================
// Library preview / diagnostic
// =====================================================================
//
// Click the preview button on a library row to:
//   1. Fetch <base>/search/index.json and report status
//   2. List the entries with their category + source
//   3. Sample-load the first per-source data file (e.g.
//      bestiary-HOMEBREW.json) so the user can see exactly what
//      this plugin would receive when looking up a real entry
//   4. Show CORS / 404 / JSON-parse errors verbatim

const CATEGORY_LABEL_ZH: Record<number, string> = {
  1: "怪物", 2: "法术", 3: "背景", 4: "物品", 6: "状态",
  7: "专长", 8: "能力", 9: "灵能", 10: "种族", 11: "奖励",
  12: "副规则", 13: "冒险", 14: "神祇", 15: "载具",
  16: "陷阱", 17: "灾害", 19: "教派", 20: "恩惠",
  21: "疾病", 24: "表格", 42: "动作", 43: "语言",
  46: "怪物概述", 48: "食谱", 52: "牌组",
};

function categoryFilePathFor(c: number, source: string): string | null {
  // Mirror of CATEGORY[].data in modules/search/page.ts. Returns the
  // data path (relative to <base>/data/) or null when this category
  // doesn't have a per-source data file.
  switch (c) {
    case 1: return `bestiary/bestiary-${source}.json`;
    case 2: return `spells/spells-${source}.json`;
    case 3: return `backgrounds.json`;
    case 4: case 31: case 47: case 56: case 57: return `items.json`;
    case 6: case 21: case 49: return `conditionsdiseases.json`;
    case 7: return `feats.json`;
    case 8: case 22: case 23: case 27: case 29: case 32: case 33: case 34: case 37: return `optionalfeatures.json`;
    case 9: return `psionics.json`;
    case 10: return `races.json`;
    case 11: return `rewards.json`;
    case 12: return `variantrules.json`;
    case 13: return `adventures.json`;
    case 14: return `deities.json`;
    case 15: case 35: return `vehicles.json`;
    case 16: case 17: return `trapshazards.json`;
    case 18: case 44: return `books.json`;
    case 19: case 20: return `cultsboons.json`;
    case 24: return `tables.json`;
    case 42: return `actions.json`;
    case 43: return `languages.json`;
    case 46: return `bestiary/fluff-bestiary-${source}.json`;
    case 48: return `recipes.json`;
    case 52: return `decks.json`;
    case 54: return `items.json`;
    default: return null;
  }
}

interface PreviewIndexEntry {
  id?: number;
  c?: number;
  n?: string;
  cn?: string;
  s?: string | number;
  u?: string;
}

interface PreviewResult {
  baseUrl: string;
  indexUrl: string;
  /** undefined while loading; "ok" / "fail" once resolved. */
  state: "loading" | "ok" | "fail";
  errorMsg?: string;
  entryCount: number;
  sourceMap: Array<{ code: string; id: number }>;
  entries: PreviewIndexEntry[];
  dataProbes: Array<{
    label: string;
    url: string;
    ok: boolean;
    statusMsg: string;
    arrayCount?: number;
  }>;
}

async function probeLibrary(baseUrl: string): Promise<PreviewResult> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const indexUrl = `${cleanBase}/search/index.json`;
  const result: PreviewResult = {
    baseUrl: cleanBase,
    indexUrl,
    state: "loading",
    entryCount: 0,
    sourceMap: [],
    entries: [],
    dataProbes: [],
  };
  try {
    const res = await fetch(indexUrl, { cache: "no-cache" });
    if (!res.ok) {
      result.state = "fail";
      result.errorMsg = `${indexUrl} → HTTP ${res.status} ${res.statusText}`;
      return result;
    }
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch (e: any) {
      result.state = "fail";
      result.errorMsg = `JSON 解析失败：${e?.message || String(e)}`;
      return result;
    }
    if (!parsed || !Array.isArray(parsed.x)) {
      result.state = "fail";
      result.errorMsg = "search/index.json 格式不对：缺少 x 数组";
      return result;
    }
    result.state = "ok";
    result.entryCount = parsed.x.length;
    if (parsed.m?.s && typeof parsed.m.s === "object") {
      for (const [code, id] of Object.entries(parsed.m.s)) {
        result.sourceMap.push({ code, id: Number(id) });
      }
    }
    // Show first 30 entries — usually enough to spot obvious typos.
    result.entries = parsed.x.slice(0, 30);
  } catch (e: any) {
    result.state = "fail";
    // Most common: CORS rejection (browser surfaces it as a generic
    // TypeError). Mention CORS in the message so the user can fix it
    // on their host.
    const msg = e?.message || String(e);
    result.errorMsg = `${msg}\n（如果错误形如 "TypeError: Failed to fetch"，多半是 CORS 没开放；GitHub Pages 默认就有 Access-Control-Allow-Origin: *。）`;
    return result;
  }

  // Sample data-file probes: for each unique (c, source) seen in the
  // first 30 entries, fetch the corresponding data file and report
  // status. Cap at 5 probes so a huge library doesn't fan out.
  const seen = new Set<string>();
  for (const e of result.entries) {
    if (typeof e.c !== "number") continue;
    let src = "";
    if (typeof e.s === "string") src = e.s;
    else if (typeof e.s === "number") {
      const found = result.sourceMap.find((m) => m.id === e.s);
      src = found?.code ?? "";
    }
    if (!src) continue;
    const key = `${e.c}:${src}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (result.dataProbes.length >= 5) break;
    const path = categoryFilePathFor(e.c, src);
    if (!path) continue;
    const url = `${cleanBase}/data/${path}`;
    const label = `${CATEGORY_LABEL_ZH[e.c] ?? "类别" + e.c} · ${src}`;
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) {
        result.dataProbes.push({
          label, url, ok: false,
          statusMsg: `HTTP ${res.status} ${res.statusText}`,
        });
        continue;
      }
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        // The top-level array key matches the category — pick the
        // first array we find.
        let count = 0;
        for (const k of Object.keys(data)) {
          if (Array.isArray(data[k])) { count = data[k].length; break; }
        }
        result.dataProbes.push({
          label, url, ok: true,
          statusMsg: `200 OK`,
          arrayCount: count,
        });
      } catch (e: any) {
        result.dataProbes.push({
          label, url, ok: false,
          statusMsg: `JSON 解析失败：${e?.message || String(e)}`,
        });
      }
    } catch (e: any) {
      result.dataProbes.push({
        label, url, ok: false,
        statusMsg: `网络错误：${e?.message || String(e)}`,
      });
    }
  }
  return result;
}

function renderPreviewHtml(p: PreviewResult, lang: Language): string {
  if (p.state === "loading") {
    return `<div class="lib-preview-body">${lang === "zh" ? "加载中…" : "Loading…"}</div>`;
  }
  if (p.state === "fail") {
    return `
      <div class="lib-preview-body">
        <div class="lib-preview-status fail">
          ✗ ${escapeAttr(p.indexUrl)}
        </div>
        <pre class="lib-preview-err">${escapeAttr(p.errorMsg ?? "未知错误")}</pre>
        <p class="lib-preview-hint">
          ${lang === "zh"
            ? "排查清单：1) URL 拼写正确（不带末尾斜杠）；2) 直接在浏览器打开 search/index.json 看是否能访问；3) 如果浏览器能但插件不能，多半是目标站点 CORS 没开放（响应头需 Access-Control-Allow-Origin: *）。"
            : "Checklist: 1) Verify the URL (no trailing slash); 2) Open search/index.json directly in browser; 3) If the browser sees it but the plugin doesn't, the host probably doesn't send Access-Control-Allow-Origin: *."}
        </p>
      </div>
    `;
  }
  // ok
  const sourceMap = p.sourceMap.length > 0
    ? p.sourceMap
        .map((m) => `<code>${escapeAttr(m.code)}=${m.id}</code>`)
        .join(" ")
    : `<em>${lang === "zh" ? "（空 — 没问题，但条目里如果用数字 s 就解不开）" : "(empty — fine if entries use string s, but numeric s won't resolve)"}</em>`;
  const entryRows = p.entries.length === 0
    ? `<p class="lib-preview-empty">${lang === "zh" ? "索引文件里没有 x 条目。" : "Index has no x entries."}</p>`
    : `<table class="lib-preview-tbl"><thead>
        <tr>
          <th>#</th>
          <th>${lang === "zh" ? "类别" : "c"}</th>
          <th>${lang === "zh" ? "中文名" : "cn"}</th>
          <th>${lang === "zh" ? "英文名" : "n"}</th>
          <th>${lang === "zh" ? "来源" : "s"}</th>
          <th>${lang === "zh" ? "slug" : "u"}</th>
        </tr></thead><tbody>
        ${p.entries.map((e, i) => `
          <tr>
            <td>${e.id ?? i}</td>
            <td>${e.c ?? "?"} ${CATEGORY_LABEL_ZH[e.c ?? -1] ?? ""}</td>
            <td>${escapeAttr(e.cn ?? "")}</td>
            <td>${escapeAttr(e.n ?? "")}</td>
            <td><code>${escapeAttr(String(e.s ?? ""))}</code></td>
            <td><code>${escapeAttr(e.u ?? "")}</code></td>
          </tr>
        `).join("")}
      </tbody></table>`;
  const probeRows = p.dataProbes.length === 0
    ? `<p class="lib-preview-empty">${lang === "zh" ? "（没有可探测的数据文件，索引可能为空或没有 c 字段）" : "(no probes — empty index or missing c field)"}</p>`
    : p.dataProbes.map((d) => `
        <div class="lib-preview-probe ${d.ok ? "ok" : "fail"}">
          <span class="lib-preview-probe-label">${d.ok ? "✓" : "✗"} ${escapeAttr(d.label)}</span>
          <span class="lib-preview-probe-url">${escapeAttr(d.url)}</span>
          <span class="lib-preview-probe-status">${escapeAttr(d.statusMsg)}${d.arrayCount != null ? ` · ${d.arrayCount} ${lang === "zh" ? "条" : "entries"}` : ""}</span>
        </div>
      `).join("");

  return `
    <div class="lib-preview-body">
      <div class="lib-preview-status ok">
        ✓ ${escapeAttr(p.indexUrl)}
        <span class="lib-preview-count">· ${p.entryCount} ${lang === "zh" ? "条目" : "entries"} · ${p.sourceMap.length} ${lang === "zh" ? "来源" : "sources"}</span>
      </div>
      <div class="lib-preview-section">
        <div class="lib-preview-h">${lang === "zh" ? "来源映射 (m.s)" : "Source map (m.s)"}</div>
        <div class="lib-preview-srcmap">${sourceMap}</div>
      </div>
      <div class="lib-preview-section">
        <div class="lib-preview-h">${lang === "zh" ? `条目（前 ${p.entries.length} 条）` : `Entries (first ${p.entries.length})`}</div>
        ${entryRows}
      </div>
      <div class="lib-preview-section">
        <div class="lib-preview-h">${lang === "zh" ? "数据文件探测（每个唯一 c+s 试一次）" : "Data-file probes (one per unique c+s)"}</div>
        ${probeRows}
      </div>
      <p class="lib-preview-hint">
        ${lang === "zh"
          ? "如果搜索时仍找不到这里出现的条目，请检查：1) 库已经勾选启用；2) 已清掉浏览器搜索缓存（重新打开搜索框就会刷新）；3) 数据版本设置（基础设置）有没有把它过滤掉 —— 自定义 source 都属于 \"other\"，应该不受 2014/2024 影响。"
          : "If the search still misses entries shown here: 1) library is toggled ON; 2) search cache is cleared (just close + reopen the search bar); 3) data-version setting (Basics tab) — custom sources are always 'other' and unaffected by the 2014/2024 toggles."}
      </p>
    </div>
  `;
}

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
        <button class="lib-preview-btn" type="button" title="${lang === "zh" ? "预览：检测此库的索引和数据文件能否加载" : "Preview: probe this library's index + data files"}">${lang === "zh" ? "🔍 预览" : "🔍 Preview"}</button>
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
      <div class="lib-preview" hidden></div>
    </div>
  `;
}

function escapeAttr(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function renderLocalContentBlock(lang: Language): string {
  const files = getLocalFiles();
  const empty = lang === "zh"
    ? "<p class=\"lib-local-empty\">还没导入任何本地文件。</p>"
    : "<p class=\"lib-local-empty\">No local files imported yet.</p>";
  const rows = files.map((f) => localFileRowHtml(f, lang)).join("");
  const head = lang === "zh"
    ? `
      <h3 class="lib-local-h">📁 本地内容（无需托管）</h3>
      <p class="lib-local-desc">把符合 5etools 规范的 JSON / MD 文件直接导入到本插件，存储在浏览器本地（不上传到任何服务器）。导入的内容会自动合并到搜索框 / 怪物图鉴里。每个客户端独立，DM 端导入的不会自动同步给玩家 —— 想全员共享请使用上面的 URL 库或自己托管。</p>
    `
    : `
      <h3 class="lib-local-h">📁 Local content (no hosting needed)</h3>
      <p class="lib-local-desc">Import 5etools-shaped JSON / MD files directly into the suite. Stored in your browser (never uploaded to any server). Imports merge into search + bestiary automatically. Storage is per-client — DM imports don't auto-sync to players. For shared content use the URL libraries above.</p>
    `;
  const buttons = isGM ? `
    <div class="lib-local-actions">
      <button class="lib-local-import-json" type="button">${lang === "zh" ? "+ 导入 JSON 文件" : "+ Import JSON"}</button>
      <button class="lib-local-import-md" type="button">${lang === "zh" ? "+ 导入 MD 文件" : "+ Import MD"}</button>
      <input class="lib-local-file-input" type="file" accept=".json,.md,application/json,text/markdown" hidden>
    </div>
  ` : `<p class="role-notice">${lang === "zh" ? "玩家端只读 · 由 DM 设置" : "Read-only · Set by DM"}</p>`;
  return `
    <div class="lib-local">
      ${head}
      ${buttons}
      <div class="lib-local-list">${files.length ? rows : empty}</div>
    </div>
  `;
}

function localFileRowHtml(f: LocalFileMeta, lang: Language): string {
  const kindLabel: Record<string, string> = lang === "zh" ? {
    monster: "怪物", spell: "法术", item: "物品", feat: "专长", race: "种族",
    background: "背景", optionalfeature: "能力", condition: "状态", vehicle: "载具",
    deity: "神祇", language: "语言", psionic: "灵能", reward: "奖励",
    variantrule: "副规则", trap: "陷阱", hazard: "灾害", cult: "教派",
    boon: "恩惠", disease: "疾病", table: "表格", action: "动作",
    recipe: "食谱", deck: "牌组",
  } : {
    monster: "Monster", spell: "Spell", item: "Item", feat: "Feat", race: "Race",
    background: "Background", optionalfeature: "Feature", condition: "Condition",
    vehicle: "Vehicle", deity: "Deity", language: "Language", psionic: "Psionic",
    reward: "Reward", variantrule: "Rule", trap: "Trap", hazard: "Hazard",
    cult: "Cult", boon: "Boon", disease: "Disease", table: "Table",
    action: "Action", recipe: "Recipe", deck: "Deck",
  };
  const kindStr = kindLabel[f.kind] || f.kind;
  const disable = isGM ? "" : "disabled";
  return `
    <div class="lib-local-row" data-local-id="${escapeAttr(f.id)}">
      <span class="lib-local-name" title="${escapeAttr(f.filename)}">${escapeAttr(f.filename)}</span>
      <span class="lib-local-meta">${escapeAttr(kindStr)} · ${f.count}</span>
      ${isGM ? `<button class="lib-local-del" type="button" ${disable} title="${lang === "zh" ? "删除" : "Delete"}">✕</button>` : ""}
    </div>
  `;
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
      <summary>${ICONS.book ?? ""} 如何编写自己的内容（含 AI 提示词）</summary>
      <div class="lib-tut-body">
        <h4>方式一（推荐）：本地导入 —— 不用托管</h4>
        <p>用 AI 把你的资料转成符合规范的 JSON 或 MD 文件，然后用上面的 <b>📁 本地内容 → 导入 JSON / MD</b> 直接选文件加载。整个文件存在你浏览器的 localStorage 里，不上传到任何服务器；导入的内容自动并入搜索框 / 怪物图鉴。每个客户端独立存储 —— 想全员共享请使用方式二。</p>

        <h4>方式二：托管 URL 库 —— 全员共享</h4>
        <p>把数据放到 HTTPS 静态站（GitHub Pages / 对象存储等），CORS 必须开放。目录结构：</p>
        <pre><code>your-host.com/
  search/
    index.json        ← 总索引（含每条 ENG_name + source + 类别号）
  data/
    bestiary/
      bestiary-HOMEBREW.json   ← 怪物（按 source 分文件）
    spells/
      spells-HOMEBREW.json     ← 法术
    items.json, feats.json, ...</code></pre>
        <p>然后在上面的 <b>+ 添加库</b> 里填入 URL（不带末尾斜杠）。本插件会从 search/index.json 自动推断要拉哪些数据文件，所以 <code>data/bestiary/index.json</code> 那个映射文件不是必须的。</p>

        <h4>JSON 格式示例（怪物）</h4>
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
      "trait": [{"name": "Cold Aura", "entries": ["Any creature within 5 ft. takes {@damage 1d4} cold damage."]}],
      "action": [{"name": "Frost Touch", "entries": ["{@atk ms} {@hit 5}, reach 5 ft., one target. {@h}{@damage 2d6+3} cold damage."]}]
    }
  ]
}</code></pre>
        <p>类别键：<code>monster</code>（怪物）/ <code>spell</code>（法术）/ <code>item</code>（物品）/ <code>feat</code>（专长）/ <code>race</code>（种族）/ <code>background</code>（背景）等。每个文件只有一个顶层键，里面是一个数组。</p>

        <h4>MD 格式示例（怪物，单怪）</h4>
        <pre><code>---
name: 霜灵精怪
ENG_name: Frost Wisp
source: HOMEBREW
size: T
type: elemental
ac: 14 (natural armor)
hp: 22 (5d4 + 10)
speed: fly 30, hover
str: 6
dex: 16
con: 14
int: 8
wis: 12
cha: 10
cr: "1/2"
---

## Traits
### Cold Aura
Any creature within 5 ft. takes {@damage 1d4} cold damage at the start of its turn.

## Actions
### Frost Touch
{@atk ms} {@hit 5}, reach 5 ft., one target. {@h}{@damage 2d6+3} cold damage.</code></pre>

        <h4>AI 提示词（JSON 版）</h4>
        <p>粘贴给 ChatGPT / Claude / DeepSeek / 通义千问 等模型，把怪物 / 法术 / 物品资料贴在末尾，模型会输出可直接导入的 JSON 文件。</p>
        <textarea class="lib-prompt" readonly>${escapeAttr(AI_PROMPT_TEMPLATE)}</textarea>
        <button class="lib-prompt-copy" type="button">复制 JSON 提示词</button>

        <h4>AI 提示词（MD 版，单怪物）</h4>
        <p>如果你想让 AI 输出更人类可读的 Markdown 格式（适合一次只录一个怪物，方便事后用任意编辑器修改）：</p>
        <textarea class="lib-prompt-md" readonly>${escapeAttr(AI_PROMPT_MD_TEMPLATE)}</textarea>
        <button class="lib-prompt-md-copy" type="button">复制 MD 提示词</button>

        <p style="color:#9ab;font-size:11px;margin-top:8px">本地导入失败时多半是 JSON 解析错（多 / 少逗号、引号没闭合）；URL 库加载失败开浏览器 DevTools 看 Network 面板，常见是 CORS / 404 / JSON 格式错误。</p>
      </div>
    </details>
  ` : `
    <details class="lib-tut">
      <summary>How to write your own content (with AI prompt)</summary>
      <div class="lib-tut-body">
        <h4>Option A (recommended): Local import — no hosting</h4>
        <p>Use an LLM to convert your raw notes into a 5etools-shape JSON or MD file, then click <b>📁 Local content → Import JSON / MD</b>. Files live in your browser's localStorage (never uploaded anywhere). Imports merge into the search bar + bestiary automatically. Per-client only — use Option B if you need to share with players.</p>

        <h4>Option B: Hosted URL library — shared</h4>
        <p>Put your JSON data on any HTTPS static host (GitHub Pages, S3, your own server) with CORS enabled. Layout:</p>
        <pre><code>your-host.com/
  search/
    index.json
  data/
    bestiary/
      bestiary-HOMEBREW.json
    spells/
      spells-HOMEBREW.json
    items.json, ...</code></pre>
        <p>Then use <b>+ Add library</b> above with the URL (no trailing slash). The bestiary file list is derived from search/index.json automatically — you don't need a separate data/bestiary/index.json.</p>

        <h4>JSON example (monster)</h4>
        <pre><code>{
  "monster": [
    {
      "name": "Frost Wisp", "ENG_name": "Frost Wisp",
      "source": "HOMEBREW", "page": 0,
      "size": "T", "type": "elemental", "alignment": ["N"],
      "ac": [{"ac": 14, "from": ["natural armor"]}],
      "hp": {"average": 22, "formula": "5d4 + 10"},
      "speed": {"fly": 30, "hover": true},
      "str": 6, "dex": 16, "con": 14,
      "int": 8, "wis": 12, "cha": 10,
      "cr": "1/2",
      "trait": [...], "action": [...]
    }
  ]
}</code></pre>

        <h4>AI prompts</h4>
        <textarea class="lib-prompt" readonly>${escapeAttr(AI_PROMPT_TEMPLATE)}</textarea>
        <button class="lib-prompt-copy" type="button">Copy JSON prompt</button>
        <textarea class="lib-prompt-md" readonly>${escapeAttr(AI_PROMPT_MD_TEMPLATE)}</textarea>
        <button class="lib-prompt-md-copy" type="button">Copy MD prompt</button>
      </div>
    </details>
  `;

  return `
    ${head}
    <div class="lib-list" id="libList">${list}</div>
    <div class="lib-actions">${addBtn}</div>
    ${renderLocalContentBlock(lang)}
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

    // Preview button toggles the diagnostic panel below the row.
    const previewBtn = row.querySelector<HTMLButtonElement>(".lib-preview-btn");
    const previewBox = row.querySelector<HTMLDivElement>(".lib-preview");
    previewBtn?.addEventListener("click", async () => {
      if (!previewBox) return;
      // Toggle close.
      if (!previewBox.hidden) {
        previewBox.hidden = true;
        previewBox.innerHTML = "";
        previewBtn.textContent = getLocalLang() === "zh" ? "🔍 预览" : "🔍 Preview";
        return;
      }
      const cur = (getState().libraries ?? []).find((l) => l.id === id);
      if (!cur) return;
      previewBtn.disabled = true;
      previewBtn.textContent = getLocalLang() === "zh" ? "⏳ 加载中…" : "⏳ Loading…";
      previewBox.hidden = false;
      previewBox.innerHTML = renderPreviewHtml(
        { baseUrl: cur.baseUrl, indexUrl: "", state: "loading", entryCount: 0, sourceMap: [], entries: [], dataProbes: [] },
        getLocalLang()
      );
      try {
        const result = await probeLibrary(cur.baseUrl);
        previewBox.innerHTML = renderPreviewHtml(result, getLocalLang());
      } catch (e: any) {
        previewBox.innerHTML = `<div class="lib-preview-body"><pre class="lib-preview-err">${escapeAttr(e?.message || String(e))}</pre></div>`;
      } finally {
        previewBtn.disabled = false;
        previewBtn.textContent = getLocalLang() === "zh" ? "✕ 关闭预览" : "✕ Close preview";
      }
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

  // Copy prompt — both the JSON variant and the new MD variant share
  // the same flash-on-click affordance.
  const wirePromptCopy = (btnSel: string, taSel: string) => {
    const btn = root.querySelector<HTMLButtonElement>(btnSel);
    const ta = root.querySelector<HTMLTextAreaElement>(taSel);
    if (!btn || !ta) return;
    btn.addEventListener("click", () => {
      ta.select();
      try {
        navigator.clipboard.writeText(ta.value).catch(() => document.execCommand("copy"));
      } catch { document.execCommand("copy"); }
      const old = btn.textContent;
      btn.textContent = getLocalLang() === "zh" ? "已复制 ✓" : "Copied ✓";
      setTimeout(() => { btn.textContent = old; }, 1200);
    });
  };
  wirePromptCopy(".lib-prompt-copy", ".lib-prompt");
  wirePromptCopy(".lib-prompt-md-copy", ".lib-prompt-md");

  // Local content import (JSON + MD)
  const fileInput = root.querySelector<HTMLInputElement>(".lib-local-file-input");
  let pendingMode: "json" | "md" | null = null;
  const importBtnJson = root.querySelector<HTMLButtonElement>(".lib-local-import-json");
  const importBtnMd = root.querySelector<HTMLButtonElement>(".lib-local-import-md");
  importBtnJson?.addEventListener("click", () => {
    if (!isGM || !fileInput) return;
    pendingMode = "json";
    fileInput.accept = ".json,application/json";
    fileInput.value = "";
    fileInput.click();
  });
  importBtnMd?.addEventListener("click", () => {
    if (!isGM || !fileInput) return;
    pendingMode = "md";
    fileInput.accept = ".md,text/markdown";
    fileInput.value = "";
    fileInput.click();
  });
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file || !pendingMode) return;
    try {
      const text = await file.text();
      const result = pendingMode === "json"
        ? await importLocalJson(file.name, text)
        : await importLocalMd(file.name, text);
      if (!result.ok) {
        window.alert(`${getLocalLang() === "zh" ? "导入失败：" : "Import failed: "}${result.error}`);
      } else {
        // Notify search + bestiary iframes to drop their caches.
        try {
          await OBR.broadcast.sendMessage(BC_LOCAL_CONTENT_CHANGED, {}, { destination: "LOCAL" });
        } catch {}
        renderContent();
      }
    } catch (e: any) {
      window.alert(`${getLocalLang() === "zh" ? "导入失败：" : "Import failed: "}${e?.message || String(e)}`);
    } finally {
      pendingMode = null;
      fileInput.value = "";
    }
  });

  // Local content delete
  root.querySelectorAll<HTMLButtonElement>(".lib-local-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!isGM) return;
      const row = btn.closest<HTMLDivElement>(".lib-local-row");
      if (!row) return;
      const id = row.dataset.localId;
      if (!id) return;
      const ok = window.confirm(getLocalLang() === "zh" ? "删除此本地内容？" : "Remove this local file?");
      if (!ok) return;
      removeLocalFile(id);
      try {
        OBR.broadcast.sendMessage(BC_LOCAL_CONTENT_CHANGED, {}, { destination: "LOCAL" });
      } catch {}
      renderContent();
    });
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

        ${STABLE_HIDES ? "" : `
        <div class="basics-block" style="margin-top:14px">
          <div class="basics-h">${lang === "zh" ? "面板布局" : "Panel layout"}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <button class="layout-editor-btn" type="button">${
              lang === "zh" ? "调整面板布局" : "Edit panel layout"
            }</button>
            <button class="reset-panels-btn" type="button">${
              lang === "zh" ? "重置所有面板位置" : "Reset all panel positions"
            }</button>
          </div>
          <p style="margin:0;line-height:1.7">${
            lang === "zh"
              ? "悬浮按钮、投骰记录、先攻条、怪物图鉴、角色卡信息这几个面板都可以拖动它们左上角的⋮⋮把手来自定义位置。位置只在你自己的客户端记忆，不会同步给其他玩家。"
              : "The cluster, dice history, initiative bar, bestiary panel and character-card info popover can all be repositioned by dragging the ⋮⋮ grip in their top-left corner. Positions are stored per-client and never synced to other players."
          }</p>
        </div>
        `}

        <div class="basics-block" style="margin-top:14px">
          <div class="basics-h">${lang === "zh" ? "调试模式" : "Debug mode"}</div>
          <div class="row">
            <div class="lbl">
              ${lang === "zh" ? "显示面板真实阻挡区域" : "Show real click-blocking areas"}
              <div class="desc"><em>${
                lang === "zh"
                  ? "开启后所有插件 iframe 会显示<b>黄色透明遮罩</b>+虚线边框，方便排查「那块本应透明的区域却挡住了点击」的问题。<b>仅本地</b>，不影响其他玩家。"
                  : "When ON, every suite iframe shows a <b>yellow tint + dashed outline</b> over its real popover footprint, useful for debugging \"why is this transparent area still blocking clicks\". <b>Local only</b>, never synced."
              }</em></div>
            </div>
            <button class="tog" data-key="debugOverlay" type="button" aria-pressed="false"></button>
          </div>
        </div>
      `;
      // Sound-effect toggle moved out of 基础设置 — each module
      // (骰子动效 / 先攻追踪) now owns its own SFX switch under the
      // localStorage keys obr-suite/sfx-dice and
      // obr-suite/sfx-initiative respectively. See sfx.ts for the
      // per-channel gating + legacy fallback.
    },
    afterRender: (root) => {
      // Reflect current debug-overlay state on the toggle's pressed
      // attribute + .on class so the UI matches LS at first paint.
      const debugBtn = root.querySelector<HTMLButtonElement>('.tog[data-key="debugOverlay"]');
      if (debugBtn) {
        const isOn = (() => {
          try { return localStorage.getItem("obr-suite/debug-overlay") === "1"; }
          catch { return false; }
        })();
        debugBtn.classList.toggle("on", isOn);
        debugBtn.setAttribute("aria-pressed", String(isOn));
        debugBtn.addEventListener("click", async () => {
          const cur = debugBtn.classList.contains("on");
          const next = !cur;
          debugBtn.classList.toggle("on", next);
          debugBtn.setAttribute("aria-pressed", String(next));
          const m = await import("./utils/debugOverlay");
          m.setDebugOverlay(next);
        });
      }
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

      root
        .querySelector<HTMLButtonElement>(".layout-editor-btn")
        ?.addEventListener("click", async () => {
          // Background owns the bbox registry, so we just ask it to
          // open the editor — it'll gather bboxes and pack them
          // into the modal URL.
          try {
            const layout = await import("./utils/panelLayout");
            await OBR.broadcast.sendMessage(
              layout.BC_OPEN_LAYOUT_EDITOR,
              {},
              { destination: "LOCAL" },
            );
          } catch (e) {
            console.warn("[obr-suite/settings] open layout editor failed", e);
          }
        });

      root
        .querySelector<HTMLButtonElement>(".reset-panels-btn")
        ?.addEventListener("click", async () => {
          const ok = window.confirm(
            getLocalLang() === "zh"
              ? "重置悬浮按钮、投骰记录、先攻条、怪物图鉴、角色卡信息的位置到默认锚点？"
              : "Reset cluster, dice history, initiative bar, bestiary panel and character-card info to their default anchors?"
          );
          if (!ok) return;
          try {
            const layout = await import("./utils/panelLayout");
            layout.resetAllPanelOffsets();
            // Tell every iframe + every background module to clear local
            // visuals + re-issue OBR.popover.open() with default anchors.
            await OBR.broadcast.sendMessage(
              layout.BC_PANEL_RESET,
              {},
              { destination: "LOCAL" },
            );
          } catch (e) {
            console.warn("[obr-suite/settings] reset panel offsets failed", e);
          }
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
    // Auto-add-to-initiative toggle MOVED into the bestiary popover
    // (see modules/bestiary/panel-page.tsx — the green pill in the
    // popover header). Settings page just shows the description now;
    // the GM flips the option inline while spawning instead of
    // hunting for it in a Settings tab.
    body: BESTIARY_DESC,
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
      // 2014 sheet bumped 2026-05-02 to v3.5.9_1 (latest 悲灵 revision
      // the user maintains for 2014 mode).
      const tpl2014 = assetUrl("template-belling-2014-v3.5.9_1.xlsx");
      const tpl2024 = assetUrl("template-belling-v1.0.12.xlsx");
      const btns = lang === "zh"
        ? `<div class="dl-row">
             <a class="dl-btn" href="${tpl2014}"
                download="DND5E人物卡_悲灵v3.5.9_1 (2014).xlsx" target="_blank" rel="noopener">
               ⬇ 5E2014 模板（传统 5e · 悲灵 v3.5.9_1）
             </a>
             <a class="dl-btn" href="${tpl2024}"
                download="DND5.5E人物卡-悲灵v1.0.12 (2024).xlsx" target="_blank" rel="noopener">
               ⬇ 5E2024 模板（5e 修订 · 悲灵 v1.0.12）
             </a>
           </div>`
        : `<div class="dl-row">
             <a class="dl-btn" href="${tpl2014}"
                download="DND5E-Character-Sheet-v3.5.9_1 (2014).xlsx" target="_blank" rel="noopener">
               ⬇ 5E2014 sheet (legacy 5e · 悲灵 v3.5.9_1)
             </a>
             <a class="dl-btn" href="${tpl2024}"
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
        ${INITIATIVE_DESC[lang]}
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
    zh: `${ICONS.d20} 定位骰子`,
    en: `${ICONS.d20} Tactical Dice`,
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
        ${DICE_DESC[lang]}
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
        ${PORTALS_DESC[lang]}
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
    id: "bubbles",
    zh: `${ICONS.heart} 血量气泡`,
    en: `${ICONS.heart} HP Bubbles`,
    moduleId: "bubbles",
    dynamicBody: (lang) => {
      // Per-client vertical-offset preference. Negative shifts the
      // whole bubble cluster up; default -20 keeps it clear of the
      // OBR token-name label that hangs below the token. Match the
      // localStorage key exported from `modules/bubbles/index.ts`.
      const offset = (() => {
        try {
          const v = localStorage.getItem("com.obr-suite/bubbles/vertical-offset");
          if (v != null && v !== "") {
            const n = Number(v);
            if (Number.isFinite(n)) return n;
          }
        } catch {}
        return -20;
      })();
      // Player visibility threshold — see LS_BUBBLES_PLAYER_THRESHOLD
      // in modules/bubbles/index.ts. 0..100. Locked tokens shown to
      // players quantise their HP ratio to multiples of this percent.
      const threshold = (() => {
        try {
          const v = localStorage.getItem("com.obr-suite/bubbles/player-threshold");
          if (v != null && v !== "") {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
          }
        } catch {}
        return 25;
      })();
      const desc = lang === "zh"
        ? `<p>每个 token 头顶的<b>紧凑信息条</b>：HP 条（按比例填充）+ AC 盾牌。自动跟随<em>拖动 / 缩放 / 传送</em>，旋转时保持竖直。</p>
<ul>
  <li><b>绑定怪物图鉴</b> → 自动写入 HP/AC，<em>默认对玩家隐藏</em>（与图鉴一致）</li>
  <li><b>绑定角色卡</b> → 同步当前 / 最大 / 临时 HP 与 AC，所有人可见</li>
  <li>HP / Max HP / Temp HP / AC <b>编辑入口</b>在怪物 / 角色卡的悬浮窗里</li>
  <li><b>本地渲染</b>（OBR.scene.local），不同步给其他玩家</li>
</ul>`
        : `<p><b>Compact info row</b> over every token: HP bar + AC shield. Auto-follows <em>drag / scale / teleport</em>, stays upright on rotation.</p>
<ul>
  <li><b>Bestiary-bound</b> → HP/AC auto-written, <em>hidden from players by default</em> (matches bestiary)</li>
  <li><b>Card-bound</b> → syncs current / max / temp HP + AC, visible to everyone</li>
  <li>HP / Max HP / Temp HP / AC <b>edit entry points</b> live in the monster + card popups</li>
  <li><b>Local render</b> (OBR.scene.local) — does not sync to others</li>
</ul>`;
      const offsetLbl = lang === "zh" ? "上下偏移" : "Vertical offset";
      const offsetDesc = lang === "zh"
        ? "本机偏好。负值向上偏移（远离 token），正值向下。默认 -20 让气泡不和角色名字标签重叠。"
        : "Per-client preference. Negative shifts up (away from token), positive shifts down. Default -20 keeps bubbles clear of the OBR name label.";
      const thresholdLbl = lang === "zh" ? "玩家进度阈值" : "Player threshold";
      const thresholdDesc = lang === "zh"
        ? "上锁角色对玩家显示的血条进度按这个百分比量化。默认 25：玩家只在血量降至 75% / 50% / 25% / 0% 时看到血条变化。设为 0 则连续显示真实比例，100 则始终显示满血（玩家看不到任何进度）。"
        : "Locked tokens' HP ratio shown to players quantises to this percent. Default 25 → players see the bar change only at 75% / 50% / 25% / 0%. 0 = continuous, 100 = always full (progress hidden).";
      return `
        <h3>${lang === "zh" ? "选项" : "Options"}</h3>
        <div class="row">
          <div class="lbl">
            ${offsetLbl}
            <div class="desc"><em>${offsetDesc}</em></div>
          </div>
          <input type="number" step="1" value="${offset}"
                 data-key="bubblesVerticalOffset"
                 style="flex:0 0 80px;align-self:center;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:3px 6px;color:#fff;font:inherit;text-align:right"/>
          <span style="flex:0 0 28px;text-align:right;color:#9aa0b3;font-size:11px">px</span>
        </div>
        <div class="row">
          <div class="lbl">
            ${thresholdLbl}
            <div class="desc"><em>${thresholdDesc}</em></div>
          </div>
          <input type="number" min="0" max="100" step="5" value="${threshold}"
                 data-key="bubblesPlayerThreshold"
                 style="flex:0 0 80px;align-self:center;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:3px 6px;color:#fff;font:inherit;text-align:right"/>
          <span style="flex:0 0 28px;text-align:right;color:#9aa0b3;font-size:11px">%</span>
        </div>
        ${desc}
      `;
    },
    afterRender: (root) => {
      const offsetInput = root.querySelector<HTMLInputElement>('input[data-key="bubblesVerticalOffset"]');
      if (offsetInput) {
        const commit = () => {
          const raw = offsetInput.value.trim();
          if (raw === "") {
            // Empty submit = restore default (-20). Persist the
            // explicit value so subsequent reads are deterministic.
            offsetInput.value = "-20";
            try { localStorage.setItem("com.obr-suite/bubbles/vertical-offset", "-20"); } catch {}
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          // Clamp to a sane range — runaway values would push the
          // whole bubble row off-screen.
          const clamped = Math.max(-200, Math.min(200, Math.round(n)));
          offsetInput.value = String(clamped);
          try { localStorage.setItem("com.obr-suite/bubbles/vertical-offset", String(clamped)); } catch {}
        };
        offsetInput.addEventListener("change", commit);
        offsetInput.addEventListener("blur", commit);
        offsetInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            offsetInput.blur();
          }
        });
      }
      const thrInput = root.querySelector<HTMLInputElement>('input[data-key="bubblesPlayerThreshold"]');
      if (thrInput) {
        const commit = () => {
          const raw = thrInput.value.trim();
          if (raw === "") {
            thrInput.value = "25";
            try { localStorage.setItem("com.obr-suite/bubbles/player-threshold", "25"); } catch {}
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          const clamped = Math.max(0, Math.min(100, Math.round(n)));
          thrInput.value = String(clamped);
          try { localStorage.setItem("com.obr-suite/bubbles/player-threshold", String(clamped)); } catch {}
        };
        thrInput.addEventListener("change", commit);
        thrInput.addEventListener("blur", commit);
        thrInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); thrInput.blur(); }
        });
      }
    },
  },
  {
    id: "statusTracker",
    zh: `${ICONS.statusWheel} 状态追踪 <span class="tab-beta">调试中</span>`,
    en: `${ICONS.statusWheel} Status Tracker <span class="tab-beta">BETA</span>`,
    moduleId: "statusTracker",
    body: {
      zh: `<p><b>全屏追踪</b>：状态、buff、消耗性资源（法术位 / 激励 / 子弹 …）一站式管理。</p>
<ul>
  <li><b>打开</b>：Select 工具下按 <kbd>]</kbd>，或点击工具栏的状态追踪按钮</li>
  <li><b>中央舞台</b>按视口比例显示场景里的所有角色 token</li>
  <li><b>右下调色板</b>：拖状态到角色 = 应用；状态文字会以弧形气泡浮在 token 头顶</li>
  <li>已应用的 buff <b>拖到别人</b> = 转移，<b>拖到空白</b> = 删除</li>
  <li><b>右上资源追踪</b>：选中角色 → 添加自定义资源（命名 + 上限），战斗中按 ＋／− 计数</li>
</ul>`,
      en: `<p><b>Full-screen tracker</b> for status effects, buffs, and consumables (spell slots, bardic inspiration, ammo …) — one place to manage them all.</p>
<ul>
  <li><b>Open</b>: press <kbd>]</kbd> while in the Select tool, or click the toolbar action</li>
  <li><b>Centre stage</b> shows every character token in the scene at its viewport-proportional position</li>
  <li><b>Bottom-right palette</b>: drag a status onto a character to apply it. The buff label appears as an arc-style bubble above the token</li>
  <li>Applied buffs: <b>drag to another</b> = transfer, <b>drag to empty space</b> = remove</li>
  <li><b>Top-right resource tracker</b>: select a character → add a custom resource (name + max). Tap ＋ / − during play to count usage</li>
</ul>`,
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
        ${SEARCH_DESC[lang]}
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
  {
    id: "metadataInspector",
    zh: `${ICONS.telescope} 元数据检查`,
    en: `${ICONS.telescope} Metadata Inspector`,
    moduleId: "metadataInspector",
    body: {
      zh: `<p><b>DM 专用调试工具</b>。开启后 OBR 工具栏会出现一个望远镜图标。激活该工具，<b>选中任何物体</b>都会在物体旁弹出一个气泡，列出该物体上所有 metadata（按命名空间分组）和 OBR 原生字段（位置 / 缩放 / 旋转 / layer / locked / visible 等）。</p>
<ul>
  <li><b>分组标签</b>：<span style="color:#c89251">枭熊</span>（套件自身的元数据，如 bestiary slug、portals 数据、character cards 列表等）/ <span style="color:#e088b6">外部</span>（Stat Bubbles for D&amp;D、Smoke! 等第三方插件）/ <span style="color:#6fdc94">原生</span>（OBR 原生 Item 字段）。</li>
  <li><b>实时刷新</b>：物体被改动时气泡内容自动更新。</li>
  <li><b>动态高度</b>：内容多就撑高（最高 85% 视口），少就缩小，支持滚动。</li>
  <li><b>用例</b>：排查"为什么这个 token 的血量条不正常显示"、"哪个插件给这个 token 加了 metadata"、"它的 attachedTo 指向哪个 item"。</li>
</ul>
<p style="color:var(--text-dim);font-size:11.5px">仅 DM 可见这个工具；玩家端开启此模块也不会出现工具图标，所以无副作用。</p>`,
      en: `<p><b>DM-only debug tool.</b> When enabled, a telescope icon appears in the OBR tool sidebar. Activate it and <b>select any item</b> — a bubble pops next to it listing every metadata key on the item (grouped by plugin namespace) plus the native OBR fields (position / scale / rotation / layer / locked / visible / etc).</p>
<ul>
  <li><b>Group badges:</b> <span style="color:#c89251">Suite</span> (this suite's own metadata — bestiary slug, portals data, character-cards list…) / <span style="color:#e088b6">External</span> (Stat Bubbles for D&amp;D, Smoke! and other third-party plugins) / <span style="color:#6fdc94">Built-in</span> (native OBR Item fields).</li>
  <li><b>Live refresh:</b> the bubble updates as the item changes.</li>
  <li><b>Dynamic height:</b> grows for verbose metadata (capped at 85% viewport), shrinks for short ones, scrolls when needed.</li>
  <li><b>Use cases:</b> "why is this token's HP bar acting weird?", "which plugin stamped this metadata?", "what is this item attached to?"</li>
</ul>
<p style="color:var(--text-dim);font-size:11.5px">DM-only tool; even with the module enabled, players don't get the icon — zero side effect on the player side.</p>`,
    },
  },
  {
    id: "vision",
    zh: `${ICONS.eye} 视野迷雾`,
    en: `${ICONS.eye} Vision / Fog`,
    moduleId: "vision",
    body: {
      zh: `<p><b>动态视野系统</b>。给 token 挂上「光源」，光会被墙壁阻挡，墙之外是黑色迷雾，每个客户端单独渲染（玩家只看自己 token 的视野，DM 看全部）。</p>
<ul>
  <li><b>添加光源</b>：右键任何 token → <b>添加光源</b> → 弹窗里设半径、颜色、暗视半径。</li>
  <li><b>双层半径</b>：内圈是<b>明视</b>（彩色），外圈再延伸是<b>暗视</b>（黑白覆冷调），代指 darkvision 之类。</li>
  <li><b>墙壁来源</b>：① OBR 自带「迷雾」工具画的墙；② 通过下方<b>绘制碰撞图</b>自动生成的墙（地图右键即可进入）。</li>
  <li><b>共享视野（下方开关）</b>：默认开启 = 全员看到所有 token 的视野并集；关闭 = 每个玩家只看自己 owner 的 token 视野（DM 始终看全部）。</li>
</ul>
<h3 style="margin-top:14px">绘制碰撞图（自动识别墙壁）</h3>
<p>右键地图（MAP layer 上的 image item）→ <b>绘制碰撞图（自动识别墙壁）</b> → 全屏编辑器：</p>
<ul>
  <li><b>取色 + 阈值识别</b>：点地图上的墙颜色（比如阴线 / 黑色），调阈值，一键把所有相似像素标为墙 —— 大幅减少手动画线。</li>
  <li><b>画笔 / 橡皮 / 套索</b>：手动微调（画笔尺寸可调，套索一拖填充区域）。</li>
  <li><b>缩简强度</b>：保存时用 Douglas-Peucker 把涂的区域转成多边形墙，强度越高线越简单。</li>
  <li><b>保存</b>：墙变成<b>锁定的不可选 item</b>，<b>跟随地图移动 / 缩放 / 旋转</b>，不会被误选误删，再次进编辑器可以重新涂改（保存时自动替换旧的）。</li>
</ul>`,
      en: `<p><b>Dynamic vision system.</b> Attach a "light source" to any token; light is blocked by walls, the rest of the scene is fogged. Per-client rendering — players only see their tokens' vision, DM sees everything.</p>
<ul>
  <li><b>Add light:</b> right-click any token → "Add light" → popover sets radius, color, darkvision range.</li>
  <li><b>Two-tier radius:</b> inner ring = <b>color vision</b>; outer extension = <b>darkvision</b> (greyscale tint).</li>
  <li><b>Wall sources:</b> ① OBR's native fog/wall drawing tool; ② walls auto-generated from the collision-map editor.</li>
  <li><b>Shared vision toggle (below):</b> ON (default) = all players see the union of every token's vision; OFF = per-owner only (DM always sees all).</li>
</ul>
<h3 style="margin-top:14px">Collision-map editor</h3>
<p>Right-click a map → "绘制碰撞图" → full-screen editor with color-pick auto-detect, brush / eraser / lasso, Douglas-Peucker simplification. Save → locked walls attached to the map.</p>`,
    },
    dynamicBody: (lang) => {
      const isZh = lang === "zh";
      const sharedRaw = (() => { try { return localStorage.getItem("com.obr-suite/vision/shared"); } catch { return null; } })();
      const shared = sharedRaw === null ? true : sharedRaw === "1";
      return `
        <div class="row" style="margin-top:8px">
          <div class="lbl">
            ${isZh ? "共享视野（玩家可见所有 token 的视野并集）" : "Shared vision (every player sees the union of all tokens' vision)"}
            <div class="desc">${isZh
              ? "默认开启。<b>关闭</b>后每个玩家只看自己 owner 的 token 的视野，DM 始终看全部。"
              : "On by default. When OFF, each player only sees vision from tokens they own; the DM always sees everything."}</div>
          </div>
          <button class="tog ${shared ? "on" : ""}" id="vision-shared" type="button" aria-pressed="${shared}"></button>
        </div>
      `;
    },
    afterRender: (root) => {
      const btn = root.querySelector<HTMLButtonElement>("#vision-shared");
      btn?.addEventListener("click", () => {
        let cur = true;
        try { cur = localStorage.getItem("com.obr-suite/vision/shared") !== "0"; } catch {}
        const next = !cur;
        try { localStorage.setItem("com.obr-suite/vision/shared", next ? "1" : "0"); } catch {}
        btn.classList.toggle("on", next);
        btn.setAttribute("aria-pressed", next ? "true" : "false");
        // Manually fire a storage event so the vision module's own
        // listener (in the background iframe) re-reads. localStorage
        // doesn't auto-fire `storage` for the SAME window.
        try {
          window.dispatchEvent(new StorageEvent("storage", {
            key: "com.obr-suite/vision/shared",
            newValue: next ? "1" : "0",
          }));
        } catch {}
      });
    },
  },
  {
    id: "worldPack",
    zh: `${ICONS.box} 世界包`,
    en: `${ICONS.box} World Pack`,
    dynamicBody: (lang) => {
      const isZh = lang === "zh";
      // Hard-coded high-contrast palette for the binding warning so
      // it stands out against the body's neutral background even
      // when the user customises the theme.
      const warnBox = `
        <div style="margin:10px 0 14px;padding:10px 12px;border-radius:7px;
                    background:linear-gradient(180deg, rgba(231,76,60,0.14), rgba(245,166,35,0.10));
                    border:1px solid rgba(231,76,60,0.55);
                    font-size:12.5px;line-height:1.7">
          ${isZh
            ? `<div style="color:#e74c3c;font-weight:700;font-size:13px;margin-bottom:4px">⚠️ 关键提示：图片为<u>直接引用</u>，不复制</div>
               <div style="color:var(--text)">
                 .fobr 里所有图片（地图 / token / 立绘）都是 <b style="color:#f5a623">直接引用世界包制作者的 OBR 图床 URL</b>，<b style="color:#f5a623">不会复制图片本身</b>。这意味着：
                 <ul style="margin:6px 0 0 22px">
                   <li><b style="color:#e74c3c">高度绑定</b>：玩家加载这个 .fobr 时，浏览器会去抓<b>制作者的 OBR 图片库</b>。</li>
                   <li><b style="color:#e74c3c">不可替代</b>：制作者一旦在自己 OBR 库里<b>删掉、替换、改名</b>这些图片，所有人导入时<b>对应物体的图片就会缺失（404 / 占位）</b>。</li>
                   <li><b style="color:#f5a623">建议</b>：作为世界包制作者，请把这个 .fobr 用到的所有图片<b>单独存一份"不可改动"的资源</b>在你的 OBR 库里。</li>
                   <li><b style="color:#f5a623">建议</b>：作为玩家，请<b>先确认从可信来源拿到的 .fobr</b>，再导入。</li>
                 </ul>
               </div>`
            : `<div style="color:#e74c3c;font-weight:700;font-size:13px;margin-bottom:4px">⚠️ Critical: images are <u>referenced</u>, not copied</div>
               <div style="color:var(--text)">
                 Every image in a .fobr (maps / tokens / portraits) is a <b style="color:#f5a623">direct URL reference into the creator's OBR asset library</b>; the bytes are <b style="color:#f5a623">never copied</b>. This means:
                 <ul style="margin:6px 0 0 22px">
                   <li><b style="color:#e74c3c">Tight binding</b>: when a player loads the .fobr, their browser fetches images straight from the <b>creator's OBR library</b>.</li>
                   <li><b style="color:#e74c3c">Irreplaceable</b>: if the creator <b>deletes, replaces or renames</b> any of those images, every imported scene loses the corresponding asset (404 / fallback).</li>
                   <li><b style="color:#f5a623">For creators</b>: keep an "untouchable" copy of every asset used by your .fobr in your OBR library.</li>
                   <li><b style="color:#f5a623">For players</b>: only import .fobr files from sources you trust.</li>
                 </ul>
               </div>`}
        </div>`;

      return `
        <h3>${isZh ? "世界包（.fobr）" : "World Pack (.fobr)"}</h3>
        <p style="line-height:1.7">${
          isZh
            ? "把当前场景的<b>所有内容</b>打包成单文件 <code>.fobr</code>：每一个 item（地图、token、墙、迷雾、灯光、绘制、文字…）+ <b>scene metadata</b>（套件状态、传送门、bestiary 共享数据…），可选包含<b>房间元数据</b>（套件设置、<b>人物卡列表</b>等跨 scene 数据）。位置 / 缩放 / 旋转 / metadata 全部一字不差往返。"
            : "Pack the <b>entire current scene</b> into a single <code>.fobr</code> file: every item (maps, tokens, walls, fog, lights, drawings, text…) plus <b>scene metadata</b> (suite state, portals, bestiary shared data…) and optionally <b>room metadata</b> (suite settings, <b>character cards list</b>, other cross-scene data). Positions / scale / rotation / metadata all round-trip verbatim."
        }</p>
        ${warnBox}

        <h3 style="margin-top:14px">${isZh ? "导出" : "Export"}</h3>
        <div class="row" style="margin-top:6px">
          <div class="lbl">
            ${isZh ? "包含房间元数据（人物卡 / 套件设置等）" : "Include room metadata (character cards / suite settings…)"}
            <div class="desc">${isZh
              ? "默认关闭。开启后 .fobr 还会带上<b>跨 scene 的房间数据</b> —— 整个房间的人物卡列表、套件设置、贡献名单等。适合「整体交接给另一个 DM」；普通分享单张地图保持关闭。"
              : "Off by default. When ON, the .fobr also carries the <b>room-scoped data</b> — full character-cards list, suite settings, contributor list, etc. Use for handing off a whole room to another DM; keep OFF for sharing a single map."}</div>
          </div>
          <button class="tog" id="wp-include-room" type="button" aria-pressed="false"></button>
        </div>
        <div class="row" style="margin-top:10px">
          <button id="wp-btn-export" class="btn-primary" type="button" ${isGM ? "" : "disabled"}>
            ${isZh ? "📦 导出 .fobr" : "📦 Export .fobr"}
          </button>
          ${!isGM ? `<span class="role-notice" style="margin-left:8px">${isZh ? "仅 DM 可导出" : "DM only"}</span>` : ""}
        </div>
        <div id="wp-progress" style="margin-top:6px;font-size:11.5px;color:var(--text-dim);min-height:18px;font-family:ui-monospace,Consolas,monospace"></div>

        <h3 style="margin-top:18px">${isZh ? "导入" : "Import"}</h3>
        <div class="basics-block" style="margin-top:6px">
          <div class="basics-h">${isZh ? "导入模式" : "Mode"}</div>
          <div class="seg">
            <button id="wp-mode-replace" class="on" type="button">${isZh ? "替换" : "Replace"}</button>
            <button id="wp-mode-merge" type="button">${isZh ? "合并" : "Merge"}</button>
          </div>
          <p style="margin-top:6px;font-size:11px;color:var(--text-dim);line-height:1.6">${
            isZh
              ? "<b>替换</b>：清空当前场景的全部 item + 元数据后再载入。<br><b>合并</b>：保留当前场景，把包内的 item 加进来（item id 重新生成防冲突）。"
              : "<b>Replace</b>: wipe current scene's items + metadata, then load. <br><b>Merge</b>: keep current scene; add pack's items on top (ids regenerated)."
          }</p>
          <div class="row" style="margin-top:8px">
            <div class="lbl">
              ${isZh ? "同时应用房间元数据" : "Also apply room metadata"}
              <div class="desc">${isZh
                ? "仅当 .fobr 含房间元数据时有效。开启会写回<b>跨 scene 的房间数据</b>（人物卡列表、套件设置等），<b style=\"color:#f5a623\">可能覆盖你当前房间的偏好</b>，不确定就别开。"
                : "Only effective when the .fobr contains room metadata. When ON, writes the <b>cross-scene room data</b> back (character-card list, suite settings…); <b style=\"color:#f5a623\">may overwrite your current room preferences</b>, keep OFF if unsure."}</div>
            </div>
            <button class="tog" id="wp-import-room" type="button" aria-pressed="false"></button>
          </div>
        </div>
        <div class="row" style="margin-top:10px">
          <input id="wp-file" type="file" accept=".fobr,application/octet-stream" style="display:none"/>
          <button id="wp-btn-import" class="btn-primary" type="button" ${isGM ? "" : "disabled"}>
            ${isZh ? "📥 选择 .fobr 文件并导入" : "📥 Pick .fobr and import"}
          </button>
        </div>
        <div id="wp-import-progress" style="margin-top:6px;font-size:11.5px;color:var(--text-dim);min-height:18px;font-family:ui-monospace,Consolas,monospace"></div>

        ${!isGM ? `<p class="role-notice" style="margin-top:14px">${isZh ? "玩家端只读 · 由 DM 操作" : "Read-only · DM only"}</p>` : ""}
      `;
    },
    afterRender: (root) => {
      let importMode: "replace" | "merge" = "replace";
      let includeRoomMeta = false;
      let applyRoomMeta = false;
      const setMode = (m: "replace" | "merge") => {
        importMode = m;
        root.querySelector("#wp-mode-replace")?.classList.toggle("on", m === "replace");
        root.querySelector("#wp-mode-merge")?.classList.toggle("on", m === "merge");
      };
      root.querySelector("#wp-mode-replace")?.addEventListener("click", () => setMode("replace"));
      root.querySelector("#wp-mode-merge")?.addEventListener("click", () => setMode("merge"));

      const includeRoomBtn = root.querySelector<HTMLButtonElement>("#wp-include-room");
      includeRoomBtn?.addEventListener("click", () => {
        includeRoomMeta = !includeRoomMeta;
        includeRoomBtn.classList.toggle("on", includeRoomMeta);
        includeRoomBtn.setAttribute("aria-pressed", includeRoomMeta ? "true" : "false");
      });
      const applyRoomBtn = root.querySelector<HTMLButtonElement>("#wp-import-room");
      applyRoomBtn?.addEventListener("click", () => {
        applyRoomMeta = !applyRoomMeta;
        applyRoomBtn.classList.toggle("on", applyRoomMeta);
        applyRoomBtn.setAttribute("aria-pressed", applyRoomMeta ? "true" : "false");
      });

      const progEl = root.querySelector("#wp-progress") as HTMLDivElement | null;
      const writeProg = (msg: string) => { if (progEl) progEl.textContent = msg; };

      const exportBtn = root.querySelector<HTMLButtonElement>("#wp-btn-export");
      exportBtn?.addEventListener("click", async () => {
        if (!isGM || exportBtn.disabled) return;
        exportBtn.disabled = true;
        try {
          writeProg("正在采集场景…");
          const result = await exportScene({
            // Image embedding is permanently OFF — OBR rejects items
            // with image.url > 2048 chars on import, so embedded packs
            // can't round-trip. World packs always rely on URL refs.
            embedImages: false,
            includeRoomMetadata: includeRoomMeta,
            onProgress: (p: ExportProgress) => {
              if (p.phase === "encoding") {
                writeProg(`正在压缩图片  ${p.doneImages} / ${p.totalImages}`);
              } else if (p.phase === "packing") {
                writeProg("打包中…");
              } else if (p.phase === "snapshot") {
                writeProg("正在采集场景…");
              } else if (p.phase === "done") {
                writeProg(p.message ?? "完成");
              }
            },
          });
          downloadBlob(result.blob, result.filename);
          const sizeMb = (result.blob.size / 1024 / 1024).toFixed(2);
          writeProg(
            `✅ 已下载 ${result.filename}（${sizeMb} MB · ${result.manifest.meta.stats.items} items · ${result.manifest.meta.stats.embeddedImages} 张图嵌入）`,
          );
        } catch (e) {
          console.error("[worldPack] export failed", e);
          writeProg("❌ 导出失败 — 详见控制台");
        } finally {
          exportBtn.disabled = false;
        }
      });

      const impProgEl = root.querySelector("#wp-import-progress") as HTMLDivElement | null;
      const writeImpProg = (msg: string) => { if (impProgEl) impProgEl.textContent = msg; };

      const fileInput = root.querySelector<HTMLInputElement>("#wp-file");
      const importBtn = root.querySelector<HTMLButtonElement>("#wp-btn-import");
      importBtn?.addEventListener("click", () => fileInput?.click());
      fileInput?.addEventListener("change", async () => {
        if (!isGM || !fileInput.files || fileInput.files.length === 0) return;
        const file = fileInput.files[0];
        if (importMode === "replace") {
          const ok = window.confirm(
            "导入模式 = 替换：将清空当前场景的所有 item 和元数据，再载入包内全部内容。继续？",
          );
          if (!ok) return;
        }
        importBtn!.disabled = true;
        try {
          writeImpProg("解析 .fobr…");
          const result = await importPackFromBlob(file, {
            mode: importMode,
            applyRoomMetadata: applyRoomMeta,
            onProgress: (p: ImportProgress) => {
              if (p.phase === "rewriting") writeImpProg("展开嵌入图片…");
              else if (p.phase === "applying-metadata") writeImpProg("应用场景元数据…");
              else if (p.phase === "applying-items") writeImpProg(`导入 item  ${p.doneItems} / ${p.totalItems}`);
              else if (p.phase === "done") writeImpProg(p.message ?? "完成");
            },
          });
          writeImpProg(
            `✅ 已导入 ${result.applied} 个 item（场景：${result.manifest.meta.sceneName ?? "(无名)"}，导出于 ${new Date(result.manifest.meta.exportedAt).toLocaleString()})`,
          );
        } catch (e) {
          console.error("[worldPack] import failed", e);
          writeImpProg(`❌ 导入失败：${(e as Error).message}`);
        } finally {
          importBtn!.disabled = false;
          fileInput.value = ""; // allow re-picking same file
        }
      });
    },
  },
];

// Stable channel hides: drop tabs whose backing module is hidden
// behind STABLE_HIDES so the user never sees the entry. Dev channel
// keeps everything.
const HIDDEN_TAB_IDS = new Set<string>(STABLE_HIDES ? ["search", "statusTracker"] : []);
const VISIBLE_TABS = TABS.filter((t) => !HIDDEN_TAB_IDS.has(t.id));

// --- DOM refs ---
const titleEl = document.getElementById("title") as HTMLHeadingElement;
const tabsEl = document.getElementById("tabs") as HTMLElement;
const topBarEl = document.getElementById("topBar") as HTMLElement;
const contentEl = document.getElementById("content") as HTMLElement;
const langZhEl = document.getElementById("langZh") as HTMLButtonElement;
const langEnEl = document.getElementById("langEn") as HTMLButtonElement;

let lang: Language = "zh";

function findTab(id: string): TabDef {
  return VISIBLE_TABS.find((t) => t.id === id) ?? VISIBLE_TABS[0];
}

function moduleLabelKey(id: ModuleId): string {
  switch (id) {
    case "timeStop": return lang === "zh" ? "时停模式" : "Time Stop";
    case "focus": return lang === "zh" ? "同步视口" : "Sync Viewport";
    case "bestiary": return lang === "zh" ? "怪物图鉴" : "Bestiary";
    case "characterCards": return lang === "zh" ? "角色卡" : "Character Cards";
    case "initiative": return lang === "zh" ? "先攻追踪" : "Initiative Tracker";
    case "search": return lang === "zh" ? "全局搜索" : "Global Search";
    case "dice": return lang === "zh" ? "定位骰子" : "Tactical Dice";
    case "portals": return lang === "zh" ? "传送门" : "Portals";
    case "bubbles": return lang === "zh" ? "血量气泡" : "HP Bubbles";
    case "statusTracker": return lang === "zh" ? "状态追踪" : "Status Tracker";
  }
}

function renderTabs() {
  tabsEl.innerHTML = VISIBLE_TABS.map((tab) => {
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
  // Install debug-overlay listener so this iframe also shows the
  // yellow tint when the user toggles the new debug-mode switch.
  try {
    const m = await import("./utils/debugOverlay");
    m.installDebugOverlay();
  } catch {}
  startSceneSync();
  // Re-render content (including the per-tab toggles + dynamic body) on
  // any suite state change. Language changes are handled separately so the
  // panel reflects another iframe (e.g. cluster) toggling lang.
  onStateChange(() => renderContent());
  onLangChange((l) => setLang(l));
  setLang(getLocalLang());
});
