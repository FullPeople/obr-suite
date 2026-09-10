# 角色卡入口权限与异步更新交付

日期：2026-09-08。目录 `U:\枭熊插件\obr-suite`。本范围只修角色卡模块入口；未提交、推送或部署。

## 最终行为

- 入口与信息页使用相同的卡片 `visibility` / `owner_ids` 规则。分配给玩家的 GM 创建锁定单位可打开；未分配卡片保留既有创建者回退与 bubbles 解锁行为。
- 固定窗口继续保留普通取消选择后的卡片；卡片删除、绑定变化、权限撤销、降级为玩家、场景卸载会强制撤销窗口。
- 选择读取、初始角色/场景读取及 viewport 读取都有代次校验。旧 A 请求不会覆盖新 B；开关窗口串行处理，旧 close 不会关闭之后的新目标。
- 同卡不同单位也更新目标。窗口重新定位沿用当前 iframe 的初始 URL，由 LOCAL 目标消息更新内容，避免重定位把目标变回旧单位或重新加载 iframe。
- 信息页安装 SHOW 监听、取得本机 connection 后发送 READY；入口仅对本机 READY 回放当前且仍授权的目标。READY 不执行 open，已关闭目标不会被旧 READY 重新打开。
- 场景 items 事件只比较所选/固定目标的绑定、创建者、锁定字段。位置、HP 等内容变化由信息页原有实况监听处理；入口不重复读取选择/metadata/items，不额外发目标消息。
- GM 刷新角色卡只读取当前房间自己的服务地址。每卡最新请求生效；实际 updateItems 回调仍校验角色、场景、请求代次和单位绑定。当前 HP、临时 HP、其他 bubbles 字段及兼容旧 metadata 键保留。

## 文件与兼容性

本范围拥有：

- `src/modules/characterCards/index.ts`
- `tools/cc-entry-selftest.entry.ts`
- `tools/cc-entry-selftest.mjs`
- `tools/fixtures/cc-entry-sdk.ts`
- 本记录

根代理明确授权的冻结文件例外：`src/modules/characterCards/info-page.ts` 仅在初始化目标/早到 SHOW 处理后、卡片更新订阅前加入两行注释及一行 LOCAL `com.character-cards/info-ready` 发送。该文件其余改动归信息页负责人，本交付不认领。已告知该负责人。

不更改绑定弹窗 URL、模块导出、现有 metadata/broadcast 命名、卡片数据格式、主窗口布局、pin 设置格式。`BC_CARD_UPDATED` 继续允许远端通知，但通知不能传入可信 stats 或任意 fetch URL；GM 实际写入取当前房间服务返回值并重新校验绑定。

## 验证

`node tools/cc-entry-selftest.mjs --mutants`：初次交付 7 组通过、6 个定点变异被运行时断言捕获；根复核补充旧血条 metadata 独立字段保留，并在固定树独立通过 7 个变异（另六项为撤销分配所有者、固定阻止权限撤销、去掉选择代次、重定位改变 iframe URL、放行外部 READY、去掉写入时绑定校验）。变异仅作用于临时构建，不改产品文件。批次固定树、根复核工件和 GitHub 状态以 [实施记录](../IMPLEMENTATION_PROGRESS_20260908.md) 为准。

覆盖：延迟初始选择、A/B/C 乱序读取、慢 open/close、同卡切单位重定位、迟到 READY、本机 sender 校验、关闭后 READY、固定后撤权、角色变更、场景卸载/恢复、刷新响应乱序、保留当前/临时 HP、延迟真实 updateItems 回调遇到重新绑定/卸载，以及卸载清理监听。

120 次位置/HP 场景事件测得入口新增 `getSelection/getItems/getMetadata/viewport` 调用均为 0，新增 SHOW 消息和 popover open 均为 0。这是模拟 SDK 条件下的调用预算，不能换算成真实玩家设备帧率。

最终入口运行工件：`C:\Users\admin\AppData\Local\Temp\cc-entry-leacYj\selftest.mjs`；同目录保留变异日志。

`node tools/cc-info-dom-selftest.mjs`：加入上述 READY 配套后 30 项通过，验证实际信息页 DOM 与延迟加载行为。该工具由信息页负责人持有，本范围未修改。

`tsc --noEmit`：通过。

限制：入口测试运行实际产品入口函数，但 SDK 宿主传输、窗口生命周期与服务响应为可控模拟；信息页 DOM 测试使用真实浏览器但宿主 SDK 仍模拟。尚未完成真实 Owlbear 房间中的选中、权限传播、布局重定位和多人验收。
