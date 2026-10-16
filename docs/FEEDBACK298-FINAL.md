# 2026-10-16 · 298 玩家反馈修复已上线

北京时间 2026-10-16 20:40:59，正式发布回执确认四个前端完成原子切换；唯一一次 apply 的最终退出码为 0。随后独立读取发布回执，重新核对完整线上文件树、四份完整恢复副本与 125 项保护值，并完成公网和生产浏览器验证。本记录及后续文档提交不替代下列冻结运行来源。

## 运行来源与范围

- Web／卡库／Wiki：`standalone-1.0.298`，运行提交 `f4cd9a28626c81e0178d677e763a7204dd44af21`，已合并 PR78／79。
- Suite dev：`1.0.298-dev`，运行提交 `003ac253458c00331d0f3f3da673415de3233030`，已合并 PR91—95。
- 后台保持 `1.0.295`；正式插件保持 `1.3.32`。QQ／云端继续暂停，账号资料私有；轻量 2D 保持启用，物理 Worker／WASM 不启用。
- 只切换 `/var/www/dnd-center/card`、`library`、`wiki` 和 `/var/www/obr-plugins/suite-dev`。首页、旧站导出、正式插件、其他项目、服务配置及玩家资料保持保护。未操作真实玩家角色或发送邮件。

本批修复来源职业表定义的资源次数、休息恢复和升级保留消耗；骰子历史删除由宿主持久化，并阻止同源旧页面把已删除记录写回。2014／2024 身份仍独立，运行规则不按具体职业／特性名称分支。

229 份原始输入、18,789 个身份和 70 个实际消费者模块的完整审计沿用已完成结果，没有重新下载或修改锁定资料。Data 权威提交为 `3d37d147bf557829c7846c0ef0d5d9ca50c524d4`，报告 SHA-256 为 `32f224c2358f233671491ee05eabb13470d20215c1b04f3876385e6f31d4556e`。6,537 个身份至少有一项计算／选择可用，不代表整条规则完整自动执行；4,561 项审阅、522 项不可用和零未解决保持原记录。

## 精确运行提交 CI

下列 8 组检查在本地接手续作时重新从 GitHub 核对，提交、分支、结论和全部任务成功状态均匹配封存证明。

