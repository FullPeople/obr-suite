# 2026-10-07 · 三入口 251 发布最终回执

本轮已完成新增修复的合并和配套部署：网站 [standalone-1.0.251](https://obr.dnd.center/card/)（公告 0.1.41）、新版 [Suite 1.0.251-dev](https://obr.dnd.center/suite-dev/manifest-dev.json)、旧稳定 [Suite 1.3.16](https://obr.dnd.center/suite/manifest.json)。发布时间为 `2026-10-07T10:56:30.040632+00:00`。保留已发布 250 的源码、公告历史和既有功能，没有重放 PR11／12／10 或 FUS PR3。

## 本次修复

- 战俑 ERLW／EFA 工具熟练选择：校验真实来源，覆盖选择、替换、保存刷新、撤销、重做及移除，保留手工熟练和资源余额。已完成完整 Data 重审后才合入 PR14。
- 自适应法术位 SVG：修复普通、契约及自定义分组的高度和裁剪问题；同一卡在 A4、自适应、实际分隔条与窗口调整之间往返，保留角色、资源及外观。原 PR15 `f00ec547435a234243e9dee71bde112dbd0c880a` 已包含在 PR14 的最终集成历史中，GitHub 自动标记为 MERGED，未重复合并。
- 新旧插件均移除“编辑地图迷雾”右键入口，并在启动时清除旧菜单 ID。设置页面和完整动态迷雾引擎保持原字节。旧稳定版定向更新五页查看器及迷雾入口，没有整体合入 dev。
- 新版 3D 骰子应用附件完整冷启动补丁：字体与音频、渲染器并行初始化；readiness 保证初始资源未就绪或失败时，WebGL 恢复不会提前开放投掷，正常完成后仍允许恢复。旧稳定版没有该新版 3D 模块。不把冷启动修复称为热投掷零延迟。

附件 `dice-startup-review-small-20261007.zip` 的 SHA256 为 `1a2bf245cdd5d8c934f03474dd452eb085868dc01b91adc104f26994af8dea9b`；18 项附件清单全部匹配。使用累计 product.patch 中的完整 readiness，未仅应用旧 fc2ce5b，也未重复应用同一 readiness 增量。实际 overlay 字节 SHA256 为 `a187787af48c688ac3c0ce6ca075537bf89ef123a851876a4a5e14d004dcfd02`。

## 原输入与完整 Data 验证

找回原缓存 `F:\CodexWork\2026-10-06\fullpeople-dnd-card-web-fullpeople-dnd5e\work\coverage-inputs` 的全部 229 份 JSON，共 52318109 字节，缺失 0 份。每份物理字节散列、规范 JSON 散列及来源 URL 均与旧账本一致；18,789 条身份清单与原快照完全匹配。index SHA256 为 `654898faa8fd821e6dbc8dddbaa3914b287bcaef418512da6a4cfa7eca8d55f7`。没有以新下载覆盖原审计输入，没有修改原哈希或跳过检查。

完整审计重新执行全部 18,789 条输入，消费者为不可变集成源码 `2a8f52c009b4b4e38f2e630761fa997db72b0e5f`，绑定 49 个模块的 Git blob 和实际物理字节，包含 Overview。此后发布源码的这 49 个模块逐一保持相同散列；报告从实际 Data 提交 `bd796832fa483338d41f6e71b84cce66d73533dc` 的已提交 blob 导入。报告 SHA256 为 `11f454bc765e69873ad7b2a61c43d9988acbb07b368053018af6ca19cec8f479`。原规则快照 SHA256 `7ee119297b4a93c1193f52e35c3fa8dc5e819dabd71ee508de5747848c68759a` 保持不变。

实际结果：总数 18,789、已核对 4,561、已实装 6,527、未解析 0；保留 522 条消费者目录不可用的原装备衍生身份，不将其冒充实装或删除以缩小分母。按 PR14 交接应用 Data39 字节核验补丁，并在 CI 中先验证实际消费者字节，再运行真实函数正反验证。完整审计日志与输入核对记录保存在本轮 evidence；原缓存初查记录中的“尚未生成”是当时状态，原记录没有事后改写。

## 精确源码与合并

四个 PR 按 Data6 → Web14 → Suite18 → Suite19 串行 merge。合并前再次核对全部远端基线、最终头及检查；四个实际合并树均等于通过检查的候选树，没有新冲突、squash、rebase 或旧 SHA 产物替换。

| 仓库／分支 | 已测试且实际运行的源码 | 发布时实际合并 SHA | 合并 |
| --- | --- | --- | --- |
| FullPeople/dnd5e-automation-data / main | `bd796832fa483338d41f6e71b84cce66d73533dc` | `2068d03725b4518bb85ab8e4fc1d89c338a7d4fb` | [PR6](https://github.com/FullPeople/dnd5e-automation-data/pull/6) |
| FullPeople/DND-card-web / main | `7085b0ef1c30d1549afb10bfbb7b787fd27deea7` | `d4673f77123b5b57bcfc1e07aba4c6d22a0ead1d` | [PR14](https://github.com/FullPeople/DND-card-web/pull/14) |
| FullPeople/obr-suite / dev | `b158985433f97fe8a2258fc3e08c2dfe94c0a6d3` | `004d109acea6b00a0eb0fb24c6b39cd32832426c` | [PR18](https://github.com/FullPeople/obr-suite/pull/18) |
| FullPeople/obr-suite / main | `2ca2b9eb456dee5253435317b1c7ba285d3567cf` | `cdaac8ace921b8e8f0c8f6581886a1c27499fd4d` | [PR19](https://github.com/FullPeople/obr-suite/pull/19) |

后续发布回执仅修改文档；运行源码、精确 CI 构建、源码 ZIP 和封包散列保持不变。实际最新分支头以本地最终 `RESULT.md` 的回执提交附录及远端核对为准。

## 验证与失败记录

最终源码 13 个工作流全部 success，39 个发布检查任务成功。Data 的 pipeline 任务按既有事件条件 skipped：它仅在定时或手动触发时抓取上游；本轮 push／PR 验证未执行该任务，不能冒称新抓取流水线成功。完整原缓存重审确已本地执行，CI 对已提交结果执行实际消费者字节及真实函数验证。

Web 完整 CI 为 23／23，1,036 项单元测试通过，32 项既有条件跳过；双浏览器各 13 项法术图标生产像素和往返场景通过。Data 本地完整测试 318 通过、11 项既有历史 G3 条件跳过，另有 14 项 Node、6 项 Python 导出、8 项真实函数正反验证及 49 模块字节核验。新版完整回归 45 组、跨窗口和骰子资源四任务通过；冷启动 36 项、新旧迷雾各 7 项通过。真实 WebGL 三种初始资源／上下文场景通过，正常恢复后两次实际 D6 投掷完成；合成 SDK 与软件 GPU 的边界明确保留。去掉 readiness 的负对照确实出现 6 项单元失败及三种浏览器提前投掷，未将负对照推送到远端。

- [web · web.yml · 23 项成功](https://github.com/FullPeople/DND-card-web/actions/runs/37607394852)：源码 `7085b0ef1c30d1549afb10bfbb7b787fd27deea7`。
- [web · automation-progress.yml · 1 项成功](https://github.com/FullPeople/DND-card-web/actions/runs/37607399052)：源码 `7085b0ef1c30d1549afb10bfbb7b787fd27deea7`。
- [web · shield-training.yml · 1 项成功](https://github.com/FullPeople/DND-card-web/actions/runs/37607404382)：源码 `7085b0ef1c30d1549afb10bfbb7b787fd27deea7`。
- [web · equipment-ac.yml · 1 项成功](https://github.com/FullPeople/DND-card-web/actions/runs/37607409113)：源码 `7085b0ef1c30d1549afb10bfbb7b787fd27deea7`。
- [web · legacy-viewer.yml · 1 项成功](https://github.com/FullPeople/DND-card-web/actions/runs/37607413582)：源码 `7085b0ef1c30d1549afb10bfbb7b787fd27deea7`。
- [web · warforged-tools.yml · 1 项成功](https://github.com/FullPeople/DND-card-web/actions/runs/37607417619)：源码 `7085b0ef1c30d1549afb10bfbb7b787fd27deea7`。
- [web · responsive-spell-icons.yml · 2 项成功](https://github.com/FullPeople/DND-card-web/actions/runs/37607422974)：源码 `7085b0ef1c30d1549afb10bfbb7b787fd27deea7`。
- [suite · verify-suite.yml · 1 项成功](https://github.com/FullPeople/obr-suite/actions/runs/37607378247)：源码 `b158985433f97fe8a2258fc3e08c2dfe94c0a6d3`。
- [suite · dice-cross-window-ready.yml · 1 项成功](https://github.com/FullPeople/obr-suite/actions/runs/37607378331)：源码 `b158985433f97fe8a2258fc3e08c2dfe94c0a6d3`。
- [suite · dice-release246-profile.yml · 4 项成功](https://github.com/FullPeople/obr-suite/actions/runs/37607378229)：源码 `b158985433f97fe8a2258fc3e08c2dfe94c0a6d3`。
- [suite · dice-startup-readiness.yml · 1 项成功](https://github.com/FullPeople/obr-suite/actions/runs/37607378246)：源码 `b158985433f97fe8a2258fc3e08c2dfe94c0a6d3`。
- [suiteStable · verify-stable-paired.yml · 1 项成功](https://github.com/FullPeople/obr-suite/actions/runs/37607385489)：源码 `2ca2b9eb456dee5253435317b1c7ba285d3567cf`。
- [data · build.yml · 1 项成功](https://github.com/FullPeople/dnd5e-automation-data/actions/runs/37604594784)：源码 `bd796832fa483338d41f6e71b84cce66d73533dc`。

封包后的本地 11 项入口检查及公网 11 项均通过：三入口两版完整原 JSON 导出、中文／手工／未知熟练、失败刷新清除；旧 0.3 导出及真实上传桥接往返；网站 1440／390 像素版本、日期公告、折叠历史、实际 6,527 进度；两个插件宿主公告。已检查窄屏旧稳定、旧稳定公告及进度截图。公网 181 个差量及固定入口文件 SHA256 一致，17 个源码别名长度与首尾范围绑定提交，12 个压缩响应解压后散列一致；源码 ZIP 整包散列在服务器完整树检查中验证，不把范围请求称为完整 HTTP 下载。

服务器三入口全部 1324／5884／2537 个文件与发布预期一致，三个完整备份和 16 个服务／配置／非目标保护项均一致。未写玩家资料、未重启服务、未更改 SSH／sudo／Nginx／OIDC，也未发布独立三龙或 FUS。

保留首轮失败与修正证据：战俑浏览器测试最初没有执行刷新后切到“特性”和右键显示已自动收起选项的真实操作，补齐操作后所有原断言继续通过，未修改生产逻辑；Windows 默认 5 秒临时 Git／复制检查超时，完整本地验证使用 60 秒预算，Linux 最终 CI 保持原默认预算并通过；盾牌精确源码检查首次连接下载超时，同 SHA 的第二次检查通过且散列门禁不变；直接预览原始 CI 构建缺少封包时生成的 release.json，版本标签检查失败，封包后重新执行完整 11 项通过。原失败日志、截图与记录均保留，未发布失败候选。

## 发布封存与回滚

- 封包回执 SHA256：`8befc74baaba5c12b3a3291bd12085b36ae56d65b33699a545393c735d510b78`。
- 发布器 SHA256：`fe01c163bd27900857de1f8946f90077ec7f9f776e0ebddfbada21dfb77d5735`，与已审查的 250 发布器字节一致。
- 服务器发布回执：`/root/codex-release-receipts/card-suite-followup251-20261007.json`，SHA256 `c406c42dc71026dda876a30a439bd2182c6e61de5e69a05b32ebb4efb6051c19`。
- 封包目录：`/root/codex-release-packages/card-suite-followup251-20261007`。六项仅合成目录的预检、并发拒绝、全备份顺序、自动回退、手动回滚及路径安全验证通过。

- `card`：`/var/www/obr-plugins/card-before-card-suite-followup251-20261007`，完整恢复文件 1247 个，已复核全部散列。
- `suite-dev`：`/var/www/obr-plugins/suite-dev-before-card-suite-followup251-20261007`，完整恢复文件 5733 个，已复核全部散列。
- `suite`：`/var/www/obr-plugins/suite-before-card-suite-followup251-20261007`，完整恢复文件 2460 个，已复核全部散列。

所有完整备份完成并核验后才首次原子切换，使用统一排他锁和 `renameat2 RENAME_EXCHANGE`。需要恢复到本轮前的网站 250／新版 250-dev／旧稳定 1.3.15 时，在服务器执行：

```sh
python3 -B /root/codex-release-packages/card-suite-followup251-20261007/atomic_frontends.py --archives /root/codex-release-packages/card-suite-followup251-20261007 --receipt-sha 8befc74baaba5c12b3a3291bd12085b36ae56d65b33699a545393c735d510b78 --rollback
```

回滚检查当前完整树、备份及保护状态；发生后续漂移会拒绝覆盖。回滚保留备份和失败发布目录，本轮没有在生产执行回滚。源码历史使用表中各实际 merge SHA 的 `git revert -m 1` 建立回退分支并重新检查，不 reset、clean 或 force push。

源码下载封存：

- web：SHA256 `7bbb4fd19eedb1be87d14c3d4eefcfaae0b26ea512f861032643f579c5b1947c`，6597963 字节，ZIP comment 为 `7085b0ef1c30d1549afb10bfbb7b787fd27deea7`。
- suite：SHA256 `32d4dc6fc3415e5da48b82ec7a5a52bf7426a5052a3879bc9550584096b0374c`，32982022 字节，ZIP comment 为 `b158985433f97fe8a2258fc3e08c2dfe94c0a6d3`。
- suiteStable：SHA256 `786f0719f7539efec6b0b08c784b01f93f68f89028c51253b856a83e1fedba77`，28247261 字节，ZIP comment 为 `2ca2b9eb456dee5253435317b1c7ba285d3567cf`。

本轮隔离目录为 `U:/CodexWork/2026-10-07/card-suite-followup`，原混合目录、FUS 与其他会话工作树未改动。真实登录房间、玩家原设备、实体手机和实体 GPU 尚未现场验收，不宣称整个项目或所有规则完成。
