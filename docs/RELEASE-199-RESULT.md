# 2026-09-27 · 199 怪物图鉴热修已发布

已修复用户原样报告的 `Converting circular structure to JSON`（`__ → props → children[1]`）。已发布 198 的完整页面可以稳定复现；199 的本机及公网新旧插件均通过同一完整流程。

| 渠道 | 已发布版本 |
| --- | --- |
| 新版插件 | [1.0.199-dev](https://obr.dnd.center/suite-dev/manifest-dev.json) |
| 旧版插件 | [1.3.8](https://obr.dnd.center/suite/manifest.json) |
| 国内单机 | [standalone-1.0.199](https://obr.dnd.center/card/)，公告 0.1.8 |
| GitHub Pages | [本轮 Web 提交](https://fullpeople.github.io/DND-card-web/)，公告 0.1.8 |

本次是枭熊图鉴修复，只加入枭熊对应公告，单机说明不混入枭熊内容。实际运行源码 Web `a1d78ea2766981ab9f604664def05bc0fcbda436` / Suite `7d6b50aafea66511488c2877a56ffe6cc69aab07`，文档回执的后续提交不改变运行源码。

原因是对象形式的 CR 被直接交给 Preact，当作界面节点写入父引用，污染了原始资料。随后处理继承怪物及缓存时失败。现在列表只接收 CR 文字，原始普通/巢穴/共巫 CR 数据全部保留；详情见 [修复和漏检复盘](RELEASE-199.md)。

## 验证结果

- 198 已发布构建原样复现相同错误及循环路径，另捕获到缓存 DataCloneError。
- 本机和公网新旧插件：7 种 CR 形态、先显示预览再处理继承、点击放怪并检查共享场景 JSON、真正等待重新下载后的刷新、持久缓存重载，全部通过。无脚本错误、循环引用或缓存写入错误。原始对象 CR 的其他字段未丢失。
- 真实资料生产页面：4559 / 4559 条，首次 111 次图鉴请求，缓存重载仅 1 次索引请求。两次无图鉴加载失败和页面脚本错误；控制页有一条资源 404，不将其算成所有图片均已验证。
- 原有来源禁用与依赖链回归 4 项通过。新旧完整构建、TypeScript 通过。GitHub 全部发布门禁与 Pages 部署通过：[运行 36294254396](https://github.com/FullPeople/DND-card-web/actions/runs/36294254396)，包括 51 项发布回归、本轮沿用的 8 项界面检查、触摸、离线、统一布局。
- 服务器 1054 个文件哈希核验通过，公网抽查 195 个文件通过。公网页面检查包含新旧公告与本次修复说明。

场景后端为模拟，使用真实 SDK 与已部署页面，不冒充真人多人房间验收。之前的实际手机、多人状态/光源/视野、偶发放怪和性能待验证项目不因本次热修而关闭。

## 发布记录

已推送 Web main、本轮分支，以及 Suite dev、本轮分支。主目录混合源码没有覆盖，只回填文档。服务器保留 `suite-before-199`、`suite-dev-before-199`、`card-before-199`；原资源与下载保留。角色数据未改，中继未重启且源码哈希不变，nginx 配置未改。

离线包：[DND-Card-Standalone-199.zip](https://obr.dnd.center/card/downloads/DND-Card-Standalone-199.zip)，SHA256 `6d26eca681d4140c78d2a302a90e07ad309cd92a92acf917eaed679624e4309f`。

证据入口 `F:/CodexWork/2026-09-27/feedback/release199/`，包括 `deployment.json`、`public-verification.json`、`public-bestiary-stable.json`、`public-bestiary-dev.json`、`live-browser.json`、`ci-result.json`。源代码在同根目录 `{web,suite}`。打包时 F 盘空间不足，本次打包目录及旧的两份可重建构建目录已转存到 `D:/Temp/DND-card-release199-storage/`，原 F 路径通过联接保留；未删除用户资料或测试证据。
