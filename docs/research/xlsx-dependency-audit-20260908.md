# 英文 XLSX 公式与导入依赖审计（2026-09-08）

范围：从已审核文字候选到可下载完整英文卡；本次仅只读原卡与当前本地消费者。没有修改产品、原卡、翻译 reviews 或生成英文成品，没有 Excel/WPS 重算、实际上传或线上服务验证。工作树为 U:\枭熊插件\obr-suite，旁边 U:\枭熊插件\character-cards-server 是本次检查的服务端源码，其线上部署是否一致尚未验证。

已读 tools/xlsx-localization/README.md、docs/research/xlsx-localization-20260908.md、现有 coverage/structure 与 prepare/verify_candidate。此前电子表格技能要求保留公式、验证、名称、隐藏页、外链及布局；本轮没有做工作簿写入。

## 结论与实施顺序

完整正文翻译仍需继续，但发布前还有四项独立的功能工作：

1. 给现有服务端增加按规则版本识别的中英文页名适配，并保留中文原卡路径；不能只靠 Main 名称猜模板。
2. 将“显示文字、精确查找键、公式字符串条件、验证选项、名称和页名引用”按依赖组一起迁移。中文“是/否”是已确认会改变 AC 计算的例子。
3. 拆分 AV1 到有明确清单的辅助公式，补 JSON 字符串转义，同时保留 AV1 的机器 schema/ruleset 和字段类型。不能靠现有缓存宣称导出公式已修好。
4. 在原 OOXML 包上定点应用；扩展候选核验器以显式允许新增导出辅助单元格/页，其余部件继续严格保留。完成真正 Excel/WPS 重算、下拉选择与实际导入回归后，才新增英文下载链接。

当前设置页仍如实提供两份 “Chinese” 模板（src/settings.ts:2413–2433）。本次没有把内部部分文字候选接成下载成品。

## 1. 固定证据与本次诊断

| 项目 | 2014 | 2024 |
| --- | --- | --- |
| 原卡 SHA-256 | 94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6 | 264fc65569e3e80932544af548830ca70f10ee308493c8b0234608fcd01c9b04 |
| AV1 公式字符数，不含开头 = | 8013 | 8663 |
| 已保存 AV1 JSON 字符数 | 1897 | 1848 |
| schema / ruleset | obr-suite-card/v1 / 5E2014 | obr-suite-card/v1 / 5E2024 |
| 原式实际函数 | IF、ISNUMBER、_xlfn.TEXTJOIN | 同左 |
| 网页导入页及显示公式 | B2:P28；B8=主要!$AV$1 | 同左 |
| 服务端读到的法术字典条数 | 522 | 808 |

两份原卡在检查结束时重新散列，与开头一致。服务端 parser.py SHA-256：b7f73c7fc06e11679b696b7b08e528ae9aaf455518a4f03bcb2eb1c645b6c9c1；server.py：d0704d9add92f0267c0d2468dcf872fb8ab03b5052b467b2a603cebfe10cd5f1。后续消费者变更应重新跑相同输入。

本次 [xlsx-dependency-diagnostics.json](./xlsx-dependency-diagnostics.json) 保存了原式模型及真实 parser 函数的结果。模型只解释原式实际使用的三种函数、连接与相等操作，读取原卡已保存的单元格值；两版模型输出都与原 AV1 缓存 JSON 完全相等。它证明拼接/转义缺陷，不代表 Excel 计算引擎、区域设置或缓存新鲜度通过。

## 2. AV1：公式长度、转义和输出上限是不同问题

