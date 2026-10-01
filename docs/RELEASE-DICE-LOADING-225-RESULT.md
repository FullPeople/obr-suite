# Suite 225 · 骰子加载修复最终发布回执

日期：2026-10-01（Asia/Shanghai）。新版已从本轮 224 更新为 **1.0.225-dev**，延续用户修复并部署授权。

- 安装入口：https://obr.dnd.center/suite-dev/manifest-dev.json
- 运行提交：bec46775113177208b7409d118cc796e8bfa73ce；分支 codex/dice-loading-225。
- 发布包 SHA-256：a48ab1dee09a38a63acf912c42c0d90a531922704a94dc3dd1b60db548b9a070。
- 静态恢复点：/var/www/obr-plugins/suite-dev-before-dice3d225；部署回执 /var/www/obr-plugins/dice3d225-deployment.json。
- 263 发布文件、59 个资产锁通过；新版内其余 1356 文件保持原字节。
- 保护站点逐文件一致：suite 581、card 184、dice-lab-dev 81、独立三龙牌 522。两个应用服务启动时间不变，没有修改玩家数据。
- 225 静态切换保留本轮 224 添加的骰子专用压缩规则，未再次修改 Nginx。压缩配置备份和全部 31 文件解压验证见 RELEASE-DICE-LOADING-224-RESULT.md。
- 构建前后 615 个源文件散列一致，源码 ZIP 的运行提交、CRC 和本次两个关键运行文件验证通过。

## 最终行为

移除 vendor/lock.json、asset-hashes.json 和 catalog.json 的启动网络等待；失败下载及引擎初始化可重新尝试，持续损坏仍拒绝。二进制资源传输压缩实测减少约 47%，WASM 从 2021569 字节降至 750509 字节。

核对原始 Jolt 1.1.0 生成脚本后，确认 wasmBinary 不受支持，原逻辑会在下载校验之后再发无版本请求。225 使用其实际支持的 instantiateWasm 回调，直接从已校验字节编译和创建实例；不再重复下载，也不绕过我们的超时/散列检查。见 DICE-LOADING-225.md。

## 验证边界

本轮 224：完整加载器/损坏/核心/发送队列/提交桥/生命周期/门禁检查通过；实际 Edge 双端模拟宿主完成房主、玩家先攻及重开后私密优势，限流注入恢复，启动 JSON 请求 0。公网压缩后的 224 也完成真实物理与动画，失败的早期网络尝试原样记录。

225 补充：两个 TypeScript 工程、36 核心检查、正式构建、1053 静态引用与 59 资产锁通过。本机正式 Edge 在阻断启动 JSON 和无版本 WASM 的条件下，只有一次带版本 WASM 请求；仍完成真实 Jolt/WASM/WebGL 2d6+1d20+5、物理面 6/5/16、总数 32 和完整动画，错误 0。错误脚本恢复、持续损坏三次拒绝、同 worker 失败后恢复继续通过。

实际 HTTPS 回环逐文件验证 263 文件 / 104324038 字节全部通过，域名与证书检查保留；该项不等同于 Windows 公网下载。公网 225 直连 Edge 空缓存回测通过：屏蔽启动 JSON 和无版本 WASM，JSON 请求为 0、带版本 WASM 只有一次请求，真实物理面 6/5/16、总数 32，完整动画完成，浏览器错误 0。记录 .cache/edge225/public/public-edge.json 与 public-edge.png。真实玩家原设备及登录枭熊房间未在本次验证中覆盖。

当前工作区 D:/Desktop/DND-card-web/local-dice-loading-224；证据 .cache/edge225，构建/发布包 .cache/release225。玩家重新加载整个枭熊房间以更换旧 worker；无需清除角色存储。
