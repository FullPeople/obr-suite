# DM 公告

> 编辑此文件直接修改弹窗内容。每个 `## 标题 [kind] [lang]` 是一个分区，
> kind 决定渲染样式：`[warn]` 红色警告条 / `[info]` 蓝色提示条 /
> `[todo]` 待办列表 / `[changelog]` 更新日志 / `[footer]` 落款。
> lang 控制独立的 CN|EN 切换：`[zh]` 仅中文模式显示，`[en]` 仅英文，
> 不带语言标签则两边都显示（如 footer / 共享通知）。
>
> 行内：`**粗体**`、`` `代码` ``、邮箱自动转 mailto 链接，
> `<span style="color:#hex">文本</span>` 给一段文字上色。
> 部署：`bash deploy-suite-dev.sh`（dev）或 `bash deploy-suite.sh`（正式版）。

## 警告 [warn] [zh]

## 提示 [info] [zh]

- 有任何其他的 bug 可以汇报到我的邮箱：1763086701@qq.com。
- <span style="color:#5dade2">**枭熊插件已经内置血量条**</span>，现在可以**关闭** Stat Bubbles for D&D 这个第三方插件，由本插件接管 HP/AC 显示，体验更统一。
- 为了更稳定的体验，目前是不再修改的**稳定版**。我会在测试版中逐渐实现待办中的新功能，并且等到功能完善了再放到正式版里。
- 询问我功能需求时，可以查阅下方的新功能/待办列表看看！
- 您的支持会添加到 **贡献名单**，在**设置**里找到支持链接，**助力我修快些加功能加快点**，並且完成以下待办！！

## 更新日志 [changelog] [zh]

> 每行格式：`版本号 · 描述`。最新的放最前面。