Excel 公开限制为公式内容 8192 字符、内部公式 16384 字节，单格文本 32767 字符。2024 原式已超过内容限制 471 字符；2014 仅余 179 字符，加入英文页名和转义也可能超限。必须同时检查两版的全部新增公式，而非只让 2024 变短。[Microsoft：Excel specifications and limits](https://support.microsoft.com/en-us/excel/excel-specifications-and-limits)

原式把 A1/E3/E4、种族/职业/武器/能力描述等值直接拼进 JSON 引号内，没有 SUBSTITUTE。例如原式片段：

~~~text
""character_name"":"""&E3&""",""display_name"":"""&背景!E3&"""
~~~

2024 的个人页引用为 起源!E3。用真实原式和原缓存，只替内存中的 主要!E3：

| 输入 | 两版原式模型结果 |
| --- | --- |
| Aria | JSON 有效且逐字还原 |
| A"B | JSON 语法错误 |
| 字面量 C:\notes | JSON 有效，但 \n 被解释为换行，姓名发生静默改变 |
| LF、CRLF、Tab、Backspace | JSON 非法控制字符错误 |

这不是“英文名字不能用引号”的输入限制；引号和换行本来就是合理内容，导出需要编码。应对所有动态字符串字段做统一 JSON 转义，包含标题和长正文，不能仅修角色名。

建议先在辅助页对每个动态字符串建立转义值，再组装分段对象/数组，最后由 Main!AV1 拼接。原数字分支仍保留 IF(ISNUMBER(...),...,0) 等现有类型/coercion，不把数值全部改成字符串或把字符串数字强转。普通字符内容应在 JSON.parse 后逐字相等；CRLF 不应被擅自归一化为 LF。

常用五类转义的公式结构示例（仅说明构造顺序，不是完整生产实现）：

~~~excel
=SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(Main!E3&"",CHAR(92),CHAR(92)&CHAR(92)),CHAR(34),CHAR(92)&CHAR(34)),CHAR(13),CHAR(92)&"r"),CHAR(10),CHAR(92)&"n"),CHAR(9),CHAR(92)&"t")
~~~

必须先转义反斜杠再添加其它转义，避免把新加入的反斜杠重复转义。生产版本还要处理可进入单元格的其它 U+0000–001F 控制字符；Excel/XML 无法表示的输入应明确拒绝，不能用 CLEAN 丢字符。不能无条件引入只在部分版本支持的 LET/LAMBDA，现有 _xlfn.TEXTJOIN 的实际 Excel/WPS 兼容也需保留实测。

拆分辅助格只解决“公式太长”，没有解除最终 JSON 单格 32767 字符限制；TEXTJOIN 超出该限制会返回 #VALUE!。[Microsoft：TEXTJOIN](https://support.microsoft.com/en-US/Excel/textjoin-function)
AV1 包括多条能力、武器、道具描述，已填人物卡可能超过空白模板的 1848/1897 字符很多。完整正文不能删减来满足导出：
- 第一阶段维持原 AV1 单 JSON 契约，测量总输出长度，在溢出时明确报错，禁止截断或回退到旧缓存。
- 若实际正常使用卡确需超过 32767，另做版本化分块导出契约与服务端重组；网页导入!B8 的单格复制路径也必须同步支持。没有消费者适配前不能悄悄让 AV1 变为第一块/摘要。

## 3. AV1 的机器证明与真实消费者

### 3.1 前端盾牌适配

src/modules/characterCards/xlsx-shield-state.ts:156–168 在缓存缺失/JSON 无效时，仍可从 **AV1 本身的公式字面量**核验 schema 与 ruleset。若把 AV1 改成纯 =Export!B1&Export!B2，这条兜底就会消失。

应保留 AV1 中的 ""schema"":""obr-suite-card/v1"" 与 ""ruleset"":""5E2014""/""5E2024"" 字面量，辅助页只承担其余安全编码段。也可新增显式模板机器元数据，但须先实现消费者、处理重复/冲突和旧卡兼容；不能根据任意 Main 页接受未知布局。

该读取器只接受“主要”或“Main”，要求唯一主表，继续检查 ZIP 关系路径和 namespace，再读取 AV1、AL39/AQ39/AS39、AQ40/AS40（同文件:178–254）。这些坐标与 Shield / AC / Equipped 标签必须保持。切页名不应挪动统计格。schema/ruleset 冲突、显式错误格仍应返回未知而不写资源；不得借英文迁移更改 AC。

原式及服务端旧布局仍取 AS41 作为 shield.equipped，而实际原卡 AS40 是“否”、AQ40 是 2，AS41 为空。前端已有针对 AS40 的校正。迁移不能顺手把 AS40 移到 AS41；如单独修 AV1/服务端读取坐标，应作为明确功能补丁测试，保留 AC 的现有含义。

