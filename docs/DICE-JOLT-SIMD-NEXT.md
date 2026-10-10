# 下一轮：同版本单线程 Jolt SIMD

核查日期：2026-10-10。本文件只记录后续实验依据，不属于 271 的产品、构建或发布变更。本轮未下载 SDK、构建引擎或执行性能测试。

当前锁定的 Jolt WASM **没有 SIMD 指令**。同版本单线程 SIMD 是值得优先试验的方向：它可以保持现有步长、碰撞精度与合法性判断，但是否更快、是否逐位等价，都还没有实测结论。不能据此承诺加速倍数或任何设备均在 0.3 秒内出骰。

## 已确认的实际制品

检查对象为 `extensions/workbench-dice3d/public/vendor/jolt-physics.wasm.wasm`，与当前 `vendor/lock.json` 一致。

| 项目 | 结果 |
| --- | --- |
| 包版本 | `jolt-physics@1.1.0` |
| WASM 大小 | 2,021,569 字节 |
| WASM SHA-256 | `65f044b2ec57be2bbf0f84828f3948d6f3f9e17942ad80aa98923b94dd292f90` |
| JS 大小 | 964,712 字节 |
| JS SHA-256 | `bcebc61c2a5db94f1b155b2ce1902667f952d9d63baa003b654e9e5d1ff20eb4` |
| 完整解码的函数体 | 5,061 |
| 完整解码的指令 | 898,359 |
| SIMD 指令 / v128 局部变量 | 0 / 0 |
| 未识别指令 | 0 |
| 函数体长度、结束边界校验 | 全部通过 |

