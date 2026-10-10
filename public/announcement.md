# DM 公告

## 新版 Full Suite（该插件不再更新） [notice]

这里的“该插件”指你正在使用的旧版插件。旧版完成本轮兼容修正后，不再继续新增功能；后续更新集中在新版 Full Suite。
新版将五页角色卡与规则资料库放在同一个工作区，支持预备法术、背包、角色与怪物编辑，以及自定义资料。
新版安装地址（可以选中复制）：
[https://obr.dnd.center/suite-dev/manifest-dev.json](https://obr.dnd.center/suite-dev/manifest-dev.json)
在枭熊中添加上述扩展地址。启用新版时，请禁用同一房间中的旧版插件。
[打开车卡网站](https://dnd.center/card/?intro=0)，完成后导出完整 JSON，再上传到插件。

## 1.3.23 · 2026-10-10 [release]

### QQ 个人卡库

- 打开“我的 QQ 卡库”，登录并连接账号后，读取和加载自己的角色卡。
- 加载后默认锁定。卡主解锁后，房间成员可编辑，改动自动写回云端原卡。
- 卡主可重新锁定或移出房间；移出不会删除原卡。多人同时修改发生版本冲突时保留草稿。
- 网站只显示本人的卡及明确授权的卡，旧站 JSON 导出入口保留。


## 1.3.22 · 2026-10-10 [history]

### Wiki 收藏与就地选择

- 新版工作台和独立站增加“收藏”分类，条目右键可收藏或移除收藏；按各自浏览器保存，切卡与刷新后保留。
- 虚线选项在非编辑模式也可点击，自动开启编辑，在当前特性框内展开，不再跳页。
- 未填项可选择忽略，进度仍显示真实填写数；全部填完或忽略后收起。
- 受限筛选和当前职业页签持续显示状态动效，文字保持清楚的对比；全局搜索遵守规则基础版本。
- 核对并同步旧卡后忽略未填选项，继续先备份旧卡，再更新当前卡，保留原 ID、绑定、选择和资源。
- 旧插件只同步完整五页查看器，新功能请使用新版工作台或独立站。

枭熊继续按房间权限保存角色卡。收藏不会写入房间公共规则。新版保留上一版小批次骰子提速修复；真实多人房间与实体设备仍待验收。

## 2026-10-09 · 262 [history]

### 编辑与角色管理

- 新建条目和怪物编辑使用完整文档，在点击位置附近修改；长条目可滚动，保留 JSON 模式。
- 导入的扩展同时显示在自定义分类，补全物品编写示例，支持拖入扩展 JSON。
- 角色簿支持排序、筛选和调整顺序；怪物与玩家名字栏分开。
- 卡片、角色名字和资源卡增加定位入口；没有可读取的场景绑定时禁用。
- 核对旧卡先备份原卡，再更新当前卡，保留原 ID 与棋子绑定。
- 公告记住“下次版本更新前不再弹出”；旧插件逐卡加载不再播放启动动画。
- 新版工作台的公告、设置、音乐和转场控制在工作台中打开。移除设置里的迷雾编辑器入口。
- 空公共仓库默认收起，职业和自定义筛选更清楚地提示当前选择。
- 感谢“用短弓磨死欧吕尔的神秘红发女子”赞助 100 元，新增提供的头像。

独立站支持临时公开云端存储与分享；枭熊继续使用房间保存，不接入云端。真实多人房间与实体手机仍待验收。

## 2026-10-09 · 259 [history] [zh]

### 角色卡与操作

- 五页查看器同步逐页头像构图和背景页布局。
- 血条增加占格框锚定选项，默认仍沿用画布锚定。
- 棋子绑定也读取房间角色目录，实际读写继续使用枭熊棋子归属权限。
- 配色撤回、名字栏拖动和职业升级选择请使用新版插件或独立站。
- 独立站补齐生命骰图标、赞助二维码，并优化画廊过渡。枭熊端继续使用房间保存。
- 五页查看器在没有完整 Wiki 时，常见武器熟练名称也显示中文；自定义名称和原始引用保留。

实际多人房间和实体手机仍待验证。关闭附加窗口，刷新房间后重新打开插件。

## 2026-10-08 [history] [zh]

### 五页查看器与界面

- 五页查看器中的调色盘支持保存和导入界面配色，圆钮支持点击或长按拖动选色。
- 独立站卡库支持滚轮与循环拖拽切换，点击旁边的卡只切换；全屏保持 A4 比例。

- 五页查看器同步角色卡组件配色和精简后的法术悬浮提示；完整 Wiki 保留学习范围。
- 更新 11 个职业图标，使用提供的 PSD，统一为留空的透明正方形。
- 独立站已支持临时公开云端存储与分享，枭熊端继续使用房间保存。
- 新版 Full Suite 同步统一调色盘和 Wiki 右键创建自定义副本；旧插件保持原有功能范围。
- 原始 JSON、资源余额、枭熊权限和三龙牌入口保持。

## 2026-10-07 [history] [zh]

### 地图与五页查看器

- 移除“编辑地图迷雾”右键入口，动态迷雾设置与运行保留。
- 五页查看器同步工具熟练选择的显示与自适应法术位图标修复；原始 JSON 导出、手工记录和资源余额保留。
- 骰子冷启动修复适用于新版 Full Suite，旧稳定插件没有新版 3D 骰子模块。
- 真实房间和实体手机仍待验证。关闭附加窗口，刷新枭熊房间，再重新打开插件。

## 2026-10-07 [history] [en]

### Map menu and five-page viewer

- Remove the Edit Map Fog context menu entry while preserving dynamic fog settings and behavior.
- Update tool proficiency display and responsive spell slot icon painting in the shared viewer; preserve original JSON export, manual records and resource balances.
- The dice cold startup fix applies to the new Full Suite; the stable extension does not contain that 3D dice module.
- Real-room and physical-device validation remains outstanding. Close extension windows, refresh the room and reopen the extension.

## 2026-10-07 [history] [zh]

### 五页角色卡查看器

- 查看器顶部增加「导出 JSON」，下载本次收到的完整原文，保留未知字段、手工记录与资源余额。
- 已知工具熟练改用中文名称，盾牌熟练显示统一；自定义名称与未知条目的原名保留。
- 刷新失败时清除上次卡面与导出入口，避免误用旧资料。
- 本轮只配套更新稳定版查看器，原有 XLSX、地图和工具继续保留。
- 感谢「别名」支持 50 元。战俑工具选择仍待处理，真实房间和实体手机仍待验证。
- 更新后关闭附加窗口，刷新枭熊房间，再重新打开对应窗口。

## 2026-10-07 [history] [en]

### Five-page character viewer

- Export the original loaded JSON, preserving unknown fields, manual records and resource balances.
- Display known tool proficiency names in Chinese while retaining custom and unknown labels.
- Clear the previous character and export action when refreshing fails.
- This update reuses the stable viewer adapter; existing XLSX, maps and tools are preserved.
- Warforged tool selection, real-room and physical-device validation remain outstanding.
- Close extension windows, refresh the Owlbear room and reopen the extension after updating.

## 2026-10-03 [history] [zh]

### 角色卡、权限与资源

- 保留旧版角色卡、XLSX、地图与原有工具，本轮不把新版工作台整包替换旧版。
- 使用棋子的原生 Set Owner；生命值、资源、保存和删除操作会重新核对权限。
- 修复已打开资源设置后撤权仍可能写入的问题，多绑定操作不会越权改动其他所属玩家的棋子。
- 共用五页阅读器更新布局、法术与来源显示，支持每张卡保存的头像框隐藏设置。
- 同步旧卡及完整编辑请前往车卡网站或新版 Full Suite。

---

### 三龙牌与历史

- 设置 → 三龙牌增加“恢复此房间的旧版牌局”，沿用原规则与私有存档，仅打开已有牌局。
- 旧大厅主持和旧座位都离线时，保留宽限时间及在线座位优先，由符合条件的当前 GM 接任。
- 缺少原主持浏览器私有手牌及牌库时只提示恢复，不自动清桌、重建或伪造牌局。
- 快速切换骰子历史时，迟到取消不会覆盖新的显示意图；查看头顶结果时 Action 保持打开。
- 新旧公告及已读状态分开，原有重要权限图文与完整公告历史保留。

---

### 验证范围

- 已在准备的双账号测试房间验证撤权、双方入座、缺失存档保护及旧稳定牌局刷新恢复。
- 真实断网、多 GM 同时竞争、实体手机及玩家原设备仍待验证；自动检查不代替真实房间验收。
- 更新后关闭附加窗口，刷新枭熊房间，再重新打开对应窗口。
- 反馈邮箱：1763086701psw@gmail.com。

## 2026-10-03 [history] [en]

### Character cards and permissions

- Stable tools, XLSX support and maps are retained. Shared repairs do not replace this channel with the dev workbench.
- Card and resource operations recheck the token's native Set Owner permissions, including an already-open resource editor.
- Shared five-page viewing receives card layout, source/spell display and per-card portrait-frame settings.
- Full editing and old-card synchronization are available on the standalone card website or dev Full Suite.

---

### Three-Dragon Ante and verification

- Settings can recover an existing historical table using its original rules and private browser archive.
- An abandoned lobby keeps its grace period and online-seat priority before an eligible current GM succeeds its host.
- Missing private hands or deck produces a recovery notice; the existing game is not rebuilt or cleared.
- Rapid dice-history changes preserve the latest intent and keep the Action panel open.
- GM/player entry and stable private-game refresh recovery passed in the prepared test room. Actual network outages, competing GMs and physical mobile devices remain unverified.

## 2026-09-28 [history]

### 角色卡阅读

- 同步了新版法术列表，戏法、预备和赠送法术分组显示。
- 保留法术格的专注、仪式效果和来源次数显示。
- 旧插件继续支持 XLSX；编辑与基础自动化请前往车卡网站或新版 Full Suite。

---

### 待验证

- 玩家具体导入文件与实体手机显示待验证。

## 2026-09-27-二 [history]

### 角色卡与导入

- 修复了角色 JSON 转换时遗漏已填写武器攻击的问题。
- 旧插件继续支持 XLSX；玩家具体 JSON 文件待验证。

---

### 更新公告

- 旧公告现在按日期折叠，同日更新按批次编号。

## 2026-09-27-一 [history]

### 角色卡与导入

- 优化了角色卡上传区，可以选择或拖入 JSON / XLSX，也可以粘贴 JSON。
- 更新了格式说明：旧插件暂时恢复 XLSX 导入。
- 旧插件改用五页角色卡，车卡和编辑请前往车卡网站。
- 暂时恢复 XLSX 选择、拖拽、批量导入和覆盖更新，JSON 继续可用。

---

### 怪物与状态

- 修复了怪物图鉴加载出错的问题。
- 优化了怪物图鉴进度和按钮的排版。
- 修复了移除状态后头顶标识残留的问题；真实多人房间待验证。
- 增加了放怪图片重试和失败恢复；原偶发故障待验证。

---

### 地图与投骰

- 修正了所属玩家光源共享处理；真实房间视野待验证。
- 部分玩家缺少投骰按钮：待验证，尚未复现。
- 修正了无卡棋子的血量气泡处理；地图显示效果待验证。
- 新增玩家可见、仅 DM 能开关的门；真实动态视野待验证。
- 骰子历史现在显示完整公式，包括 max(1d20,20)。

---

### 三龙牌

- 三龙牌新增“命运之轮的轮转使用”牌组，额外加入善良、力量 12 的时光龙；能力为取得弃牌直至手牌上限。
- 优化了三龙牌的卡顿问题；完整牌局流畅度待验证。
- 三龙牌支持主动移交主持后离开了。
- 三龙牌 DM 不入座也可开启获准的全能视图；真实多人牌局待验证。

## 新版角色卡与 Wiki [highlights]

- workbench-preview.png | 角色卡与规则资料同屏 | 五页纸卡、预备法术与背包，和可搜索、可拖拽填卡的规则资料库一起使用。

## 公告版本 [changelog]

- 1.3.22 · 配套查看器和公告同步，收藏与就地选择请使用新版工作台
- 1.3.21 · 就地编辑、角色排序与定位、扩展拖入和原卡同步备份

- 1.3.20 · 同步逐页头像构图，补齐跨场景绑定并增加占格框血条锚定
- 1.3.19 · 更新调色盘导入导出与长按选色，保留五页查看器和房间保存
- 1.3.18 · 更新职业图标、五页查看器配色与云端功能公告
- 1.3.14 · 原生 Owner、资源撤权、历史显示与已有旧牌局恢复
- 1.3.12.20260927 · 武器 JSON 修复、三龙牌自动交接与历史公告折叠