- 1.0.99 · **新插件登场**：① 新增<span style="color:#c89251">**元数据检查望远镜**</span>（DM 工具栏多了望远镜图标，开启后选中任何 item 弹出气泡，列出该 item 上所有 metadata，按插件命名空间分组（枭熊 / 外部 / OBR 原生），方便排查"这个 token 上挂了哪些插件的数据"。② 新增<span style="color:#5dade2">**世界包（.fobr）导出 / 导入**</span> — 设置面板新增一个 tab，可以把当前场景的全部 item + scene metadata 打包成一个 `.fobr` 文件直接下载（玩家间传递）。URL 引用保留 URL；OBR 自有上传 / 本地内容会 fetch 后嵌入；大图按可配置上限（默认 2048px / 1.5MB）重编码不丢细节；gzip 压缩。导入支持替换 / 合并两种模式，合并模式自动重新生成 item id 避免冲突。注：迷雾视野插件还在设计中。
- 1.0.98 · **大杂烩**：怪物图鉴搜索栏右侧的 ✕ <span style="color:#c89251">**移到了搜索框内部**</span>（之前在外面太像"关闭面板"按钮）；自动先攻按钮左边新增<span style="color:#5dade2">**自动隐藏开关**</span>（默认开启 — 新生怪物先对玩家隐藏，DM 摆好阵后再揭面）；编辑传送门弹窗在锁定按钮左边再加了 <span style="color:#c89251">**显示名字**</span> 和 <span style="color:#5dade2">**可见**</span> 两个切换按钮，三个状态都和 token 实时同步、再次打开弹窗会还原。骰子组合大改：支持<span style="color:#c89251">**分类**</span>+<span style="color:#5dade2">**拖拽排序**</span>+跨分类拖拽，每个组合可以单独改分类、整个分类可重命名 / 删除（删分类时组合移到未分类），保存时支持选分类。修复 <span style="color:#c89251">**WTTHC 等家酿怪物数据丢失**</span>：`_copy` 父引用同时尝试中文名 / 英文名两种 slug，rawBySlug 双键索引，列表上限从 80 提到 200。
- 1.0.97 · **小修补**：怪物 info 面板的<span style="color:#5dade2">**技能现在可以点击掷骰**</span>（左键 1d20+技能加值，右键打开优势/劣势/暗骰菜单，与原有的属性 / 豁免 rollable 同一套机制）；公告栏右上角加了<span style="color:#c89251">**独立 CN|EN 切换**</span>（不会影响整个插件的语言设置，只切公告显示）；公告里加粗的橙色 / 蓝色调暗了一档，不再刺眼；编辑传送门弹窗加了<span style="color:#c89251">**保存按钮**</span>和<span style="color:#5dade2">**锁定切换按钮**</span>（顺序：锁定 / 保存 / 取消，锁定调用 OBR 原生 `item.locked`）。
- 1.0.96 · **小修补**：投骰记录拖拽把手现在<span style="color:#c89251">**和左侧 cluster 一致地朝外凸出**</span>（之前方向反了）；群豁免弹窗合并<span style="color:#c89251">**群体 HP 编辑**</span>（−HP / +HP / =HP 三个按钮）；怪物 info 面板补齐<span style="color:#5dade2">**技能 / 感知 / 语言 / 抗性 / 免疫 / 易伤 / 状态免疫**</span>；战斗准备/进行中阶段，所有<span style="color:#c89251">**绑定到怪物图鉴的 token 血量条会以剪影形式出现给所有玩家**</span>（条会动但不显示具体数字和 AC，玩家能感知"敌人还剩多少血"的相对量）；怪物图鉴新增<span style="color:#5dade2">**来源筛选输入框**</span>（在自动先攻按钮旁边，方便玩家筛选自己上传的家酿本子）；本地内容现在支持 `tokenHref` 字段<span style="color:#c89251">**直接指定外部 token 图片 URL**</span>。
- 1.0.95 · **大量小修补**：所有面板加了<span style="color:#c89251">**实心拖拽把手**</span>（cluster / trigger / search 都是同一套方块+边角无缝衔接的样式）；先攻卡槽<span style="color:#c89251">**图片真正裁剪上下 10%**</span>+投骰按钮负距离塞进卡槽下沿；血量条<span style="color:#c89251">**红色加深**</span>不再透明；先攻投骰改成<span style="color:#5dade2">**三色色块（红/灰/绿）**</span>。**全局搜索补齐**：现在可以搜<span style="color:#c89251">**职业 / 子职业 / 职业能力 / 子职能力 / 子种族**</span>，武器属性 chip（<span style="color:#5dade2">轻型 / 灵巧 / 投掷 / 精通词条</span>）也能点击查定义。**怪物图鉴**改了三折屏图标。**人物卡武器**支持 <span style="color:#c89251">**附加伤害骰**</span>（如偷袭骰）和"投掷(射程20，60)"括号不被拆开。**设置说明全面重写**，简洁明了，加粗的字加了颜色更显眼。基础设置里<span style="color:#c89251">**新增调试模式开关**</span>，能直观看见各面板的实际鼠标阻挡区域。<span style="color:#5dade2">**状态追踪暂时默认关闭**</span>（仍在调试中），需要时去设置里手动打开。
- 1.0.90 · **角色卡全屏面板大改**：抛弃了之前 Python 渲染出的静态 HTML，改成<span style="color:#c89251">**数据驱动 + 暖色羊皮纸主题**</span>（少蓝紫多金/赭/沉沙绿）。<span style="color:#5dade2">**点骰子互动**</span>（左键投，右键优势），<span style="color:#5dade2">**HP/AC/临时/生命骰**</span>支持就地编辑，<span style="color:#c89251">**导出 JSON**</span>一键下载，<span style="color:#c89251">**导入 JSON**</span>支持本地预览替换。后端 parser 同步增加了**奇物 / 战斗风格专长（2024）/ 特殊能力 / 消耗品**字段（须等 server 重新部署 parser 才能在新上传的卡里看到 — 导入旧卡仍然兼容）。
- 1.0.80 · UI 布局大改：快捷键栏 / 投骰记录 / 怪物 info 重新分布到屏幕四角；新增<span style="color:#5dade2">**本地内容导入**</span>（直接选 json / md 文件即可，无需托管）；库设置加预览按钮可诊断索引和数据；修了多个家酿库（自定义来源）相关的搜索 / 图鉴 bug。
- 1.0.70 · 修改了 ui 排版。
- 1.0.68 · 添加了公告按钮，会在新版本更新后闪烁提示。
- 1.0.66 · 添加了血条插件，虽然现在有点问题但已经在修了，先放出来让大家体验一下。
- 1.0.61 · 现在<span style="color:#c89251">**怪物图鉴支持拖拽怪物到地图上**</span>了！
- 1.0.58 · 新增更新日志板块。
- 1.0.57 · 完善了允许面板拖拽的功能。
- 1.0.54 · 现在浏览器大小发生变化时，面板也会重新锚定了。
- 1.0.52 · 增加了拖拽自动先攻开关，可以在战斗中从资源库拖拽 token 入场直接加入先攻。

