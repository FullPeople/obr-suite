# 三龙牌与 Master Loot 调研（2026-09-08）

本报告对应用户需求 3、9，并为需求 4 的公开数据来源提供一条线索。**用户已经确认：三龙牌采用 Three-Dragon Ante: Legendary Edition 基础版，不含扩展。版本问题已解决，不应再次询问。**

**最终工作目录为 `U:\枭熊插件\obr-suite`，从用户指定的共享目录恢复完整 Git 历史。** 线上 stable 1.2.2、dev 1.0.148-dev 已按各自历史提交重建并校验；当前最新源码另含未上线提交，详见[版本依据](../DEPLOYMENT_BASELINE_20260908.md)。先前位于同一 U: 路径的 1.1.11 / dev 1.0.143-dev 副本已移至 `_retired_local_20260908` 下隔离。Master Loot 和三龙牌的公开来源结论有效；本文基于旧副本记录的集成位置仍明确标为历史建议，不能据此推断线上功能缺失。最新源码的英语 UI、模板和数据源检查见[全范围英文本地化](2026-09-08-localization.md)。

曾读取 `U:\枭熊插件\obr-suite` 的 `docs/PLAYER_UPDATE_PLAN.md`、`src/background.ts`、`src/state.ts`、`src/modules/characterCards/fullscreen-page.tsx`。旧计划建议分批 dev、真实多人房间验收后再考虑 stable；本次没有据此发起任何发布。本调研只读取公开来源和源码，未安装外部插件、部署、改产品代码或宣称完成房间实测。此前 D: 副本只有读取，没有写入。

本报告现收录于项目的 `docs/research`。原始研究档案保留在本机 `U:\枭熊插件\_audit\2026-09-08`，属于本地证据，不是 GitHub 仓库附件。旧代码观察不混同为当前产品审计结论；线上版本依据见上方链接，本文不重复请求线上站点。

## 建议结论

| 项目 | 结论 | 最简单的产品路径 |
| --- | --- | --- |
| 三龙牌 | 值得做，但属于带私有手牌、完整规则和恢复能力的多人游戏，不能用三个随机数字比较大小充数 | 工具栏一个“小游戏”入口；建桌、加入、自动发牌；每回合只呈现当前可做的动作 |
| Master Loot 共存 | 技术上较可行，命名空间独立；需真实房间验证性能、徽章和窗口交互 | 设置中的可选入口，安装完成后由 token 徽章直接打开，不要求玩家不断切换 action 面板 |
| Master Loot 全量并入 | 暂不推荐；目前没有拾取/分配/背包同步，直接搬入增加维护和常驻开销 | 若有实际使用需求，先吸收“书信一键阅读”的体验，再决定是否做物品分配 |
| Master Loot 数据导入 | 比双向实时同步更值得考虑 | GM 一次导入、预览后确认；保留来源 ID、署名和可回滚记录 |
| 5etools 网页 CF 问题 | 该项目展示了直接读取公开 JSON 的路线；不是发现了官方源站，也不应把代理挑战页面作为运行依赖 | 使用现有库配置和缓存，按物品链接定位数据；不要每次弹窗打开都下载整库 |

## 1. 三龙牌：来源与范围已确认

