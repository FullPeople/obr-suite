# 2026-09-27 · 203 三龙牌服务器同步已发布

| 入口 | 已发布版本 |
| --- | --- |
| Full Suite 内嵌牌桌 | [1.0.203-dev](https://obr.dnd.center/suite-dev/manifest-dev.json) |
| 独立三龙牌 | [0.7.17-dev](https://obr.dnd.center/three-dragon-ante-dev/manifest.json) |

新建牌桌的出牌、准备、结算、历史和手势通过自有服务器同步。枭熊仍提供插件入口、房间发现及身份/权限核验。服务器负责纯规则计算、保存和按玩家发送私有视图，减少原广播分包排队。原牌组及 81 张时光龙牌组保留。

所有客户端刷新后使用新版本。原来处于大厅或进行中的旧牌桌保留旧同步；旧局结束后刷新并创建新牌桌，才进入服务器模式。不要把旧牌局本地存档当作已经迁移。主持离开前使用移交主持，新玩家初次认证及非主持 DM 的权限续期需要现任主持在线。

## 验证结果

- TypeScript 检查、Suite-dev/独立三龙牌生产构建及内嵌阅读器构建通过。
- 新服务器 9 组 WebSocket/SQLite/规则检查通过，覆盖 130 次合法动作、隐私、重复操作、保存失败回滚、GM 权限变化、跨浏览器同座位、重启恢复和主持移交。旧控制器 15 组、时光龙边界和 32 个种子回归通过。
- 本地 Edge 真 UI，以及正式构建连接公网 HTTPS/WSS 的独立版主持 / 内嵌版手机尺寸玩家 / 未入座 DM 检查通过。发牌、前注、手牌隔离、断线恢复通过，无游戏广播、脚本错误或横向溢出，截图已查看。枭熊 SDK 身份和宿主环境使用夹具，不等同真人多人房间或实体手机。
- 服务器临时数据库、独立进程有界压测：20 桌、120 连接、800 次操作，48.43 次/秒，P95 确认 279.61ms，RSS 131.12 MiB，约占单核 51.51%。压缩下行 3.43 Mbps。延迟是服务器回环值，未包含玩家公网往返；不是用户套餐带宽测量或长期高峰承诺。
- 服务器 806 个文件哈希，公网 61 个变更脚本/样式/入口哈希通过。公网服务 health 200，systemd active，检查时 NRestarts=0。仅清理了 4 张明确编号的合成测试牌桌，没有删除用户牌桌。
- 7 项公告持久化/独立版本测试通过，新版公告简短分组。单机公告仍为 0.1.9，旧插件与单机站、Pages 未重新发布。

真实枭熊房间身份链路、玩家公网长局和实体手机流畅度：待验证。没有从夹具和回环压测推断已经解决所有玩家环境中的卡顿。

## 发布与恢复

运行源码 Suite `8e3dd12367806e6138767f070323ecb48dbd4c53`，Web `7f64c1e88b73bc1163d5b1c72814ee45f8f23461`，均已推送 codex/feedback-september。后续文档回执提交不改变运行源码或上述归档版本。

服务 obr-three-dragon，127.0.0.1:5013，反代 /three-dragon-api/v1/；程序 /opt/obr-three-dragon/server.mjs，持久化 /var/lib/obr-three-dragon/game.sqlite。使用 DynamicUser、StateDirectory、256M 内存限制和 20 活跃桌 / 180 连接上限。SQLite 状态、完整历史与动作去重回执在同一事务中提交后才确认。

静态回滚目录：/var/www/obr-plugins/suite-dev-before-203、/var/www/obr-plugins/three-dragon-ante-dev-before-203。保留了旧静态资源以兼容仍打开的页面。Nginx 回滚文件：/etc/nginx/rollback/obr-plugins-before-three-dragon-203.conf；配置先 nginx -t 再 reload。既有 vtt 重复 MIME 警告未新增或扩大。202 gzip 冷启动修正保留。

原角色卡中继文件哈希和启动时间未变，没有重启中继或修改角色数据。单机站仍 standalone-1.0.200，旧插件仍 1.3.10。不得为了回滚前端删除新 SQLite 牌局；切回旧前端前要考虑本轮已创建的服务器牌局，保留服务及数据库供恢复。

证据、归档、截图、上线和清理记录：D:/Temp/DND-card-release203-storage/release203/。实现与边界见 [203 说明](THREE_DRAGON_SERVER_203.md)。主目录只回填发布文档，没有覆盖历史混合源码。
