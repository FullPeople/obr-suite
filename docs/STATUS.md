# 2026-10-01 · Suite 224 骰子加载修复已部署，公网回测通过

当前新版 1.0.224-dev，以已发布 223 的 Suite 2d9769d 为基线；运行提交 f614267f71759d7fc767fa596f9c7bc68b724bf7，隔离分支 codex/dice-loading-224 已推送，工作区 D:/Desktop/DND-card-web/local-dice-loading-224。保留 223 已发布内容，不从历史混合脏根目录整包发布。

已复现玩家 lock.json 三次超时 AbortError。锁表、资产散列和目录改为程序内置；资产/引擎失败缓存可重试恢复，59 项完整性校验保留。Edge 本机正式产物及双端先攻/私密优势/限流恢复、加载门禁回归通过。263 线上文件及实际 HTTPS 逐文件核验通过；保护站点和应用服务保持一致。补充仅骰子二进制传输压缩，31 文件解压散列全通过，传输量减少约 47%。Nginx 已按此范围平滑重载，配置有独立备份。

公网首次代理回测超时记录保留；压缩后的最终 Edge 直连冷加载完成真实投骰和动画，错误 0。真实玩家原设备和登录枭熊房间未验证。详见 [修复证据](DICE-LOADING-224.md) 与 [发布回执](RELEASE-DICE-LOADING-224-RESULT.md)。静态恢复点 /var/www/obr-plugins/suite-dev-before-dice3d224；配置备份 /etc/nginx/obr-plugins-before-dice224-gzip.conf。

