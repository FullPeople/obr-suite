# 2026-10-10 · Excel 导入与同步提示 272 最终回执

[角色卡网站](https://dnd.center/card/?intro=0) 与卡库已上线 **standalone-1.0.272**，公告版本 **0.1.56**；[新版枭熊插件](https://obr.dnd.center/suite-dev/manifest-dev.json) 已上线 **1.0.272-dev**。刷新网站或重新打开插件工作台后使用。

## 已落实

角色卡网站和新版插件的“导入／导出”支持拖入或点击选择 `.xlsx`，原 JSON 入口保留。旧插件的 2014／2024 Excel 模板、工作表别名与历史坐标在浏览器内重新解析，不上传文件到旧解析服务。整批校验通过后才保存；数值、资源、装备、背包、金币和背景沿用原内容，自定义护甲不会重复计算防御等级。

读取 Excel 后询问是否同步 5etools 资料。选择同步，直接进入现有资料核对流程，每份 Excel 最终只保存一张同步后的角色卡，不先创建原卡或同步副本。选择“取消同步，导入自定义卡”，按原内容保存自定义卡。关闭询问窗口则不保存。此前对已保存旧卡执行同步时的备份行为保留。

网站等待持久保存确认，失败时恢复内存状态。新版插件逐张等待宿主确认，失败后重试跳过已确认的卡，未确认的卡保留原身份；保存结果不确定时阻止重复提交。

同步条目名称后增加圆形 **i** 图标，只有图标悬停或获得焦点时才显示说明，正文和来源文字不再触发。支持键盘、触屏点击与 Escape 关闭，点击图标不会改变条目选择。提示默认显示在实际鼠标位置上方，按窗口高度限制内容并避开底部“下一步”等按钮。

本次范围为角色卡网站、卡库及新版插件。保留插件 270 的文字演出和音乐板、271 的投骰更新；稳定插件、旧卡存档入口、首页、三龙、后台服务、网络配置和玩家数据均由保护检查覆盖。

## 来源与完整验证

插件生产制品运行源码 Suite `5e55185e962cbbe070f4227f5a137843d01eacd9`，配套 Web `0b225940caa5e1b54c7afa3c9c000df149856c6d`，Data `14a2282fe50cb92da3b5c667cb279b8f9efab3bc`。网站正式发布源码为 main 合并提交 `6919710fd99b226b5659aeadba98b107cf8dcb41`；其 tree `e8d821ce0b40bff4d46b67e90747dab8636defca` 与配套 Web 受测源码完全一致。

- [Web PR 47](https://github.com/FullPeople/DND-card-web/pull/47) 合并为 `6919710fd99b226b5659aeadba98b107cf8dcb41`。
- [Suite PR 46](https://github.com/FullPeople/obr-suite/pull/46) 合并为 `7532739e75c2c0f7c00e3e873bb6bb453509de5d`，tree `2ee0e7c41eaf09a4ad06e139a9d205681454cc3f` 与受测源码一致。
- [Data PR 23](https://github.com/FullPeople/dnd5e-automation-data/pull/23) 保留并发特性前置条件文档，只更新本批完整运行审计回执。

| 仓库 | 精确提交检查 | 源码 | 结果 |
| --- | --- | --- | --- |
| suite | [Verify Suite candidate](https://github.com/FullPeople/obr-suite/actions/runs/38018405035) | `5e55185e962cbbe070f4227f5a137843d01eacd9` | 成功 |
| web | [Verify tool proficiency choices](https://github.com/FullPeople/DND-card-web/actions/runs/38018285887) | `0b225940caa5e1b54c7afa3c9c000df149856c6d` | 成功 |
| web | [Verify shield training binding](https://github.com/FullPeople/DND-card-web/actions/runs/38018285889) | `0b225940caa5e1b54c7afa3c9c000df149856c6d` | 成功 |
| web | [Verify automation progress](https://github.com/FullPeople/DND-card-web/actions/runs/38018285883) | `0b225940caa5e1b54c7afa3c9c000df149856c6d` | 成功 |
| web | [Verify responsive spell icon painting](https://github.com/FullPeople/DND-card-web/actions/runs/38018285885) | `0b225940caa5e1b54c7afa3c9c000df149856c6d` | 成功 |
| web | [DND Center cloud migration](https://github.com/FullPeople/DND-card-web/actions/runs/38018285890) | `0b225940caa5e1b54c7afa3c9c000df149856c6d` | 成功 |
| web | [Verify web](https://github.com/FullPeople/DND-card-web/actions/runs/38018285869) | `0b225940caa5e1b54c7afa3c9c000df149856c6d` | 成功 |
| data | [automation-ir validation](https://github.com/FullPeople/dnd5e-automation-data/actions/runs/38018048971) | `14a2282fe50cb92da3b5c667cb279b8f9efab3bc` | 成功 |
| data | [automation-ir validation](https://github.com/FullPeople/dnd5e-automation-data/actions/runs/38018045751) | `14a2282fe50cb92da3b5c667cb279b8f9efab3bc` | 成功 |
| 网站 main | [DND Center cloud migration](https://github.com/FullPeople/DND-card-web/actions/runs/38019175566) | `6919710fd99b226b5659aeadba98b107cf8dcb41` | 成功 |
| 网站 main | [Validate dot deploy contract](https://github.com/FullPeople/DND-card-web/actions/runs/38019177945) | `6919710fd99b226b5659aeadba98b107cf8dcb41` | 成功 |
| 网站 main | [Verify web](https://github.com/FullPeople/DND-card-web/actions/runs/38019164703) | `6919710fd99b226b5659aeadba98b107cf8dcb41` | 成功 |

本机类型检查、Web 1267 项单元检查、新增 7 项 Excel 单元检查、独立站 6 项与插件宿主模式 2 项浏览器检查通过。已有 JSON／Suite 导入和旧卡同步备份检查通过；宽屏及 390 像素窄屏提示位置通过。两份原有公开 2014／2024 Excel 模板在实际 Edge 中读取，15 组字段与旧 Python 解析器结果一致，未读取玩家文件。插件完整自检、双方生产构建和启动模块边界检查通过。

规则审计保持 229 份原始锁定输入，完成实际 18789 条全量运行核对、62 个消费者模块绑定与正反例验证；实现见证 6535、已审查 4561、明确不可用 522、未解决 0。全量回执 SHA-256 为 `1bcc4d406d5b8c5c908eb8f53a00a894c4520e84017b4df018f4a0afd5cdb7ae`。未改写原输入散列、历史见证或规则实现来通过门禁。

## 上线结果与边界

插件使用 [最终源码 CI](https://github.com/FullPeople/obr-suite/actions/runs/38018405035) 的精确生产制品，生产骰子证明为 production，未带诊断探针。发布前新建完整备份并核对，服务器 8286 项目标文件、1332 项本批文件、123 项原保护值通过；公网 89 项完整文件、9 个源码别名及 6 项压缩响应通过。

网站 [完整制品预检](https://github.com/FullPeople/DND-card-web/actions/runs/38020190353) 与 [正式发布](https://github.com/FullPeople/DND-card-web/actions/runs/38020346713) 成功，直接使用已通过预检的冻结制品。两个目标共 438 项服务器文件与完整备份吻合；公网 83 项实际依赖、Excel／同步模块、两份完整源码 ZIP、版本及压缩响应吻合。后台保持 `1.0.261`，QQ 状态为 ready，旧浏览器存档入口继续可用；ready 不等于真实 QQ 授权验收。

最终组合核对保留两份冻结基线：插件原保护项中只有已授权网站发布导致的前端摘要变化，其余 122 项一致；网站发布所冻结的 123 项保护值全部一致，目标之外的前端完整、数据库完整且发布前后记录数一致。未改写任何原始保护基线来掩盖变化。

实际公开生产页面已完成网站和插件的 Excel 拖拽、询问、直接同步、每份一张卡、正文不触发提示、图标提示在鼠标上方及底部按钮无遮挡检查。验收使用自编测试工作簿、规则夹具和模拟插件宿主，外部写请求为零。该结果证明公开制品可运行；真实 Owlbear 多人房间、玩家网络和实体设备未现场验收。

## 备份与回滚

网站发布前为 standalone-1.0.268，完整恢复点为 `/root/codex-release-packages/dnd-center-actions-38020190353-1/backup/frontend`。插件发布前为 1.0.271-dev，完整恢复点为 `/var/www/obr-plugins/suite-dev-before-excel-import272-20261010`。两处均先核对完整备份和保护状态，再原子切换。

**需要整批恢复时，先网站，后新版插件。** 网站的保护基线包含已上线的插件 272；插件的保护基线包含网站 268，恢复顺序必须与发布顺序相反。各自发布器检查源、当前文件、完整备份与保护值，发生后续变化时应停止复核，不绕过保护。

```sh
python3 /root/codex-release-packages/dnd-center-actions-38020190353-1/frontend.py --package /root/codex-release-packages/dnd-center-actions-38020190353-1 --manifest-sha a3641d73969fc130a569c4a53599ce40f4cce9f97f3f3e9d06d0b232eeef8169 --rollback
python3 /root/codex-release-packages/excel-import272-20261010/suite_links.py --archives /root/codex-release-packages/excel-import272-20261010 --receipt-sha e840b0e17b17ec53790ef711a33069c871923dcb73f891b27725d86e8f9736c4 --rollback
```

本文件与随后提交的状态记录仅补充发布结果，不重新构建或替换上述运行源码、受测树、制品和源码 ZIP。
