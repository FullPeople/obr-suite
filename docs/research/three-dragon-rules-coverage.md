# Three-Dragon Ante rules core — 2026-09-08

用户确认的范围：**Legendary Edition 基础盒，默认独立卡牌玩法，不含扩展**。
新增代码仅在 `src/modules/threeDragonAnte/rules/`；本文件与专用测试独立于
Owlbear transport、background、牌桌 UI 和任何部署。此阶段不是已上线小游戏。

## 权威资料与核对方法

WizKids 产品页及其 Download Rules 指向的 28 页规则书：

https://wizkids.com/three-dragon-ante-legendary-edition/

https://eadn-wc03-13179282.nxedge.io/posters/repository/wizkids/3%20Dragon%20Ante%20Rulebook%20WEB.pdf

以下均为**印刷页码**，与本 PDF 页序一致。核对 p4、p6–11、p15–24、p26–28；
不从其他版本、论坛摘要或 S&S 代码推断规则。牌表使用事实性身份、点数、分类；
没有复制卡图、整段卡面技能文案、规则书或商标美术。简短中英操作提示独立编写。
这项代码实现和公开素材分发许可是两件事；没有据此宣称取得数字卡图发行许可。

## API 与秘密信息边界

`rules/index.ts` 导出：

- `createGame(config, rng?)` 创建主持端私有 JSON 状态；2–6 座位，默认 70 标准牌
  加随机 10 特殊牌、每人 6 手牌、初始金币为人数 ×10。`specialIds` 可指定恰好
  10 张基础盒特殊牌；其余 20 张仍不投影给玩家。
- `applyAction(state, action, rng?)` 不修改传入状态。动作包含 `id`、`revision`、
  `seatId`、`kind`，以及 `cardId` 或 `choiceId/optionIds`。返回机器错误码或新状态。
- `eligibleActions(state, seatId)` 只列这个座位当前可执行的动作。下注和出牌用
  `ante/play`；连续效果用 `choose`。没有自创通用 pass 或随意买牌。
- `projectPublic` 只输出白名单公开字段；`projectSeat` 增加自己的手牌、暗置下注、
  自己的操作候选。另一玩家的手牌、Seer 候选、牌库顺序、未使用特殊牌、随机状态、
  内部任务队列和幂等账本均不输出。
- `RULE_PROMPTS/rulePrompt` 覆盖全部 18 种能力选择和机器错误；`cardName`、
  `CARD_HINTS/cardHint` 提供全部 40 家族的中英名称与独立撰写的短能力提示。
  每个选项含 `cardId`、`seatId` 或本地化 `code`，`min/max` 定义确认数量。
  `Choice.sourceCardId/beneficiarySeatId` 说明能力来源与收款方；`PublicView.effects`
  与座位 `archmage` 反映已公开且仍持续的规则效果，源牌离场也不误隐藏。

生产默认使用 `crypto.getRandomValues` 的有界整数拒绝采样。显式 `seed` 只用于
可复现模拟；也可以注入 `RandomSource.int(upperExclusive)`。产品不能公开随机
状态、初始牌序或主持端完整状态。接口没有把这些数据存进 OBR metadata。

Transport 必须把已认证连接绑定到真正的 seatId；不能直接信任客户端自报的
seatId。引擎校验游戏座位和轮次，不负责身份认证、加密、主机迁移或跨进程持久化。
相同已接受动作 ID 和相同内容先返回幂等结果；内容改变则冲突；未接受的旧版本动作
返回 STALE_REVISION。重复请求不会再次执行扣款、抓牌或随机选择。

## 基础流程覆盖

| 印刷页 | 实现／测试焦点 |
| --- | --- |
| 4 | 80 张开局牌组、2/6 人金币及手牌、隐藏未使用特殊牌 |
| 6 | 同时暗置下注、揭示后收费、排除并列点数选领打、全部成对平局重新下注 |
| 7 | 领打发动；之后等于或低于前一张才发动；新一轮领打平局；延长回合 |
| 8–9 | 颜色／点数组合、先能力后奖励、颜色先于点数、每种组合每轮局只奖一次 |
| 10 | 传奇颜色、自动买牌、欠款只计未支付差额、空奖池立即中断当前流程 |
| 11 | 胜者分配、付入 hole 后检查结束、按胜者开始补牌、10 张上限、弃牌重洗 |
| 26–28 | 公开金币／手牌数量、龙与凡人区别、Dragon god 不可被普通复制能力复制 |