### 3.2 服务端 AV1 不是完整导入契约

U:\枭熊插件\character-cards-server\parser.py:1467 起先按格读取数据，再将 AV1 JSON 作为可选 overlay。正式返回形状是 schema_version:"0.3"；AV1 使用 schema:"obr-suite-card/v1"，二者不是可互换的 JSON 文件。

已用原卡缓存形状调用真实 _overlay_embedded_json（:1654 起）：
- 将 abilities.str.score 设为 19，仍保留格读取的 10；当前 overlay 只接收 abilities.str 的数值形状。
- 将 core_stats.hp 改为 {current:7,max:21,temp:3}，仍保留格读到的 0/0/0；当前分支读取标量 hp/hp_current 等。
- classes[0].name="Wizard" 没有覆盖；_g 只遍历 dict，不能进入 classes 数组。

因此“只修 AV1 就能绕过中文页名、格坐标、缓存”不成立。建议本批先保留现有 AV1 字段形状与格解析优先行为；若以后扩大 overlay 支持，用显式 schema 分发/形状测试修复，而非在模板翻译时偷偷换 JSON 键或默认数值。原 AV1 本身不包含所有完整人物卡内容，例如法术正文/个人背景仍靠格与字典导入。

## 4. 英文页名迁移必须先接服务端

parser.py:607–661 的布局判定依赖：
- 起源存在 → 2024 布局；
- 主要 + 背景 + 装备/数据表/圆形效应范围 + 网页导入或骰娘导入 → 2014 新布局；
- 未匹配时回退旧布局/标题版本。

parser.py:1472/1477/707 在读取 AV1 overlay 前就读取中文“主要”。只将实际原卡的页名通过内存代理换为 Main / Origins / Background 等，不改任何值，两版均选择 v1.0.0 并在 parse_classes 抛 KeyError:'主要'。

应引入按“规则版本 + 模板布局”验证后的 sheet-role 解析器，一次解析并将真实页对象/页名传给所有下游，避免每个函数各自猜名字。保留完整中文映射和旧布局回退，但对有英文特征却缺关键页、重复 Main/主要、版本冲突的卡闭门报清楚错误，不按错误坐标继续导入。

建议角色映射（不能跨版本直接全局替换“背景”）：

| 角色 | 2014 原名 → 英文 | 2024 原名 → 英文 |
| --- | --- | --- |
| 主表 | 主要 → Main | 主要 → Main |
| 个人背景页 | 背景 → Background | 起源 → Origins |
| 背景字典 | 背景数据 → Background Data | 背景 → Background Data |
| 法术字典 | 法术大全 → Spell Compendium | 同左 |
| 独立物品容器 | 背包 → Inventory | 同左 |
| 导出说明 | 网页导入 → Web Import | 同左 |

其余页名按独立审核的唯一映射处理；内部 layout_version 不要因显示语言变化而变成另一种坐标布局。标题 A1 的作者/版本提取（parser.py:590）以及主要!E2:N2 的规则标识读取（:567）也要保留机器部分。

其它会静默退化的页依赖：
- load_spell_db（:892）找不到“法术大全”便返回空字典；真实原卡 522/808 条会变为 0，导入不一定直接报错，但正文/成分/持续时间/学派丢失。
- parse_containers（:1185）优先找“背包”；新版旧主表容器区为空，改名后可能静默失去容器物品。
- 所有新版/旧版词典路径均应通过同一角色映射，包括旧分支的种族特性查找；保持现有匹配算法，不以英文改版名义改数值规则。

## 5. 查找键和枚举需要依赖闭合

### 5.1 已证实的数值破坏例子

两版 主要!D23 原式均为：

~~~excel
=SUM(AF40,AI40,G23,+IF(AS40="是",AQ40,0))
~~~

同页验证选项为 "是,否"，覆盖 AS40:AT40 等格。只把下拉选项/当前值改成 Yes/No，公式仍比较“是”，选择 Yes 后就不会增加 AQ40 盾牌 AC。必须一起改验证、当前值、所有对应公式/条件格式字符串；保留 O/X 等不同的熟练/同调标记，不能把所有真假样式统一改成 Yes/No。

