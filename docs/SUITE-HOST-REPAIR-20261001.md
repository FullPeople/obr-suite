# Suite 宿主修复 · 第一阶段

独立分支 `codex/suite-host-repair-20261001`，基线远端 `codex/final-integration230-suite` 的 `5b733dbf9c35aa066ac16fe2eafec0befe199a5b`。挂载 main 为另一条旧稳定历史；obr-suite-dev/main 停在 `ef0696922948a6a818c9182c32b7b24b5854f9db`，均未作为新版输入。没有修改 Web 代码、版本号、main、线上站点、房间数据或账号设置。

## 修复

- 新版后台每日公告、控制台和公告页统一读取 `announcement-dev.md`；由构建时明确指定的配套 Web `releaseHistoryFor('suite')` 与 `announcementVersionFor('suite')` 生成，保留最新批、折叠历史及 Gmail。旧版继续读取原 `public/announcement.md`。两者使用不同 modal ID 和已读/每日状态键。无法读取本频道 manifest 时不再借另一个频道的版本冒充成功。
- 历史只显示一个结果；群体自动结果与历史结果不再叠加。再点同一历史，显示节点应彻底移除，随后迟到的群体结果不重新显示已取消数字。保留群体显式显示控制。
- 迟到的旧行关闭消息不重置新行状态。身份或权限变化清理全部已显示结果。
- 坐标读取过程中取消结果时，强制补发最终空状态，避免 DOM 留住旧数字。
- 旧版设置和公共公告反馈已经使用 `1763086701psw@gmail.com`；另发现 Buff Studio 公共贡献入口仍有旧 QQ 邮箱，已改为同一 Gmail 链接。没有改赞助账户或其他私有身份资料。

## Web 最小协议（现有协议，无需新增类型）

本地 `com.obr-suite/dice-replay`，数据 `{cid, action:'toggle'|'open'|'close'}`。单次 cid=rollId，群体 cid=collectiveId。`toggle` 同项取消；`open` 替换当前项；`close` 仅关闭匹配当前 cid 的项。Suite 只接受本机 connectionId 与有权查看的历史，不写房间数据。Web 任务负责页面选中态和用户点击；Suite 负责地图标签状态和最终清屏。

## 第一阶段验证

类型检查、新旧两种 Vite 宿主构建通过。选择 8、群体 29、骰子核心 36、队列 6、加载器 6、生命周期 10、资产锁 6 项通过。生命周期新增回归覆盖历史互斥、再点取消、迟到关闭、群体重复及迟到结果、权限切换、坐标读取消竞争。初次测试夹具缺失 ts，补齐真实历史必需字段后通过；未改变产品校验来迁就夹具。

项目不存在 AGENTS.md / .agents 指令或适用本次代码工作的 SKILL.md；工作区指令目录为空。分支完整树没有 `.github/workflows`，Suite 没有 GitHub.io 或桌面打包 pipeline；国内部署脚本及独立质量测试保留。仓库 hooks/Actions API 在此环境返回 Forbidden，不能核实外部 hooks；源码分支使用 `[skip ci]` 保存，且不运行任何部署脚本。

国内 manifest 公开读取在本环境 HTTP 403；不能据此认定源码加载故障或声称独立复核线上 230 成功。Firefox 下载同样被网络策略 403 拦截。本机可用 Chromium；下一阶段补实际浏览器与 SDK / relay 证据。真实 Owlbear 双端、实体手机和玩家实际线路尚未验证。
