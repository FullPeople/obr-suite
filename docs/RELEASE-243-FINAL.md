# 2026-10-04 · 玩家加载恢复与 Owner 权限修复 243 最终回执

用户指定的 Web b336325 / Suite 06e4e48 已完整合入 Web main / 新版 Suite dev，并配套部署网站 standalone-1.0.243（单机公告 0.1.34）与新版插件 1.0.243-dev。只发布 /card/ 与 /suite-dev/。部署于北京时间 2026-10-04 01:10:03 开始、01:11:06 完成；服务端状态为 published。

## 本次行为

- 玩家首次打开角色时，当前有权查看的目标资料缓存可以直接结束读取状态；首次发送失败可重新交付，不再因先前去重标记永久停在读取。恢复无需玩家重选令牌，也不产生保存请求。
- 原生 Owner 撤销后，当前界面、排队修改、发送前与宿主异步写入边界都重新核对权限。旧编辑意图、旧缓存及迟到回执不能恢复写权；撤权后重新授权不会补写旧修改。Owner 依据原生令牌 createdUserId，不借用导入来源字段。
- 主持人功能栏“音乐板”右侧显示红色“关于玩家分配卡和权限”入口，玩家端不显示。沿用原说明和截图；图片完成加载且实际滚动到底后，点击“我真的知道了”才记录已读。关闭窗口不标记已读，浏览器和发布通道各自保存。
- 独立网站公告只说明自身维护更新；最新批次展开、完整历史默认折叠。角色资料、资源余额及显示偏好沿用原有持久化。

## 并行工作与来源

开始时基于线上 241。另一会话先发布启动恢复 242，本轮再次合入其 Web 21affa0025c21a3f59d8b84a097eb2e467f63567 / Suite f0831bc15749e67b12630184c993b00380f071cc，并顺延为 243。保留 242 已发布的头部资源错误捕获和重放、开屏透明退出、延后可选任务及恢复编辑模式。指定 Owner 分支里重叠的启动实验没有覆盖这套已发布实现。另一会话随后提交的 242 最终回执也已合入。

隔离构建路径为 U:/CodexWork/2026-10-04/owner-sync242/{web,suite}；目录名和部分仓库外验证文件保留最初候选编号。此前本方 242 包只上传暂存，未切换上线；实际发布键始终为 owner-sync243-20261004。Web 混合根目录 D:/Desktop/DND-card-web 与 Suite 混合根目录 U:/枭熊插件/obr-suite 不作为构建输入。记录时两个根目录的前后 git status 快照逐字节相同；没有 reset、clean 或写入其源文件。