前端 data-normalize.ts 已接收 yes/no、是/否；这不会替 Excel 修复 D23。服务端旧 shield 仍读 AS41 且有自己的接受集合，也不能据前端支持判断整链通过。

### 5.2 背景 A 列是压缩目录，不是同行正文主键

2024 正确路由：
- 起源!E6 → 背景!I2；
- 背景!O2=IFERROR(VLOOKUP($I$2,$B$2:$H$141,7,FALSE),"") → **起源!AP4**；
- 背景!K2 同样精确 VLOOKUP 返回第 3 列，即 D 专长名称 → 起源!AF4。

更正旧独立报告的措辞：AP4 在“起源”（sheet1），不在“主要”；主要!AP4 为空。这不改变 B→H 正文键匹配的既有结论。

A63 的数组公式是第 63 个非空 B 值；其缓存是“笑面人”，不能与 H63 配对。B63 是由 自定义调整栏!E36 控制的“神话调查员”，H63 是对应神话调查员正文。A65 的目录缓存是“琼达斯海盗”，其真实键在 B102，正文在 H102。应记录 B 的公式字面量及启用条件；禁用时 B 缓存为空不能当作不存在的正文。

### 5.3 建议的可追溯键清单

为每一实际查找族建立独立映射：
- 身份：原卡 SHA / 2014或2024 / 源页角色 / 实际键列或命名单元格 / 原中文键 / 来源与上下文；记录公式门控条件和所有消费者。
- 英文候选优先使用**同一记录**已有英文名称列，再人工确认同规则版本、同来源、同条目；没有同记录英文名时使用经审核译名。不得用同名另一版本条目替代。
- 同一键跨相关字典、选项、显示与正文标题使用同一确定译名；同名不同来源不能因中文一致便盲合并。检查重复英文键是否使 VLOOKUP/MATCH 返回第一条错误记录。
- 自制姓名、手写故事、已写人物卡内容不可全局“替换词”；成品空白模板与用户旧卡的升级是不同操作。

本轮父代理指出 2024 背景 D90:D101、D112:D121 的 22 个专长名是描述性英译，例如“异变者→Mutant”“咒饰编织者→Charm Weaver”“翠绿闲庭新羽→Emerald Enclave Fledgling”“骄阳之子→Child of the Blazing Sun”。它们应列为 key-resolution pending：定位专长页实际记录及已有英文名，按同来源/版本选择唯一 target，再同步依赖组；不能因为正文翻译通过就独立写进 D 列。D→K2→起源AF4 是本次已核实的显示传递；未证明的后续自动查找不能臆称存在，但需要与用户选择专长时的名称保持一致。

G116 的“链火绒盒”没有原文分隔，暂译 Chain + Tinderbox 已留疑点；应保留待内容审查，不能将 + 当已验证的装备列表结构。

### 5.4 客户端和服务端枚举

- JSON 能力键 str/dex/con/int/wis/cha，proficiency 的 none/proficient/expertise，货币键、资源 type/id 等是机器字段，应保持。
- parse_skills（parser.py:781）从布局常量输出中文技能名，**不读取用户翻译后的可见技能标签**。只翻译表头不会自行破坏被动察觉；不要误报。现有 _compute_core_stats_fallback（:1633）仍匹配“察觉”，若未来把服务端技能名改成英文，则必须先改为稳定技能身份或中英文别名，不能只改常量。
- 客户端 localization.ts:26–31 已能显示中英文固定属性/技能/规则词，并保留未知自制名称。保留它的作者文字边界，不把整个 JSON 递归机械翻译。
- _collect_area（parser.py:692）、SECTION_TOKENS（:1030）、容器表头过滤（:1198）只跳过中文标签。翻译“语言/熟练工具/名称/特殊能力”等时，应按固定表头坐标排除或补明确双语集合，防止英文标题变成语言、特性、物品。
- 法术 DB 用 A 列键建立字典，_enrich_spell（:925）按 entry.name 精确匹配。仅翻译字典名或仅翻译已知/准备列表，会丢正文；要同时更新键、选项与查找公式，保留 N 列现有英文名称作为同条目证据。
- _build_auto_resources（:1396）仍输出中文法术位显示名，特殊资源 id 则来自实际名字的散列（:1359）。“狂暴→Rage”会改变 id；对空白英文模板没旧 token 需迁移，但不能将现有玩家资源视作同 id 自动覆盖。未来旧卡语言升级需显式映射/保留原 id，不能只改显示名后重导造成重复。
- 独立服务端 HTML renderer/render.py:26–47 和 renderer/template.html:69 等仍硬编码中文，weapon_properties.py 用中文键。完整英文卡下载不自动代表这些独立 HTML 页面已经英文化；若该页面仍由用户使用，需另接语言与固定术语显示，不能将其计入本批已完成。

