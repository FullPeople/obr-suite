# 2026-10-02 · 230 最终源码合并验证

用户要求核对并合并 GitHub 上的选择延迟、骰子及角色卡加载顺序修复。本批输出两个配套源码分支：Web `codex/final-integration230`、Suite `codex/final-integration230-suite`。230 是源码整合编号；沿用上一条“提交 GitHub，不部署”，没有修改线上版本、公告、站点、服务或玩家数据，也没有合并 main。

## 核对及合并范围

| 修复 | Web 来源 | Suite 来源及处理 |
| --- | --- | --- |
| 地图选择延迟、频繁重连、取消选择恢复原页 | `codex/selection-follow223`，84d50cc5e183b982a40fb695d591bbde9213aeeb | `codex/selection-follow223-suite`，a8dc0c6a941429a4f318057f1c393f6a8c6fb788；合入最新宿主 |
| 骰子加载、损坏缓存恢复、WASM 重复下载、发送队列 | 不另建 Web 骰子实现 | `codex/dice-loading-225`，5d8b0e440f140d15e6b1612c6444f7d9dae3f688；运行代码已在 startup-226 内，本次合并遗漏的发布回执。220 分支的完整验证历史也保留 |
| 卡面先显示，Wiki、自动化运行库和工具随后加载 | `codex/a4-wiki-recovery-229`，8c58542bc02692041bfb4289f09e851994f5ba05；包含 228 首屏拆分 b7181aa、226 和 227 已发布基线 | `codex/startup-226`，1da2715def0aee1f6e710de7622e4adb7d2a6a01；实际是 227 宿主基线，并非只含旧 226 |

同时保留默认自动化、222 仪表盘、223 自动化、225 响应式可选显示，以及 229 默认 A4 / Wiki 重试与暂停 / 离线功能缓存。玩家保存的显示偏好、主动关闭自动化和资源余额仍按原合同保留。

Web 的 229 与 223 有一处 App 导入冲突：保留 229 按需加载旧卡同步界面及轻量 `cardMigrationIssues`，接入 223 的 `getGroupRoll`，避免把迁移运行库拉回首屏。两个分支的交接及状态历史均保留。Suite 运行代码自动合并，没有重新实现同一批修复。

Web 合并节点 c8432105b39b2dd43b354b9755d54db47ee82581，Suite 合并节点 ac03f733443013baeb45fa545c1410013ec198c5。最终提交还包含本批复验及以下修订；最终完整 SHA 由推送后的配套回执确定。`INTEGRATION-230-BRANCHES.json` 记录来源 SHA 与祖先验证。

Suite 的 `main` 是另一条旧稳定历史，不能直接作为新版宿主整体覆盖输入。本次使用已核对的 227 宿主基线，不混入旧 stable。Web main f9f4ba3 已被完整包含，但不推送 main，以免触发 Pages。

## 本次发现与处理

- 首轮浏览器 37 通过、5 跳过、3 失败。两项失败来自禁用 Service Worker 的浏览器环境：注册被抑制后，PerformanceObserver 已安装，后续下载触发对空注册对象的 `active` 访问。注册不可用时现在直接退出，不遗留异步监听；新增两个测试验证该环境及真实激活后功能文件补存。未把这个受控环境异常称为真实玩家网络故障的已确认根因。
- 第三项失败是 Wiki 断线测试的预算假设：四个并发读取器中，首个耗尽重试的文件释放读取器后，可以在第二个耗尽触发暂停前开始第五份文件。首轮实际 13 个请求，旧断言只允许 12。修正为最多五份文件、每份最多三次，并继续验证暂停后请求不增长、旧库保留及恢复补读。没有修改产品的暂停阈值或隐藏读取错误。
- 初次骰子生产检查缺少 `dice3d/assets/catalog.json`：宿主构建与 3D 骰子应用是项目规定的两个构建步骤。随后从相同最终 Suite 源码单独构建骰子、校验并组合，再执行生产浏览器检查通过。没有借用旧线上骰子产物冒充本次构建。

## 合并后验证

