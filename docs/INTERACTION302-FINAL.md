# 302 最终发布记录 · 2026-10-19

新版插件 `1.0.302-dev` 与工作台内部版本 `0.1.76` 已于北京时间 12:59:56 实际发布。运行源码固定为 Suite `c58f1d40de24bb12735d42aedadacc3672e09a2d` 和 Web `a17685fbd7871984f672f7221d4b6b55b9204aad`；本记录及后续文档提交不替代运行来源。单机网站、卡库、Wiki 同批发布为 `standalone-1.0.302`。

数值修改在既有合并窗口后统一派生并复用已认证结果；启动只预读当前及相邻有权限卡，完整目录保留，当前卡读取有独立优先级，切卡与撤权取消未开始的旧预读。保留原界面、角色格式、同步和权限语义。见 [本地性能验证](WORKBENCH_PERFORMANCE_LOCAL_20261019.md)。

最终 Suite 六组精确 CI 与对应 Web、Data 门禁全部通过；四份新建完整恢复副本、四棵线上树、128 项保护、数据库完整性及公网实际资源散列通过。Suite 完整恢复副本为 `/var/www/obr-plugins/suite-dev-before-interaction302-20261019`。发布／独立复核各执行一次，没有重复 apply。玩家数据未修改，服务未重启；稳定 `/suite/` 保持 `1.3.34`，后台保持 `1.0.295`，QQ／云继续暂停。

服务器封存记录位于 `/root/codex-release-packages/interaction302-20261019`，发布回执 SHA-256 为 `c605f0fa5dd6576bb7d43987d30ade3e4009ee6c899bbab08b1c93be9ddcb44c`。完整证据、18 组 CI 链接、历史失败、来源和不可变资源保留说明见 [Web 最终记录](https://github.com/FullPeople/DND-card-web/blob/main/docs/INTERACTION302-RELEASE.md)。

本地单机定稿 5317 与内嵌 5353 预览保留。公网版本和实际页面已确认；真实多人房间、实体触屏、微信／QQ 仍需原环境验收。刷新房间后关闭并重开角色工作台，不需要清除存储。
