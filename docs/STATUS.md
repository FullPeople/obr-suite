# 2026-10-01 · Suite 225 骰子加载修复已部署并完成公网回测

当前新版 **1.0.225-dev**，运行提交 bec46775113177208b7409d118cc796e8bfa73ce，独立分支 codex/dice-loading-225；工作区 D:/Desktop/DND-card-web/local-dice-loading-224。以线上 223 为本轮基线，保留其已发布的自动化、资源与历史集成；历史混合脏根目录不作为整包发布源。

玩家 lock.json 超时已用旧正式 worker 在 Edge 复现。三份启动 JSON 已编入程序，资产/引擎失败缓存可重试恢复；完整资产校验保留。补上骰子二进制传输压缩，31 文件合计减少约 47%。继续核对 Jolt 源码发现 wasmBinary 参数不受支持，225 用 instantiateWasm 直接创建已校验字节对应的物理实例，消除无版本的第二次 WASM 下载。

本轮 Edge 双端先攻/私密优势/限流恢复及加载门禁通过。225 类型检查、核心、生产构建和故障注入通过；最终公网直连 Edge 空缓存完成实际 Jolt/WASM/WebGL 投骰和动画，错误 0，启动 JSON 请求 0，WASM 仅一次请求。263 发布文件 / 59 资产锁及 263 实际 HTTPS 文件全部通过。保护站点和应用服务未变，未改玩家数据；仅为骰子资源调整 Nginx 压缩并平滑重载，配置有备份。早期代理线路超时及后续恢复记录保留，不混记成功。

真实玩家原设备与登录枭熊房间仍未覆盖，玩家需重新加载整个房间以替换旧 worker。详见 [修复证据](DICE-LOADING-225.md)、[最终发布回执](RELEASE-DICE-LOADING-225-RESULT.md)。静态恢复点 /var/www/obr-plugins/suite-dev-before-dice3d225；配置备份 /etc/nginx/obr-plugins-before-dice224-gzip.conf。

# 2026-10-01 · Suite 224 骰子加载修复已部署，公网回测通过

当前新版 1.0.224-dev，以已发布 223 的 Suite 2d9769d 为基线；运行提交 f614267f71759d7fc767fa596f9c7bc68b724bf7，隔离分支 codex/dice-loading-224 已推送，工作区 D:/Desktop/DND-card-web/local-dice-loading-224。保留 223 已发布内容，不从历史混合脏根目录整包发布。

已复现玩家 lock.json 三次超时 AbortError。锁表、资产散列和目录改为程序内置；资产/引擎失败缓存可重试恢复，59 项完整性校验保留。Edge 本机正式产物及双端先攻/私密优势/限流恢复、加载门禁回归通过。263 线上文件及实际 HTTPS 逐文件核验通过；保护站点和应用服务保持一致。补充仅骰子二进制传输压缩，31 文件解压散列全通过，传输量减少约 47%。Nginx 已按此范围平滑重载，配置有独立备份。

公网首次代理回测超时记录保留；压缩后的最终 Edge 直连冷加载完成真实投骰和动画，错误 0。真实玩家原设备和登录枭熊房间未验证。详见 [修复证据](DICE-LOADING-224.md) 与 [发布回执](RELEASE-DICE-LOADING-224-RESULT.md)。静态恢复点 /var/www/obr-plugins/suite-dev-before-dice3d224；配置备份 /etc/nginx/obr-plugins-before-dice224-gzip.conf。

