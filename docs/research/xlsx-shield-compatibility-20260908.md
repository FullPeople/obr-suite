# XLSX 盾牌读取的中英兼容（2026-09-08）

本批只修改前端 `src/modules/characterCards/xlsx-shield-state.ts`，新增独立回归工具。未修改两份原始 XLSX，未生成简化模板或英文发行副本，未触碰相邻的无 Git 角色卡服务，未提交、部署或调用真实上传接口。完整翻译准备仍以 [xlsx-localization-20260908.md](xlsx-localization-20260908.md) 为准。

## 原件与先行复现

| 原件 | SHA-256 | 原始盾牌区 |
|---|---|---|
| public/DND5E人物卡_悲灵_弗人_枭熊适配版.xlsx | `94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6` | 主要!AL39=盾牌，AQ39=AC，AS39=着装，AQ40=2，AS40=否 |
| public/DND5R人物卡_悲灵_弗人_枭熊适配版.xlsx | `264fc65569e3e80932544af548830ca70f10ee308493c8b0234608fcd01c9b04` | 同一盾牌区坐标 |

先用真实 Edge 执行修改前的产品函数：两份原件均返回 `false`；在内存中将页签和表头替换为 Main/Shield，并使用 Yes，均返回 `null`；保留中文而移动实体 Main XML、更新关系并调整页签顺序，也均返回 `null`。六项旧行为断言通过后才修改产品代码。这是读取兼容性复现，不是 Excel 重算或上传验收。

根代理与 Maxwell 复核发现本批初版新增退化：AQ40 明确为 `t="e"/#REF!`、AS40 为 Yes 时，初版把错误读取成 null，再经空 AC 判断返回 false。修复前再次用两份真实原件派生包复现，均返回 false；模拟服务器已装备时，都产生 GET + PUT 并误写 `equipped=false`。该复现完成后才加入下述错误单元格契约及回归。

## 明确识别契约

1. 只接受 `xl/workbook.xml` 内唯一一个名为 `主要` 或 `Main` 的工作表。两种别名同时存在、缺少 `r:id`、同一关系被多个页签使用时返回 `null`，不按首个匹配猜测。
2. 通过 `xl/_rels/workbook.xml.rels` 的精确 Id 和 worksheet 类型定位实际 XML；支持合法相对路径、包内绝对路径和规范化的 `.`/`..`，不读取外部地址或逃出包根的目标。不回退到 sheet2。重复关系 Id、多个 worksheet 关系指向相同目标、缺失目标均拒绝。
3. 两种已核对的 2014/2024 布局共用盾牌区坐标：AL39 接受 `盾牌` / `Shield`，AQ39 接受 `AC` / `Armor Class`，AS39 接受 `着装` / `Equipped`。后续完整英文工作簿可采用这些明确标签；新增翻译或变更坐标需先更新契约，不能模糊猜测。
4. AV1 必须带有适配器机器标识 `schema=obr-suite-card/v1` 和 `meta.ruleset=5E2014` 或 `5E2024`。优先读可解析缓存；原件中带这些固定字面量的导出公式也可识别。因此原公式的作者文本引号导致缓存 JSON 无效，或者缓存尚未保存，不会单独使识别失败。缓存和公式明确指向不同规则版本时拒绝。普通 Main/Shield 表格不会仅凭这两个显示标签触发修正。这些标识是布局契约，不是工作簿真实性或版权认证。
5. 使用浏览器原生 XML 解析器，支持 Transitional / Strict 命名空间、属性顺序或单双引号变化、sharedStrings 关系重命名、行内字符串、富文本及数值实体。字符串的注音辅助内容不并入值。无 sharedStrings 的行内布局也可读；声明了但缺失/损坏的字符串表不猜值。重复单元格、不合法 XML、错误命名空间和 DTD/实体声明均拒绝识别。
6. 六个目标单元格 AV1、AL39、AQ39、AS39、AQ40、AS40 都先区分有效值、缺失/空值和明确无效。任一格有 `t="e"`、不支持的类型、非空却无法解析的共享字符串索引、类型不合法的数值/布尔缓存、重复或混合值容器、异常富文本结构时，整次读取返回 null，修正流程零网络操作。错误不会经空 AC 判断卸盾，也不会被 AV1 的旧公式标识回退吞掉；即使 AQ40 是 0，AS40 的明确错误仍优先使整次读取跳过。

未知或不明确布局返回 `null`，后续修正函数不读取或写入服务数据。损坏 ZIP、越界目录、加密或不支持的压缩方式等抛错，仍不进入写入。ZIP 只解压所需 workbook、关系、Main 和共享字符串 XML，不解压媒体或其他资料页；每个需要解压的 XML 设 32 MiB 上限，并核对实际解压长度，避免异常目录尺寸导致无限扩张。这不是通用 ZIP/Excel 校验器，不处理 ZIP64、多卷包或宏执行。

## 保持的行为

通过上述单元格有效性检查后，仍从 AQ40 的保存值判断盾牌 AC：缺失、空串或精确 `0` 返回未装备；其他情况下，AS40 交给既有 `readBooleanFlag` 处理，包括中文是/否、英文 Yes/No、原生布尔及公式缓存。AS40 缺失或空白仍返回 false；空的共享值 `<v/>` 与非空坏索引分开处理。普通字符串 `Maybe` 这类未知非空装备文字仍按既有规则返回 false，服务器原为 true 时仍可能提交未装备；本批明确保留这一兼容行为，没有扩大成新的装备词表，也不把它混同为 OOXML 错误。没有引入公式计算器，没有改变旧零值判定成通用数值计算。

`reconcileUploadedCardShieldState` 的网络/数据契约未改。只有识别出的装备状态与已上传数据不同才提交，唯一变更是 `combat.shield.equipped`。`combat.ac`、`ac_base`、盾牌 AC、自定义字段、玩家姓名/正文和规则版本均保留原值。不存在本批新增的前端 AC 总值重算；既有服务如何重新处理 AC 仍需真实上传核验。

## 验证及边界

运行仓库本地 Node：

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tools/xlsx-shield-selftest.mjs
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tools/xlsx-shield-mutations.mjs
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/typescript/bin/tsc --noEmit
```

真实 Edge 加载打包后的产品函数；独立 ZIP 工具只读两份原件并在内存中派生测试包。当前 219 项断言通过，包含原件散列、Blob/ArrayBuffer/带偏移的 Uint8Array、两版中英与布尔/AC 矩阵、关系迁移与混淆页签、损坏和未知布局、无共享字符串的行内布局、Strict 命名空间及冲突关系属性、重复缓存值、导出缓存异常及模拟上传的精确写入内容。新增 AQ40/AS40 错误、共享索引错误、非法类型/结构等均同时验证返回 null 和零网络操作；未知普通装备文字单独验证其既有 false 写入行为。完整 TypeScript 检查通过。八项产品变异均被捕获：固定 sheet2、放宽多 Main、忽略模板标识、忽略零 AC、把 No 当真、无效格退为空值、坏共享索引退为空值、接受非法类型；不把静态计数当成真实 Excel 验收。

仍未验证：实际 Excel/WPS 打开、重算并保存未来完整英文副本；真实服务识别 Main/英文列值及 2014/2024 解析；真实上传后的 HP/AC/资源一致性。此批只打通前端盾牌兼容，不能宣称完整英文模板或端到端上传已经可发布。