## 6. 具体候选制作路线

1. 固定上述原卡散列，保留原始文件。语义 review 与 dependency review 分开；长正文、名词、formula_literal、sheet_name、validation、conditional、defined_name 均按实际引用关系审查。
2. 先实现中英文 sheet-role/枚举消费兼容并用原中文卡回归；保持坐标、公式数值语义、0.3 JSON 和老模板规则。不强依赖 AV1 来替代格解析。
3. 为每版生成声明式依赖变更清单：原部件/格/公式 hash、目标 hash、页名映射、查找键映射、受影响引用、预期机械结果。使用公式 token/AST 识别页引用、名称引用、字符串比较；INDIRECT 中的地址字符串、验证公式、条件格式、图表/名称/打印区域等分开审查，禁止全包文本替换。
4. AV1 建议使用一个新增隐藏英文辅助页（名称需唯一），写入分段转义和 JSON 构造；AV1 留机器头字面量及最终拼接。保留原所有页顺序/状态，新增页及其关系、明确增加的公式格由清单逐项批准。不要把格式化空白格当安全空间直接覆盖。若选择复用 Web Import 未用区域，也先证明公式、合并、验证、打印布局和引用均不使用该区域。
5. 继续用 artifact-tool 制作并精确回读目标单元格内容，再将经过验证的目标定点并入原 OOXML 包；保留未受影响共享字符串、富文本强调、样式、图片、外链与关系部件。之前整本 artifact 导出已证明会丢隐藏状态、外链等并生成大量错误缓存（另见 xlsx-roundtrip/roundtrip-report.md），不应作为完整英文卡的包级底稿。
6. 当前 verify_candidate.py:35–62 要求页数、cell_count、formula_count、公式坐标集合和包部件完全相等；单纯 approvals 哈希无法批准新增辅助页/格。要加**明确新增集合**的狭窄契约，并依旧拒绝未列明的移动/删除/新增，检查依赖闭合和每个新公式长度。不能为了让候选通过关掉这些检查。
7. 文字替换会使原公式缓存仍显示中文。保留原缓存用于可追溯差异不等于它有效；候选完整重算后重新检查派生值。原有种族 #N/A、装备 AO59 #REF、坏 defined names/外链单独记录，不擅自删去以获取“零错误”。
8. 正式英文下载使用独立、有校验和的文件名/版本，中文下载继续保留。只有全量内容审核、依赖检查、Excel/WPS/上传验证通过才切下载入口；部分候选仍明确标为内部候选。

## 7. 对原件可执行的测试与发布门槛

已执行的是末尾附录的只读诊断；结果见 JSON，原卡散列未变。运行 openpyxl 时出现不支持 extension/conditional-format extension 的警告，但未调用 save，未删除原包内容。

后续对**原卡副本**及目标英文候选做同一组输入，形成版本对应的预期结果；原卡只做基线，不覆盖 public：

