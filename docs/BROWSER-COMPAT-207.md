# 2026-09-27 · 浏览器加载兼容修复已验证并上线

用户反馈为 Edge 等浏览器提示“加载失败”，未提供版本、报错原文或具体入口。没有把所有 Edge 故障归为同一原因。

## 已确认的问题与修改

- Wiki、Web/Suite 角色中继直接使用 `AbortSignal.any`，旧 Chromium 无此接口时，请求还没发送便抛错。206 正式构建在移除 any / timeout 的当前 Edge 中无法读出职业资料，负向测试已保留。
- 改用基础 AbortController 实现有期限的请求作用域；保持主动取消、完整响应体超时、原错误传播，在成功和失败后释放监听与计时器。Web、Suite 宿主、三龙牌会话及保存结果核对使用同一实现（两仓库文件内容一致）。没有删掉超时或并发保护。
- Wiki 缓存读写不是角色文档保存。缓存不可读时仍可请求网络，缓存写满时保留本次下载成功的条目并显示缓存提示；没有把角色卡存储失败当成功。
- Web、Suite、独立三龙牌及嵌入面板明确编译到 Chrome/Edge 109、Firefox 102、Safari 15.4 的语法目标。语法目标不等于已在所有这些浏览器完整验收。
- HTML 首屏能在主程序脚本失败或长期未启动时给出重试和可复制错误；React 入口增加错误边界处理动态文件加载失败。重试是用户主动刷新，不删除 IndexedDB、角色、备份或浏览器缓存。没有自动无限刷新。

## 当前实测

- 当前 Edge：4 项正式构建浏览器检查通过（缺少新请求 API、缓存配额耗尽、动态程序文件失败后重试并保留卡片身份、首个脚本加载失败提示）。
- 从 Google 官方 Chrome for Testing 下载的实际 Chrome 114.0.5696.0：同样 4 项检查通过。原生 `AbortSignal.any` 为 undefined；timeout 与 structuredClone 存在。测试在隔离临时浏览器配置中进行，不修改系统默认浏览器。
- Chrome 114：18 项安装版 Owlbear SDK / 真实 iframe 宿主通信检查通过；后端和房间为合成夹具。
- 5 项请求作用域单元检查通过：新 API 不存在、预先取消、请求途中取消、响应体期限、失败后释放资源。
- 证据目录 `D:/Temp/DND-card-compat207/`，含 baseline、edge、chrome114、host114 及日志。HTML 错误提示截图 `edge/startup-failure.png`。

Edge 自身采用 Chromium，不应笼统称为性能不足。参考 [Microsoft Edge 说明](https://support.microsoft.com/en-us/edge/microsoft-edge-chromium)、[MDN AbortSignal.any 兼容性](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static)、[Vite 构建仅默认转换语法](https://vite.dev/guide/build)。未通过不安全 JSON 克隆替换 structuredClone；更老的浏览器、IE 模式、玩家的具体设备、扩展拦截、真实网络和受限存储仍待验证。

已发布：新版 1.0.207-dev、单机 0.1.12 / standalone-1.0.207、独立三龙牌 0.7.19-dev；部署证据见 [RELEASE-207-RESULT.md](RELEASE-207-RESULT.md)。旧插件 1.3.11 的 XLSX 不变。
