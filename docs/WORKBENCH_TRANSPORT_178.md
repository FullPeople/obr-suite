# 178 浏览器直连与骰子路径验证

记录时间：2026-09-23。开发候选；以下数据不是实际 Owlbear 多人房间验收。

## 已确认的区别

浏览器标签页和独立窗口都可以使用 `postMessage`。是否有可用窗口引用才是区别，窗口外观不是区别。177 已经有本地 `postMessage` 通道，因此“改成子窗口”本身不会让已有直连更快。

177 launcher 的原生链接由短命的 action iframe 打开，`window.opener` 指向该 iframe。初次连接可以发现同一房间的 background iframe；action 关闭不影响已拿到的 background 引用。但是整个枭熊页面刷新会销毁 background iframe，而 action iframe 也早已销毁，旧页面不能再从 opener 找到新 background，只能退回网络通道。

178 左键保持普通命名标签页（不传 popup 窗口特性），同时保存房间顶层 WindowProxy 作为当前 workbench 文档的 opener。这样，workbench 页面保持打开时，可以在枭熊整个页面刷新后重新发现新的 background。链接和右键菜单依旧保留。

这是当前文档的引用，不是永久更换浏览器底层 opener 关系。根据 WHATWG，非 null 的 opener setter 定义当前 Window 的属性；workbench 自身刷新也会丢失该属性。两端同时完整刷新、复制链接、浏览器 noopener 打开，都必须保留网络回退，不能宣称始终本地直连。

## 浏览器原型数据

`node tools/workbench-178-bridge-selftest.mjs`

真实 Edge 153，`localhost` 顶层房间内嵌 `127.0.0.1` 的两个 sandbox iframe；使用实际编译 launcher，模拟关闭 action、完整刷新房间和 workbench。此测试不替代真实 Owlbear 的 SDK、角色数据和权限测试。

| 浏览器消息往返，150 次 | 中位数 | P95 | 最大 |
| --- | ---: | ---: | ---: |
| 原 launcher，首次直连 | 0.10 ms | 0.30 ms | 0.50 ms |
| 178 launcher，首次直连 | 0.10 ms | 0.20 ms | 0.40 ms |

原 launcher 整页刷新房间后无法恢复直连；178 可以。两页都重载后，单靠该 launcher 修正仍不能恢复直连，此限制已明确作为测试结果保留。

## 骰子业务路径

SDK getter 本身经过 iframe RPC，不能当作内存属性反复使用。dice-rpc 和骰子宿主入口从事件驱动的 `workbenchObservation` 读取玩家、权限、棋子和队友快照；实际广播与修改仍经过 SDK。已经授权的当前 target 不再重复 access；不同棋子仍强制做权限检查。

宿主构造 `QuickRollIdentity` 给原有骰子引擎，省掉同一投骰里串行读取玩家 ID、姓名、颜色；不接受客户端自己声明身份。legacy 调用不传该上下文，原流程保留。外观读取与世界坐标读取并发开始，开发版 rollId 去重后不再先关闭一个不存在的骰子 modal。

`node tools/workbench-178-dice-selftest.mjs`：预热后 20 次真实投骰 handler 调用没有新增玩家、队友、棋子 SDK getter；同 target 不重复验证，不同 target 被拒绝；SDK 玩家降权事件后隐藏投骰和固定结果权限均被拒绝。handler 中位数 0 ms、P95 2.7 ms，只表示无多余等待；不把 mock 广播时间当作场上动画出现时间。

## 备选科研：无 opener 的本机 DataChannel

`node tools/workbench-178-datachannel-research.mjs` 是独立原型，未集成生产同步协议。跨站 sandbox 宿主与无 opener 的独立标签页可以通过 WebRTC DataChannel 建立本机直接通道，仅用 HTTP 交换 SDP；不使用外部 STUN/TURN。HTTP 信令每次加 40 ms 延迟，实测建链 320 ms。

| DataChannel 往返 | 中位数 | P95 | 最大 |
| --- | ---: | ---: | ---: |
| 小消息，150 次 | 0.70 ms | 2.00 ms | 34.10 ms |
| 16 KB 消息，30 次 | 2.70 ms | 3.70 ms | 4.60 ms |

180 条业务消息期间 HTTP 请求为 0，候选为 host/UDP。这证明右键或复制标签页也有不依赖 opener 的低延迟技术路径，但生产实现仍要处理认证信令、刷新代际、重复回执、消息分块（本次协商上限 262144 字节）、缓冲背压和浏览器禁用 UDP 时的回退。不能用 DataChannel 掩盖业务内部重复 RPC 或持久化队列问题。

## 浏览器依据

- [WHATWG：跨源 Window 可访问属性](https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginproperties)：包括 top、parent、frames、postMessage。
- [WHATWG：opener setter](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-opener)：非 null 赋值的文档生命周期边界。
- [MDN：postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)：身份须验证 origin/source，并使用明确 target origin。
- [MDN：BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)：同源但不同顶层站点的存储分区不同，不能用 BroadcastChannel 假定跨 iframe/独立页可通信。
- [MDN：RTCDataChannel](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel)：任意双向点对点数据，独立于页面 opener。
- [Owlbear：扩展架构](https://docs.owlbear.rodeo/extensions/getting-started/)：action/popover 嵌入为 iframe。
