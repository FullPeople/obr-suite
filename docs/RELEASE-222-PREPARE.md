# 2026-10-01 · 222 仪表盘发布准备

本批已于 2026-10-01 部署为 `1.0.222-dev`。实际版本、验证与恢复点以 [222 发布回执](RELEASE-222-RESULT.md) 为准；下文保留发布前的准备记录。

用户已验收本地仪表盘并授权部署，追加要求总览资源使用相同格式。本文件记录 Suite 配套输入与自动验证，不是部署成功回执。

最新线上预检确认 Suite 为 `1.0.220-dev`，运行提交 `a0db78b416b3b532c0bc062811a75c5d4117016a`。已完整保留 220 的 Edge 资源校验、限流队列与维护去重增量，再合入本批历史与仪表盘；219 仅为隔离树起点，不再当作当前线上基线。

## 源码与版本

- 当前隔离树：`D:/Desktop/DND-card-web/.local-evidence/resource-dashboard220/suite`，分支 `codex/resource-dashboard220-suite`，远端 `https://github.com/FullPeople/obr-suite.git`。
- 隔离树起点为 219 回执提交 `fcdb76ec0c1e1ac5e70b81d4c0cbef61e438f595`；219 运行提交 `fb0e915e634db8300bc3c00195a3be257adac8fd`。随后保全线上 220 运行提交 `a0db78b416b3b532c0bc062811a75c5d4117016a` 与发布回执，219 的 Action 不关闭和唯一后台先攻提交行为继续保留。
- 新版清单 `public/manifest-dev.json` 更新为 `1.0.222-dev`；`package.json` 的 `1.3.10` 是仓库包版本，不作为部署清单版本，不改旧版清单。
- Web 目标 `standalone-1.0.222`，公告版本 `0.1.20`。嵌入的新版 Suite 公告来自 Web `src/platform/releaseNotes.ts`，应保留 219 的 `2026-10-01-三` 历史，新批日期为 `2026-10-01-四`，仅最新批展开。Suite `public/announcement.md` 属于旧版 DM 公告，保持原样。
- 群公告草稿：`docs/ANNOUNCEMENT-222.txt`。本次没有代发消息。

## Suite 数据契约

- 资源摘要支持 16 款现行样式及 2 个旧样式，保留样式、六位十六进制颜色、白名单图标、12 × 6 几何和资源池分组。
- 投影只包含当前接收者获准看到的资源 ID；池成员同样过滤。几何和样式不拥有或重置资源余额。
- 武器区域以独立 `resourceAttacks` 投影传输；没有伪造武器资源。原生 `quickbarLayout` 优先于旧格式。
- 公共仓库支持相同外观，仍仅 DM 可修改外观，玩家消费不会覆盖外观；CAS 与重复请求保护保留。
- 排版的临时重叠、冲突禁止保存、幽灵拖入及总览的实际组合显示由本批 Web 实现并验证。本次未改旧版 Suite 的原生 DM 资源面板。

## 已完成 218 历史链的迁入

按本轮明确授权，从 `U:/code/DND-card-suite-release210` 只读取回已完成的历史增量与 5 个测试文件；没有覆盖原目录。迁入包含统一 100 条、按投骰身份去重与公开状态升级、延迟旧结果排序、四种可见范围、降权隐藏与升权恢复，以及历史窗口、投骰页、回放与宿主转发的一致过滤。

改动通过只含历史路径的补丁应用；`history-page.ts` 合并保留 219 Action 不关闭行为及错误处理。生产适配器继续引用 `dice-submit`，后台继续安装并拆卸唯一提交服务；在保全 220 时，同步取回该版本对提交发送和错误文本的改进。218 测试的根路径改为当前隔离树/环境变量，便于重跑，没有复制旧构建产物。

## 线上 220 修复的保全

保留 `docs/DICE-EDGE-220.md` 与 `docs/RELEASE-DICE-EDGE-220-RESULT.md`，没有使用旧 219 骰子覆盖线上 220。除清单仍为本批 222 外，其余 220 新增/修改文件均已取回；`controller.ts` 和 `dice3d.ts` 与本地历史链合并，生产适配器依旧只创建一套后台引擎。

两份 vendor 文本按 220 的 `.gitattributes` 恢复精确 Git 锁定 LF，仅在原文件 CRLF→LF 与目标 Git 字节一致时写回。其他文件与二进制未任意归一。合并补丁及该字节转换的前后散列记录在 `suite-validation222/edge220-merge/`。完整构建继续用原 217 构建器，但内嵌 220 的新版骰子构建器会核对 `asset-hashes.json` 与 `vendor/lock.json` 两份锁，实际锁定资产共 59 项。

