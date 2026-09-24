# 179 本地：场景反馈、头像与状态操作

本文件记录本地修改，不代表已经部署或通过真实枭熊房间验收。

## 已实现

- 鸣谢字幕保持原捐助金额字号曲线，改为四条上方轨道、最多 16 个轮转槽位、150 px/s 从右向左。按前一名字的实际宽度保持间隔，设置关闭立即清除。网页字幕移除旧居中暗影和星点背景。
- 绑定角色的最新棋子 image URL 放在临时 `Target.tokenPortrait`，不写进角色 JSON、不同步图片字节。角色未自定义头像时即时显示该 URL；已有自定义头像与独立立绘优先且不受影响。
- 通知补齐此前根本未发出的生命值 / 临时生命 / AC 和状态变化。原资源、背包、转移、法术准备通知继续保留。保留 DM 不提示消息开关和上锁内容隐去细节。
- 上锁内容发往 REMOTE 的通知在发送前重建为最小摘要；不包含隐藏角色 / 物品 / 资源的名称、标识、数值、owner 列表或嵌套正文。授权本机可看完整通知，其他连接（包括同一 owner 的另一端）只收摘要；其详细角色数据仍从既有权限读取路径获得。状态摘要使用操作者名字，不暴露隐藏角色名。
- 透明通知层按需打开并在显示结束后关闭；SDK `disablePointerEvents` 和 DOM `pointer-events:none` 同时生效。送达 / ACK 带 iframe 实例标识，真正首帧绘制后确认；旧 iframe 不能误吞新通知。实际房间中“全部无提示”尚无完整客户端诊断，不能把这些修补等同于已证明所有线上原因。
- 总览状态 `condition` 命令沿现有角色 JSON / 怪物 metadata 权威修改，无新状态仓库或假库存格。添加、移除、跨卡转交、合并重复状态、撤销 / 重做都有明确的单字段历史。旧库存授予的对应状态通过原 `syncNative` 退役，防止随后投影使其复活。
- 源端移除须可写；可见且未锁目标可接收单条状态给予。给予不会授予普通修改目标卡的权限；其历史只能逆转该次请求实际修改的那条字段。
- 跨两张角色卡不是数据库原子事务：先写目标，再移除源。确定失败时仅在指定字段仍匹配的情况下撤回本次已完成的写入；提交结果未知或回滚冲突时返回 `CONDITION_TRANSFER_PARTIAL`，保留诊断并要求核对，不盲目重放或回退整卡。
- 旧库存授予的退役与角色文档仍是两步提交。若库存已提交但随后角色写入失败，返回 `uncertain:true` 与 `CONDITION_GRANT_PARTIAL`，记录 phase、ledgerRevision、itemId、conditionId 和已提交部分；转交时保留此原因且不盲目撤回目标卡。实际库存提交标记来自 `syncNative.ledgerCommitted`，仅仅读到 ledgerRevision 不代表提交。没有库存修改时的明确 4xx 拒绝依旧是普通失败。

## 骰子记录真实拖动缺陷

Dev 用 `setupWorkbenchDice` 替换旧模块后漏接了关闭、拖动完成及重置广播。补接这些生命周期事件后，实际 Pointer Events 回归仍失败：浏览器在新预览 iframe 挂载后继续把 mouseup 交给源 iframe，旧 `bindPanelDrag` 将正常松手错当为提前取消。

现在源 grip 捕获并转发实际 move/up；预览同时接收原生输入与源帧转发，用 gestureId 去重。真实房间 shell 与测试共用 `panelDragHost.ts`；宿主缓冲预览未就绪的最终坐标，快速松手仍能完成，取消 / 关闭与异步打开竞态不会遗留透明阻挡层。空记录同样能关闭。

## 验证与边界

- `tools/workbench-condition-179-selftest.mjs`：14 项事务 / 权限 / 故障验证。覆盖目标已有相同状态、undo 保留目标原状态、明确失败补偿、未知写结果不盲目补偿、部分库存提交诊断和转交保留已确认目标、单状态给予权限、旧历史拒绝覆盖变化、头像仅引用 HTTP(S) URL。
- `tools/workbench-notice-179-selftest.mjs`：32 项浏览器整链检查。使用真实 Suite controller、真实 toast DOM、HTTP CAS 服务和具有真实 Immer draft 语义的 SDK fixture；覆盖玩家给予 / 禁止任意删他人状态 / grant 撤销、native 与 legacy 卡转交、怪物 metadata、生命值、库存、法术准备与取消、隐私、拒绝失败保存的成功提示、最新棋子 URL。新增明确 400 拒绝的四项检查：无库存授予的 condition / 普通 save 不误报提交，存在已退役库存授予时报告部分提交，并验证磁盘库存已改变而角色文档保持原值。
- `tools/workbench-scene-179-selftest.mjs`：12 项真实 DOM / Pointer Events 检查。真实 grip pointerdown → 真实 preview move/up → 偏移持久化 → popover 新坐标；另测预览晚挂载 250ms 的快速松手、× 关闭、关闭后 reset 不重开、场景点击穿过可见通知、过期 iframe 拒收、REMOTE 私有通知发送边界、字幕同时超过六条和即时停止。
- 最终本地构建后的 `tools/workbench-168-selftest.mjs`：89 项整链检查通过、19 次角色保存；涵盖 DM / 玩家权限、设置、音乐、三龙牌、规则隔离、库存投影 503 故障恢复、状态移除 / 撤销、无棋子空白卡与重新加载。旧断言按现行契约更新为真实 hover 后点隐藏锁按钮、真实 503 投影失败（不依赖已取消的同步 warning 字段）、骰窗点遮罩关闭、真实 PLAYER 事件、纯名字角色标签及玩家规则摘要；权限与持久化检查保留。
- 完整回归迭代中出现过一次 Wiki 状态重新添加后 5 秒未写入的超时；同一点在随后三轮正常，尚无足够证据解释该次超时，不计为已解决原因。条件测试现保留失败时最近消息与场景数据诊断；网页另有 ACK 边界压力验证记录。
- 截图：`F:/CodexWork/2026-09-20/w-xu/scene179/notice-history.png`、`supporters.png`。真实拖动事件链：同目录 `drag-events.json`。
- 以上均不是登录真实枭熊服务的双玩家实机验收；没有进行部署。

SDK 约束核对：[Modal disablePointerEvents](https://docs.owlbear.rodeo/extensions/apis/modal/)、[Broadcast LOCAL / REMOTE 与 connectionId](https://docs.owlbear.rodeo/extensions/apis/broadcast/)。
