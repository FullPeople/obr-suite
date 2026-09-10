# 种族资料英文审核 · 2026-09-10

本批完成两版种族名称、亚种、特性标题和部分说明的语言审核，尚未修改角色卡。完整种族资料迁移继续进行，不把审核数量当作可下载英文卡的完成度。

## 已保存的成果

`tools/xlsx-localization/reviews/species-text-first-20260910.jsonl` 新增 **2,374 条定位审核**，覆盖 **3,244 个位置、1,296 段不同原文**。其中 2014 为 941 条，2024 为 1,433 条；2,208 条为单元格文字，166 条为公式中的文字片段。

已审核内容包括两版现有种族及亚种名称、全部短标题、体型／速度／语言说明、短特性正文，以及部分带段落的等级能力和龙纹法术列表。规则正文以用户项目中的中文卡为依据，保留不同版本的触发条件、消耗、次数和限制。并非从公开页面替换整段规则。

审核文件 SHA-256：`5b2d6b23d3c5e8645de1dd2b7db287047e8e794f38da548387052c89275a8c60`。

全目录累计 **13,303 条正式审核、2,171 条种子、10,448 条无译文记录**。种族数据仍有 **268 条定位记录／233 段不同原文**待审核，主要为较长的能力说明。后续的职业、专长、装备等内容仍未完成。

## 名称与规则核对

通过原资料来源开关及相邻正文定位名称，避免只按中文字面猜测：

- “影妖精”属于 Book of Ebon Tides 的 Shadow Fey，与 Shadar-kai 区分；同书的 Sable Elf 也与 Drow 分开。[出版方资料页](https://koboldpress.com/kpstore/product/book-of-ebon-tides-for-5th-edition/)
- Obojima 的 Dara、Nakudama 与其资料开关对应；不按相似读音误用其他资料书种族。[出版方介绍](https://obojima.com/collections/books/products/obojima-pdf)
- 节日包的 Snowborn、Tarandus、Hederan、Canisar 按正式目录辨认。[正式目录](https://www.dndbeyond.com/sources/dnd/oswhap)
- Ratatosk 的 Ekorre／Tradvakt 按出版方资料确认拼写。[出版方介绍](https://koboldpress.com/ratatosk-celestial-gossips/)

同一个中文“迅捷”在化兽者处为 Swiftstride，在鹿族／鸮族的固定速度提升处为 Fleet of Foot，按版本与列分别审核。2014 化形后的移动反应在其他生物进入邻近范围时触发；2024 则在其他生物于邻近范围结束回合时触发，保留这一区别。

首轮特性键检查发现牛头人两个能力被译成相同标题，以及人类龙纹两项能力发生同名。现已修正 Goring Rush／Hammering Horns、Expert Handling／Wild Intuition；同时核对兽人 Adrenaline Rush 和 Draconblood 的 Forceful Presence。第一次报告和六条改正记录均保留，最终名称与同一特性行的标题均无新冲突。

数字对照发现的 11 处差异已逐项检查，均为文字／数字写法或重复表述合并，例如 `2万尺` → `20,000 feet`、`3/4` → `three-quarters`，并未改变值。特别保留源卡中 Dexterity 施法、1d4 次长休恢复等不常见说明，不擅自改成另一版本的规则。

## 依赖审计

新增只读工具 `tools/xlsx-localization/species_reference_audit.py`。它重新核对原卡、定位审核及第四十批工程卡的哈希，比较种族页全部文字／公式及公式属性；不比较计算缓存作为规则内容，不写入 XLSX。

| 检查 | 2014 | 2024 |
| --- | ---: | ---: |
| 种族页公式 | 1,075 | 725 |
| 直接读取主卡的公式 | 16 | 16 |
| 引用种族页的下拉规则 | 4 | 33 |
| 已审核位置 | 1,446 | 1,798 |
| 未审核记录 | 117 | 151 |
| 新名称／同一特性行重名 | 0 | 0 |

工程卡种族页的文字、公式和公式属性与原卡语义一致；整个 XML 字节并不相同，因此没有宣称文件部件原封不动。

主卡选择位于 `主要!T6/T7`，等级来自 `O6`，特性选择来自 `BT3:BT15`。2014 在 `AG3/AG4` 和 `AM2:AM14` 接收输入；2024 对应 `BT3/BT4` 和 `BZ2:BZ14`。正文由下拉规则提供，未发现其他页直接读取种族页的单元格公式；这不表示没有依赖，因为实际存在 37 条下拉规则。

后续迁移需要把旧中文输入映射到对应英文键，再检查 2014 的互斥能力统计、2024 的资料开关、亚种继承和正文选择。源卡中个别 2014 特性查找范围有逐行偏移，也应在原生对照中验证，不能未经测试直接扩大范围。多行固定正文应沿用背景批次已验证的段落保留方法；不得将玩家输入变成固定公式。

## 复现与接续

只读审计接受 `--input-2014`、`--input-2024` 和新的 `--output` JSON 路径。输入继续使用第四十批 U 盘目录：

`U:/枭熊插件/_audit/xlsx-background-data/background_data-candidate-20260909T234245614582Z`

两版哈希仍为 `2c13b2f4… / cf33cdb2…`，没有新工程卡取代它们。

工作目录：`F:/CodexData/admin/.codex/tmp/obr-species-data-20260910`。完整分组在 `groups.json`；标题与短正文在 `targets-labels-0..6.json`，后续正文在 `targets-bodies-0..3.json`，语境修正在 `target-overrides.json`。已审核至分组 `r1295`，下一段为 `r1296`。这些编号仅为本批工作索引，正式身份以审核文件的源哈希、版本和定位 ID 为准。

`reference-audit.json` 保留初始标题冲突，`corrected-titles.json` 记录修正，`reference-audit-final.json` 为最终只读结果。小型证据复制至 `U:/枭熊插件/_audit/2026-09-10/xlsx-species-review`。新增审核已通过目录重建与逐字验证。

本批没有原生重算、XLSX 作者操作、保存／打印验收、前端发布或服务器部署。完整英文下载、七份服务端解析补丁和真实房间验收仍待完成，持续目标保持执行。
