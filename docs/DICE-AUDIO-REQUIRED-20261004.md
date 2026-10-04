# 骰子启动音频依赖精简，本地候选

基线：`308a7ccf0cb70794055ac75170bf112a36989993`。本候选仅本地实现与验证；未推送、合并或部署，也未验收真实手机/平板或多人房间。

## 已确认的依赖

- `renderer.audioPlan()` 当前始终返回 `stinger:null`；普通、公式、多人及回放最终沿用该音频计划，公式覆盖仅追加 `rules`。
- `cue.ts` 明确不使用 tension / natural-1 / natural-20 戏剧提示。tension 无播放调用；natural 提示仅由 `audio-mixer.tick()` 在显式非空 stinger 计划下调用。
- 碰撞、滚动、结果落点和强调仍需主题音频。max/min 规则声音仍由 `rule-sound.ts` 合成，未更改。
- 保留运行目录全部 5 种主题的必要音频预加载。房间 READY 代表能立即接收其他参与者选择的主题，只预加载本地所选主题会改变该协议，需要另行设计，不能直接削减。

## 修改

1. `DiceAudio.load()` 保留默认十 WAV 严格契约；新增 `loadRequired()` 仅加载六种碰撞强度/表面组合与 rolling。
2. Mixer 当前预热全部主题的必要声音。未来显式 stinger 计划通过 `loadStinger()` 在准备/释放阶段等待所选提示，不在播放 tick 中异步拉取，不后台预取未使用文件。
3. 失败的下载/解码、主题及 mixer Promise 缓存会移除，允许新的明确加载尝试；失败不会被当作 READY。失败的 overlay 挂载不会因单独重试 mixer 而自动发布 READY，仍须正常重新挂载/重开。
4. 释放代次阻止慢加载恢复已暂停或删除的轨道；重复释放幂等；等待期间的 retime 更新目标时间并淘汰旧释放。
5. Overlay 进度仅列实际启动必需资源，仍同时等待视觉和必要音频，未先显示画面再补声音。

## 准备状态的含义

- 视觉准备：`renderer.init()` 完成。
- 音频资产准备：全部当前主题的必要音频已下载并解码。
- `overlay-ready`：以上两个条件都完成。任一必要声音失败即拒绝完成；音量为 0 也不绕过。
- 浏览器已解锁声音是另一个条件，仍需要既有用户手势/`resume()`；资产解码完成不表示 AudioContext 已 running。

未来显式 stinger 的兼容钩子不会保证慢下载时声音仍准时出现：现有晚于提示时间 120ms 的抑制策略保持不变。若未来恢复这些效果，调用方需在视觉释放前完成提示预加载/就绪协调；不能把本候选的钩子当作完整的新视觉音频协议。当前生产计划始终为 null，因此无新增首次投骰缺声路径。

## 量化

运行目录包含共享文件，因此按唯一 URL 去重：

- 音频启动请求依赖：22 → 13，移除 9 个未使用的 tension/natural 文件。
- Overlay 启动计划：49 → 40 个唯一资源。
- 原全部音频编码文件：1,557,518 字节。
- 保留必要音频：428,162 字节。
- 从当前启动路径移除：1,129,356 字节，约 72.5% 音频编码字节。

这些是请求依赖与文件字节统计，**不是启动延迟减少 72.5%**。没有证据指认线上 46/49 时究竟是哪三个 URL 卡住，也没有本候选真实网络、浏览器或设备加速测量。

## 验证

`node tools/dice-audio-warmup-selftest.mjs` 运行生产 audio、mixer、audio-host、overlay 代码，Web Audio、DOM、WebGL 边界使用可控替身。测试包含每一个必要 URL 的慢/失败状态、其他主题、零音量、解码失败缓存重试、严格十文件接口、显式提示、失败/迟到提示、暂停/删除/替换/重复释放、等待中 retime、碰撞/滚动/结果/强调/合成规则音频、overlay 双重就绪门槛与无未处理 Promise 拒绝。

- 最终候选：21/21 通过。
- `DICE_AUDIO_BASELINE=308a7cc` 注入不可变基线生产文件：9/21 通过、12/21 预期失败；慢未使用文件阻塞及失败缓存/生命周期问题可复现。基线在同时间 retime 时停止/替换声音，候选则直接不变；两者均需保证活跃声音不重复。
- 骰子 TypeScript 检查通过。
- 原有骰子核心 36 项与固定资产 6 项通过。
- 生产骰子构建通过，59 个锁定资产校验无变化；只有既有大 chunk 提示。
- 未尝试绕过当前环境的浏览器/socket 限制。无真实声音设备、GPU 帧或手机时延验收结论。

可重复命令：

```sh
DICE_AUDIO_BASELINE=308a7cc DND_DICE_EVIDENCE=.cache/dice-audio-red node tools/dice-audio-warmup-selftest.mjs
DND_DICE_EVIDENCE=.cache/dice-audio-green node tools/dice-audio-warmup-selftest.mjs
node node_modules/typescript/bin/tsc -p extensions/workbench-dice3d/tsconfig.json
node tools/workbench-dice3d-selftest.mjs
node tools/dice-pinned-assets.test.mjs
DND_DICE3D_OUT=/absolute/new/output node tools/build-workbench-dice3d-release.mjs
```

本地详细结果：`.cache/dice-audio-{red,green}/result.json` 和 `.cache/dice-audio-validation/*.log`。测试工具同时记录字节与资源计划数，最终以可重复测试输出为准。
