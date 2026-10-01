# 2026-10-02 · 230 已获部署授权，准备中

用户在最终源码合并验证后明确要求部署，覆盖下方230“仅源码、不部署”阶段。发布输入为 db223af / 5b733db 的配套版本，隔离分支 codex/release230 / codex/release230-suite；运行版本计划 standalone-1.0.230 / 1.0.230-dev，公告0.1.24。当前实际源站活动目录和公网均为209（稳定版1.3.13），虽然历史227回执仍在；必须固定实际目录散列、保留恢复点后升级，不沿用历史227活动基线假设。发布结果与真实房间边界以后续230最终回执为准。

# 2026-10-02 · 230 最终配套源码，仅 GitHub、不部署

当前源码以 startup-226 的实际 227 宿主基线 1da2715 为基础，包含骰子225及其完整回执，合入 selection-follow223-suite。对应 Web 为 codex/final-integration230（229/228首屏与Wiki恢复 + selection-follow223）。Suite 输出 codex/final-integration230-suite。230为源码合并编号，manifest仍保留1.0.227-dev和stable1.3.14，本次没有部署，下面225的“当前新版”表述仅为历史记录。

合并后的单元482通过/23跳过，组合Edge浏览器40通过/5跳过；Suite选择及群体37项、骰子各类53项通过；真实物理/完整动画、59资产锁、1053静态引用、实际SDK及5卡20怪物本地HTTP relay通过。未执行真实登录房间、玩家原设备/线路、公网发布和完整发布CI。首轮失败、修订及具体复验见 [230合并记录](INTEGRATION-230-RESULT.md)。

构建时必须用 DND_CARD_WEB_ROOT 指定同批最终Web分支，不能使用历史混合脏根目录。隔离目录 D:/Desktop/DND-card-web/.local-evidence/final-integration230/{web,suite}；旧工作树和用户预览保留。不得把旧稳定main整体覆盖到当前宿主，不推送main或dev，不运行部署脚本。下面历史发布回执不能代替本批合并验收。

# 2026-10-01 · Suite 225 骰子加载修复已部署并完成公网回测

当前新版 **1.0.225-dev**，运行提交 bec46775113177208b7409d118cc796e8bfa73ce，独立分支 codex/dice-loading-225；工作区 D:/Desktop/DND-card-web/local-dice-loading-224。以线上 223 为本轮基线，保留其已发布的自动化、资源与历史集成；历史混合脏根目录不作为整包发布源。

玩家 lock.json 超时已用旧正式 worker 在 Edge 复现。三份启动 JSON 已编入程序，资产/引擎失败缓存可重试恢复；完整资产校验保留。补上骰子二进制传输压缩，31 文件合计减少约 47%。继续核对 Jolt 源码发现 wasmBinary 参数不受支持，225 用 instantiateWasm 直接创建已校验字节对应的物理实例，消除无版本的第二次 WASM 下载。

本轮 Edge 双端先攻/私密优势/限流恢复及加载门禁通过。225 类型检查、核心、生产构建和故障注入通过；最终公网直连 Edge 空缓存完成实际 Jolt/WASM/WebGL 投骰和动画，错误 0，启动 JSON 请求 0，WASM 仅一次请求。263 发布文件 / 59 资产锁及 263 实际 HTTPS 文件全部通过。保护站点和应用服务未变，未改玩家数据；仅为骰子资源调整 Nginx 压缩并平滑重载，配置有备份。早期代理线路超时及后续恢复记录保留，不混记成功。

真实玩家原设备与登录枭熊房间仍未覆盖，玩家需重新加载整个房间以替换旧 worker。详见 [修复证据](DICE-LOADING-225.md)、[最终发布回执](RELEASE-DICE-LOADING-225-RESULT.md)。静态恢复点 /var/www/obr-plugins/suite-dev-before-dice3d225；配置备份 /etc/nginx/obr-plugins-before-dice224-gzip.conf。

# 2026-10-01 · Suite 224 骰子加载修复已部署，公网回测通过

当前新版 1.0.224-dev，以已发布 223 的 Suite 2d9769d 为基线；运行提交 f614267f71759d7fc767fa596f9c7bc68b724bf7，隔离分支 codex/dice-loading-224 已推送，工作区 D:/Desktop/DND-card-web/local-dice-loading-224。保留 223 已发布内容，不从历史混合脏根目录整包发布。

已复现玩家 lock.json 三次超时 AbortError。锁表、资产散列和目录改为程序内置；资产/引擎失败缓存可重试恢复，59 项完整性校验保留。Edge 本机正式产物及双端先攻/私密优势/限流恢复、加载门禁回归通过。263 线上文件及实际 HTTPS 逐文件核验通过；保护站点和应用服务保持一致。补充仅骰子二进制传输压缩，31 文件解压散列全通过，传输量减少约 47%。Nginx 已按此范围平滑重载，配置有独立备份。

公网首次代理回测超时记录保留；压缩后的最终 Edge 直连冷加载完成真实投骰和动画，错误 0。真实玩家原设备和登录枭熊房间未验证。详见 [修复证据](DICE-LOADING-224.md) 与 [发布回执](RELEASE-DICE-LOADING-224-RESULT.md)。静态恢复点 /var/www/obr-plugins/suite-dev-before-dice3d224；配置备份 /etc/nginx/obr-plugins-before-dice224-gzip.conf。

