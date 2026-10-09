# 2026-10-09：259 已合并、部署并通过公网检查

| 入口 | 实际版本 | 受测源码 |
| --- | --- | --- |
| [在线车卡](https://dnd.center/card/) | standalone-1.0.259 / 公告 0.1.49 | [bc010449](https://github.com/FullPeople/DND-card-web/commit/bc010449656e8e3af299a25393f6ca15f9d3f5af) |
| [角色卡库](https://dnd.center/library/) | standalone-1.0.259 / 公告 0.1.49 | [bc010449](https://github.com/FullPeople/DND-card-web/commit/bc010449656e8e3af299a25393f6ca15f9d3f5af) |
| [新版枭熊](https://obr.dnd.center/suite-dev/manifest-dev.json) | 1.0.259-dev | [8cb9277d](https://github.com/FullPeople/obr-suite/commit/8cb9277d581571738b2808e9af1e81cb61aea6cd) |
| [稳定枭熊](https://obr.dnd.center/suite/manifest.json) | 1.3.20 | [cf9ceaa8](https://github.com/FullPeople/obr-suite/commit/cf9ceaa83bd7f42bde86ee7d42c18b3928e05df1) |

后端保持 1.0.253 / Node 24.9.0。真实 QQ 登录仍申请中；临时公开上传可用，同一个 IP 最多 10 张，只有原上传浏览器可修改和删除。付款未接入，购买槽位信息隐藏。枭熊继续使用房间棋子归属权限，不接独立站云端。

## 本次改动

- 调色盘支持撤回、重做；导入和恢复默认也计为一次操作。历史有上限，仅恢复颜色，角色切换和外部颜色变化会清理失效记录。
- 角色名字栏支持滚轮和拖拽，不因拖动误切角色；各页头像单独保存构图，旧卡保留原构图，完整 JSON 和云端往返保留这些字段。
- 卡库发布正式共用图片，恢复生命骰图标、赞助二维码等资源。五个展示位置提前读取，已读卡面复用；拖动分别改变各卡弧线位置与深度，画廊容器不平移。
- 卡库及五页只读查看器没有完整 Wiki 时，也能显示常见武器与工具的中文熟练名称。优先保留明确自定义名称和已解析资料名称，原 UID 不改写，未知来源保留原文；不为翻译额外下载整套 Wiki。
- 合入背景页布局、职业选择与真实旧 FS 恢复、占格框血条锚定、只读请求与中断发布恢复。跨场景棋子绑定同时读取场景、房间与持久目录，排除删除记录，写入前重新检查 GM 权限。

## 来源、验证与边界

- [dnd5e-automation-data PR13](https://github.com/FullPeople/dnd5e-automation-data/pull/13) 已合并，合并提交 `eaf21945e5fc421ae33f059b07fa822848f3797c` 与受测源码的 Git 树完全一致。
- [DND-card-web PR30](https://github.com/FullPeople/DND-card-web/pull/30) 已合并，合并提交 `e465cf1abd46797c2f084dfe5a18dea09307294e` 与受测源码的 Git 树完全一致。
- [obr-suite PR31](https://github.com/FullPeople/obr-suite/pull/31) 已合并，合并提交 `8381fa05a3fdf70158ff8be8124472771a4e4040` 与受测源码的 Git 树完全一致。
- [obr-suite PR32](https://github.com/FullPeople/obr-suite/pull/32) 已合并，合并提交 `de1344772882de309e377cb4d3d15e3e95a7defe` 与受测源码的 Git 树完全一致。

Web PR7、PR17、PR24、PR29 与 Suite PR12、PR25 已定向整合。Go 后端 PR2 按用户要求关闭；重复三龙牌入口 PR21 与旧整包 Suite PR7 已复核关闭，原分支和本机未提交内容保留。Suite Issue8 修复已发布，真实多人房间仍需验收。

最终 14 个工作流、43 个作业：39 个成功，Data pipeline 和 3 个仅手动触发的远程只读请求因事件条件跳过；没有失败。三个只读请求的合同测试均成功。云端接口单测 31 项、实际 SQLite 浏览器流程 31 项通过。旧卡熟练名称的桌面与窄屏悬浮详情额外连续复验 3 次，等待已知旧卡提示完成布局后再操作。

- [web-contract / Validate dot deploy contract](https://github.com/FullPeople/DND-card-web/actions/runs/37881447866)，提交 `bc010449`。
- [web-readonly / Dot readonly request](https://github.com/FullPeople/DND-card-web/actions/runs/37881447849)，提交 `bc010449`。
- [web-cloud / DND Center cloud migration](https://github.com/FullPeople/DND-card-web/actions/runs/37881447850)，提交 `bc010449`。
- [web-legacy-viewer / Verify legacy viewer JSON and captions](https://github.com/FullPeople/DND-card-web/actions/runs/37881447868)，提交 `bc010449`。
- [web-tools / Verify tool proficiency choices](https://github.com/FullPeople/DND-card-web/actions/runs/37881447874)，提交 `bc010449`。
- [web / Verify web](https://github.com/FullPeople/DND-card-web/actions/runs/37881447843)，提交 `bc010449`。
- [web-progress / Verify automation progress](https://github.com/FullPeople/DND-card-web/actions/runs/37881447857)，提交 `bc010449`。
- [web-responsive / Verify responsive spell icon painting](https://github.com/FullPeople/DND-card-web/actions/runs/37881447838)，提交 `bc010449`。
- [web-shield / Verify shield training binding](https://github.com/FullPeople/DND-card-web/actions/runs/37881447862)，提交 `bc010449`。
- [suite-readonly / Dot readonly request](https://github.com/FullPeople/obr-suite/actions/runs/37881454859)，提交 `8cb9277d`。
- [suite / Verify Suite candidate](https://github.com/FullPeople/obr-suite/actions/runs/37881449321)，提交 `8cb9277d`。
- [suiteStable-readonly / Dot readonly request](https://github.com/FullPeople/obr-suite/actions/runs/37881454754)，提交 `cf9ceaa8`。
- [suiteStable / Verify scoped stable paired release](https://github.com/FullPeople/obr-suite/actions/runs/37881449397)，提交 `cf9ceaa8`。
- [data / automation-ir validation](https://github.com/FullPeople/dnd5e-automation-data/actions/runs/37875600098)，提交 `4702c46f`。

Data 正式报告绑定 `4702c46f97543a4775fb73341252687b7f718706`，使用原 229 份输入完成 18,789 项检查，60 个消费者模块与发布源码一致；6,527 项具备至少一个已支持的执行机制，不代表全部规则自动化。追加名称兜底只改显示层，未改这 60 个审计模块字节。

公网检查覆盖 HTTPS、两个网站页面、190 个网站资源、115 个插件资源检查及 4 份完整源码下载。云端 API 未模拟：明确确认后真实上传、自动同步、匿名五页、其他浏览器删除拒绝、冲突保留本机草稿、完整 JSON 导出和核对导入均通过；合成验收卡已删除。

实际图片加载、卡库和全屏中文熟练名称、各页头像字段、配色撤回与重做、长按预览零上传且松手只同步一次均已在公网核对。现有卡库循环切换、滚轮、侧卡选择、拖动、全屏等比 A4 与每卡一次读取通过。原 258 浏览器缓存升级到 259，保留本机草稿，并验证五页离线重载。

两个插件的实际公告与公开查看器资源通过浏览器检查，390 像素宽度无横向溢出。SDK 就绪和权限回归使用合成宿主；实体手机、玩家原设备和真实多人枭熊房间尚未验收。

## 部署与数据保护

本次使用已授权的 root SSH 发布 CI 制品，没有在服务器编译。仅替换 card/library 和 suite-dev/suite 静态目录，共享发布锁，创建各目标完整新备份后原子切换。首页、三龙牌、旧站完整 JSON 导出入口、后端、数据库与旧玩家目录保留；原有 6 张卡的内容散列一致，数据库完整性为 ok，自动备份定时器仍运行。

自动部署帮助程序已升级到 `bc010449656e8e3af299a25393f6ca15f9d3f5af`，五个安装文件与已审源码散列一致。备份位于 `/root/codex-backups/dnd-production-entry-20261009T041041Z`。本轮没有修改 Nginx、SSH、sudo 授权、防火墙、DNS 或网络配置，也没有重载 SSH；帮助程序安装与实际静态发布分别记录。

Web CI 构建使用 GitHub 的临时合并提交，制品内记录真实构建提交；发布清单单独记录受审分支提交，并核对两者 Git 树一致。源码下载保留受审完整提交。文档补充提交不视为新的运行时代码版本。

## 回滚到 258

先回滚两个插件，再回滚网站；此顺序恢复各包记录的保护状态。命令仅恢复静态站点，不回滚玩家数据库、Cookie 或旧玩家目录。若有后续部署或保护状态变化，帮助程序会拒绝覆盖，先核对新的基线。

```sh
python3 /root/codex-release-packages/suite-ux259-20261009/suite_links.py --archives /root/codex-release-packages/suite-ux259-20261009 --receipt-sha 08e14d9de8520172382997737cf9c4d1f5b725e58054cc9821c51e0dd4459d3c --rollback
python3 /root/codex-release-packages/dnd-center-ux259-20261009/frontend.py --package /root/codex-release-packages/dnd-center-ux259-20261009 --manifest-sha 0a2bd0e08ffaf645ed30c5b24134f6d6748bf86b2105bcb082e39e5b3cb0b8b3 --rollback
```

网站新备份：`/root/codex-release-packages/dnd-center-ux259-20261009/backup/frontend/card` 与 `library`。两个插件新备份：`/var/www/obr-plugins/suite-dev-before-suite-ux259-20261009` 与 `/var/www/obr-plugins/suite-before-suite-ux259-20261009`。

网站的断电中断恢复也可以使用同一封存值加 `--status`、`--recover` 核对与补偿。完成发布后不要为了普通状态查询调用恢复。帮助程序自身的旧五文件和旧 installation.json 在上面的安装备份中，恢复时核对前后散列，仅恢复这些文件，不改已有 SSH 策略。
