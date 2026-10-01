# Edge 骰子启动 JSON 超时修复 · 224

日期：2026-10-01（Asia/Shanghai）。延续用户的修复并部署授权。调查时线上已推进至 Suite 223；基线为发布回执对应的 2d9769dbedbe3e26a55d276b4b7113b7c5e91e9c，隔离工作区为 D:/Desktop/DND-card-web/local-dice-loading-224。保留 223 已合入的资源仪表盘、历史和职业自动化集成。

## 原因与边界

玩家错误发生于 physics-warmup 的 vendor/lock.json 下载：30 秒无数据触发 AbortController，三次失败后显示 E_DICE_JSON / E_DICE_ASSET。427 字节锁文件成为物理引擎的前置网络依赖。服务器检查当时该文件返回 HTTP 200，约 0.48 秒；访问日志也存在重复请求与客户端断开，无法据此确定玩家链路停顿的具体环节。

旧生产 worker physics.worker-BuRNiADO.js 在实际 Microsoft Edge 中注入锁文件请求停滞后，复现与玩家逐字符相同的错误：`attempt=3/3: AbortError: signal is aborted without reason`。测试仅将 worker 的 30 秒超时缩短至 50 ms；请求、解析和重试路径仍为旧正式产物。同 worker 再次 warmup 立即返回原错误，未发新请求，证实初始化 Promise 缓存了失败。

## 实现

- vendor 锁、资产散列清单和骰子目录直接编入带内容散列的程序。控制器、物理引擎、覆盖层、音频和皮肤预览不再下载这三份启动 JSON；每个调用者取得独立目录副本。
- 下载器默认携带完整锁表，继续检查引擎、WASM、模型、贴图和音频，构建/打包继续核对全部 59 个锁定文件。错误字节仍拒绝，不降低校验。
- 失败的资产 Promise 从缓存删除；引擎初始化失败释放 memoized Promise，同一个实例可以重试恢复。成功缓存及并发去重保留。
- 资源版本更新为 dice-assets-224，通信协议仍为 suite-3d-3。超时报告区分响应头与文件数据，并明确 30 秒无数据，避免无原因 AbortError。仍有三次有界下载预算。

## 本机验证

- Suite 与骰子 TypeScript 通过；生产构建输出 259 文件、52 根 HTML，1053 个静态引用与 59 项资产锁通过。
- 6 项新加载器恢复/超时/损坏检查、6 项真实资产完整性、36 项骰子核心、6 项发送限流队列、9 项提交桥、5 项生命周期、10 项加载门禁通过。
- 实际 Edge 正式产物：阻断三份启动 JSON 地址，调用次数保持 0；仍完成真实 Jolt/WASM/WebGL、2d6+1d20+5 的 6、5、16 / 总数 32 及完整动画，浏览器错误 0。
- 实际 Edge 错误 CRLF 脚本恢复、持续错误三次拒绝，以及同 worker 在失败后恢复真实物理引擎均通过。

可复跑脚本：tools/dice-loading224-baseline.mjs、dice-loading224.mjs、dice-loading224-production.mjs。证据位于 .cache/edge224，构建及源码散列位于 .cache/release224。最终部署、双端回归与公网结果以后续发布回执为准。真实玩家原设备与登录枭熊房间不在这些夹具验证范围内。