## 本机验证

Node `22.17.1`，使用现有依赖 junction，没有安装或删除依赖。

- `node tools/resource-dashboard-220-selftest.mjs`：15 项通过，覆盖样式/几何、授权池投影、JSON 持久化、增量保存、并发余额保留、公共库存权限/CAS/重复请求。
- `node --experimental-strip-types tools/resource-presentation-217-selftest.mjs`：原有投影及原生/旧版写入断言通过。Node 实验类型擦除提示不是失败。
- `node tools/resource-presentation-inventory-217-selftest.mjs`：原有库存资源外观、权限、CAS、持久化断言通过。
- `node tools/workbench-177-transport-selftest.mjs`：12 项通过，包含真实本机 HTTP relay，未连接真实房间。
- `node tools/workbench-dice-frame-219.mjs`：9 项通过，确认先攻 iframe 复用常驻后台、连接边界、错误传递、重复请求和拆卸保护。
- `node tools/workbench-initiative-219.mjs`：3 项通过，确认未接受不写先攻、失败可读、接受后的兜底只写一次。用例故意输出一次合成 429 错误。
- 迁入历史后追加 `workbench-dice-history-218.mjs` 11 项、`workbench-dice-controller-history-218.mjs` 5 项、`workbench-dice-lifecycle-217.mjs` 5 项，共 21 项通过。随后再次执行 219 提交桥 9 项与先攻 3 项，均通过。
- 保全 220 后，36 项骰子核心、6 项发送队列、6 项真实锁定资产损坏检查通过；21 项历史/生命周期、9 项提交桥与 3 项先攻再次通过。
- `node node_modules/typescript/bin/tsc --noEmit` 与独立骰子 `tsc -p extensions/workbench-dice3d/tsconfig.json --noEmit`：两个完整类型检查通过。

新资源、历史、骰子桥与先攻结果材料在隔离树同级 `suite-validation222/`；`history-merge/` 保存取回补丁与原文件散列。本机 HTTP relay 结果位于 `workbench-test-output/transport177/`。完整 Suite 构建已经完成，生产浏览器复验排队中；当前没有真实宿主测试，没有提交、推送或部署。

## 正确构建路径

复用已审阅的 `tools/build-release217.mjs`，它会完整重建 Suite 根入口、物理 Worker、`workbench-dice` 和 `dice3d`，不会把 Web 嵌进去，也不会覆盖线上内容。每次输出必须是全新目录；现有历史构建不可当本批产物。

```powershell
$env:DND_SUITE_DEPS_ROOT='D:/Desktop/DND-card-web/.local-evidence/resource-dashboard220/suite'
$env:DND_SUITE_RELEASE_OUT='D:/Desktop/DND-card-web/.local-evidence/resource-dashboard220/release222-build/suite-host'
node tools/build-release217.mjs
```

构建器内部回执保留 `release:217`，外层 222 回执应注明该历史构建器，不能直接篡改其产物证明。当前协议为 `suite-3d-3`。构建器记录源码快照并校验构建期间不变、52 个根 HTML、固定资产及 HTML/CSS/ESM/Worker 静态依赖闭包；其输出是 overlay，不是完整独立站点，未生成 manifests/source ZIP 或嵌入 Web。

本次全新 `release222-build/suite-host` 构建成功：259 文件、52 根 HTML、1053 静态引用；`suite-host.build-evidence/` 保存源码快照与完整回执，构建前后运行输入一致。构建器旧回执 `pinnedAssets:56` 对应主锁，实际骰子构建还验证 vendor 的 3 项，双锁共 59 项通过，记录在 `suite-validation222/suite-build.log`。保留现有大分块提示，没有以本批扩大为分块重构。

## 打包与部署边界

- `tools/package219.py` 锁定公告专用 Web 白名单，`tools/deploy-release219.py` 锁定旧 217 → 219 Suite 单站热修，不能直接用于本批。
- 本批需要审阅的 222 外层打包与部署工具：网站 card 使用全新 standalone Web；Suite workbench 使用全新 integrated Web；根 Suite 用上述完整 overlay，源码 ZIP 绑定最终完整提交。
- 先读取线上 card/Suite 版本、哈希和源码归档，避免回滚并行骰子发布。保留旧站、独立骰子/三龙牌和后端服务；仅替换授权 card 与 suite-dev。源码包不得含私有角色或上游资料快照。
- 发布须保留原目录作为恢复点，默认只读预检，逐文件哈希与路径白名单验证，显式 apply 后原子切换，再核对服务器与公网文件。
- 真实多人房间、权限联动与实体触屏仍待验证。此次本机测试不证明完整枭熊联动正常。