Windows，Node 22.17.1，分别 `npm ci --no-audit --no-fund`，浏览器为官方 Windows Microsoft Edge。全部使用隔离浏览器及原创测试角色，没有读取或写入真实玩家文档。

| 项目 | 最终结果 |
| --- | --- |
| Web 全套单元 | 482 通过，23 因缺少外部语料条件跳过，0 失败 |
| Web / Suite 类型检查 | 通过 |
| 单机、Web 集成、Suite 工作台及旧只读查看器构建 | 通过 |
| 组合 Edge 浏览器 | 选择/权限/群体流程 11 通过；单机启动、自动化、迁移、Wiki 恢复和离线流程复验 29 通过、5 外部语料跳过；合计 40 个不同流程通过，0 最终失败 |
| Suite 选择及群体单元 | 8 + 29 通过 |
| 骰子核心、加载器、队列、生命周期 | 36 + 6 + 6 + 5 通过 |
| 实际安装 SDK / 跨窗口的生产宿主逻辑 | 21 项断言通过，另保留一项缓存选择计时样本；无脚本错误 |
| 实际本地 HTTP relay / 生产桥 / 小房间 | 5 项通过；5 张卡、20 只怪物，模拟空闲 60 秒后选卡更新约 65ms，怪物、多选和取消恢复均通过 |
| 生产 Edge Jolt/WASM/WebGL | 损坏脚本恢复、持续损坏拒绝、同 worker 再试通过；2d6+1d20+5 的物理面 6/5/16、总数32、完整动画完成，错误0；启动 JSON 请求0、带版本 WASM 仅1次 |
| 宿主/骰子静态产物 | 259 文件、1053 静态引用检查通过；59 资产锁通过；仅对确实匹配锁定散列的文本进行 CRLF→LF 输出归一化 |

首轮失败与复验分别保留，不累计重复执行数量。原有 Web 首屏核心与骰子目录的大块构建警告、Suite MusicBoard 同时静态/动态导入警告仍存在，没有通过关闭警告掩盖它们。

## 复现与交接

源码隔离目录：`D:/Desktop/DND-card-web/.local-evidence/final-integration230/{web,suite}`。用户根目录、U 盘旧工作树、手机原型和现有预览均未修改。本批测试端口 5640/5641、SDK 5631、relay 5632/5634、骰子5220，测试结束不占用用户原预览端口。

从两条最终分支分别安装依赖；必须将 `DND_CARD_WEB_ROOT` 指向同批最终 Web，不能用混合脏根目录。运行 Suite `tools/build-workbench-dev.mjs`、Web `build:standalone`；按 `tools/build-workbench-dice3d-release.mjs` 要求给骰子指定全新绝对输出路径，再组合到宿主 `dice3d/`。`tools/build-release217.mjs` 可独立验证当前宿主/骰子静态引用，其产物是宿主覆盖包，不是完整站点。

Web 组合浏览器命令：`node node_modules/@playwright/test/cli.js test --config playwright.integration230.config.ts`。单元命令 `npm test`。Suite 复用已有 selection-223、group-217、dice-edge220、dice-loading224、dice3d 和 lifecycle-217 工具。不要运行任何 deploy 脚本来复现本次源码验证。

原始证据位于隔离目录的忽略路径：`web-unit-final.log`、`web-browser.log`（首轮）、`web-browser-final.log`（单机最终复验）、`web/.local-evidence/integration230-browser{,-final}`、`suite-{selection,group,types}.log`、`suite-build-final.log`、`web-standalone-build-final.log`、`sdk-browser/results.json`、`small-relay-browser/results.json`、`dice-production/production-edge.json`、骰子单元日志及 `host-static-check.log`。

未执行本批公网部署、完整发布 CI、真实登录枭熊房间双端操作、玩家原线路/设备或实体手机验收。小房间模拟与生产物理动画能验证合并代码，不能证明真实 Suite 宿主、权限、多人同步与所有玩家性能均正常。自动选择/筛选式专长赠送规则和完整插件英文翻译等历史未完成事项没有因合并而变为已完成。
