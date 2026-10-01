# Suite 宿主修复 · 最终源码与验证

独立分支 `codex/suite-host-repair-20261001`，基线远端 `codex/final-integration230-suite` 的 `5b733dbf9c35aa066ac16fe2eafec0befe199a5b`。挂载 main 为另一条旧稳定历史；obr-suite-dev/main 停在 `ef0696922948a6a818c9182c32b7b24b5854f9db`，均未作为新版输入。没有修改 Web 代码、版本号、main、线上站点、房间数据或账号设置。

## 修复

- 新版后台每日公告、控制台和公告页统一读取 `assets/announcement-dev.md`；由构建时明确指定的配套 Web `releaseHistoryFor('suite')` 与 `announcementVersionFor('suite')` 生成，保留最新批、折叠历史及可点击 Gmail。旧版继续读取原 `public/announcement.md`。两者使用不同 modal ID 和已读/每日状态键。无法读取本频道 manifest 时不再借另一个频道的版本冒充成功，版本正文的 `-dev` 后缀完整显示。
- 历史只显示一个结果；群体自动结果与历史结果不再叠加。再点同一历史，显示节点彻底移除，随后迟到的群体结果即使携带旧 `visible:true` 也不重新显示已取消数字。取消后显式显示与隐藏控制仍可用。
- 迟到的旧行关闭消息不重置新行状态。身份或权限变化清理全部已显示结果。
- 坐标读取过程中取消结果时，强制补发最终空状态，避免 DOM 留住旧数字。
- 旧版设置和公共公告反馈已经使用 `1763086701psw@gmail.com`；另发现 Buff Studio 公共贡献入口仍有旧 QQ 邮箱，已改为同一 Gmail 链接。没有改赞助账户或其他私有身份资料。

## Web 最小协议（现有协议，无需新增类型）

本地 `com.obr-suite/dice-replay`，数据 `{cid, action:'toggle'|'open'|'close'}`。单次 cid=rollId，群体 cid=collectiveId。`toggle` 同项取消；`open` 替换当前项；`close` 仅关闭匹配当前 cid 的项。Suite 只接受本机 connectionId 与有权查看的历史，不写房间数据。Web 任务负责页面选中态和用户点击；Suite 负责地图标签状态和最终清屏。

## 源码与构建范围

阶段性保存 SHA：`48cd2871cca790533cc5d68878f250cabde7cffa`。最终 SHA 在推送回执提供，避免把提交自身 SHA 写进自身文件造成自引用。

配套 Web 只读参考是 `codex/final-integration230` 的 `db223af57bd3df9e5422534de5d9a0806cd8832f`；未修改其代码或提交。两侧源码沿用原 227 manifest/公告版本。本任务不发布新版本；部署方以后须同时更新配套源版本，不能把此截图里的 227 当作已部署 230 的独立回执。

构建新版时必须指定 `DND_CARD_WEB_ROOT`；缺失或不完整配套源会明确拒绝构建，而不会回退读取旧公告。新正文置于既有 `assets/` 白名单内，已通过国内宿主覆盖包构建。Vite 本地开发也提供同一生成路由。未扩大历史发布脚本白名单、没有运行部署。

## 验证

类型检查、新旧两种 Vite 宿主构建通过。选择 8、群体 29、骰子核心 36、队列 6、加载器 6、生命周期 11、历史权限 11、Controller 历史 5、资产锁 6 项通过。公告内联原有 9 断言通过。生命周期新增回归覆盖历史互斥、再点取消、迟到关闭、群体重复及迟到结果、取消后显式显示/隐藏、权限切换、坐标读取消竞争。初次测试夹具缺失 ts，补齐真实历史必需字段后通过；未改变产品校验来迁就夹具。