## 全牌目录与处理器覆盖

标准牌点数直接保存在 `cards.ts`，每色 7 张，共 70；每张 ID 都通过实际出牌动作
进入家族处理器。专用场景额外检查结果，不能仅凭“存在 handler”算通过。

| 标准家族（各 7 张） | 页码 | 结果／分支检查 |
| --- | --- | --- |
| Black | 16 | 奖池扣减与立即结束 |
| Blue | 16 | 两种金币去向与场上张数 |
| Brass | 17 | 右邻给牌／付款，公开给牌，满手上限 |
| Bronze | 17 | 最低明牌平局选择、九张手牌时二选一 |
| Copper | 18 | 连续替换、当前轮牌值、替换牌发动 |
| Gold | 19 | 善龙计数含自身、十张上限 |
| Green | 20 | 左邻给牌／付款，严格较低点数 |
| Red | 22 | 最强对手、付款、随机牌不公开 |
| Silver | 22 | 合格座位与抓牌顺序 |
| White | 23 | 最弱对手平局选择 |

| 传奇牌（各 1 张） | 页码 | 结果／分支检查 |
| --- | --- | --- |
| Bahamut | 16 | 混合阵营收款、不可胜利条件 |
| Black Raider | 16 | 按座位递增金币，奖池先行 |
| Blue Overlord | 16 | 两种金币去向 |
| Brass Sultan | 17 | 双邻居；两人局同一人承担两次 |
| Bronze Warlord | 17 | 没有明牌仍挂上延局效果；第三轮未赢进入第四轮 |
| Chromatic Wyrmling | 18 | 接受／拒绝替换，替换能力后再判断空手 |
| Copper Trickster | 18 | 替换必做、能力可选、Archmage 强制能力 |
| Dracolich | 18 | 只在结算加总，不更改单牌点数 |
| Gold Monarch | 19 | 赢牌局后送礼、Princess 重复发动 |
| Green Schemer | 20 | 双邻居；两人局双次付款 |
| Metallic Wyrmling | 21 | 善龙替换及保留分支 |
| Red Destroyer | 22 | 付款与私密随机牌 |
| Silver Seer | 23 | 公共抓牌后私密候选、选择与弃牌 |
| Tiamat | 23 | 自动颜色、混合阵营禁胜、不提供可复制神力 |
| White Hunter | 23 | 按自身牌组比较所有较弱对手 |

| 凡人牌（各 1 张） | 页码 | 结果／分支检查 |
| --- | --- | --- |
| Archmage | 16 | 后续发动；被换走后原玩家效果保留 |
| Dragonrider | 19 | 平时印刷点数、结算改值与新点数组合奖励 |
| Dragonslayer | 19 | 必须移除合法弱龙，包括自己的 |
| Druid | 19 | 反转胜者、平局继续回合 |
| Fool | 19 | 抓牌数量按其他牌组比较 |
| Illusionist | 20 | 交换／跳过、新能力、Merchant 收款人迁移 |
| Kobold | 20 | 先确定全部弃牌再抓牌、可不换 |
| Merchant Prince | 21 | 买牌款重定向，未进入奖池 |
| Priest | 21 | 胜者左邻分奖，奇数向胜者取整 |
| Princess | 21 | 善龙顺序选择、逐个续接，限定原始目标集合 |
| Prophet | 22 | 展示而不打出手牌、使用 Prophet 点数、Copper 替换本体 |
| Queen | 22 | 混合阵营收款、随机牌不公开 |
| Sorcerer | 23 | 公开三张、替换续接、其他两张入 ante、Copper 嵌套 |
| Thief | 23 | 奖池扣减 |
| Wyrmpriest | 24 | 持续颜色通配，保持凡人类型 |

## 印刷冲突、解释与待裁定

已选择有明确依据的解释：

- p9 示例中的 Copper Trickster 卡面与 p18 逐牌解释不同；按 p18 的详细解释处理。
- p16 Black Raider 标题误写 Mortal；p15 把它列为传奇龙，p16 又明确其黑龙颜色。
  采用邪恶传奇黑龙分类，未把它混入凡人组合。
- p19/p21 的延迟数值效果按每次发动分别登记；重复 Gold Monarch 会再登记送礼。
  Druid/Priest 等规则开关不重复叠加；Merchant 的收款人跟随交换后的牌。
