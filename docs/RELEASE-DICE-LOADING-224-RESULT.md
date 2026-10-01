# Suite 224 · 骰子加载恢复发布回执

日期：2026-10-01（Asia/Shanghai）。延续用户修复并部署授权。新版从 1.0.223-dev 更新为 **1.0.224-dev**，保留 223 已发布的其他功能。

- 安装入口：https://obr.dnd.center/suite-dev/manifest-dev.json
- 运行源码：f614267f71759d7fc767fa596f9c7bc68b724bf7；分支 codex/dice-loading-224 已推送。
- 基线源码：2d9769dbedbe3e26a55d276b4b7113b7c5e91e9c，与线上 223 源码归档及发布回执相同。
- 发布包 SHA-256：587bf48a17fc61f0f0ac1a9861539b7e657dd9ff4615cb7869c2e2f666232467；35635780 字节。
- 恢复点：/var/www/obr-plugins/suite-dev-before-dice3d224；部署回执 /var/www/obr-plugins/dice3d224-deployment.json。
- 263 发布文件、59 项锁定资产校验通过；新版内部其他 1347 文件逐字节保留。
- 保护站点逐文件一致：旧 suite 581、card 184、dice-lab-dev 81、独立三龙牌 522。应用服务启动时间不变，没有修改玩家数据。静态切换时 Nginx 未变，后续骰子专用传输压缩改动见下文。
- 实际 HTTPS 回环逐文件检查 263 文件 / 104284090 字节，域名及证书验证保留；此项不等同于 Windows 公网下载。
- 构建前后 615 个源码文件散列一致；对应源码 ZIP 的提交标识、CRC 和 9 个本次关键运行源文件验证通过。

## 原因与修复

旧 worker 中锁文件下载三次停滞后，能在 Edge 复现与玩家逐字符相同的 AbortError；后续 warmup 会立即复用失败结果。现在把锁文件、资产散列和骰子目录编入程序，避免三份启动 JSON 的网络依赖；资产与引擎失败缓存可释放并重试，完整性检查仍保留。下载停滞明确报告响应头或文件数据等待超时。完整说明见 [修复证据](DICE-LOADING-224.md)。

## 传输压缩补充

公网第一轮经配置代理的 Edge 在 90 秒内未等到覆盖层 ready；之后直连已完成覆盖层加载，但物理预热仍等待网络，该轮在更改传输配置前主动结束。未把这两轮计为成功。服务器采样时出站约 5.723 Mbps，这不是云服务带宽上限的证明。发现原 gzip 范围没有覆盖骰子二进制文件。

新增仅匹配 /suite-dev/dice3d/ 下 wasm、glb、wav、ttf 的 Nginx location 压缩规则。配置与指令范围依据 [Nginx 官方文档](https://nginx.org/en/docs/http/ngx_http_gzip_module.html#gzip_types) 核对。实际 HTTPS 检查所有 31 文件的 gzip、Vary、CORS 与解压后 SHA-256；物理 WASM 从 2021569 字节降至 750509 字节，全部 31 文件传输共从 3911623 字节降至 2072073 字节。磁盘上的原始资产完全不变。

配置先通过 nginx -t，再平滑 reload；应用服务没有重启。首轮探测遇到旧 worker 尚未交接，脚本自动恢复配置；加入最多 5 秒交接探测后再次应用，所有检查通过。备份 /etc/nginx/obr-plugins-before-dice224-gzip.conf，补充回执 /var/www/obr-plugins/dice3d224-transfer.json，脚本 tools/deploy-dice224-compression.py。其他站点不匹配新规则。

## 已验证

两个 TypeScript 工程、正式构建、1053 个静态引用与 59 个锁通过。6 项加载恢复、6 项资产完整性、36 核心、6 发送队列、9 提交桥、5 生命周期、10 加载门禁检查通过。

实际 Edge 正式产物在阻断三份启动 JSON 地址时仍完成真实 Jolt/WASM/WebGL 投骰和完整动画，固定种子物理面 6、5、16，总数 32，错误 0。错误脚本缓存恢复、持续损坏三次拒绝、同 worker 失败后恢复全部通过。

双端模拟宿主完成房主先攻、玩家先攻、重开后私密优势骰；注入一次 RateLimitHit 后成功恢复，每客户端保持一个物理 worker 与覆盖层，启动 JSON 请求为 0，浏览器错误 0。使用实际物理与渲染器，枭熊 SDK 边界为夹具。

压缩后的公网直连 Edge 空缓存回测通过：启动 JSON 请求 0，真实物理面 6、5、16 / 总数 32，完整动画完成，浏览器错误 0。证据 .cache/edge224/public-compressed/public-edge.json 与 public-edge.png。真实玩家原设备及登录枭熊房间未在本次验证中覆盖。

证据在本工作区 .cache/edge224，构建及发布包在 .cache/release224。玩家需要重新加载枭熊房间以替换仍运行着的旧 worker；无需删除角色存储。