- Chromium `151.0.7922.173`，360 / 1280 宽度，真实 DOM 与 BroadcastChannel 的宿主/overlay 标签逻辑及新旧生产公告页共 45 项通过，无脚本错误。单次及群体再点后 `.token-result` 节点数量为零；并非透明度变低。标签测试只替换 SDK 与物理渲染器边界，不能据此称实际物理投掷通过。
- 独立实际安装 SDK / iframe 跨窗口宿主流程 21 个行为断言通过，另有一个缓存选择计时样本。快速切换、迟到绑定、慢卡绕过、Pin/Unpin、权限撤销恢复、保存 ACK 与旧值拒写通过，无脚本错误。
- 实际本地 HTTP relay、生产 Web 桥、5 卡 / 20 怪物场景：普通空闲约 46 秒后 5 项通过；虚拟时钟空闲 60 秒后 5 项通过；CDP 实际冻结宿主 61 秒后恢复共 6 项通过。恢复后选卡分别约 15 / 15 / 14ms。后续怪物、多选与取消恢复通过。三个运行是不同故障/时序场景，未累计成真人房间验收。
- 实际重建 Jolt / WASM / WebGL（SwiftShader 软件渲染）6 项通过：损坏脚本恢复、持续损坏三次后拒绝、同 worker 再试、固定种子 `2d6+1d20+5` 物理面 `6/5/16` 与总数 32、完整动画、WASM 一次带版本下载、启动 JSON 零请求。6 项由原工具的检查分组计数；不是 GPU 性能测试。
- 最终源码宿主 / workbench-dice / dice3d 重建：261 个文件，1061 个静态引用、59 个资产锁通过；未重用旧在线 3D 子站。工具生成的是宿主覆盖包，非完整网站，不含 manifest 或部署。

复跑中还纠正了独立配置打包把 rolldown 原生动态依赖内联进单文件的问题；使用明确依赖根动态装载后覆盖包通过。公告邮箱浏览器断言起初误要求全页只有一个邮箱链接，历史批也有同一公共邮箱；修正为当前入口可点击，不删历史内容。

已保存可复核 JSON、单元日志及窄屏/宽屏截图至 [evidence/suite-host-repair-20261001](evidence/suite-host-repair-20261001)。原始完整浏览器请求/relay 流量和构建日志在忽略路径 `.local-evidence/`，证据提交不包含会话凭证、真实玩家数据或下载依赖。

## 加载与发布流程排查

ModuleLifecycle 按项目既有顺序启动。独立生产类测试证实慢前置 hook 会延后后续模块且上报 slow；失败的 cluster popover 不阻止权威设置到达后的模块启动。未发现需要本次新增补丁的启动死锁。MusicBoard 与 Transitions 仍有同时静态/动态导入警告，可能扩大初始下载；保留为后续可量化优化，不冒险改为全部并发。

项目不存在 AGENTS.md / .agents 指令或适用本次代码工作的 SKILL.md；工作区指令目录为空。分支完整树没有 `.github/workflows`，Suite 没有 GitHub.io 或桌面打包 pipeline；国内部署脚本及独立质量测试保留。仓库 hooks/Actions API 在此环境返回 Forbidden，不能核实外部 hooks；源码分支使用 `[skip ci]` 保存，且不运行任何部署脚本。

## 阻塞与未验

国内 manifest 的 curl 与网页读取在本环境 HTTP 403 / 无法访问；不能据此认定源码加载故障或声称独立复核线上 230 成功。Firefox 下载安装被网络策略 403 拦截，环境没有其他可用浏览器；Chrome/Edge/Firefox/Safari 的完整跨引擎验收未完成。旧 `workbench-notice-175-selftest.mjs` 首次因写死 Windows Web 路径失败，本轮未把它算作通过；使用独立模块类检查上述启动边界。

没有已授权可用的真实 Owlbear 测试会话；未建立玩家房间、未额外登录账号。真实房主/玩家双端、角色 Owner 边界、多端群体暗骰、玩家实际线路与实体手机触控仍待真人验证。依次慢加载的实际玩家网络原因仍待 trace；当前 403 仅是执行环境的访问限制。

回滚方式为在未来获准集成/发布前撤销本分支两个源码提交；目前生产没有变化。复现使用项目既有 selection/group/dice 工具，`tools/suite-host-repair-browser.mjs` 的 `PLAYWRIGHT_PACKAGE` 指向安装有 Playwright 的 package.json，`PLAYWRIGHT_EXECUTABLE_PATH` 指向可用 Chromium；61 秒冻结由 `HOST_FREEZE_MS=61000` 启用。不要运行任何 deploy 脚本来复现测试。