| 仓库 / 主线 | 指定输入 | 已验证并发布的运行源码 | 完整 CI |
| --- | --- | --- | --- |
| FullPeople/DND-card-web / main | b336325f84c38883212926396eebafa58d1d2d8b | fbccf5725e93e605b016858d3f45d35bddb27f08 | [37138388195](https://github.com/FullPeople/DND-card-web/actions/runs/37138388195)，verify 与 17 个浏览器组全部 success |
| FullPeople/obr-suite / dev | 06e4e4825c40da5e4d3449e95d8b70cbc79fc46a | 207f584347b6797c70eabaedff9825d8cdc36b88 | [37138391408](https://github.com/FullPeople/obr-suite/actions/runs/37138391408)，25 组及构建、浏览器全部 success，固定上述 Web 精确 SHA |

双方指定输入均为合入历史的祖先。最终回执与并行 242 回执合并属于 docs/ 下的文档提交；与上表运行源码相比，没有运行代码、依赖或构建配置差异。公网 source.zip 由上表精确提交 git archive 生成，ZIP 提交注释、CRC 和过滤边界已核对。

| 公网源码包 | SHA-256 |
| --- | --- |
| Web /card/source.zip 及 /suite-dev/workbench/source.zip | eea9fa026bb6575fa43496834b91b7cf7d9ac6bc4cb958c4f4ba7304c5613921 |
| Suite /suite-dev/source.zip | 64a831bdea272457ad0147ec990c4a889a7af3c5c6203f6bca435f89fce22121 |

## 验证与明确边界

- 本机 Web 单元 829 通过 / 25 外部资料条件跳过，106 测试文件通过 / 1 条件跳过；类型检查、集成和 standalone 构建通过。Owner 浏览器 13 项、独立公告浏览器 7 项通过。
- Suite 本机 Owner 冷启动 SDK 浏览器 8 项、权限说明浏览器 8 项、说明控制器 13 项和按目标权限转换 7 项通过。SDK 浏览器使用实际 SDK 与 iframe 生命周期，房间数据为合成夹具；不等于登录真实枭熊房间。类型检查及最终配套生产构建通过；56 固定资源、1077 静态引用检查通过。
- 最终精确提交的完整 GitHub CI 均成功，覆盖既有角色卡、资源、装备、护甲、持久化、开屏恢复、Owner 以及三龙牌既有回归。
- 实际 HTTPS 公网逐文件校验 242 项全部通过：本批 card 73 项、suite-dev 167 项及旧稳定和独立牌桌 manifest 各 1 项。含运行代码、预压缩资源、发布元数据和上述源码 ZIP，均匹配发布包。
- 实际公网 Edge 浏览器四个场景最终通过：独立公告与五页切换 / 重载；玩家只靠当前授权资料恢复首次读取且没有 select/save；撤权 / 再授权丢弃旧 debounce、迟到 ACK 后仍禁写且没有 save；主持人红色入口紧邻音乐板、1440/390px 可见、切成玩家后入口消失。加载实际线上产物；仅消息宿主、房间身份和规则资料采用原创夹具，不触碰真实玩家数据。
- 公网首次运行前三项通过，第四项因夹具 access.enabled 漏传 musicBoard 而失败。产品优先采用授权包里的功能开关，所以测试中音乐板按契约未出现。补齐同一夹具开关后仅复跑该项，通过并查看宽 / 窄截图；没有修改或再次发布产品代码。
- 本机 Suite 最终聚合为 24 组通过、three-dragon-controller-selftest 一组失败（Node 22 / Windows，actual 6、expected 5）；单独重跑仍失败。该组前两轮本机曾通过，最终 Linux / Node 24 完整 CI 也通过。本轮未修改三龙牌控制器或放宽断言，保留原日志；其重做继续由另一会话负责。
- 初次本方 242 Web CI 因单机公告混入枭熊措辞失败，修正适用范围后，最终 243 完整 CI 通过；Windows 测试脚本的换行和路径兼容问题已修正，未改变产品权限逻辑。
- 本次尚未在真实登录房间、玩家原设备及实体手机现场复验；没有把合成消息测试称为真实多人验收，也不将另一会话的启动专项算作本轮新增修复。

## 部署与回滚

[独立网站](https://obr.dnd.center/card/)：standalone-1.0.243；[新版插件 manifest](https://obr.dnd.center/suite-dev/manifest-dev.json)：1.0.243-dev。旧 /suite/ 1.3.14、独立 /three-dragon-ante-dev/ 0.7.22-dev 保留原文件树；旧稳定 main 仍为 639c8217b41905fbde4222783ff16e95bde13b67。

两个目标均在任何切换前创建完整备份并校验，然后以 renameat2 RENAME_EXCHANGE 原子交换；保留旧散列资源供已打开页面使用。服务端最终完整树和备份检查通过，protectedBefore 与 protectedAfter 相等，包含 relay / 三龙牌服务代码与状态、系统服务运行起点和 Nginx 配置。本轮不写后端、玩家数据库或私人角色，不合入后端 PR、独立牌桌重做或未发布的其他会话改动。

服务端回执：/root/codex-release-receipts/owner-sync243-20261004.json。

- /var/www/obr-plugins/card-before-owner-sync243-20261004（727 个文件）
- /var/www/obr-plugins/suite-dev-before-owner-sync243-20261004（3257 个文件）

回到本轮发布前的 242，可在服务器执行下列已有回滚器。它要求线上树、两份备份及受保护状态仍匹配本轮回执；若已被后续发布改变会拒绝覆盖。本轮没有修改 Nginx，不需更改配置。此处记录恢复命令，本次未执行回滚。

```sh
python3 /root/codex-owner-sync243-20261004/deploy243.py --archives /root/codex-owner-sync243-20261004 --rollback
```

发布包回执 SHA-256：7d5c929c80f08fbcff340e27db103140aa83fdf6b7ef240e7c1242781dacb588。仓库外证据保存在 U:/CodexWork/2026-10-04/owner-sync242/：ci-{web,suite}243.json、gate243.json、package243/package-receipt.json、deployment243.json、server-receipt243.json、https243.json、browser-public243.log、browser-public243-permission-rerun.log、unit-suite-final.log、three-dragon-controller-rerun.log；宽窄截图在 web/.local-evidence/public242/results/。原始夹具、上游正文、私人角色与生成证据不进入公共仓库。

玩家更新方式：关闭旧附加窗口、刷新枭熊房间，再重新打开新版 Suite。群通知见 [本批纯文本](ANNOUNCEMENT-243-GROUP-TEXT.md)。