- Seer 已满十张时仍可查看并选择，但 p11 禁止新增手牌；选中牌留在牌库顶，其余
  弃置。这是把 p11 上限与 p23 查看效果组合后的实现解释，并非查到的独立 FAQ。

没有在官网检索到补充这些角落的 FAQ。因此以下情况保留完整私有状态并明确进入
`adjudication`，输出对应机器码；**不应把本版本宣传为所有罕见规则均已最终裁定**：

| 机器码 | 涉及页码／缺口 |
| --- | --- |
| RULE_DECK_AND_DISCARD_EMPTY | p11 只规定重洗弃牌；两处同时无牌没有后续定义 |
| RULE_EMPTY_STAKES_TIE | p10 立即结束与 p11 单一胜者之间缺少并列／补牌顺序规则 |
| RULE_NO_ELIGIBLE_GAMBIT_WINNER | p16/p23 两种神力同时排除全部参赛者时无胜者规则 |
| RULE_TIED_WINNERS_ODD_HOLE_COIN | p11 要求玩家协商剩余金币；程序不替桌上玩家做决定 |
| RULE_EMPTY_HAND_AT_ANTE | 非正常恢复输入，规则不允许在 ante 随意买牌 |
| RULE_UNBOUNDED_EFFECT_CHAIN | 安全停止 2048 个自动步骤仍未收敛的替换链，避免锁死后台 |

本引擎没有加入“任意裁判改牌／改钱”的恢复动作。牌桌应呈现原因并暂停；后续明确
采用桌规后再增加窄范围裁定 continuation，而不是在 UI 中直接篡改权威状态。
可选 D&D 角色能力圆片（附录 5，p24–26）与主题桌规不属于本轮默认独立玩法。

## 验证证据与剩余集成

`node tools/three-dragon-rules-selftest.mjs --mutations`：20851 条断言通过；
2 人 12 局、6 人 12 局全部自然结束。每一步检查 80 张牌守恒和实体金币（包括
stakes/hole）守恒。18 个变异均因规则／权限／隐私断言失败，没有以编译崩溃冒充。
测试包含全部 100 个 ID、40 家族结果场景、分支与连续效果、动作重试／篡改／过期、
私密候选、手牌上限、强制买牌、平局、欠款、牌库重洗。自动整局不是穷举全部牌序。

独立复核找到并复验了以下顺序修正；另一个审查者使用独立构造的 80 牌分布，
没有复用这里的 fixture：

- p23：术士替换牌的能力先完整结算，再把另两张放入明牌区。Bronze 替换不能提前
  取这两张；`sorcerer-early-ante` 变异由此用例拒绝。
- p10/p23：上述能力立即清空奖池时，中断余牌入 ante，但仍须弃置公开保留牌；
  `sorcerer-lost-leftovers` 验证不丢牌。
- p18：Copper/Copper Trickster 先弃旧牌，再抽替换；耗尽时旧牌参与本次重洗。
  `copper-late-discard` 验证先后顺序。
- p11：最后一张牌被取走后立刻重洗当时已有的弃牌，后续新弃牌不能混入已经准备
  好的牌库；`delayed-reshuffle` 验证。独立复验使用 Gold 最后一抽接 Kobold 弃牌。

## 独立牌桌界面验证

`node tools/three-dragon-ui-selftest.mjs`：根集成补充后 256 条 Edge 浏览器 DOM 断言通过，
与上述规则断言分开计数。覆盖中英、18 种选择／40 家族说明、min/max/0 张确认、
合法动作使用最新 revision、旁观不展示手牌、创建者主持、重开确认、主持离线与
恢复记录缺失、选择与焦点保留、窄屏布局、裁定暂停、LOCAL 投影来源核对、
请求超时同页重连、清理订阅且关窗不退桌。检查了 390px 中英实际截图。
UI 只读公开／本人投影，不持有其他手牌、牌堆顺序、随机种子或主持私有状态。根补充了完整 LOCAL 分片回放与过期视图检查、按需展开的弃牌堆，以及确认后回大厅换人的新局流程。

尚未完成：真实多人房间对局、网络乱序与关闭重开／主持断线的端到端验收、
人类对局验收、上述未定义规则的最终裁定。运输与恢复由主任务独立实现测试，
不计入这里的规则或 UI 结果。新增 core 与 UI 后全仓库类型检查通过。
本子任务没有部署、stage、commit 或 push。
