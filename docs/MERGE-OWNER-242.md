# 2026-10-04 Owner 配套修复合并

用户授权合并及部署 Web `b336325f84c38883212926396eebafa58d1d2d8b` / Suite `06e4e4825c40da5e4d3449e95d8b70cbc79fc46a`，重点为玩家首次加载恢复、原生 Owner 撤权即时禁写与主持人权限说明入口。目标为 Web main 与新版 Suite dev，发布 `/card/` 与 `/suite-dev/`。旧稳定、独立三龙牌、后台服务、玩家文件与数据库不在本次发布范围。

隔离目录 `U:/CodexWork/2026-10-04/owner-sync242/{web,suite}`。基线来自已核实远端 Web `9e8cf1f` / Suite `b48783c`，与线上241的来源一致。指定输入的完整上游 CI 均 success：Web37133436004 / Suite37133538982；最终合并源码仍须单独验证。

输入分支同时含有与另一会话重叠的启动实验。合并保留241已发布的 index、main、afterPaint、startup、preload、offline shell、startup preview 与既有启动/键盘测试；App只引入该候选的当前权限检查。新增无损PNG交付、WebP否决后的实验检查与启动延迟测试不纳入242运行实现；其原始候选记录保留为历史证据。已发布的编辑偏好恢复、完整开场/透明退出与不可交互保护保持。权限宿主与Web实现、恢复/撤权转换及说明入口测试完整接入。

Web公告0.1.33 / 网站standalone-1.0.242；新版Suite1.0.242-dev。两端公告内容与适用范围分开，241完整历史收进默认折叠历史。本轮的完整验证、失败复验、实际运行SHA、公网验收与回滚点以 RELEASE-242-FINAL.md 为准。