## 接下来会有的新功能 [todo] [zh]

> 每行格式：`描述 | 标签 | 标签等级`。标签等级 = `large` 时高亮放大；其他值不放大。

- 支持通过面板编辑数据
- 支持角色卡隐藏
- 更直观的血条和数据展示，解决目前面板过大的痛点
- 让 DM 导入的本地内容能同步给玩家（当前只有 DM 自己能看到）| 规划中
- 资源追踪面板，利用这个面板快速便捷给角色添加 buff，和管理环位/战术骰子/诗人激励等消耗性资源 | 规划中 | large
- 在先攻追踪卡槽中添加血量数据
- 搜索框完整联动所有数据 | 困难
- 使先攻追踪支持隐形生物 | 困难
- 直接支持传递人物卡 json 文件来生成人物卡
- 血条在 token 缩放时也跟着缩放，不再大小错乱 | 最后处理
- 玩家上传或刷新角色卡，桌上其他人立刻看到最新版，不用各自刷新 | 最后处理
- 更好的迷雾和墙 | 万一呢

## Notice [info] [en]

- Found a bug? Email me at 1763086701@qq.com.
- <span style="color:#5dade2">**The suite now ships its own HP/AC bubbles**</span> — you can safely **disable** the third-party "Stat Bubbles for D&D" plugin; the built-in bubbles take over with a more unified look (silhouette mode for bestiary-bound enemies, locked/viewmode, threshold quantisation).
- The current public build is the **stable** channel. New features land first on the dev channel; once they settle they get promoted here.
- Curious what's next? Check the upcoming-features list below.
- Your support will be credited in the **contributors list** (link in **Settings**). It directly funds faster fixes and the items below!

## Changelog [changelog] [en]

