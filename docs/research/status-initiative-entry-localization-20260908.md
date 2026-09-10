# 状态入口与先攻骰子文案尾项

本批补齐状态工具、模式、`]` 快捷动作的名称，活动调色板的「以此创建状态」右键项，以及无名图片创建状态时的默认名称。已有自定义状态、单位名称、图片缩放/旋转、目录键、菜单过滤条件和角色权限均沿用。此模块没有另一个固定中文的用户通知入口；控制台诊断不当作界面文案翻译。

先攻本地掷骰和 Dice+ 回包的固定双语标签，改为发送时读取当前语言并使用已有模块词条。广播字段、发送范围、角色名、骰值与落地时机不变。因为本批保留协议，收到广播的另一位玩家会看到发送端使用的标签；不宣称已经实现每位接收者单独翻译历史骰子记录。

具体接收路径：`dice/index.ts:188` 的载荷只有普通 `label`，`:531` 将其传入演出 URL，`dice/effect-page.ts:127`、`:635` 原样显示；`history-page.ts:236` 与 `replay-page.ts:103` 也原样显示。虽然本地先攻 rollId 有 `init-` 前缀，Dice+ 镜像未提供该 ID，由 `dice/index.ts:1426` 生成时间/随机 ID；因此现有字段不能同时可靠识别两路先攻与用户自定义标签。接收端各自语言留待明确语义边界后处理。

## 原生入口更新与边界

[官方 Tool API](https://docs.owlbear.rodeo/extensions/apis/tool/) 提供 `create/createMode/createAction`，没有 `setLabel/updateTool`。`setMetadata` 更新的是工具元数据，不能直接改标签。按 [官方 ToolApi 源码](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/ToolApi.ts) 和安装版 SDK 3.1.0，以相同 ID 重交完整描述；SDK 的回调表按该 ID 替换。语言变化不调用 remove、activate 或窗口开关，保留回调及过滤条件。重复语言通知不发送更新，更新串行执行并读取当时的语言。

[Context Menu API](https://docs.owlbear.rodeo/extensions/apis/context-menu/) 同样采用固定 ID 的 create；仅活动调色板更新其右键项。SDK 3.1.0 的 `ContextMenuApi.create` 内部没有等待宿主应答，因此不能把它返回视为宿主已经绘制或已确认成功。测试使用真实 API 类、可控宿主传输；同 ID 的宿主视觉表现仍需实际 Owlbear 房间验收。

关闭模块先使入口会话失效，退订语言通知，等待已发出的原生工具更新结束，再删除入口，防止迟到更新复活入口。安装版 SDK 的 removeMode/removeAction 仍可能保留本地回调引用，故旧回调也核对会话。新增守卫仅保护这些入口生命周期；未扩大重写本模块的同步、拖放或权限模型。

## 验证

- `node tools/status-entry-locale-selftest.mjs`：12 项真实模块 + 安装版 ToolApi/ContextMenuApi 检查。覆盖初始中英、活动/非活动菜单、过滤条件/快捷键、保留作者名称与图片参数、选择/窗口保留、更新后实际 SDK 点击回调、重复语言零写入、延迟刷新关闭、SDK 残留回调无效和重新启用。工件：`C:\Users\admin\AppData\Local\Temp\status-entry-locale-YveLv4`。
- `node tools/initiative-edit-selftest.mjs`：26 项，其中原有 22 项真实 hook、SceneItemsApi/Immer、编辑会话与撤权检查继续通过；新增本地骰和 Dice+ 两路各中英一项。测试 HTTP 明确声明 UTF-8，避免中文断言受临时页面编码猜测影响。工件：`C:\Users\admin\AppData\Local\Temp\initiative-edit-fVG5QT`。
- `npx tsc --noEmit`、`git diff --check` 通过。未做真人多人房间 UAT。

根独立复核中，先攻临时服务器首次被系统分配到 Chromium 禁止访问的 6669 端口，在进入产品断言前出现 `ERR_UNSAFE_PORT`。测试器已改为仅对此传输错误重新绑定，最多三次，不改变浏览器安全设置、不重试产品断言；重跑 26 项通过。状态入口独立 12 项亦通过。

产品仅修改 `statusTracker/index.ts` 与 `initiative/hooks/useInitiative.ts`。测试修改既有 initiative-edit runner/fixture，并新增 status-entry runner/fixture；共享状态、全局词典和其他模块未改。本批不代表全项目英文覆盖完成。
