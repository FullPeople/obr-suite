# 2026-09-27 · 200 公告分组已发布

公告已按用户提供的短句重写，增加功能中标题和分割线。新版 8 组 35 项、单机 5 组 23 项、旧版 4 组 16 项，各渠道只列自己的功能。可复制全文见 [公告文本](ANNOUNCEMENT-20260927.md)。Owner 红字折叠说明仍在新版前方，旧版完整安装链接仍可复制。

| 渠道 | 已发布版本 |
| --- | --- |
| 新版插件 | [1.0.200-dev](https://obr.dnd.center/suite-dev/manifest-dev.json) |
| 旧版插件 | [1.3.9](https://obr.dnd.center/suite/manifest.json) |
| 国内单机 | [standalone-1.0.200](https://obr.dnd.center/card/)，公告 0.1.9 |
| GitHub Pages | [公告 0.1.9](https://fullpeople.github.io/DND-card-web/) |

运行源码 Web `45d04032f2134d442745345ec8c13d5ec9c585e3` / Suite `2cff2784648917393ab6e5b646fdbd0b44c5b360`。本次修改公告内容与展示，不新增规则或多人行为修复；199 循环引用热修保留。手机、多人状态/视野、性能等原有待验证标记保持。

## 已完成检查

- TypeScript、单机、新旧插件生产构建通过。
- 本机 7 项单机回归、2 项新版公告回归通过。
- 本机及公网三份生产公告桌面/390px 窄屏验证通过：分组、分割线、条数、渠道隔离、红字折叠权限说明、完整安装链接均正确；无页面脚本错误及横向溢出。已人工检查本机和公网截图。
- GitHub 发布门禁与 Pages 部署通过：[运行 36295716369](https://github.com/FullPeople/DND-card-web/actions/runs/36295716369)。
- 服务器 1054 个文件、公网 195 个文件哈希核验通过。

公告回归使用模拟 SDK 就绪信号和原创/空资料夹具，不代表真人房间的新一轮功能验收。没有把公告检查当成整份历史问题清单均已实测的证明。

## 发布与证据

服务器保留 `suite-before-200`、`suite-dev-before-200`、`card-before-200`。旧资源及下载保留，角色数据未改，中继未重启，nginx 配置未改。源码已推送 Web main、Suite dev 及本轮分支；两处主目录只回填文档。

离线包：[DND-Card-Standalone-200.zip](https://obr.dnd.center/card/downloads/DND-Card-Standalone-200.zip)，SHA256 `2932c9e6276a1c6d7810f18465220b8e03fdeb9d77c843b1c8b7879217bbe9d8`。

源码在 `F:/CodexWork/2026-09-27/feedback/{web,suite}`。证据入口 `F:/CodexWork/2026-09-27/feedback/release200/`（联接至 `D:/Temp/DND-card-release200-storage/release200`），含打包、部署、CI、公网哈希、浏览器检查及三渠道截图。构建复制步骤已支持构建目录联接，不将联接本身发布。