| 仓库 | Run | 成功任务数 | 结论 |
| --- | --- | ---: | --- |
| FullPeople/DND-card-web | [38859012299](https://github.com/FullPeople/DND-card-web/actions/runs/38859012299) | 28 | success |
| FullPeople/DND-card-web | [38859065512](https://github.com/FullPeople/DND-card-web/actions/runs/38859065512) | 1 | success |
| FullPeople/DND-card-web | [38859069586](https://github.com/FullPeople/DND-card-web/actions/runs/38859069586) | 1 | success |
| FullPeople/obr-suite | [38859865282](https://github.com/FullPeople/obr-suite/actions/runs/38859865282) | 1 | success |
| FullPeople/obr-suite | [38859865273](https://github.com/FullPeople/obr-suite/actions/runs/38859865273) | 1 | success |
| FullPeople/obr-suite | [38859865164](https://github.com/FullPeople/obr-suite/actions/runs/38859865164) | 1 | success |
| FullPeople/obr-suite | [38859865067](https://github.com/FullPeople/obr-suite/actions/runs/38859865067) | 1 | success |
| FullPeople/obr-suite | [38859865248](https://github.com/FullPeople/obr-suite/actions/runs/38859865248) | 1 | success |

Web 主检查为 28/28；云迁移最终完整成功，包含原有 55 项启用态隔离流程、生产暂停检查和 Wiki。云迁移第一次运行的时序失败及第二次完整通过保留在 PR79。Suite 包含完整候选、权限、当前轻量 2D、多人同步和云暂停检查。

历史可变来源下载专项仍有严格拒绝大小／散列不符的失败，旧 3D 专项也仍有已记录失败；没有恢复物理骰子、放宽断言、修改审计散列或使用 `DND_QQ286_RELEASE_EXCEPTION`。

## 发布回执与保护核对

服务器封包：`/root/codex-release-packages/feedback298-20261016`。

- manifest SHA-256：`576625a08c87479b037e71dbbacee4ca346287e9558c9bd157180e1bf016423e`。
- baseline SHA-256：`83b8ef147645599d12e939eae268de97fa2d2ad65b4b32daef71b54183813d0d`。
- 正式回执：`/root/codex-release-receipts/feedback298-20261016.json`，状态 `published`；封包内 `published.json` 内容一致。
- 回执 SHA-256：`7d4524abb20981b647748cf0ebd60854e5c1826853cbb57973a01738200eb85f`。
- 原预检在 `2026-10-16T12:04:54.279820+00:00` 成功结束。接手后先读回该结果，没有重复启动预检。
- apply 于 `2026-10-16T12:35:31.012446+00:00` 通过持久后台任务启动一次；`apply-started.json`、`apply-result.json`、stdout／stderr 均保留，退出码 0。
- `postverify-result.json` 记录独立完成后的全量复核；125 项保护值前后及当前值相同，数据库设备／inode 身份保持，后台文件与服务、旧站和正式插件等保护项不变。

正式 Web 预检 [38896413260](https://github.com/FullPeople/DND-card-web/actions/runs/38896413260) 在上传前被旧 QQ pending／ready 策略阻止。本轮沿用已用于 297 的维护发布器，执行封存的暂停策略和精确 CI 核验，没有恢复 QQ、修改正式入口或跳过守卫。已有 10 项发布策略正反例检查通过。

| 目标 | 版本 | 新制品文件 | 保留旧资源 | 线上完整文件 | 完整副本文件 |
| --- | --- | ---: | ---: | ---: | ---: |
| card | standalone-1.0.298 | 185 | 1439 | 1624 | 1546 |
| library | standalone-1.0.298 | 109 | 521 | 630 | 604 |
| suite-dev | 1.0.298-dev | 1262 | 799 | 2061 | 1906 |
| wiki | standalone-1.0.298 | 64 | 6 | 70 | 70 |

保留文件按封存发布器的明确规则计算，不能按新制品文件数清除旧线上资源。四个独立完整恢复副本为：

- `/var/www/dnd-center/card-before-feedback298-20261016`
- `/var/www/dnd-center/library-before-feedback298-20261016`
- `/var/www/obr-plugins/suite-dev-before-feedback298-20261016`
- `/var/www/dnd-center/wiki-before-feedback298-20261016`

发布器本轮未触发失败恢复；自动恢复路径仍保留。以后若需回滚，先核对当时的运行版本、回执和保护值，再使用这些完整静态副本进行同文件系统原子切换并验证 HTTP；当前数据库、房间数据和玩家后续修改必须保留，不能用旧数据覆盖。本段不是已执行回滚的声明。

## 公网与生产浏览器

原 `verify-public.mjs` 在联网前发现其错误要求 Suite 根 `index.html`，而冻结清单从未包含该入口。保留原脚本和失败日志，另存 `verify-public-local.mjs`，仅对 Suite 使用清单中的 manifest／background／workbench 等既有入口，其他断言保持。补充 `public-validation-seal.json` 绑定原发布清单、原脚本与新验证脚本的 SHA-256，发布清单和制品没有修改。修正后的验证实际下载并核对 55 个公网文件的 SHA-256，全部通过，包含七个完整 Git 源码 ZIP 入口的实际字节。完整源码在封包准备阶段已逐文件核对 Git blob。

首次公网检查的 48 个页面／脚本通过，七个源码 ZIP 均触发原 180 秒传输超时，失败保存在 `public-verification-first.json`。随后仅重验这七个传输失败项，使用封存散列绑定的分段校验脚本：HEAD 必须为 200 且长度匹配候选包；每段必须为 206，范围、长度、ETag 和实际字节数全部匹配，再按顺序计算完整文件 SHA-256。分段进度和验证脚本散列另行封存，没有把 HEAD／部分下载当作整包验证成功，也没有放宽内容断言。

验证附加清单 SHA-256：`6a4b05f2efac5409ed3fc018520621d71efeb1b932be3804549c1780d8520538`；分段校验脚本 SHA-256：`9de593d14226aceef9ee9ec01d282e4610d730b572c716a176bcdd122fd3b2c0`。生成本记录前再次核对原发布清单、原脚本及两个验证补充脚本的实际散列，全部匹配。

公网独立复核四个 `release.json` 的版本和冻结提交、后台私有／暂停策略、七个 `503 cloud_disabled` 接口及正式插件 `1.3.32`，共 13 项检查通过。完整证据位于本机 `.local-evidence/release298/`，含 `public-verification.json`、`public-policy-verification.json` 和 `server-receipts/`；这些本机证据不提交公开仓库。

使用既有生产 Playwright 配置，在新的独立 Chrome 上下文运行实际 `https://dnd.center/card/` 页面，两个原创角色流程通过：资源出现与次数修改，升级后保留已消耗量，刷新恢复，以及原生 JSON 导入后保留余量。目录请求沿用既有测试资料夹具；未读写真实玩家存档，没有关闭、重启或清理用户浏览器。两项流程均无页面脚本异常，未重跑已完成的完整来源审计。

此前实际轻量包的四个合成客户端和 11 个公式检查通过，物理 Worker／WASM 请求为零。该证据与本轮生产单机浏览器检查均不等同于真实 Owlbear／F7 四端验收。

## 未验收项与反馈状态

- 原浏览器 CDP 9222—9225 在本轮再次只读探测仍不可连接；真实 F7 四端、真实房间和实体设备验收未完成。
- Issue75 的来源表资源修复已部署，发布包与生产资源流程已验证，按本轮指示关闭。
- Issue73 保持开放，仍需原卡复验；Issue77 保持开放，两条工作台复活路径已修复，但真实房间、其他玩家及枭熊内置骰子尚未验收。
- 此前已核对的 9 封邮件反馈不重复审计；版本差异不合并为统一规则，不发送邮件回复。
