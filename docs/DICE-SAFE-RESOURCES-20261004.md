# 骰子显示、资源与生命周期候选，2026-10-04

推荐分支：`fix/dice-safe-resources-20261004`。从本地组合 `ff335f79f3efb5a27dd0340c85042bef4306a449` 拆分；它与已推组合 `3d596cbf032ad2afac0451866e98e885418e27e9` 的 tree 相同（`6a2fcda83030d1bfcc0a41dd9d80a55771622780`）。245 父基线仍为 `308a7ccf0cb70794055ac75170bf112a36989993`，其中玩家加载与安全性能 `2e2ddb1` 保留。

## 当前范围

- 保留小屏 renderer/cue 适配、必要音频预热、验证后相同数字纹理共享。
- 保留 `a7242c5` 闲置生命周期与后续异步销毁防线，包含48项 dispose 边界回归。
- 移除新增 `inlineRollV1` / `inlineChunkV1` 的广告、能力字段、发送及接收快路。所有骰数、单片和多片均按245的 `offer → chunk[0..n-1] → chunks-done` 顺序进入现有队列。定向准备和迟到开播重试发送纯 manifest；丢片继续通过原 missing/chunk 修复。
- 保留与快路独立的正确性修复：peer restart 后 outgoing 身份守卫与群体取消、重复 manifest 的 total/bytes 检查、仅新数据片刷新进度时间，以及所有异步销毁守卫。原 `sendTimed` 开播时钟、ACK不确定性处理、权限、权威结果、准备门槛与旧骰落稳碰撞下界均保留。

除 `controller.ts` 和 `types.ts` 的协议撤出外，生产源码与上述组合 tree 相同。未包含 dirty-clear、ground-cache、ground-mask 或多区域重复绘制等被否决渲染实验。

## 为什么拆分

组合候选的9骰软件GL配对观察不支持宣称已达到稳定加速：portrait 首次CPU路径约快78ms，但P95约400ms变为433/450ms；landscape 首次CPU路径约慢168/175ms。测量包含多个变化，不能据此归因 inline 协议，也不能排除产品退化。因此把尚未证明收益的小骰新传输协议从推荐范围移出；原组合实验与证据留在原分支。

[小骰协议目标](DICE-SMALL-ROLL-TARGET-20261004.md)与[夜间组合候选](DICE-SMALL-RESOURCE-NIGHT-20261004.md)记录的是先前实验，其 inline 生效与队列节省描述不代表本分支当前行为。

## 验证与边界

`tools/dice-small-inline-selftest.mjs` 沿用历史文件名以保留现有 aggregate/CI 调用；其断言已改为32项现行队列回归，包含1/2/5/9/10骰单/多片、旧端兼容、权限与结果拒绝、重试、restart/group取消、重复进度和丢片恢复。未把 inline 正向性能断言作为当前通过条件。

本地 focused 全部通过：当前协议32、dispose48、闲置生命周期18、timeout23513、时钟27、3D核心36、原生命周期18、群体32项；真实生产发送队列的 warm/rate-retry/unknown-start/slow-ack 四种虚拟传输场景通过。3D TypeScript 与 diff whitespace 检查通过。全量与浏览器 CI 尚由集成任务按最终精确提交执行。Node 测试使用实际 Controller/codec 和模拟网络、物理、renderer 边界，不等于浏览器像素、手机、平板或真实房间验收。本地 browser socket EPERM 未绕过。没有零延迟、无性能风险或实机已验的结论。

用户仅授权推送和 CI；合并与部署由用户自行执行。
