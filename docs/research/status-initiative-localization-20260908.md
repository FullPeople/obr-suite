# 状态页面与先攻页面的英文遗漏修正

规范目录：`U:\枭熊插件\obr-suite`。本批限定实际使用的状态调色板、状态管理、状态拖动提示及先攻面板；没有修改共享 `i18n.ts`、state/settings/background/cluster、DEFAULT_BUFFS 或其存储键，也没有修改上一批冻结的共享指针。未提交、推送或部署。

## 确认的问题与改变

| 触发 | 原行为 | 本批行为与证据 |
| --- | --- | --- |
| 英语打开先攻，查看提示或屏幕阅读标签 | 收起/展开、拖动、排序、优势/劣势、结束回合、首次 Loading 部分仍固定中文 | 既有模块词典增加成对文案；`panel-page.tsx:673,811`、`InitiativeList.tsx`、`InitiativeItem.tsx:243` 按当前本机语言读取 |
| 英语打开未修改的内置状态目录 | 12 个状态名和内置分组直接显示中文 | `statusTracker/localization.ts:11,30,33` 仅显示翻译；调色板、预览、编辑初始名称、管理和拖动提示使用同一识别方式 |
| 语言切换时状态编辑弹窗或分类输入尚有草稿 | `render()` 关闭 popup 并重新创建分类输入，可能丢稿或触发 blur 保存 | `status-tracker-page.ts:1931` 原位更新文字与提示，不重建输入、视频预览或弹窗；原节点、焦点、选区和待保存值保持 |
| 已打开状态管理/拖动页面后切语言 | 管理页无语言订阅；拖动提示固定中文 | 页面自己的语言监听只更新文字，退出解除新增监听；保持原有关闭、拖动和传输数据 |
| 先攻数值按 Enter | Enter 与随后的 blur 各保存一次 | `InitiativeItem.tsx:72,84,92` 每次编辑的同步守卫；Escape 取消后 blur 为零写，下次编辑重新开始会话 |
| 玩家修改别人的先攻修饰值 | 组件和 `updateModifier` 都没有 count 所用的 GM/owner 限制 | 组件入口与 `useInitiative.ts:876` 的执行入口、真实 SDK draft 都按现有 count 规则核对；当前 owner 与 GM 继续可以修改 |

先攻重复提交失败样本：`C:\Users\admin\AppData\Local\Temp\status-initiative-locale-0vaiAv`。实际 Preact 页面按一次 Enter，模型边界收到两条 `['count','hero',27]`。

修饰值越权的修复前证据：`C:\Users\admin\AppData\Local\Temp\initiative-edit-Z7MaUF\baseline.json`。使用真实 `useInitiative`、真实 `SceneItemsApi` 和 Immer；count 的 `canEdit(other)` 为 false，旧 `updateModifier(other,19)` 仍生成该 token 的 metadata 更新。

## 内容保护与范围

名称识别同时核对内置 ID 和**完整默认定义**，不是拿中文字符串或 ID 直接替换。改名、改色、改效果或其它字段的同名内置状态，以及采用相同名称的自定义 ID，都保留作者原文。默认签名使用深拷贝，因为旧调色板通过 `DEFAULT_BUFFS.slice()` 初始化时元素仍可能被编辑；不能让编辑把判断基准也一起改掉。管理页原有字段投影会丢掉一些效果字段，因此用 WeakMap 保留完整来源的自定义判断，不给保存/拖动 payload 新增字段。

内置分组没有稳定 ID。只有组中所有状态都是未修改默认定义时，将“异常/增益”显示为 Conditions/Benefits；自定义、混合或空分类保留原标签。这是保守显示选择，不迁移作者数据。目录读写格式、分组键、名称原值、预设名和拖动 payload 保持原样。英语编辑器未更改显示名称时，保存仍使用原始名称；明确输入新名称才改名。

数值编辑的 Promise 失败沿用“结束本次输入、保留尚未更新的显示值”的模型行为，并捕获拒绝避免未处理异常；再次打开输入是新会话，可以重试。没有自动重复提交。新增场景代次只约束 count/modifier 数值写入，未重构战斗轮转、骰子、排序或整个 hook 的其它异步路径。当前所有权判断继续优先 `createdUserId`，再回退先攻 metadata 的 `ownerId`，与既有 count 显示规则一致。

仍待其它批次处理：`statusTracker/index.ts` 的原生工具和右键菜单固定中文；先攻广播骰子动画仍有固定“先攻 / Initiative”描述；其它模块、法术模板、第三方内容和作者自定义文本不在此批覆盖中。不能据此宣称全项目英文已经完整。

## 验证

- `node tools/status-initiative-locale-selftest.mjs`：**46 项**通过。真实四页面、真实 Preact 组件及真实共享/模块词典；SDK/state、骰子/布局边界与先攻模型 hook 为可控 fixture。验证中英、内置与自定义区分、原始数据与传输保持、输入节点/选区/焦点/草稿、分类不误提交、原有玩家限制及关闭入口。
- `node tools/initiative-edit-selftest.mjs`：**22 项**通过。第二套使用真实 `useInitiative`、列表/数值组件、安装 SDK 3.1.0 的 `SceneItemsApi`、真实 Immer。验证 owner/非 owner/GM、Enter+blur 单写、Escape 零写、后续新会话和失败后重试、编辑期间撤销权限、无 items 事件时 SDK draft 发现所有权变化、角色变化、场景重新打开、先攻 metadata 移除、hook 卸载取消。
- `node tools/status-initiative-locale-mutations.mjs`：**6 个定向变异均失败于目标断言**。覆盖仅看名称的误翻译、可变默认签名、切语言关闭草稿、重复提交、SDK draft 丢失所有权检查、失去场景代次检查。
- 整树 `npx tsc --noEmit` 通过；本批 tracked diff whitespace 检查通过。

最终工件：

- DOM：`C:\Users\admin\AppData\Local\Temp\status-initiative-locale-N6fjtG`，包含 result.json、340×544 的 palette-zh/en.png、720×180 的 initiative-zh/en.png。
- 真实 hook/SDK：`C:\Users\admin\AppData\Local\Temp\initiative-edit-i25XUy`。
- 变异：`C:\Users\admin\AppData\Local\Temp\status-initiative-mutants-u7BXJQ`。

四张中英截图均已人工查看，保留既有页面布局。使用 Edge `152.0.4191.66`。这些是实际浏览器中的页面和 SDK 边界回归，**没有进入真实 Owlbear 多人房间，不等于真人 UAT**；没有声称实际宿主权限服务、网络或延迟表现已验收。

本批产品文件共 9 个：三个 `src/status-tracker-*-page.ts`，新增 `src/modules/statusTracker/localization.ts`，以及先攻 `utils/i18n.ts`、`panel-page.tsx`、`components/InitiativeList.tsx`、`components/InitiativeItem.tsx`、`hooks/useInitiative.ts`。专用测试为 `tools/status-initiative-locale-{selftest,mutations}.mjs`、`tools/initiative-edit-selftest.mjs`、`tools/fixtures/status-initiative-locale-sdk.ts`、`tools/fixtures/initiative-edit-{sdk.ts,entry.tsx}`。
