# 2026-10-02 · 223 仅提交 GitHub 源码，不部署

用户本轮授权将这批已验证修复提交并推送 GitHub，明确不部署。Web 源码分支 `codex/selection-follow223`，Suite 配套分支 `codex/selection-follow223-suite`；保留 222 发布基线，不合并到 main、不触发 Pages 或服务器发布，也不递增在线版本/公告。验证结果与真实房间未验收的边界沿用下文，未重复开发同一批修复。

# 2026-10-01 · 小房间选择跟随与重连修复（本地批次 223）

本批基于已发布 222 的两个隔离工作树。未提交、推送、部署或更新在线公告/版本；线上仍以 RELEASE-222-RESULT.md 为准。用户暂时不能提供真实房间浏览器，因此没有宣称实际房主/玩家环境已验收。

## 已确认原因

### 1. 中继的存活判定不对称，会吞掉小房间的单选变化

Suite `src/workbench/background.ts` 收到附加窗口消息时更新 `relayPeerSeen`，普通转发只允许在其后 45 秒内进行。222 Web 的 `src/platform/workbench.ts` 在直连时发 ping，中继模式下却只有 hello 重试，没有定期 ping。宿主每 10 秒发送的 pong 可以一直维持客户端“已连接”，但无法续上宿主的发送资格。到期后的地图选择即使已经处理，也没有发给窗口；直到下一次握手才恢复。这个缺陷不需要大量卡片或怪物。

使用实际生产 background、已安装的 Owlbear SDK iframe 通讯、生产 Web bridge、原样本地中继服务器，构造 5 张卡和 20 个怪物。Playwright 的同一 context 时钟只推进一次，保留生产定时器和真实 HTTP：

- 修复前：宿主距最后客户端消息 46 秒；选择另一张卡，1 秒观察窗内未到达，窗口仍显示 online=true 和旧卡。随后正常恢复握手；取消选择也未返回原卡。5 项中 3 通过、2 失败。
- 修复后：模拟空闲 60 秒，客户端持续用轻量 ping 续连；同一单选在本机 14 ms 到达。怪物、两目标群体、取消恢复、无页面异常均通过。
- 另一次未加速的约 46 秒空闲测试，单选在本机 28 ms 到达，5 项全部通过。计时仅到生产 bridge 驱动的最小 React 视图，不是完整角色卡绘制或公网延迟保证。

修复为中继模式每 10 秒发送 ping；握手完成后不再用重复 hello 充当心跳。完整握手丢失和真正断线仍会恢复，修改请求不重放。

### 2. 短暂直连延迟被当作断线，恢复又停用缓存、清掉群体状态

原 5 秒直连门限会在一个 6 秒停顿后停用暖缓存并清空群体状态；迟到的同一宿主 pong 也不能重新绑定。现在直连回退门限为 15 秒，换路不清应用状态，同一窗口、同一宿主代次的 pong 可以恢复直连。真正 45 秒无消息仍标记断线，陌生窗口或旧代次不能冒充恢复。

健康直连不再同时经中继重复发送整套资料；只有确认是同一个客户端时才去重。新中继窗口仍可拿到完整目录，即使旧直连窗口还开着。

### 3. 无关选择触发整房间刷新，重复握手重发缓存

`OBR.party.onChange` 把其他玩家的 selection/syncView 也当作职业、权限、资料变化。现保留最新 party 数据，但这些选择/视口字段不触发资料重建；姓名、角色和权限等变化仍立即失效。

在 5 卡 SDK 夹具中，20 次他人选择事件原来触发 hydrate 20 次、reconcile 100 次，修复后均为 0。这个循环用于确认重复路径，不能当作本次单选卡住的唯一解释。相同窗口重试 3 次 hello 原来重发 15 份卡缓存，现在为 0；更换客户端仍重新同步。

### 4. 多选等待全部读取，取消选择缺少完整恢复

群体区域原来在全部资料读完后才出现。现在立即显示可关闭的读取状态，最多并发读取 4 个目标；取消或换选后不再启动旧队列，也不让旧结果重开区域。资料不完整时不会悄悄省略目标执行投掷/修改。

地图跟随记录原角色、页面、卡面分页和滚动位置。取消后恢复；每次地图选择附带递增代次，迟到的旧导航/快照不能抢回页面。首开时先确定默认角色，再保存跟随返回点。已进入 DC 结算的群体仍保持到主动关闭，遵守原产品约定。