| 检查 | 输入与应断言内容 |
| --- | --- |
| 原式转义回归 | 姓名、玩家名、能力长描述、武器名放入引号、反斜杠、LF/CRLF、Tab；JSON.parse 后逐字等于输入，且数值/数组结构与基线一致 |
| 长度 | 每个公式 ≤8192；核查内部长度/嵌套限制；拼接输出 32766/32767/32768 附近明确行为；不能用截断通过 |
| 盾牌 | AQ40=2，AS40 是/否或 Yes/No；公式 AC 相差 2，导入 equipped 正确；含错误格/空格仍按既有未知或未装备边界，导入不重算 AC |
| 查找 | 选一基础背景和一门控背景，验证实际 B 键、C:H 数据及个人页输出；专长名在同规则/来源字典一致；A 压缩目录变化只改变目录位置 |
| 选项/数值 | 属性、技能、职业/子职、装备、法术、专长选择各一条；检验总值、熟练、命中、HP、法术位、资源、容器物品等旧语义不变 |
| 中英文导入 | 原中文 2014/2024、新英文两版及现有旧布局；准确选择布局、规则、个人背景、法术正文和背包；重复主表/冲突 ruleset/缺关键页拒绝 |
| 原资源 | 既有角色重新导入时不因显示译名丢失/重复旧 tracker；语言显示切换不写 token 数值 |
| 包与 UI | 除明确变更清单外所有部件/公式/名称/验证/图片/隐藏状态一致；实际 Excel/WPS 开启、全重算、保存、重开无新增修复提示；检查所有可见/隐藏资料页和打印布局 |
| 真实业务 | 通过实际服务端上传/刷新，检查 .json、全屏/小卡、盾牌和资源。父服务端源码、部署版本及客户端版本都须记录 |

无 Excel/WPS 时可继续完成文本、依赖清单和包级候选，但上述实际重算、保存、视觉和上传仍是未通过项。不能用本地缓存模型、artifact render 或导出成功替代。

## 附录：本次诊断代码

运行方式：把下列 Python 代码送给 bundled Python（-X utf8），工作目录 U:\枭熊插件\obr-suite。只读取 public 原件和服务器源码，唯一写入是同目录审计输出 xlsx-dependency-diagnostics.json；不会保存工作簿。模型覆盖原 AV1 当前语法，并断言没有剩余 token；它不是通用 Excel 引擎。

~~~python

import sys,json,copy,runpy
sys.dont_write_bytecode=True
from pathlib import Path
from openpyxl import load_workbook
from openpyxl.formula.tokenizer import Tokenizer
P=runpy.run_path(r'U:\枭熊插件\character-cards-server\parser.py',run_name='audit_parser')
class Formula:
 def __init__(self,s):
  self.ts=Tokenizer(s).items; self.p=0; self.tree=self.expr(); assert self.p==len(self.ts)
 def expr(self):
  a=self.concat()
  while self.p<len(self.ts) and self.ts[self.p].value=='=':
   self.p+=1; a=('=',a,self.concat())
  return a
 def concat(self):
  a=self.atom()
  while self.p<len(self.ts) and self.ts[self.p].value=='&':
   self.p+=1; a=('&',a,self.atom())
  return a
 def atom(self):
  t=self.ts[self.p]; self.p+=1
  if t.type=='FUNC' and t.subtype=='OPEN':
   args=[]
   while True:
    args.append(self.expr()); end=self.ts[self.p]; self.p+=1
    if end.type=='FUNC' and end.subtype=='CLOSE': break
    assert end.type=='SEP',end
   return ('fn',t.value[:-1].removeprefix('_xlfn.'),args)
  assert t.type=='OPERAND', t
  if t.subtype=='TEXT': return ('lit',t.value[1:-1].replace('""','"'))
  if t.subtype=='NUMBER': return ('lit',float(t.value) if '.' in t.value else int(t.value))
  if t.subtype=='LOGICAL': return ('lit',t.value=='TRUE')
  if t.subtype=='RANGE': return ('ref',t.value)
  raise AssertionError(t)
 def run(self,values,patch):
  def text(v): return '' if v is None else ('TRUE' if v is True else 'FALSE' if v is False else str(v))
  def walk(n):
   if n[0]=='lit': return n[1]
   if n[0]=='ref':
    key=n[1].replace('$',''); key=key if '!' in key else '主要!'+key
    return patch[key] if key in patch else values.get(key)
   if n[0]=='&': return text(walk(n[1]))+text(walk(n[2]))
   if n[0]=='=':
    a,b=walk(n[1]),walk(n[2]); return ('' if a is None else a)==('' if b is None else b)
   name,args=n[1:]
   if name=='IF': return walk(args[1] if walk(args[0]) else args[2])
   if name=='ISNUMBER':
    v=walk(args[0]); return isinstance(v,(int,float)) and not isinstance(v,bool)
   if name=='TEXTJOIN':
    delim,skip=walk(args[0]),walk(args[1]); vals=[text(walk(a)) for a in args[2:]]
    return delim.join(x for x in vals if x or not skip)
   raise AssertionError(name)
  return walk(self.tree)
