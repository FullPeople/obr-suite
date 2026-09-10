# 玩家鼠标与平滑跟随：界定与小范围实验

日期：2026-09-08。规范目录 `U:\枭熊插件\obr-suite`。本轮只新增研究文档和独立 `tools/cursor-follow-probe.mjs`，没有接线、修改旧 follow、音乐板或 SDK，没有连接实际 Owlbear 房间。以下将公开接口事实、实验观察和产品建议分开。

后续已实现主动共享指针，见 [模块说明](../../src/modules/sharedPointer/README.md) 和 [第九批验证](../IMPLEMENTATION_PROGRESS_20260908.md)。下文的 12 Hz 合成预算和 Interaction 建议属于原型研究；实际接线采用 10 Hz 广播与本地图元，不能混作同一测试结果。

## 推荐决定

| 需求 | 当前判断 | 最小可用行为 |
| --- | --- | --- |
| 所有原生工具下持续显示每个人的鼠标 | 当前公开接口不足，不能承诺 | 保留为平台能力缺口；不盖透明捕获层、不抢占其他工具 |
| 玩家按需向队友指示地图位置 | 值得做小原型 | 可选共享指示工具，用原生 Pointer + Interaction；松手/停留/切工具后消失 |
| 一般移动时共享悬停位置 | 有条件可行 | 可选“共享移动”模式，把拖动交还默认 Move；拖动期间是否仍提供指针事件须真房间验证 |
| 坐骑、挂件、编组保持偏移一起移动 | 最值得先验证 | 一次右键绑定，之后使用原生拖动；采用 attachment，解除保持当前位置 |
| 宠物延迟沿路、绕墙追随 | 独立难题，暂不恢复旧模块 | 先限定目标放手后追随，单执行端、按距离计时、明确取消；完整拖动轨迹/寻路另验 |

**暂不值得独立插件。** 独立安装不能获得全局指针接口，也不能消除隐藏 iframe 的计时限制；这些功能不需要单独 action 页面。Suite 内可选工具/右键已能承载可行部分，额外安装会增加维护和玩家操作。

## 核实的公开边界