## 最终验证

| 验证 | 结果 |
| --- | --- |
| Web 全量单元 | 437 通过，5 个外部资料可选测试跳过，0 失败 |
| Web Edge 完整页面定向测试 | 11 通过，0 跳过/失败；包含缓存切卡、推送更新、撤权、握手和不重放修改、单选返回、多选加载/取消 |
| Suite 新选择/观察层单元 | 8 通过 |
| Suite 既有群体/骰子事务回归 | 29 通过；包括结算保持、未知回执不重放、部分成功重试、先攻重绑保护 |
| Suite 生产 background + 实 SDK 小规模夹具 | 21 项断言通过，另 1 项缓存切卡采样；无页面异常 |
| 5 卡/20 怪物实际本地中继 | 正常时钟及可控时钟各 5 项通过 |
| Web/Suite 类型检查 | 通过 |
| Suite 完整 dev 生产构建（指定本隔离 Web 输入）、Web standalone 构建 | 通过；保留已有大 chunk/构建插件耗时提示 |
| git diff --check | 两树通过 |

Web 类型/插件入口构建由 Suite 官方 `tools/build-workbench-dev.mjs` 运行，`DND_CARD_WEB_ROOT` 明确指向同级隔离 Web；另运行 standalone 构建。没有从脏主目录取构建输入。

未执行：真实 Owlbear 房主/玩家浏览器、真实公网中继/后台节流/权限双端验收、完整发布 CI 和部署后检查。原型和真实玩家数据未改，两个本地测试写入仅发生于合成 SDK 夹具的内存文档。

## 证据与复现

本机证据根：`D:/Desktop/DND-card-web/.local-evidence/resource-dashboard220/selection223/`。

- `baseline-hashes.json`、`baseline/`：编辑前原文件及哈希。
- `small-relay-before-clock-final/results.json` / `small-relay-after-clock-final/results.json`：同一小房间中继缺陷前后对照。
- `small-relay-after-r2/results.json`：正常时钟空闲验证。
- `sdk-before-small-final/results.json` / `sdk-after-small-r2/results.json`：宿主重复工作、返回原卡、权限与写入保护。
- `web-unit-final.json`、`web-browser-r2/report.json` 及截图；`suite-after-final/result.json`；`group-existing-r2/group-unit.mjs`（29 项执行输出另见 validation-summary.json）。
- `build-suite.log` / `build-standalone.log`；`validation-summary.json`：最终聚合及当前运行文件哈希。

Suite 复现脚本：`tools/workbench-small-relay-223-browser.mjs`、`tools/workbench-selection-223-sdk-browser.mjs`、`tools/workbench-selection-223-selftest.mjs`。中继脚本默认实际时钟，`VIRTUAL_IDLE=1` 使用 context 时钟；`PROFILE_OUT` 指定新的证据目录。复测基线同时设置 `SELECTION_BASELINE=../selection223/baseline/suite` 和 `WEB_BASELINE=../selection223/baseline/web`，并设 `EXPECT_PASS=0` 保留预期失败。

Web 复现：`node node_modules/@playwright/test/cli.js test --config playwright.selection223.config.ts`；端口 5633，仅使用自动创建的 Edge 浏览器。此次 Windows Vite 自动收尾停住，确认 PID 21160 和端口归属后仅停止该测试进程，测试正常以 11 passed / exit 0 生成报告；没有关闭用户浏览器或常驻预览。

## 排查中保留的失败

最早 80 卡夹具只揭示重复执行，按用户澄清已改为小房间，旧结果不作为本次主因证据。初版中继测试错误地把动态 sound.js 请求也返回了客户端脚本，引起双客户端争抢；修正路由后重新验证，不把这轮异常归因于产品。可控时钟也已改为每 context 一次安装/推进，早期双推进记录不用于时间结论。

首次页面测试 9 过/2 失败：旧握手断言不允许新增的 ping、法术页误找主要页 HP 控件；修正测试定位与契约后 11 项通过。群体回归曾因新增“不完整目标”检查遮住原 100 骰上限错误而失败，恢复正确检查顺序后 29 项通过。所有早期证据保留，没有把首次执行写成全绿。
