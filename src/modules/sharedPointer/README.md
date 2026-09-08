# 共享指针 / Share pointer

点击工具栏或快捷栏的“共享指针”，移动鼠标即可向同场景队友指示位置。姓名和颜色使用枭熊当前玩家资料；停留约 1.2 秒、松手、按 Esc、切工具或窗口失焦会结束这次指示。再次移动继续指示，不需要每次开场配置。

Select **Share pointer** in the native toolbar or quickbar, then move to indicate a location. Names and colors come from Owlbear player profiles. A pause of about 1.2 seconds, release, Escape, a tool change, or window blur ends the indication; moving again resumes it.

这是公开 API 支持的**主动工具指示**。使用原生 Move、量尺、绘图等其他工具时，不会持续读取或广播玩家鼠标。没有覆盖地图的透明层、额外 action 页面或独立插件。

## 接线

- 模块 ID `sharedPointer`、默认开启，已接入 background、设置和常用栏。模块启用只注册工具和进行有界发现，不自动切换用户工具。
- `setupSharedPointer()` / `teardownSharedPointer()`：由常驻 background 模块管理。清理长期失败时 teardown 会拒绝并保留本模块 UUID；下一次 teardown 或 setup 会重试，不能把失败当作已清干净。
- `activateSharedPointer()`：同后台可直接调用。
- 快捷栏发送 `POINTER_ACTIVATE`（`com.obr-suite/shared-pointer/activate`），数据 `{}`，目标 `LOCAL`。仅接受自身 `connectionId` 的消息。
- 工具 ID `com.obr-suite/shared-pointer/tool`，模式 ID `com.obr-suite/shared-pointer/mode`；图标为本目录原创 `icon.svg`，随常规 Vite 资源输出。
- 简体/英文标签：`共享指针` / `Share pointer`。简介应说明“使用指示工具时共享位置 / Share positions while using the pointer tool”。无需 HTML 入口或新增权限。

## 实现与有界行为

广播只包含场景随机标识、临时握手、序号和最新坐标/停止信号。每个接收端根据 SDK 广播实际连接和 party 资料建立身份，忽略包内名字颜色；fresh challenge、发送端场景代次和递增序号拒绝旧握手及重放。最多支持按连接 ID 排序的 16 个连接；更多连接不会无限添加图元。

所有控制包与位置包合用最多 **10 次/秒**的发送调度，只有一个在途发送和一个未发送位置。静止不发送心跳或坐标；初始化的两次补偿发现结束后没有空闲轮询。图元通过真实 `buildPointer()` / `buildLabel()` 建立，每端最多 32 个本地图元，合并更新间隔至少 34 ms；纯移动走 fastUpdate，改名改色使用完整本地更新，因为官方快速路径不保证 Pointer.color 或 Label.text.style。不写共享 scene Items，不提交坐标到 metadata 或撤销历史，不创建逐帧渲染循环。

唯一持久值是 `com.obr-suite/shared-pointer/scene-key`。已有有效值直接复用；缺失时由当前排序首位 GM 初始化，写前再次检查实际角色、场景和生命周期。尚无 GM 会在首次选工具时解释等待状态；后来 GM 加入会自动初始化。初始化失败不阻塞其他模块，可再次选工具重试。

离线、场景变更、模块关闭会取消监听和计时器，并按记录的 UUID 清理本地图元。旧场景的迟到 add 不复用 UUID，也不能覆盖新场景图元。删除失败最多自动尝试三轮，关闭时最多三次，然后明确报告错误并保留待清理 UUID，避免无限后台工作。其他插件图元不受影响。宿主拒绝删除期间不能承诺残留已消失；远端退出/失联依赖 party 事件或最后一个有效包到达后的 1.2 秒过期，网络传递延迟另计。

原生工具和模式分别记录清理状态；成功移除后重复 teardown 不再发送相同删除，失败项则保留并明确拒绝本次清理。SDK 没有工具存在性查询或标准 not-found 错误码，因此不会猜测宿主错误文本并吞掉真实失败。SDK 边界测试允许删除不存在的工具，但这不能代替宿主在“请求已执行、回执丢失”场景的幂等语义验收。

## 已运行验证

`node tools/shared-pointer-selftest.mjs --mutations` 执行实际模块、安装 SDK **3.1.0** 的 ToolApi、BroadcastApi、SceneLocalApi、PointerBuilder、LabelBuilder 和真实 Immer 更新；仅宿主消息总线、身份/场景状态和时钟是可控边界。

12 组检查覆盖：未选工具不指示、双方身份与改名改色、低频单在途预算、假身份/旧序号、切工具与静止清理、同场景重开、同连接模块重开、慢广播、跨场景迟到 add、短暂和持续删除失败、SDK removeMode 保留旧回调、无 GM 后自动恢复、初始化失败及写前撤销 GM、工具/模式删除部分失败后的恢复。测试宿主边界拒绝快速路径写入外观，并验证真实纯位置更新不断推进。4 个变异分别删除序号检查、接受包内身份、删除迟到 add 代次检查、谎报清理成功，均在对应断言失败。

本次证据目录：`C:\Users\admin\AppData\Local\Temp\shared-pointer-V2Ros7`。10 秒的 1,250 个移动输入压缩为 101 个包（含区间端点），合计 12,244 JSON payload bytes，最大包 123 bytes，最多一个在途请求。包大小是本次样本，不含 SDK/网络封装，不是宿主实测流量。发送器固定上限与接收人数上限仍独立约束输入规模。

**没有把这些检查当作真实多人枭熊验收。** 仍需 DM + 两玩家在实际房间验证：平移和 0.5/1/2 倍缩放时坐标对应、原生 token 拖动/框选是否仍按宿主行为工作、触屏、图元姓名大小、网络抖动和后台标签页的过期时机。`preventDrag: {}` 将拖动交给宿主 Move，但宿主拖动期间是否继续向当前模式发送移动事件没有公开保证。客户端隐藏/冻结会使计时器延迟，不能宣称恒定帧率。

## 公开依据

- [Tool API](https://docs.owlbear.rodeo/extensions/apis/tool/)：只向活动模式分派指针事件，允许保留默认点击与 Move 拖动。
- [Pointer](https://docs.owlbear.rodeo/extensions/reference/items/pointer/)：原生带短尾迹的点图元，本身不读取鼠标。
- [Broadcast API](https://docs.owlbear.rodeo/extensions/apis/broadcast/)：临时消息及实际发送连接身份。
- [Scene Local API](https://docs.owlbear.rodeo/extensions/apis/scene/local/)：本地场景图元，不广播共享 Items。
- [快速渲染路径支持值](https://docs.owlbear.rodeo/extensions/apis/interaction/#interactive-values)：支持位置；Label 只列出 plainText，不保证文字颜色/style。
- [官方画线教程](https://docs.owlbear.rodeo/extensions/tutorial-custom-tool/implement-the-line-mode/)：事件位置直接用于图元；当前实现遵循此范例，不猜测第二次坐标变换，真房间缩放校准仍待验证。
- [官方 ToolApi 源码](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/ToolApi.ts)：安装 3.1.0 的 `removeMode` 保留旧 mode 回调，因此本模块额外检查启用代次和实际模式。

更早的鼠标/挂接/宠物跟随边界见 `docs/research/cursor-follow-feasibility-20260908.md`。本模块不会修改旧 follow，也不会把按需指示宣称为所有工具下的持续鼠标共享。
