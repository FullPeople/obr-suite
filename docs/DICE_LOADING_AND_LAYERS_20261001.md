# 2026-10-01 · 骰盘加载与显示层级

本轮候选基于已合并的新版 214。不能将下述独立站顶层修复称为 Owlbear 跨 iframe 层级已经修复。

## 已完成的修复

- 骰盘新 iframe 曾无条件显示加载遮罩，之后才向常驻 Controller 查询 ready；热加载也因此闪进度。现在初始未知阶段保留 inert / 键盘闸门但不显示假进度，init 同时携带当前宿主的权威加载状态。旧宿主缺少该字段时仍查询 status，不从 localStorage 猜 ready。
- 真正的下载、首次渲染、错误和重试保留原有进度及交互禁用；ready 再失效时会重新锁定。重开骰盘不重新创建 Controller 或 WebGL。
- 独立网站的本地投骰改为原生 dialog 顶层，覆盖同文档规则弹窗和普通高 z-index UI。ESC、关闭和空白区关闭恢复原焦点并保留底下弹窗。该入口本来就是模态投骰，未将常驻 Owlbear 渲染层改成全屏输入遮罩。

## 验证

- 214 合并后与最终 215 正式 workbench-dice 构建均通过 Windows Edge 10 组加载断言：quick/index 各连续热重开 5 次（共 10 次），逐帧可见进度遮罩为 0；延迟 init、旧宿主状态回退、真实冷加载、错误重试、ready 失效再次锁定均通过，页面异常 0。
- 延迟 init 的测试现显式扣住并释放响应，避免固定 350 ms 延迟在机器繁忙时已提前结束的夹具竞态。产品源码未因此修改。
- 全 Suite TypeScript 检查通过。独立站新增实际顶层/投骰/ESC/重开/焦点恢复流程通过；首轮发现空白 pointerdown 的浏览器默认聚焦覆盖恢复焦点，已通过 preventDefault 修复并复验。根任务还将该用例纳入最终 Web 生产浏览器检查。
- 加载报告：`D:/Desktop/DND-card-web/.local-evidence/dice-layer-20261001/release215-fixed/loading-results.json`。独立顶层截图在同目录 `local-layer-fixed`。这里只使用原创测试数据；真实玩家数据未被这些测试写入。

## 真实 Owlbear 层级：尚未修复

实际房主浏览器只读采样显示：dice-history 和 initiative-panel 的宿主 fixed 祖先 z-index 为 1300；dice3d/overlay 的宿主 fixed 祖先为 1299。它们均不是 HTML 原生 :modal / :popover-open。修改子 iframe 内 CSS 不能跨越这个宿主层。

官方 [Modal API](https://docs.owlbear.rodeo/extensions/apis/modal/) 与 [Popover API](https://docs.owlbear.rodeo/extensions/apis/popover/) 及当前 SDK 类型均不提供 zIndex / bringToFront。仍需确认宿主对各 Modal 参数的实际层级选择或采用宿主支持的方案；不能以关闭穿透、让透明全屏 iframe 永久阻断地图和全部按钮来冒充置顶修复。

真实样式证据：`D:/Desktop/DND-card-web/.local-evidence/performance-dual-20261001/owner-host-layers-before.json`。导出仅保留 iframe pathname 和样式，不包含其 session 查询参数。本轮尚未改动 Suite 渲染覆盖层或历史浮窗的宿主参数。