官方产品页将 Legendary Edition 标为 2019 年发行、2–6 人，并链接 28 页规则书。基础盒包含 70 张标准龙、15 张凡人、15 张传奇龙；不能把“基础版”误解成仅 70 张普通龙。2022 年 Giants War 是另一个需要基础盒的扩展，本轮不纳入。[WizKids 基础版](https://wizkids.com/three-dragon-ante-legendary-edition/)、[WizKids Giants War](https://wizkids.com/dungeons-dragons-three-dragon-ante-giants-war/)

规则权威使用产品页的 **Download Rules**，当前指向 [官方托管规则 PDF](https://eadn-wc03-13179282.nxedge.io/posters/repository/wizkids/3%20Dragon%20Ante%20Rulebook%20WEB.pdf)。该文件含卡表（附录 3）和逐牌解释，规则资料并非完全缺失。实现时按印刷页码逐项建验收依据，不从论坛概述拼凑不同版本。

简要核对结果：每人初始金币为人数 × 10，初始手牌 6 张；默认从 30 张特殊牌随机选 10 张加入标准龙。流程涉及暗置下注、确定领打、轮流出牌和效果处理、牌组奖励、结算与补牌。平局、空奖池、缺牌购牌、欠款和持续效果均影响流程。官方 2019 年发行新闻只写每人 10 金币，与规则书设置页不同，程序和测试应以规则书为准。[规则 PDF，第 4–11 页](https://eadn-wc03-13179282.nxedge.io/posters/repository/wizkids/3%20Dragon%20Ante%20Rulebook%20WEB.pdf#page=4)、[发行新闻](https://wizkids.com/2019/09/18/gather-the-biggest-hoard-of-gold-in-three-dragon-ante-legendary-edition-available-now/)

本报告不复制整副卡面、整套技能文本或完整规则书。免费公开下载不自动等于允许再发布全套商品内容；Wizards 的 Fan Content Policy 也不是对数字重制和卡牌再分发的通用许可。[Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy)

后续可立即开展独立编写的界面、状态机、联机、占位资产和测试。真实牌包上线前要完成以下资料工作：

- 把基础盒的牌表、数量与实现中的独立规则处理器逐项核对，并记录对应规则书页码；不能声称少数示例牌等于完整基础版。
- 确认用于分发的图像、文案与字体来源；优先原创视觉和原创简明说明。若采用用户已有素材或导入包，记录使用范围，不能从“用户拥有实体盒”直接推导公开发布许可。
- 将牌包和程序分开，记录版本、校验值、数量、缺项及许可说明；加载不完整时明确说明，不能静默替换成简化玩法。

这是内容核验和发行范围的剩余问题，不是版本选择问题，也不妨碍先做合法的通用联机能力。

## 2. 三龙牌：推荐实现与易用性

以下为公开 SDK 资料与旧 U: 代码结合得出的暂定工程建议，不是 Owlbear 官方承诺；最新源码的可复用能力由主任务核验。

**一个入口、一张牌桌。** 默认不自动弹出。房内有人开桌时，其他人收到一次轻量“加入牌桌”提示；坐席沿用玩家名称和颜色。主界面只放自己的手牌、公开出牌、金币、当前操作者和一个主要动作。选目标、选牌或选效果时在当前桌面完成，不连续叠加多个确认框。完整规则通过帮助入口查看；常规计数和结算自动完成。

**牌局生命期独立于面板。** 面板关闭只停止渲染；主持服务保留局状态，重开恢复原座位和局面。暂停、退出座位、结束整局是三个清楚区分的操作。面板关闭、换 action、切场景、短断网都不能被当作玩家认输。

**私有手牌不能用“发给所有人但隐藏 DOM”实现。** Owlbear 官方描述 metadata 为扩展共享数据；Broadcast 为临时房内消息，单条最多 16 KB。本轮检查的 SDK 3.1 的 `BroadcastApi.d.ts` 仅有 `REMOTE / LOCAL / ALL` 目的地，没有按玩家 ID 私发的参数。因此共享 metadata 只适合公开牌桌摘要，明文手牌和未揭示牌库不能直接放进去。[Metadata](https://docs.owlbear.rodeo/extensions/reference/metadata/)、[Broadcast](https://docs.owlbear.rodeo/extensions/apis/broadcast/)

旧 U: 工作区存在 `character-cards-server`；待核对线上部署与最新源码后，可评估复用其部署基础，新增独立牌局服务；不能假设角色卡现有 API 已能安全处理游戏。服务按经过校验的身份和座位返回私有视图，以单一权威顺序处理动作，记录局 ID、动作 ID、版本和玩家 ID，支持幂等重试。OBR 房间用于发现牌桌和通知，HTML 负责操作界面。另一条可研究路线是端到端加密的主持客户端，但主持人掉线、主机迁移及密钥恢复的复杂度更高。

房间 metadata 全部扩展合计要低于 16 KB，因此不应将逐回合完整历史和大牌包不断塞进去。[Room API](https://docs.owlbear.rodeo/extensions/apis/room/)

最低验收应包含：2 人和 6 人完整对局；非当前座位的动作被拒绝；重试不重复扣款/出牌；玩家 A 的返回包没有玩家 B 的手牌；同时提交下注不会提前泄露；所有基础牌的规则覆盖；关闭重开、刷新和断线恢复；双方看到的最终结果一致。先用占位牌测试这些能力，再接入经过核对的完整规则与资源。占位桌、联机演示和基础版游戏必须分别标示状态。

## 3. Master Loot：实际是什么

检查目标为 [Shiroko7/master-loot](https://github.com/Shiroko7/master-loot)。截至本轮查询，`main` 最近提交是 2026-08-28 的 [`e251f28d95e751c96d6732e3132a5682ee0f1023`](https://github.com/Shiroko7/master-loot/commit/e251f28d95e751c96d6732e3132a5682ee0f1023)，`package.json` 和 manifest 均为 `0.1.0`；提交历史可见 2 次提交。不能把它当成成熟的多人背包系统。

玩家路径较清楚：点 token 上的袋子徽章打开列表，再点书信、书本或证件阅读；币堆有换算。GM 需要给 token 添加内容、设置可见并保存；作者提供文件夹、纸张风格、分页和字体选项。**README 明确把玩家领取物品列为未来功能**，现有 `lootView.ts` 也是阅读与展开交互，没有领取或分配事务。[README](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/README.md)、[玩家列表源码](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/lootView.ts)

对本项目的价值主要是“地图里的信件、笔记、证件不用离开跑团画面就能读”。如果用户主要需要战后分钱、抢领物品、直接入包，该仓库目前不能直接满足。

## 4. Master Loot：兼容性和具体风险

| 检查项 | 公开源码证据 | 对本项目的含义 |
| --- | --- | --- |
| SDK 与窗口 | SDK `^3.1.0`；独立 action、background、popover、modal | SDK 基础相同。独立安装可行性高，但 action 的占用和 modal 行为仍需真实房间验收 |
| 命名空间 | 使用 `com.shiro.master-loot` 下的 loot、badge、sparkle、settings 等键 | 与旧 U: 代码中的 `com.obr-suite` 不直接同名；读写互通必须有显式适配，不能覆写整个 metadata |
| 生命周期 | background 顶层 `OBR.onReady` 注册监听，无 suite 风格的完整 teardown | 直接复制进 suite 会让禁用/重启清理成为新增工作；应模块化后按需启动 |
| 场景变更成本 | 每次 items 变更调用清理，全场 `getItems`，逐徽章查询 bounds/grid；序列化只避免同时清理 | 大场景和频繁 token 移动时可能放大开销。先索引相关 token、合并更新，再评估全量并入 |
| 列表渲染 | 玩家列表订阅全部场景变更，`render` 清空 DOM 重建；展开内容也重新获取全场物件 | 为避免向 suite 引入不必要的刷新成本，宜只在当前容器版本变化时更新、保留滚动位置 |
| 内容存储 | 整个容器与书信正文保存在 token metadata；单文档限制 10,000 字符 | 多文档和多字节文本仍需测总序列化体积；长文本放内容存储，token 保留摘要和引用更稳妥 |
| 保存与恢复 | 编辑器为手动保存；`pagehide` 尝试异步保存；浏览器 localStorage 镜像 | 关闭页面前的异步保存不应作为唯一兜底；需要可见的保存状态和可靠草稿。浏览器备份不是跨设备备份 |
| 编辑权限 | 右键菜单限 GM；编辑页面初始化与 `saveLoot` 未见独立 GM 校验 | 菜单隐藏不是写入边界。若并入，应由真正的保存入口再次校验权限、记录失败；当前实际可写范围还受 OBR 权限影响 |

来源：[package.json](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/package.json)、[manifest](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/public/manifest.json)、[constants](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/constants.ts)、[background](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/background.ts)、[lootView](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/lootView.ts)、[loot](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/loot.ts)、[editor](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/editor.ts)、[storage](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/storage.ts)。表中性能影响属于源码推断，本轮没有测量帧率或延迟。

尚需特别验证徽章的跟随/缩放、迷雾下的可见性、玩家选中徽章时是否干扰 suite 的自动角色卡弹窗。未启用 loot 的 token 仍可包含正文数据；UI 的“暂不展示”不应宣传为对扩展或调试工具的保密隔离。

## 5. Master Loot：许可、安装与整合顺序

`package.json` 明确声明 `license: MIT`，不能写成“没有任何许可证”。但仓库顶层未见独立 LICENSE，公开 `LICENSE` 路径返回 404；如正式复用源码，应补齐对应版权与许可文本。README 对纸纹另有 Public Domain 和 CC BY-SA 2.0 署名；字体也需保留各自许可。复制代码许可不能替代图片与字体许可核对。[package.json](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/package.json)、[纹理署名](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/README.md#texture-credits)

本轮没有核实到作者已经维护的正式 manifest 安装地址；README 给的是用户自行部署后的地址形式。因此目前可以提供项目/使用说明链接，不能编造“一键安装”地址或未经验证地声称已经可装。

推荐顺序：

1. 先进行可选独立部署的真实房间试用，重点看阅读价值、首次加载、20–50 个可搜刮 token 的移动开销，以及与现有面板同时使用的体验；验收前不开默认常驻。
2. 如果阅读功能确实常用，suite 内只呈现简洁“分享资料”入口：内容、接收对象、发送；样式设为可记忆预设，复杂排版折叠。避免每次重复选择九种字体和纸张。
3. 需要迁移时，优先做只读扫描 + 一次导入，保留原 token 的 Master Loot 数据和原 ID，不自动删除外部插件附件。导入后由单一实现维护新数据，避免两个后台争写徽章。
4. 真正需要“领取到背包”后，再设计原子扣减与记账、重复领取防护、撤销和授权。旧 U: 代码的 `InventorySection` 将可编辑 `inventory.items` 与从表格导入的只读 `inventory.containers` 分开；不能简单向一个扁平数组追加就声称背包全兼容。

对应本地入口：`src/background.ts` 的 `ModuleHooks` 与模块注册表、`src/state.ts` 的 `ModuleId`、`src/modules/characterCards/fullscreen-page.tsx` 的 `InventorySection`。这些只在旧 U: 副本上核验，未确认最新源码仍采用相同结构。

## 6. 对 5etools CF 问题的有用线索

Master Loot 的 `fiveETools.ts` 不抓受挑战的物品 HTML。它解析 `items.html#名称_来源`，从 `https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/` 下载 JSON，并为成功请求保留缓存、失败请求允许重试。还处理基础物品/魔法变体及条目标记转文本。[fiveETools.ts](https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/fiveETools.ts)

可借鉴的是“网页链接只作为标识，运行时读取公开数据”的方式；不建议直接复制其全量拉取策略。旧 U: 副本存在 `LibraryConfig.baseUrl`、`indexPath` 和多库来源信息；应先检查最新源码是否已解决该问题，再决定是否在对应库加载层接入、去重、离线缓存和回退。不能把该第三方镜像称为原站或官方 API；英文数据内容的使用范围仍要独立确认。也不应删除或重写来源字段来隐藏出处。

## 7. 交付状态与剩余事项

- 已完成：规则原始来源、已确认的版本范围、私有手牌与窗口生命期设计约束、Master Loot 指定提交源码检查、旧 U: 集成入口的暂定映射。
- 本调研没有开展：三龙牌产品实现、完整卡包内容/许可核验、Master Loot 真实房间安装与交互/性能测试、正式可用 manifest 地址核实、任何发布。这是本调研的工作范围，不是对当前线上版本功能有无的判断。
- 下一批的可审查成果：三龙牌牌桌与联机状态机原型、独立牌内容清单；Master Loot 先决定“可选资料阅读器”是否确实常用，再投入重写或适配。最新权威源码已由主任务定位并完成部署资源匹配；后续 GitHub 源码更新由主任务统一处理，本报告不发起外部写入。

## 8. 原始来源地址（纯文本，便于复核）

检查日期：2026-09-08。Master Loot 源码固定到 e251f28d95e751c96d6732e3132a5682ee0f1023；规则采用用户确认的 Legendary Edition 基础版，不混入 Giants War 或其他扩展。

WizKids 基础版产品 / 官方规则入口：
https://wizkids.com/three-dragon-ante-legendary-edition/

由上述页面 Download Rules 实际链接的官方托管 PDF：
https://eadn-wc03-13179282.nxedge.io/posters/repository/wizkids/3%20Dragon%20Ante%20Rulebook%20WEB.pdf

WizKids 基础版发行新闻（初始金币简述与规则书存在差异，以规则书为准）：
https://wizkids.com/2019/09/18/gather-the-biggest-hoard-of-gold-in-three-dragon-ante-legendary-edition-available-now/

WizKids Giants War（只用于确认扩展边界，本轮不实现）：
https://wizkids.com/dungeons-dragons-three-dragon-ante-giants-war/

Wizards Fan Content Policy：
https://company.wizards.com/en/legal/fancontentpolicy

Owlbear Broadcast：
https://docs.owlbear.rodeo/extensions/apis/broadcast/

Owlbear Metadata：
https://docs.owlbear.rodeo/extensions/reference/metadata/

Owlbear Room：
https://docs.owlbear.rodeo/extensions/apis/room/

Master Loot 项目：
https://github.com/Shiroko7/master-loot

Master Loot 检查提交：
https://github.com/Shiroko7/master-loot/commit/e251f28d95e751c96d6732e3132a5682ee0f1023

Master Loot README / 纹理署名：
https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/README.md

Master Loot package.json / MIT 声明：
https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/package.json

Master Loot manifest：
https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/public/manifest.json

Master Loot background：
https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/background.ts

Master Loot 数据命名空间：
https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/constants.ts

Master Loot 保存 / 徽章 / 弹窗：
https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/loot.ts

Master Loot 玩家列表：
https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/lootView.ts

Master Loot 编辑器：
https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/editor.ts

Master Loot 浏览器备份：
https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/storage.ts

Master Loot 数据模型：
https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/types.ts

Master Loot 5etools JSON 导入路线：
https://github.com/Shiroko7/master-loot/blob/e251f28d95e751c96d6732e3132a5682ee0f1023/src/fiveETools.ts

该代码引用的数据目录（第三方镜像，不是官方原站认证）：
https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/
