# Suite 220 · Edge 骰子修复发布回执

日期：2026-10-01（Asia/Shanghai）。用户明确要求修复并部署。新版已经从 1.0.219-dev 更新为 **1.0.220-dev**。

- 安装入口：https://obr.dnd.center/suite-dev/manifest-dev.json
- 运行源码：a0db78b416b3b532c0bc062811a75c5d4117016a，分支 codex/dice-edge-220；已推送独立 GitHub 分支，不合并 main。
- 发布包 SHA-256：76a1fa17814c6b206d3031305ca1d4e622f7d81c5840bc1d0ab7fcfdca742d38。
- 恢复点：/var/www/obr-plugins/suite-dev-before-dice3d220；部署回执 /var/www/obr-plugins/dice3d220-deployment.json。
- 262 个发布文件与 59 项真实锁定资产散列通过；新版内部其余 1150 文件保持原字节，保留旧 hash 资源。
- 保护站点逐文件一致：旧 suite 581、card 167、dice-lab-dev 81、独立三龙牌 522。Nginx 和两个服务启动时间未变化，没有写玩家数据或部署后端。
- 服务端实际 HTTPS 回环核验 262 文件 / 104020050 字节，保留域名和 TLS 证书验证；该核验不是 Windows 公网下载。

## 实际修复与验证

截图 SHA-256 精确对应 Windows CRLF 的 Jolt vendor 文件，生产构建遗漏独立 vendor 锁。现已保留原始锁定 LF，构建/打包都核对两份锁；加载器使用新版本资源地址并自动重取错误缓存。只在明确 SDK RateLimitHit 拒绝时退避重发同消息，其他未知结果不重放。周期维护去重，保留现有先攻失败不写入、单后台引擎与私密权限。详见 DICE-EDGE-220.md。

本机：36 核心、6 发送队列、6 真实资产损坏、9 提交桥、5 生命周期、10 加载门禁检查通过；两个 TypeScript 工程与正式构建通过。Edge 正式产物完成错误字节自动恢复、持续损坏三次拒绝、真实 Jolt/WASM/WebGL 投骰；固定种子结果 6、5、16，总数 32，完成全段动画，错误 0。双客户端模拟宿主的房主、玩家先攻以及重开后的私密优势骰三项通过，并注入 RateLimitHit 验证恢复。

公网实际 Edge 空上下文加载正式 220，实际物理面同为 6、5、16，总数 32，整段演出完成，浏览器错误 0；该页面未连接枭熊 SDK 或向真人房间发送消息。截图 .cache/edge220/public-edge.png，回执 public-edge.json。

源码归档绑定运行提交，CRC 与五个关键运行源文件一致；构建前后 612 个源文件散列一致。证据：本工作区 .cache/edge220 和 .cache/release220。

真实玩家原设备、登录枭熊房间仍未验证。截图里的 obr-viewport-filters.onrender.com 属于另一个外部插件，未改其服务。

玩家重新加载枭熊房间即可读取 220；无需清除角色数据或更换 Firefox。未发布待办自动化/卡面试验、未改独立角色卡及公告内容。
