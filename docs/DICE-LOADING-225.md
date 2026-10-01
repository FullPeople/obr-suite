# 骰子加载最终补充 · 225

225 基于本轮已发布并验证的 224。224 已移除锁文件/目录的启动网络依赖、释放失败缓存，并部署骰子二进制专用压缩；原因、失败与恢复记录见 DICE-LOADING-224.md 和 RELEASE-DICE-LOADING-224-RESULT.md。

公网回测进一步发现：锁定的 jolt-physics 1.1.0 生成脚本根本不读取 wasmBinary 参数。原逻辑下载并检查带版本的 WASM 后，module.default 会通过内部 instantiateStreaming 再读取一次不带版本的 WASM。第二次请求既增加带宽，也绕过我们的超时、重试和完整性检查。源文件实际提供了 instantiateWasm 回调。

225 对已经完成 SHA-256 检查的 ArrayBuffer 调用 WebAssembly.compile，再通过该回调同步创建 WebAssembly.Instance。引擎直接使用这些已验证字节，不再发第二次 WASM 网络请求；不改 vendor、物理规则、房间协议或渲染表现。

验收使用真实 Edge 和正式构建：拦截并拒绝无版本的 WASM 请求，检查完整预热/投骰只下载一次带版本的 WASM，同时继续阻断三份启动 JSON。检查错误脚本恢复、持续错误拒绝、同 worker 失败后恢复以及完整 2d6+1d20+5 动画。结果与最终部署回执见 RELEASE-DICE-LOADING-225-RESULT.md。

工作区 D:/Desktop/DND-card-web/local-dice-loading-224，后续分支 codex/dice-loading-225。证据 .cache/edge225 与 .cache/release225；真实玩家原设备/登录枭熊房间仍需用户实际验收。
