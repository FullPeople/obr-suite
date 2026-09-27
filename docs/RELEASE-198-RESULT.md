# 2026-09-27 · 198 已发布回执

本轮 6 项反馈，以及后续补充的两个怪物锁说明、移除状态后图标残留，共 8 项，已完成修复、验证和发布。实际手机和真实多人房间仍按下面的边界保留待验证。

| 渠道 | 已发布版本 | 入口 |
| --- | --- | --- |
| 国内单机 | standalone-1.0.198，公告 0.1.7 | https://obr.dnd.center/card/ |
| 新版枭熊插件 | 1.0.198-dev，公告 0.1.7 | https://obr.dnd.center/suite-dev/manifest-dev.json |
| 旧版枭熊插件 | 1.3.7 | https://obr.dnd.center/suite/manifest.json |
| GitHub Pages | 本轮 Web 提交，公告 0.1.7 | https://fullpeople.github.io/DND-card-web/ |

实际打包源码 Web `fcaa81d5592cabf202d772b60f341c5c5b44d54c`、Suite `bad90400597a6dd704faf3e8ecda02ec1d9d3c8f`。Web 已推 main 和本轮分支，Suite 已推 dev 和本轮分支；旧 Suite main 未覆盖。回执文档的后续提交不改变运行源码。

## 核验结果

- GitHub 完整发布门禁与 Pages 发布通过：[运行 36293090180](https://github.com/FullPeople/DND-card-web/actions/runs/36293090180)。包括核心测试、51 项发布浏览器回归、本轮及上一轮追加 8 项、触摸、单机离线、统一布局检查。
- 本机核心检查 175 通过、2 个上游夹具条件跳过；单机 7 项通过；触摸 6 项通过、6 个平台条件跳过。跳过项不计入通过，也不等同真实手机验收。
- 状态移除 5 个场景回归通过：旧代码留下 2 个图形，新代码为 0；已有残留、删除失败、读取失败和旧本地图形清理失败后均可恢复。使用真实 SDK 构建器、模拟后端，尚无真实多人房间验收。
- 真实怪物资料禁用 MM：修复前 3121 条、988 项失败；修复后 4109 条、0 失败，禁用的 450 条仍隐藏。依赖链、错误详情和重试另有 4 个原创夹具回归。
- 服务器 1054 个发布文件 SHA256 核对通过（旧版 377、新版 649、单机 28）。公网另读取并比对 195 个文件，包括关键 HTML、JS、CSS、源代码包和离线包。
- 公网生产页面检查通过：三个渠道公告、完整安装链接、默认折叠红字 Owner 说明、职业顺序、熟练拖拽、法术来源、统一 JSON、自定义逐框帮助与参考格式、旧上传说明，以及 360 像素窗口中 3468 条图鉴布局和加载失败重试；页面脚本错误 0。规则数据使用原创夹具、SDK 房间后端模拟，不冒充真人房间验证。

本轮逐项白话说明见 [RELEASE-198.md](RELEASE-198.md)。之前的 33 项仍见 [FEEDBACK-PLAIN-20260927.md](FEEDBACK-PLAIN-20260927.md)，197 追加内容见 [RELEASE-197.md](RELEASE-197.md)。

## 待验证边界

本轮实际 Android/iOS 文字选择和系统菜单、真实多人房间状态移除同步待验证，公告已经写明。此前多人光源和动态视野、无卡血条气泡、部分玩家缺投骰按钮、偶发放怪、全库与房间切换性能、三龙整局和无座位 DM 视图保持待验证。三龙突然断线自动接任尚未完成。

## 发布与恢复

离线包：[DND-Card-Standalone-198.zip](https://obr.dnd.center/card/downloads/DND-Card-Standalone-198.zip)。SHA256：`48c0b23ff298ebc4f4ce48de7245855edb3e24f9c7dc73f6fd5cd1aeba1444e1`。

服务器保留 `/var/www/obr-plugins/` 下的 `suite-before-198`、`suite-dev-before-198`、`card-before-198`，旧资源与下载仍保留。中继没有重启，三个源码哈希与 nginx 配置不变，角色数据没有改动。

完整证据在 `F:/CodexWork/2026-09-27/feedback/release198/`：`package-receipt.json`、`deployment.json`、`public-verification.json`、`live-browser.json`、`ci-result.json`、`live-suite/suite-ui198.json` 和截图。源码仍位于隔离 `{web,suite}` 目录；两处主目录只回填文档，混合源码未覆盖。
