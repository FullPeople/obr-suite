# 骰子相同内容贴图去重 · 本地候选

基线：`ca684455cef7decacb8bd0d5cffc011b77b500a3`。本候选只改同一个 renderer 或同一个 preview 初始化期间的字形 Texture 去重，不涉及发布、CI、合并或部署。

## 原因与范围

运行目录的 5 种材质 × 7 种骰子共 35 个材质条目，使用 19 个 PNG 路径。逐一读取本地 PNG、计算 SHA-256 并核对 `ASSET_LOCKS`，全部一致，实际只有 7 种二进制内容：

- d4、d6、d8、d10、d12、d_percentile 各有一组；每组包含 stage6_calibration、godot_blue_cat_eye、royal_ember_resin 三个同字节文件。
- d20 已由运行目录统一选择 stage6_calibration 的文件，只有一个路径。
- 旧路径缓存会为前六组各创建三个相同 Texture；本候选减少 12 个重复对象。

overlay 现有 RedFormat 的 2048 × 2048 Uint8Array 基础数组按源码计算为每张 4 MiB，19 张为 76 MiB、7 张为 28 MiB，理论减少 48 MiB。此为基础数组容量模型，不是浏览器进程内存或 GPU 驻留实测，也不代表初始化总占用减少同样数量。

## 安全边界

- 只用有效 64 位十六进制不可变资产锁作内容身份，无锁或未知锁回退到原路径。校验期间锁发生变化也回退路径，不按骰子种类、文件名、尺寸猜测相同内容。锁是本轮不可变 release 配置；这个变化检查只防误合并，不支持在 `DiceAssets` 已缓存 bytes 后热替换锁，原下载器也不会因此重新校验成功缓存。
- 每次 load(path) 先调用并等待现有 `DiceAssets.bytes(path)`，再查询内容缓存。因此每个实际路径仍经过原下载/完整性逻辑，不能用好文件的 Texture 绕过另一个路径的损坏、404 或未完成校验。下载路径数不从 19 降到 7；保留下载器本来的同路径缓存、重试和错误行为。
- 相同已验证内容并发只运行一次 decode 和公共 sampler 配置。失败 Promise 从局部缓存删除，可重试。
- 缓存属于单次 renderer/preview 初始化。不同 loader、iframe、WebGL context 之间不共享 Texture，没有模块级 Texture retainer。
- overlay 保留现有 `decodeGlyphTexture`/RedFormat；preview 保留 `createImageBitmap` + `T.Texture`/RGBA。分辨率、滤波、flipY、各 context 的 anisotropy 配置不变。
- 不改字节、材质、shader、目录、模型、几何、音效、物理、随机结果、预热或 ready 流程。
- `createDiceMaterial` / `instanceDiceMaterial` 只读取尺寸并闭包引用 mask，没有按材质修改 Texture。材质是借用方；材质 dispose 不释放共享 mask。本批不增加或重构 renderer/preview 生命周期清理 API。

## 验证

执行于 Node 24.19.0；复用已安装的锁定依赖，无包清单或锁文件变更。

- `node tools/dice-texture-dedup.mjs`：15 组检查通过。覆盖同字节正控、不同 hash/无锁/无效锁负控、每个 path 校验、等待 alias 校验、损坏 alias 的实际 3 次 SHA 拒绝及恢复、404 及恢复、并发 decode 失败恢复、同步配置失败恢复、校验期间锁变化、跨实例 sampler 隔离、实际资产 19→7、Three 材质引用及 dispose 所有权、两个生产调用点的 decode 路径。
- 实际 `DiceAssets` 读取测试提供的文件响应并核验锁；实际 Three 35 个 base material 和 35 个 instance 的 `onBeforeCompile` uniform 共引用 7 个 Texture，测试 decoder/configure 回调均调用 7 次。Node 用 PNG 头尺寸建立 Texture 测试对象，没有调用浏览器图像解码器、编译 shader 或创建 WebGL context。
- `tsc -p extensions/workbench-dice3d/tsconfig.json`、Suite `tsc --noEmit` 通过。
- `node tools/dice-loading224.mjs`：6 组原加载/恢复检查通过。
- `node tools/dice-pinned-assets.test.mjs`：6 组原锁定资产检查通过。
- `node tools/workbench-dice3d-selftest.mjs`：36 项核心检查通过。
- `node tools/workbench-dice-lifecycle-217.mjs`：18 项生命周期检查通过。
- `DND_DICE3D_OUT=<new absolute directory> node tools/build-workbench-dice3d-release.mjs`：overlay/preview 生产构建通过，59 项资产锁通过且 changes 为空。保留既有 >500 kB chunk 警告。
- `git diff --check` 通过。工具测试由仓库既有 rolldown→Node 流程运行；单独追加的工具文件 tsc 检查未运行成功，因为仓库没有安装 `@types/node`，不等同于上述两个产品 tsc 失败。

新回归完整结果、19 个资产文件 hash/大小/尺寸、7 组完整路径以及容量模型可复跑生成于 `.cache/dice-texture-dedup/results.json`。

未进行浏览器图像解码、WebGL 像素对比、GPU/进程内存或玩家设备实测；没有重试或绕过浏览器 socket EPERM 限制。这些结果只支持安全的内容身份去重与静态容量估算，不应表述为视觉或性能验收已通过。