class Renamed:
 def __init__(self,wb,m):
  self.wb=wb; self.names={m.get(n,n):n for n in wb.sheetnames}; self.sheetnames=list(self.names)
 def __getitem__(self,n): return self.wb[self.names[n]]
rows=[]
for v,glob in [('2014','DND5E*.xlsx'),('2024','DND5R*.xlsx')]:
 path=next(Path(r'U:\枭熊插件\obr-suite\public').glob(glob))
 w=load_workbook(path,read_only=True,data_only=False); c=load_workbook(path,data_only=True)
 formula=Formula(w['主要']['AV1'].value)
 refs=set(t.value.replace('$','') for t in formula.ts if t.type=='OPERAND' and t.subtype=='RANGE')
 refs={r if '!' in r else '主要!'+r for r in refs}
 vals={r:c[r.split('!')[0]][r.split('!')[1]].value for r in refs}
 normal=json.loads(formula.run(vals,{})); cached=json.loads(c['主要']['AV1'].value)
 cases=[]
 for label,value in [('ascii','Aria'),('double_quote','A"B'),('backslash',r'C:\notes'),('line_feed','Line1\nLine2'),('cr_lf','Line1\r\nLine2'),('tab','A\tB'),('backspace','A\bB')]:
  actual=formula.run(vals,{'主要!E3':value})
  try:
   got=json.loads(actual)['identity']['character_name']
   cases.append({'case':label,'json_valid':True,'roundtrip_equal':got==value,'decoded_repr':repr(got)})
  except json.JSONDecodeError as e: cases.append({'case':label,'json_valid':False,'error':e.msg})
 _,ver=P['_parse_template_version'](c['主要']['A1'].value)
 m={'主要':'Main','起源':'Origins','背景':'Background' if v=='2014' else 'Background Data','法术大全':'Spell Compendium'}
 fake=Renamed(c,m); layout=P['_select_layout'](fake,ver)
 try: P['parse_classes'](fake,layout); rename_result='unexpected success'
 except KeyError as e: rename_result='KeyError: '+str(e)
 orig_layout=P['_select_layout'](c,ver)
 data={'abilities':P['parse_abilities'](c,orig_layout),'core_stats':P['parse_core_stats'](c,orig_layout),'classes':P['parse_classes'](c,orig_layout)[0]}
 before=copy.deepcopy(data); ej=copy.deepcopy(cached)
 ej['abilities']['str']['score']=19; ej['core_stats']['hp']={'current':7,'max':21,'temp':3}; ej['classes'][0]['name']='Wizard'
 P['_overlay_embedded_json'](data,ej)
 db=P['load_spell_db'](c,orig_layout)
 rows.append({'version':v,'source_formula_reference_model_equals_cached_json':normal==cached,'escape_cases':cases,'renamed_sheets_selected_layout':layout['version_label'],'renamed_sheets_import_result':rename_result,'overlay_original_str':before['abilities']['str']['total'],'overlay_requested_str':19,'overlay_observed_str':data['abilities']['str']['total'],'overlay_original_hp':before['core_stats']['hp'],'overlay_requested_hp':ej['core_stats']['hp'],'overlay_observed_hp':data['core_stats']['hp'],'overlay_class_observed':data['classes'][0]['name'],'spell_db_count':len(db),'spell_db_after_rename_with_old_layout':len(P['load_spell_db'](fake,orig_layout)),'first_spell_key':next(iter(db)),'first_skill_name':P['parse_skills'](c,orig_layout)[0]['name']})
 w.close(); c.close()
out={'scope':'Read-only original XLSX formulas with cached-cell reference model and real parser functions; NOT Excel/WPS recalculation. In-memory patch cases never saved to workbook.','results':rows}
target=Path(r'U:\枭熊插件\_audit\2026-09-08\xlsx-dependency-diagnostics.json')
target.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(out,ensure_ascii=False))

~~~