本地安装及本次读取的[官方 SDK package.json](https://raw.githubusercontent.com/owlbear-rodeo/sdk/main/package.json)均为 **3.1.0**。以下不把公开 `main` 等同于 Owlbear 宿主内部实现。

1. **指针事件按模式分派。** `ToolMode` 激活才接收 `onToolMove` 等事件；`ToolCursor` 只是 CSS 光标形状。`preventDrag` 可将匹配拖动交给默认 Move，点击可保留默认选择。没有文档保证这时仍转发拖动中的坐标。[Tool API](https://docs.owlbear.rodeo/extensions/apis/tool/)
2. 本地 `node_modules/@owlbear-rodeo/sdk/lib/types/Player.d.ts:2` 只有身份、角色、选择、名字、颜色、syncView、metadata；`lib/index.d.ts` 未提供全局 pointer/cursor API。`lib/api/ToolApi.js:107` 根据宿主消息的 mode ID 查找已注册回调。监听 tool-change 只能知道工具变更，不能由此得到地图指针。
3. **Pointer 是图元，不是鼠标读取器。** 它是带运动轨迹的圆点。官方 Interaction 示例将当前模式的事件坐标交给 `buildPointer()`；这支持“共享指示”的绘制路径，不支持读取别人使用原生工具时的鼠标。[Pointer](https://docs.owlbear.rodeo/extensions/reference/items/pointer/)、[官方指示器示例](https://docs.owlbear.rodeo/extensions/apis/interaction/#startiteminteraction)
4. **坐标须实测校准。** Tool 文档把 `pointerPosition` 描述为相对于 viewport，官方画线/Pointer 示例却直接作为图元坐标。不能凭名称再次套 inverseTransformPoint。真房间应在平移、缩放 0.5/1/2 倍后比较事件坐标、目标 item.position、转换前后标记，确定一次且仅一次转换。[官方画线教程](https://docs.owlbear.rodeo/extensions/tutorial-custom-tool/implement-the-line-mode/)
5. **没有原生拖动轨迹订阅保证。** `scene.items.onChange` 返回全场快照，公开签名没有 drag-progress/interaction-progress 订阅。旧模块注释说它只在提交时触发，这属于旧实现观察，不能升级成新宿主的绝对保证。公开文档不足以保证 getItems 能读取原生拖动的逐帧临时位置。[Items API](https://docs.owlbear.rodeo/extensions/apis/scene/items/)
6. **原生挂接已有产品入口。** Images 的 Attach/Detach 与坐骑上放角色都支持建立关系；Item 有 attachedTo 和可关闭的继承行为。它适合一起移动，未提供队列路径、延迟距离、避障或寻路。[Images](https://docs.owlbear.rodeo/docs/images/)、[Item](https://docs.owlbear.rodeo/extensions/reference/items/item/)
7. **Interaction 解决输出平滑，不提供目标轨迹或寻路。** 宿主会低频采样网络快照并在接收端插值；单次交互 30 秒后不再发送网络更新。快速渲染路径跳过层级处理，不能假定只给父 token 做 interaction 就自动动画整个 attachment 树。可传多个 item，但原生拖动父子行为与自定义父对象 interaction 必须分别验证。[Interaction API](https://docs.owlbear.rodeo/extensions/apis/interaction/)
8. **停止不是持久化承诺。** SDK dispatcher 只发 start/update/stop 消息；官方画线教程在结束时明确 addItems，再 stop。对现有 token 的最终位置应使用明确受权限/代际保护的 updateItems，不依赖旧 follow 注释“stop 会提交”的推断。

## 实验：执行的是实际 SDK，宿主边界是替身

运行 `node tools/cursor-follow-probe.mjs`。脚本把安装包的 ToolApi、InteractionApi、PointerBuilder 原实现打包，只有 MessageBus 换成记录器；随后执行真实 Chrome 双端口父页/iframe 检查。它不安装试验扩展、不写实际场景。当前基线为 SDK 3.1.0 的行为刻画；升级 SDK 后某些既有缺陷断言可能需要重审，不能据此退回新版修复。

本次结果：`C:\Users\admin\AppData\Local\Temp\cursor-follow-probe-S16kWb\results.json`，Chrome `152.0.7977.77`。

| 检查 | 观察 | 能证明的范围 |
| --- | --- | --- |
| 给非注册原生模式 ID 发消息 | 自定义回调 0 次；给注册 ID 后 1 次 | SDK 按 ID 分派，不证明替身具有宿主实际工具规则 |
| 默认点击/拖动设置 | 默认选择请求发出，preventDrag 原样提交 | 不等于已验默认 Move 的框选、触屏、旋转、吸附 |
| 删除模式后注入迟到消息 | 原始回调仍被触发；自己的启用代际能拒绝副作用 | 安装 SDK 的清理不能代替业务生命周期守卫 |
| 120 次移动 + 120 次无变化更新 | 120 条位置更新 + 120 条空 patches 消息 | SDK-to-host IPC，不是 240 个公网数据包 |
| stop 后再次 update | SDK 仍发送更新消息 | 调用方必须取消定时器和失效回调 |
| 8 个对象，30 Hz，10 秒 | 分开 2400 条/386192 JSON bytes；组合 300 条/185192 bytes | 一次多对象交互减少 IPC；未测宿主帧率或网络压缩 |
| 实际浏览器父页移动与点击 | 地图收到 21 次 move、1 次 click；两个 iframe move 都为 0 | 小面板/后台无法顺便捕获父页地图指针 |
| 实际浏览器权限与自身输入 | iframe 读取跨源 parent.document 被拒；鼠标进面板后仅面板收到事件 | 同源策略与文档输入隔离；没有地图遮挡层 |
| 隐藏 iframe 短时计时 | rAF 1 次、interval 55 次 | 只说明本次短时行为，不承诺隐藏标签页 60 FPS |

其中 removeMode 是一个**已核实 SDK 源码问题**：安装包 `lib/api/ToolApi.js:289-293` 和[官方 ToolApi.ts](https://raw.githubusercontent.com/owlbear-rodeo/sdk/main/src/api/ToolApi.ts)的 removeMode 删除 `this.tools[id]`，留下 `toolModes` 回调。通常宿主移除后不会再发新事件；但已经在途的消息仍应被自己的 `enabled + generation + scene` 守卫拦截。本轮未修改依赖，也未向外部仓库发送 issue。

原始 Interaction 源码 `lib/api/InteractionApi.js:16-31` 同样不抑制空 patches、不把 stop 后 dispatcher 设为失效。[官方 InteractionApi.ts](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/InteractionApi.ts)可对照。因此静止时不能持续调用 update，任务结束必须清掉生产者。

浏览器父子文档不能跨源直接取 DOM；已有面板事件也不会冒泡成为地图事件。[MDN 同源策略](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)。隐藏页面的 setInterval 也可能被限流，不能用它替换 rAF 就宣布稳定 60 FPS。[Chrome 定时器说明](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/)

## 建议的操作与预算（目标，不是已测平台上限）

**共享指示第一步：** 用原生 Pointer + Interaction 做按需共享。一次选择工具，随后直接指示；切工具、取消、失焦、切场景或停止移动后结束，持续运动在 25 秒前受代际保护地续建。默认保留当前玩家颜色；姓名如需额外图元，另测成本。不重复把轨迹写到 scene metadata 或 undo 栈，不把原生 Pointer 的尾迹描述为“始终可见的完整玩家鼠标”。

“共享移动”仅作为后续条件方案：独立可选 ToolMode、默认选择/拖动交给 Move；不自动抢回工具，也不拦绘图、量尺、迷雾。若实测原生拖动期间不给模式坐标，就明确只在悬停时共享或退回按需指示，不能靠全屏透明 iframe 补齐。

如果未来确需接收端各自隐藏姓名/指针，可考虑 Broadcast + scene.local 图元。建议每发送者最多 12 Hz、只保留最新未发点、最多一项在途发送、停留后过期隐藏。消息使用 SDK connectionId 验身份，名字颜色从 party 获取，携带场景实例及序号，丢弃旧场景/乱序，晚到不重放历史轨迹。[Broadcast 的身份与临时消息能力](https://docs.owlbear.rodeo/extensions/apis/broadcast/)

独立合成预算实验把 10 秒内 1250 个输入样本降到 120 次发送/7007 payload bytes；120 ms 异步延迟下发送 85 次/4962 bytes，未发队列始终 1 项，移动结束排空后为 0。这只验证设计可有界，未测实际 OBR 网络。实际目标按每包 <=160 bytes、12 Hz 估算每人 <=1.92 KB/s；8 人每客户端最多接收其他 7 人约 13.44 KB/s，均不含 SDK/传输封装。接收绘制应批量、至多 30 Hz、停止后零更新；超过 8 个持续光标先降频，不能无限增加循环。

**同移第一步：** 一次“与目标一起移动”绑定 attachment，保持当前 world position；只做平移的模式可关闭 SCALE/ROTATION 继承。保留 VISIBLE 继承，避免目标隐藏后泄露挂件；宠物模式应考虑关闭 DELETE，避免误删。建立前检查已有父关系、循环、对象权限；不要覆盖别的扩展已有 attachment。解绑保持当前世界位置，恢复旧属性前核对关系仍由自己拥有。持久成本应为绑定/解除各一批提交，移动中 Suite 不另做每帧跟随写入。

**宠物追随后续：** 一次绑定，目标提交移动后，唯一有权限的执行端规划；手动移动宠物、目标再次移动、解除、门墙变化、场景/角色变化均取消旧任务。按路径真实长度/速度计时，动画期间不写永久坐标，结束才一批提交，且每个异步边界重验对象/场景/执行权。初步上限 8 个正在动画的跟随者，一组 interaction 至多 30 Hz；路径规划放有界队列/worker，目标规划时间 <4 ms、超过 16 ms 应中断/延后而非阻塞输入；这些是验收目标，未测已达成。

“追随坐标”不等于“沿主人走过的路”。目标放手只留下终点，可能已跨墙或传送；没有拖动轨迹时只能依据当前墙另行规划，不能宣称复原原路。急转角、门变化、体型净空、传送、无法到达、手动抢控需要产品定义。先使用原生 attachment 的同移不会解决这些问题。

## 旧 follow 为什么不能直接恢复

旧代码留存不代表当前线上启用。`src/modules/follow/index.ts:344` 用路径点数乘 110 ms、下限 150 ms；`pathfinding.ts:171-173` 直线短路只返回两点，所以 1500 px 长直线等效 10000 px/s，距离变化不改变持续时间。实验按弧长对同一条 450 px 路径疏密重采样，均得 300 px/s、1.5 秒；这验证计时方向，未验证 A* 避障。

`index.ts:392` 只检查 GM，没有唯一 GM 选举；`:442` 以墙数判断规划可继续，不能反映墙位置/门状态；`:383` 16 ms interval 注释把后台稳帧当成假设；`:376` 又假定 stop 已提交。上述是旧方案复用风险，不是对已下线功能的当前用户故障复现。

## 下一轮真正需要的房间验收

1. DM + 两玩家：激活模式、原生 Move、拖 token、框选、旋转/缩放、量尺/绘图、按 Esc、指针出窗/失焦。记录每种模式实际事件数量和坐标，不模拟替代。
2. Pointer 与共享移动：平移缩放后无坐标漂移；30 秒前后、网络抖动、切场景无残留；自己停止发送时各玩家消失；不中断原生操作。
3. Attachment：保持世界位置的建立/解除；原生拖动父对象、旋转缩放、嵌套关系、隐藏删除、权限限制、复制、撤销；再单独测父对象 interaction 与全家族 interaction。
4. 宠物：短/长直线、拐角、封闭门、净空、大图、改目标、同时两 GM、玩家抢控、超 30 秒、执行端掉线；核对最终永久位置和旧任务不能反写。
5. 记录真人客户端帧时间、输入停顿、宿主网络量与 SDK IPC 分开计数。后台/最小化/移动设备分别验，不能以本探针 PASS 代替用户已报告的卡顿复测。