- 1.0.99 · **Two new modules**: ① <span style="color:#c89251">**Metadata Inspector**</span> — DM-only telescope tool. While the tool is active, selecting any item pops a bubble next to it listing every metadata key on the item, grouped by plugin namespace (Suite / external / OBR built-in). Great for "what plugins have stamped this token?" debugging. ② <span style="color:#5dade2">**World Pack (.fobr)**</span> — new Settings tab. Export the current scene as a single `.fobr` file (gzipped JSON + embedded re-encoded images) for player-to-player handoff. URL-referenced assets keep their URL; OBR-uploaded / local-content images get fetched and embedded; oversize images are re-encoded under a configurable cap (default 2048px / 1.5MB) without losing detail. Import supports Replace / Merge modes (merge auto-regenerates item ids to avoid collisions). Note: the vision/fog plugin is still in design.
- 1.0.98 · **Round-9 grab-bag**: bestiary search × button <span style="color:#c89251">**moved inside the search input**</span> (it kept getting mistaken for "close panel"). Bestiary panel gains an <span style="color:#5dade2">**Auto-hide toggle**</span> next to Auto-init (default ON — newly spawned monsters start invisible so the DM can stage them first). Portal edit popover gains <span style="color:#c89251">**Show-name**</span> and <span style="color:#5dade2">**Visible**</span> toggles next to Lock; all three sync with the actual item state and persist on the token. Dice combos overhauled: <span style="color:#c89251">**categories**</span> + <span style="color:#5dade2">**drag-and-drop reorder**</span> across categories, per-combo category change, rename / delete categories. Fix <span style="color:#c89251">**missing data for WTTHC-style homebrew monsters**</span>: `_copy` parent lookup now tries both Chinese and English name slugs, rawBySlug doubly-keyed, list cap raised from 80 → 200.
- 1.0.97 · **Round-8 polish**: monster-info skills are now <span style="color:#5dade2">**clickable rollables**</span> (left-click = 1d20+bonus, right-click = advantage / disadvantage / dark-roll menu — same wiring as ability checks). Announcement modal gets an <span style="color:#c89251">**independent CN|EN toggle**</span> in the top-right (per-client, doesn't change the suite-wide language). Bold orange / blue accent colors darkened a notch — easier on the eyes. Portal edit dialog adds a <span style="color:#c89251">**Save button**</span> and a <span style="color:#5dade2">**Lock-toggle button**</span> (order: Lock / Save / Cancel; lock uses OBR's native `item.locked`).
- 1.0.96 · **Round-7 polish**: dice-history trigger drag handle now <span style="color:#c89251">**points outward to mirror the cluster handle**</span> (was reversed). Group-saves popover gains an inline <span style="color:#c89251">**group HP editor**</span> (−HP / +HP / =HP). Monster info panel now shows <span style="color:#5dade2">**skills / senses (incl. passive perception) / languages / resistances / immunities / vulnerabilities / condition immunities**</span>. During combat (preparing or active), every <span style="color:#c89251">**bestiary-bound enemy's HP bar shows as a silhouette to all players**</span> (animated bar, no exact numbers / AC) so players can sense relative threat. Bestiary panel adds a <span style="color:#5dade2">**source-filter input**</span> (next to Auto-init — handy for players narrowing to their homebrew tag). Local-content imports now respect the `tokenHref` field to <span style="color:#c89251">**override the token image with an external URL**</span>.
- 1.0.95 · **Big batch of polish**: every panel got a <span style="color:#c89251">**solid drag handle**</span> (cluster / trigger / search share one chip-style design). Initiative slot art is genuinely cropped 10% top/bottom and the roll button is tucked into the slot's lower edge. HP bars use a <span style="color:#c89251">**deeper red**</span> instead of a translucent one. Initiative dice rolls render as <span style="color:#5dade2">**three colored chips (red/grey/green)**</span>. Global search now covers <span style="color:#c89251">**class / subclass / class features / subclass features / subraces**</span>. Weapon-property chips (<span style="color:#5dade2">light / finesse / thrown / mastery property</span>) are clickable. Bestiary book-icon redrawn as a triptych. Character-card weapons support <span style="color:#c89251">**bonus damage dice**</span> (sneak attack etc.) and the parenthesised range no longer gets split. Settings descriptions fully rewritten, with bold-color highlights. Basic settings ship a <span style="color:#c89251">**debug-mode toggle**</span> to visualise each panel's mouse-blocking area. <span style="color:#5dade2">**Status Tracker is off by default**</span> while it's in beta — turn it on in Settings.
- 1.0.90 · **Character-card panel rebuilt full-screen** — dropped the static Python-rendered HTML in favour of <span style="color:#c89251">**data-driven + warm parchment theme**</span>. <span style="color:#5dade2">**Click-to-roll dice**</span> (left = roll, right = advantage), <span style="color:#5dade2">**HP / AC / temp / hit dice**</span> editable in place, <span style="color:#c89251">**export JSON**</span> in one click, <span style="color:#c89251">**import JSON**</span> with local preview. Server parser also gained wondrous items / fighting-style feats (2024) / special abilities / consumables (existing cards keep working; new uploads need the redeployed parser).
- 1.0.80 · UI layout overhaul: shortcut bar / dice history / monster info redistributed to screen corners. Added <span style="color:#5dade2">**local-content import**</span> (just pick a json / md file — no hosting). Library settings gained a preview button to diagnose index + data. Many homebrew-library bugs fixed.
- 1.0.61 · The bestiary now <span style="color:#c89251">**supports drag-spawn from panel onto the map**</span>!
- 1.0.52 · Auto-add-to-initiative toggle: dragging a token in mid-combat from the asset library now joins initiative automatically.

## Upcoming features [todo] [en]

- Edit data through the panel
- Hide character cards
- More compact / readable HP + stat display
- Sync DM-imported local content to players (currently DM-only) | planned
- Resource-tracker panel: quick buff-add, slot / battle-die / bardic-inspiration management | planned | large
- HP numbers shown directly in the initiative tracker slots
- Full-data search-bar integration | hard
- Initiative tracker support for invisible creatures | hard
- Spawn character cards directly from a json file
- HP bars rescale with the token | last
- Live-sync: when one player uploads or refreshes their character card, the table sees it without reload | last
- Better fog / walls | maybe

## 落款 [footer]

— 弗人 / FullPeople
