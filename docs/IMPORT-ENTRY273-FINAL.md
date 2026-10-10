# 2026-10-10 · 统一导入入口 273 最终回执

[角色卡网站](https://dnd.center/card/?intro=0) 和卡库已上线 **standalone-1.0.273**，公告 **0.1.57**；[新版枭熊插件](https://obr.dnd.center/suite-dev/manifest-dev.json) 已上线 **1.0.273-dev**。

“导入与导出”只保留上方一个 JSON／Excel 文件拖拽与点击上传区，支持单个和多个文件。下方改为“本机恢复”，保留“读取上一次保存”。原文本粘贴、导出和内部单文件兼容输入保留。Excel 同步仍先核对再保存，每份文件只导入一张卡；圆形 i 图标提示仍默认显示在鼠标上方。

保留已合入主线的专长前置条件修复，以及插件文字演出、音乐板与投骰更新。旧站独立提示已经先行改为“网址搬迁了！请在下方前往新站”，持续在视口内反弹；收起停止动画，旧站存档读写和导出入口保留。该发布的完整记录见 Web 的 `docs/LEGACY-NOTICE273-FINAL.md`，后续保护基线包含新提示。

## 来源与检查

Suite 运行源码 `b904ca15c93ae058456c82aef250a7a305c9e5a9`，配套 Web `a2437fd5c07aee6d17688efbf90ac5459f85d9e8`，Data `cae2295f0f883e09bf248748ad617691f9524621`。网站正式源码 `0503f9f0c8c3807c19e237b32892df5667b613f9` 与受测 Web 树一致。Web PR 49、Suite PR 47 和 Data PR 25 均按精确提交检查后合并，三个合并树都与受测树一致。

| 仓库 | 精确提交检查 | 源码 | 结果 |
| --- | --- | --- | --- |
| suite | [Verify Suite candidate](https://github.com/FullPeople/obr-suite/actions/runs/38030341714) | `b904ca15c93ae058456c82aef250a7a305c9e5a9` | 成功 |
| web | [Verify tool proficiency choices](https://github.com/FullPeople/DND-card-web/actions/runs/38030349640) | `a2437fd5c07aee6d17688efbf90ac5459f85d9e8` | 成功 |
| web | [Verify shield training binding](https://github.com/FullPeople/DND-card-web/actions/runs/38030349604) | `a2437fd5c07aee6d17688efbf90ac5459f85d9e8` | 成功 |
| web | [Verify responsive spell icon painting](https://github.com/FullPeople/DND-card-web/actions/runs/38030349630) | `a2437fd5c07aee6d17688efbf90ac5459f85d9e8` | 成功 |
| web | [Verify automation progress](https://github.com/FullPeople/DND-card-web/actions/runs/38030349622) | `a2437fd5c07aee6d17688efbf90ac5459f85d9e8` | 成功 |
| web | [DND Center cloud migration](https://github.com/FullPeople/DND-card-web/actions/runs/38030349671) | `a2437fd5c07aee6d17688efbf90ac5459f85d9e8` | 成功 |
| web | [Verify web](https://github.com/FullPeople/DND-card-web/actions/runs/38030349711) | `a2437fd5c07aee6d17688efbf90ac5459f85d9e8` | 成功 |
| data | [automation-ir validation](https://github.com/FullPeople/dnd5e-automation-data/actions/runs/38030346862) | `cae2295f0f883e09bf248748ad617691f9524621` | 成功 |
| data | [automation-ir validation](https://github.com/FullPeople/dnd5e-automation-data/actions/runs/38030314299) | `cae2295f0f883e09bf248748ad617691f9524621` | 成功 |
| 网站 main | [DND Center cloud migration](https://github.com/FullPeople/DND-card-web/actions/runs/38031421894) | `0503f9f0c8c3807c19e237b32892df5667b613f9` | 成功 |
| 网站 main | [Validate dot deploy contract](https://github.com/FullPeople/DND-card-web/actions/runs/38031284501) | `0503f9f0c8c3807c19e237b32892df5667b613f9` | 成功 |
| 网站 main | [Verify web](https://github.com/FullPeople/DND-card-web/actions/runs/38031224980) | `0503f9f0c8c3807c19e237b32892df5667b613f9` | 成功 |

本机 Web 1276 项单元检查通过，91 项条件跳过；生产构建、启动模块边界、原有独立站 6 项与插件宿主模式 2 项 Excel 浏览器检查通过。完整源码 CI 检查既有 JSON 导入、旧卡同步、宿主权限和生产骰子制品。

重新执行全部 18789 条运行审计，原始输入 229 份、消费者模块 62 个，实现见证 6535、已审查 4561、明确不可用 522、未解决 0。回执 SHA-256 为 `dd21cc160b89afc54364e4466b072f552cd5bc4744381e438a4829aa2c30ec73`；从 Data 的精确 Git blob 复制，没有修改历史见证或输入摘要来通过门禁。

公开页面分别核对网站和插件的整个导入窗口：只有一个上传区、本机恢复按钮保留、1512 px 和 390 px 布局可用。Excel 拖拽、同步询问、每份一张卡、正文不触发提示、i 图标提示位于鼠标上方并避开底部按钮均通过。夹具使用自编规则、工作簿和模拟插件宿主，外部写请求为零；真实 Owlbear 多人房间和实体设备未现场验收。

## 发布、保护与恢复

网站使用官方部署入口：精确源码的[制品预检](https://github.com/FullPeople/DND-card-web/actions/runs/38032564363)和[正式发布](https://github.com/FullPeople/DND-card-web/actions/runs/38032751682)均成功；发布复用同一份封存制品，未重新打包运行源码。

Suite 使用精确源码 CI 的完整生产制品。服务器 8432 项目标文件与发布清单一致，独立完整备份与发布前状态一致；原保护值中除已授权网站的后续发布以外，122 项保持一致。网站服务器 491 项发布文件与清单一致，完整备份与发布前状态一致，123 项保护值均保持一致；公网 83 项实际依赖、完整源码 ZIP、版本和压缩响应通过。旧站完整文件与新提示备份通过组合检查。后台仍为 1.0.261，数据库完整，发布前后记录数一致。QQ ready 不代替真实授权验收。

首次插件发布前检查发现另一批已授权的首页更新，原包因此停止，未切换任何目标。核对独立首页回执及其 11 项文件后，建立 `import-entry273-20261010-r2` 新包和新状态快照；原包及其原始基线完整保留。两包运行制品、源码 ZIP 和提交完全相同。最终组合检查确认新版首页保留。旧站提示恢复工具只接受这份已核验的首页变化，其余保护值仍须完整匹配，并要求先恢复网站和新版插件。

网站恢复点 `/root/codex-release-packages/dnd-center-actions-38032564363-1/backup/frontend`，插件恢复点 `/var/www/obr-plugins/suite-dev-before-import-entry273-20261010-r2`。发布前网站为 standalone-1.0.272、插件为 1.0.272-dev。需要整批恢复时，先网站、再新版插件、最后旧站提示；保留各自原始保护基线，后续变化需要先核对。

```sh
python3 /root/codex-release-packages/dnd-center-actions-38032564363-1/frontend.py --package /root/codex-release-packages/dnd-center-actions-38032564363-1 --manifest-sha fafc55bea60a65a430f48850345cce30dba40c88ff082f9da7587b461ad1cdbd --rollback
python3 /root/codex-release-packages/import-entry273-20261010-r2/suite_links.py --archives /root/codex-release-packages/import-entry273-20261010-r2 --receipt-sha c88d7cf8a6134af60c0f79a4086ce2e542c91c6f7e8c7ca160bb90f2a3a0a8cd --rollback
python3 /root/codex-release-packages/import-entry273-20261010-r2/legacy-notice-recovery.py --apply
```

本文件和随后状态提交只补充发布结果，不改变已发布运行源码、制品及源码 ZIP。

补写记录时，Suite 主线已包含独立的 274 骰子候选 `d9129396e3b1d8982364712391e41039c25ecaf4`。该候选保留，本回执只确认上述 273 制品与公开检查，不作为 274 的发布或验收证据。
