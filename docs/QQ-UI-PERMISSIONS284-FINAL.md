# 界面与权限更新 284：最终发布记录

记录时间：2026-10-11T15:05:14.711741+00:00。

已按用户要求拉取、审查并合入 claude/trusting-feynman-6t6yyw 的最新推送。网站及卡库为 standalone-1.0.284，公告版本 0.1.64；枭熊新版插件为 1.0.284-dev；云端权限后台为 1.0.284，中继房间权限检查同步上线。

## 来源与范围

- Web 功能来源：434d0d5a088c7fd617ea40b31ad617c3a4029147；实际运行源码：fc2e4d5bb17e960cdae89c24526a1d5504c80d8c。
- Suite 功能来源：dd1498aa0f99c4eadff5ac34c33e0308c7c3b040；实际插件及中继源码：92ea7f14d46434bb55f949c29b1e23012ae13481。
- Data 审计提交：778a9da1580368964cc3f31d50703d98b6b4d516；消费者提交：577fff66516b1e3323c21fe1b31e3bce47ddc70e；报告散列：f8dfcf0f349b19c77c8b5b04e2950de850ab118d266f194593f9c35b51f6f0e6。
- 稳定插件、首页、三龙牌、旧导出入口分别经过保护核对。玩家原卡数据库没有替换。

本次补齐插件登录范围、权限撤回、账号配对核对码、上传前的原生所有权检查、怪物绑定与房间资料范围检查。同步集成配色方案、实时示例、Lucide 图标、角色簿拖动排序、弹窗重排、卡库滚轮动画、旧卡迟到选择和相同版本更新误报修复。

保留普通卡原位上传、QQ 原角色簿导入、房间修改自动写回云端原卡、未授权 DM 只读、音乐板和个人骰子设置。插件可移除房间中的卡，云端原卡删除集中在独立网站。QQ Connect 按账号 ID 授权，不将 OpenID 当作 QQ 号码。

## 验证

最终运行源码的 35 项持续集成任务全部成功：

- [web: .github/workflows/web.yml](https://github.com/FullPeople/DND-card-web/actions/runs/38142837729)
- [web: .github/workflows/cloud-migration.yml](https://github.com/FullPeople/DND-card-web/actions/runs/38142842467)
- [web: .github/workflows/dot-deploy-contract.yml](https://github.com/FullPeople/DND-card-web/actions/runs/38142844898)
- [suite: .github/workflows/qq-permissions.yml](https://github.com/FullPeople/obr-suite/actions/runs/38145967847)
- [suite: .github/workflows/verify-suite.yml](https://github.com/FullPeople/obr-suite/actions/runs/38145967870)
- [suite: .github/workflows/dice-release246-profile.yml](https://github.com/FullPeople/obr-suite/actions/runs/38145967840)

初次检查发现账号按钮过宽、本机卡册提前读取、旧弹窗及绑定／配色测试与新界面不匹配，以及插件清单仍写着 283。已修正性能和清单版本，并更新相应定位及断言；QQ 原位流程 33 项、绑定目录 13 项、启动器 16 项源码及两种窄屏布局通过。首次页尾滚动检查未通过；同一 Web 源码的失败项重跑后通过，发布证明保留全部任务及重跑记录。

共享主题曾向公共三龙牌兼容入口注入额外脚本，违反该入口只负责跳转的约定。现已排除兼容页，并分别验证稳定及开发路径的实际构建；正常账号和工具面板继续加载共享主题。

复用原始 229 份公开资料，完整回放 18,789 个资料身份并绑定 65 个消费者模块，记录 6,535 个实现见证。未降低运行覆盖守卫；覆盖通过不代表其余规则已实现。

本地类型检查、云端 62 项检查、选择和动画等 20 项检查、原生所有权 28 项、怪物生命周期 28 项、上传 9 项、登录会话 9 项、面板 10 项、中继 23 项，以及音乐 DOM/音频夹具通过。18 个插件入口和面板的共享主题经过完整生产包核对，公网 160 项资源核对通过；网站、私人卡库、QQ 授权跳转、WebSocket 推送和 HTTP 回退通过。

账号、卡片、房间和 SDK 权限检查使用合成夹具，未操作真实玩家卡。真实 QQ 扫码、多人房间和实体设备仍需实际验收；尚不能据这些检查宣称删卡的全部时序问题已消失。

## 备份与服务器

- 本次云端后台、通信代码、网站及插件均有独立的新备份；插件备份：/var/www/obr-plugins/suite-dev-before-qq-cloud284-20261011.tar.gz，散列 8ae5774bfad5a399093972be1f4bca114adc4323f8a0bae2daf94a7d676a9a93。
- 既有 Node 堆 96 MiB、半空间 4 MiB、队列 16 MiB、服务 256 MiB 限制保留；Nginx 配置字节未变。
- 七项服务正常，SQLite 完整性为 ok；最终剩余磁盘 14,070,476,800 字节。
- 与 283 第二轮内存限制生效后的基线相比，没有新增内核内存溢出；保留此前溢出的历史记录。

插件发布已完成且服务端保护项复核通过后，SSH 等待连接未正常退出。直接读取服务端发布回执和已完成的输出，核对精确源码、版本、保护项及空错误日志后保存本地记录，并关闭该本地等待连接；没有再次执行部署。

后续文档提交只记录验收结果，不替换本记录中的运行源码。