核查使用静态 WASM 指令解码：逐段读取、解析局部变量，按指令规则跳过 LEB、内存参数、常量、跳转表及扩展指令的立即数，并验证每个函数体边界。没有运行或编译 WASM。代码区原始字节中虽然出现 99 次 `0xFD`，但都不在指令边界；不能把字节搜索当作 SIMD 检测。SIMD 使用 `0xFD` 指令前缀，须按语法解码判断。[WebAssembly 指令编码规范](https://webassembly.github.io/spec/core/binary/instructions.html#vector-instructions)

本结论补充 `U:/CodexWork/2026-10-10/dice-research270/physics/RESEARCH.md` 中“缺少 target_features 段不能推断 SIMD”的旧说明；本次依据是实际指令流。

## 官方版本、制品和构建入口

| 层次 | 固定值与核查依据 |
| --- | --- |
| 包装层 | `jrouwe/JoltPhysics.js`，标签 `1.1.0`，提交 `c9c122bcd48e92885fbee7d267c928c3781d581c`；npm 元数据的 gitHead 与 release 一致 |
| 原生核心 | `jrouwe/JoltPhysics`，标签 `v5.6.0`，提交 `e77f175595e64cb44218cc9d9d56fc365ad0e36a` |
| Emscripten | 上述包装层的 CI 固定 `6.0.2` |
| 构建平台 | 上游说明只验证过 Linux；下一轮优先独立 Linux 环境 |
| 目标 | `jolt-wasm`，生成配套 JS 与独立 WASM |

版本依据：[npm 1.1.0 元数据](https://registry.npmjs.org/jolt-physics/1.1.0)、[官方 release](https://github.com/jrouwe/JoltPhysics.js/releases/tag/1.1.0)、[核心标签指向](https://api.github.com/repos/jrouwe/JoltPhysics/git/ref/tags/v5.6.0)、[固定 SDK 脚本](https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/ci/install-emsdk.sh)。

**没有查到该版本的官方单线程 SIMD 现成制品。** 官方 npm 文件清单与 7 个入口仅提供单线程普通版本和多线程版本；已核对实际 27 个包内文件。GitHub release API 的二进制附件数组为空，页面的两项资源为源码压缩包。不能把多线程制品当成单线程直接替换。[官方发布清单](https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/package.json)、[release API](https://api.github.com/repos/jrouwe/JoltPhysics.js/releases/tags/1.1.0)

该版单线程默认 `ENABLE_SIMD=OFF`。打开后，包装层编译和链接加入 `-msimd128 -msse4.2`，并向核心设置 `USE_WASM_SIMD=ON`。保持 `ENABLE_MULTI_THREADING=OFF` 即可单独研究 SIMD；无须引入共享内存和线程池。`Distribution` 关闭调试分析，包装层使用 `-O3`，默认关闭 LTO、双精度和内存增长。[固定版本 CMake](https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/CMakeLists.txt)

上游 `build.sh` 会清理 dist，并构建多种单线程、多线程及调试产物。下一轮只在两个独立的临时源码目录构建 `jolt-wasm`，避免多余构建和两个候选覆盖同一个 dist。[固定版本构建脚本](https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/build.sh)

## 最小复现配置与资源边界

以下是下一轮待执行的配置，**本轮未执行**。准备两个相同提交的包装层目录、一份上述固定提交的核心目录。先启用 Emscripten 6.0.2 环境，再分别安装包装层 lockfile 中的 npm 依赖。`JOLT_CORE_SOURCE` 指向核心源码根目录，不能指向其 `Build` 子目录。

```sh
npm ci --no-audit --no-fund
mkdir -p dist
cmake -S . -B Build/SimdProbe \
  -DCMAKE_BUILD_TYPE=Distribution \
  -DENABLE_MULTI_THREADING=OFF \
  -DENABLE_SIMD=ON \
  -DBUILD_WASM_COMPAT_ONLY=OFF \
  -DDOUBLE_PRECISION=OFF \
  -DALLOW_MEMORY_GROWTH=OFF \
  -DCROSS_PLATFORM_DETERMINISTIC=OFF \
  -DFETCHCONTENT_SOURCE_DIR_JOLTPHYSICS="$JOLT_CORE_SOURCE"
cmake --build Build/SimdProbe --target jolt-wasm --parallel 2
```

标量对照在另一个干净目录运行相同配置，只把 `ENABLE_SIMD` 改成 `OFF`。记录完整编译器版本、CMakeCache、编译参数、两个源码提交及产物摘要。上述配置来自固定源码，尚未经过本项目的实际构建验证。`CROSS_PLATFORM_DETERMINISTIC` 第一组保持同为 OFF，避免同时改变两项条件；如需研究确定性开关，另做 OFF/ON × 标量/SIMD 对照。

构建工具包括 Git、Python 3、npm/Node、CMake 至少 3.20、POSIX shell 工具及 Emscripten 6.0.2；上游发布流程使用 Node 24。CMake 的核心最低版本高于包装层声明的 3.13，应取 3.20。SDK 下载量、两次构建所需磁盘及峰值内存没有实测，不能用运行时 128 MiB 初始线性内存代替构建需求。下一轮先核对空闲空间和 SDK 缓存，复用一套工具链，限制为 2 个编译任务，禁止在生产服务器构建。[核心构建要求](https://github.com/jrouwe/JoltPhysics/blob/e77f175595e64cb44218cc9d9d56fc365ad0e36a/Build/CMakeLists.txt)、[包装层发布流程](https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/.github/workflows/build-and-deploy.yml)

## JS 接口与确定性风险

SIMD 开关不更换 IDL，也不要求更换现有的物理调用接口；类型声明仍由同一 IDL 生成。实际的导出与初始化行为仍要检查，不能推导为已兼容。重建后必须使用配套 JS 和 WASM，不能把新 WASM 塞进旧 glue。产品当前在 `physics.worker.ts` 中先校验两份文件，再通过 `instantiateWasm` 使用已验证的字节，避免额外未锁定请求；候选必须保留这一流程，并分别更新候选摘要和缓存版本。[官方接口说明](https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/README.md)

官方确定性保证有“相同二进制、相同修改 API 顺序”等前提。换成 SIMD 就更换了二进制，不能自动认为轨迹相同。`CROSS_PLATFORM_DETERMINISTIC` 提供更严格的约束，上游提到约 8% 的一般性成本；这不是本项目的测量结果，也不是当前要直接启用的开关。[Jolt 5.6.0 确定性文档](https://github.com/jrouwe/JoltPhysics/blob/e77f175595e64cb44218cc9d9d56fc365ad0e36a/Docs/Architecture.md#deterministic-simulation)

核心中的标量和向量数学有不同实现，例如向量求和对有符号零的处理受确定性宏影响。因此即使使用相同种子，也要比较完整轨迹、接触记录和重算顺序，不能只核对最终点数。Emscripten 路径已经关闭浮点乘加收缩；继续保持，不添加 fast-math 或 relaxed SIMD。[向量实现](https://github.com/jrouwe/JoltPhysics/blob/e77f175595e64cb44218cc9d9d56fc365ad0e36a/Jolt/Math/Vec3.inl)、[浮点编译设置](https://github.com/jrouwe/JoltPhysics/blob/e77f175595e64cb44218cc9d9d56fc365ad0e36a/Build/CMakeLists.txt)

产品由权威端生成完整轨迹，其他端回放，并非每个客户端独立模拟。因此候选数学差异不等于已经发生房间不同步，但权威迁移、保留骰子、物理规则再投与快照恢复仍需验证。少量轨迹相等也不足以证明所有种子公平；本次不改变随机源、种子选择或失败重算顺序。

多线程不列入本实验。它增加共享内存、iframe 隔离与回调线程问题；此版本官方配置明确提示多线程与 JS 回调的兼容限制。单线程 SIMD 能先独立回答主要问题，无须把这些因素混在一起。[官方多线程选项](https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/CMakeLists.txt#L18)

## 下一轮实验与采用门槛

1. **先复现标量。** 固定两层源码及编译器，在隔离目录仅构建目标；比较新标量与当前锁定制品的行为。若不一致，先定位工具链或配置差异，不把差异全归于 SIMD。
2. **确认候选确有 SIMD。** 对新制品用官方工具反汇编或完整解码，同时核对 imports/exports、同步初始化钩子、配套 glue、内存设置和资源摘要。产物保留研究目录，不覆盖正式 vendor。
3. **先做完整行为对照。** 复用 `tools/dice-physics270-selftest.mjs` 的真实 Jolt、独立新进程和 Float32 位比较机制。现有 8 枚混合骰两个种子、19 枚三次预测、20d6 两个种子是起点；再覆盖全部骰型、d100 两个实体、奇偶结束步、保留骰子碰撞、规则再投、私密结果及权威迁移。种子集预先固定，不依据候选结果筛选案例。比较完整轨迹、接触、点数、失败原因、重算次数及顺序；仅排除实际计时字段。
4. **出现差异时停止“无损”结论。** 查明差异来自重编译、SIMD 运算或接口；必要时扩展严格确定性开关对照。若最终只能保持物理规则而不能逐位相等，应作为独立引擎版本评审，补做大样本合法性、结果分布和回放兼容验证，不能沿用当前等价优化结论。
5. **行为过关再测速度。** 串行进行随机交替的标量/SIMD 对照，区分下载、编译初始化、预热、引擎 Step、合法性处理和点击至实际首帧。保留 19 枚三次预测的慢案例；按预先固定的试次数报告中位数及尾部，不用一次最快值代表整体。覆盖 Chromium、Firefox、Safari 与较弱设备；不支持 SIMD 时需验证独立标量回退及其缓存，不能让旧 WebView 无法投骰。
6. **最后决定是否接入。** 同时考虑二进制大小、冷启动、峰值内存和完整房间协议。只有可重复收益且行为验收通过，才进入后续产品变更与发布；271 本轮保持不变。

已有隔离 Node 分段计时显示，19 枚三次预测中 Jolt Step 约占 83%～88%，JS 接触回调本体约占 2.6%。这是把引擎 SIMD 列为下一步优先项的本地证据，见 `U:/CodexWork/2026-10-10/dice-research270/physics/RESEARCH.md` 和对应 profile；它不是浏览器、真实房间或手机体验的验收结果。本轮只确认优化机会存在，没有测出其收益。
