# 182：连续资源修改的确认队列

## 已复现的两个 host 阻塞点

`tools/workbench-resource-182-selftest.mjs` 运行实际安装的 Owlbear SDK、生产 `background.ts` / `notices.ts`，通过两个 iframe 和模拟的 SDK 父窗口/HTTP 文档服务控制回应顺序。不是在线房间验收。

1. `resource` 持久化成功并发送通知后，仍在 `setTokens → projectRuntime → OBR.scene.items.updateItems` 等待 SDK 回应。即使父窗口已经应用 metadata，仅延迟该回应，也会占住全局 mutation queue。第二笔资源操作尚未执行。
2. `publishWorkbenchNotice` 已本地接收、远端广播已发出，但仍等待广播 SDK 回应；这也会占住同一个持久写队列。

两种修复前样本均为：首次修改已有通知，350 ms 的控制窗口内 ACK 数为 0、第二次通知不存在、持久值停留在第一次修改。等待时间由测试控制，可以任意延长。

修复前证据：

- `F:/CodexWork/2026-09-20/w-xu/workbench-resource-182-before/results.json`
- `F:/CodexWork/2026-09-20/w-xu/workbench-resource-182-notice-before/results.json`

Web 连点 `2 → 1 → 2` 时丢失第二次修改意图是另一条已复现的客户端原因，由 Web 侧单独修复。本修复没有将该问题归咎于 metadata，也没有放宽冲突检查。

## 修复边界

- 字符卡文档仍是运行状态权威。只有文档持久提交后才允许 ACK。
- 字符卡 token 投影使用独立的、每卡串行的 SDK 写队列；排队期间更新合并为最新已提交文档。没有并发发送同一卡的新旧投影。
- 开始投影时重读观察值；尚未并入文档的原生场景改动先交给 reconcile，不会被排队资源投影覆盖。写入回调继续检查 baseline 和 runtime 是否改变。
- 已提交修改的通知保留原 UUID、本地接收、隐私裁剪、渲染去重；不等待远端广播回应。广播失败保留带 noticeId 的诊断日志。
- `resource`、`stats`、完整 `save`、`condition` 的字符卡分支都经过同一非阻塞 `setTokens` 投影路径。库存原先已按 ledger 持久化确认并后台修复 card 投影；它的条件 token 投影同样使用此队列。
- 怪物运行状态没有字符卡权威文档，metadata 就是持久写入，因此仍等待 SDK 成功。怪物血量通知改为该写入成功之后发送。
- 生命条锁定等纯 metadata 操作仍等待 SDK。没有把未提交的写入报告为成功。

## 验证

`node tools/workbench-resource-182-selftest.mjs`：8 项通过。

- 同主机 `2 → 1 → 2` 两次各持久化、各通知一次。
- 两主机间晚到旧 full-metadata 投影不会恢复旧文档，也不会产生补偿性旧值写入。
- SDK token 回应仍被扣留时，两笔资源已持久化、ACK、通知；释放后 token 收敛至最新文档。
- 同一投影回应被扣留时，资源、HP、完整保存、状态四笔都能确认；释放后只更新到最新状态。
- SDK notice 回应仍被扣留时，两次资源操作都能确认并发出各自唯一通知。
- 怪物 metadata-only 操作不会提前确认。
- 原生场景资源编辑仍能进入权威文档。
- 排队投影期间的原生 HP 改动保留并正常合并。

额外定点回归：`workbench-runtime-176-selftest.mjs` 13 项通过；`workbench-notice-181-selftest.mjs` 7 项通过（包含通知重试、音效/展示去重、隐私降级、场景重开）。

完整 `workbench-notice-179-selftest.mjs` 32 项通过。该测试的音效断言原本在 DOM 出现后立即读取广播次数，而真实 renderer 先插入 DOM / ACK，再经过 rAF / timer 发送音效。持久 ACK 加快后，测试必须独立等待音效完成；仅将同一实际 renderer 的至少 5 次 `resourceToast` 广播检查改为最多 3 秒的轮询，未减少要求、未更改生产音效逻辑。其余准备法术、库存、状态转交、隐私与失败不播报检查均保留并通过。

最新实 SDK 模拟证据：`F:/CodexWork/2026-09-20/w-xu/workbench-resource-182/results.json`。包含生产源文件 SHA256、完整 ACK、广播与文档写入路径。未部署、未进入真实多人房间。


2026-09-24 主任务后续：本记录所述修改已合入无新增 Buff 的 1.0.182-dev 并完成部署，最终候选与公网核验结果见 Suite `docs/WORKBENCH_RELEASE_182.md`。上文未部署为子任务完成时状态；真实多人房间仍未验收。
