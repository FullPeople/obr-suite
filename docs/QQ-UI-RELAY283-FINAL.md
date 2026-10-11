# 界面与通信更新 283：最终发布记录

记录时间：2026-10-11T09:29:44.839945+00:00。

按用户要求，先拉取最新分支及补充说明，再合并和部署。网站角色卡及卡库已发布 standalone-1.0.283，公告版本 0.1.63；枭熊测试版已发布 1.0.283-dev。云端 API 保持 1.0.282。

## 来源与范围

- Web 最新功能分支：c1b6add05a99864b29c627562ea88d1b9e6d8808；[合并 PR58](https://github.com/FullPeople/DND-card-web/pull/58)。
- Suite 最新功能分支：ffb5907eef02d897db6d7fee7ae4576cc96f977e，按其说明使用 dev 开发线及新增修复；[合并 PR60](https://github.com/FullPeople/obr-suite/pull/60)。
- 实际网站运行源码：76e363c9629b34b51f7c55065957a9d28cfb0cce。
- 实际插件和中继运行源码：e3cf2e849f0cdebfe974c8a8eb194a1ddd7d2ea8。
- 数据审计版本：a590938f0ea572c5415a3f6c31dd18d0839bd25c；消费者版本：b2de77342ebd00a53819fa6f4d9b0a58d10b1b37；报告 SHA-256：0a58ff867e19cf6d180c8b9977a80b86418060670ec82f0f5025356584cbeede。
- 稳定插件仍为 1.3.22；首页、三龙牌、旧角色卡导出入口和玩家数据经过独立保护核对。后续文档提交不替代上述运行源码。

界面改动、统一图标、窄屏布局和通信推送已集成。保留当前 QQ 账号卡库、普通卡原位上传、卡主及指定编辑者权限、未授权 DM 只读、房间修改写回原卡、音乐板和个人骰子设置。新增云端卡绑定目录、当前名称及云端资料读取；删除 HTTP 成功响应统一处理。

## 验证结果

最终运行源码的 28 项 Web 和 6 项 Suite 持续集成任务全部成功：

- [web: .github/workflows/web.yml，26 项任务](https://github.com/FullPeople/DND-card-web/actions/runs/38125701285)
- [web: .github/workflows/cloud-migration.yml，1 项任务](https://github.com/FullPeople/DND-card-web/actions/runs/38125705830)
- [web: .github/workflows/dot-deploy-contract.yml，1 项任务](https://github.com/FullPeople/DND-card-web/actions/runs/38125708319)
- [suite: .github/workflows/qq-permissions.yml，1 项任务](https://github.com/FullPeople/obr-suite/actions/runs/38125704960)
- [suite: .github/workflows/verify-suite.yml，1 项任务](https://github.com/FullPeople/obr-suite/actions/runs/38125704876)
- [suite: .github/workflows/dice-release246-profile.yml，4 项任务](https://github.com/FullPeople/obr-suite/actions/runs/38125704856)

完整回放覆盖 18,789 个资料身份、6,535 个实现见证和 65 个消费者模块；没有采用散列豁免。审计通过不代表其余规则均已实现。

原生云端卡浏览器检查 32 项、实际绑定窗口检查 13 项、中继通信及容量检查 20 项通过；这些账号、卡片、SDK 和房间使用合成夹具。QQ 登录、账号显示、原位上传、角色簿导入、自动写回、卡主授权、指定编辑者、未授权 DM 只读和撤销权限均有检查。

线上 96 项入口、资源及源码下载核对通过。不同源码包分别验证完整公网散列，其余下载别名验证服务器完整散列及公网文件长度和首尾分段。官网角色卡正常显示，卡库登录限制、手机及桌面 QQ 图像、QQ 授权跳转检查通过；授权页未报 100008。公网 WebSocket 握手、推送和断线后的 HTTP 回退通过，只使用独立合成会话。

上述结果不等于真实 QQ 扫码、真实多人房间和实体设备验收。

## 内存与服务器

中继服务保留 256 MiB 限制，老生代 96 MiB、半空间 4 MiB、队列 16 MiB。新增请求并发及读取总量限制，每次最多一个响应压缩任务，并限制 WebSocket 输入与输出。6 轮并发大消息检查中，12 个请求完成、12 个请求受到可重试限流，进程峰值约 113.7 MiB。

第一次 128 MiB 堆调整之后仍出现过内存耗尽；相关证据保留。16:18 改为当前限制，此后到最终复查无新增内核内存耗尽记录，中继自动重启次数为 0。发布后 7 个服务正常，数据库只读完整性检查为 ok，磁盘剩余 15.29 GB。数据库未被核对脚本写入。

## 发布回执与恢复点

- 网站及卡库：[正式发布流程](https://github.com/FullPeople/DND-card-web/actions/runs/38127065699)，回执 /root/codex-release-receipts/dnd-center-actions-38126880568-1.json；独立备份在 /root/codex-release-packages/dnd-center-actions-38126880568-1/backup/frontend，分别保留 card、library。
- 枭熊测试版：回执 /root/codex-release-receipts/qq-cloud283-20261011.json；完整发布目录 10454 个文件，129 项保护值保持一致。
- 枭熊独立备份：/var/www/obr-plugins/suite-dev-before-qq-cloud283-20261011.tar.gz，256804574 字节，SHA-256 f84592c0585c134f4fbfd06a224bec7cc588c246d69b07cf41f15f43c64a3a2f。
- 中继独立备份：/root/codex-release-packages/relay-websocket283-20261011/backup，包含发布前模块和 Nginx 配置；当前堆限制配置保留。

恢复时先以实际回执重新进行只读核对，保留备份和玩家数据，按目标使用封装发布器。本次后续目标造成的已授权保护值变更也需核实；不得为了通过恢复检查而删除备份或取消保护。

完整源码下载包：

| 来源 | 精确提交 | SHA-256 | 字节 |
| --- | --- | --- | --- |
| web | 76e363c9629b34b51f7c55065957a9d28cfb0cce | 85573cafc8c431b326954472c3bc281faf1e94af7168c819ba462911e1cb5370 | 7606217 |
| suite | e3cf2e849f0cdebfe974c8a8eb194a1ddd7d2ea8 | fa411a672a21e12f82af9321da771f3703cda2bb13645c96cb8c2dc6d3c33d12 | 34231059 |

## 修正与剩余问题

验证过程中修正了云图标的识别标签、窄屏顶栏按钮重叠、绑定及资料窗口合成夹具，以及网站和插件公告版本号。旧公告版本曾挡住测试中的登录点击；修正后 32 项原生检查及最终 CI 通过。先前骰子通信检查出现一次超时，最终运行版本完整检查通过，未放宽断言。

本分支的删除修复处理 HTTP 响应内容。前端先收到权限撤销、后收到删除成功回执时，仍有独立复现的误报竞态。本次按要求先完成合并和部署，不将其写成所有删除误报都已解决。
