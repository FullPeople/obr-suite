# 2026-10-07 · 三入口 250 发布最终回执

用户授权网站、新版插件与旧稳定插件全部部署，并要求查找既有稳定配套内容。本轮完成 Web PR11 → PR12 → PR10 已合入成果的配套发布；Web PR13、Suite dev PR16、Suite main PR17 按顺序 merge，三个合并树均与通过检查的发布源码树一致。无重排、rebase、squash 或新冲突，未沿用其他 SHA 的产物。

发布于 2026-10-07T06:41:06.875116+00:00，实际线上为 [网站 standalone-1.0.250](https://obr.dnd.center/card/)（公告 0.1.40）、[新版 Suite 1.0.250-dev](https://obr.dnd.center/suite-dev/manifest-dev.json)、[旧稳定 Suite 1.3.15](https://obr.dnd.center/suite/manifest.json)。旧稳定复用现有 `tools/build-legacy-card-viewer.mjs`，只定向更新共享五页查看器、公告、版本与配套验证；没有整体合入 dev。既有稳定宿主、XLSX、地图及工具保留。

## 成果与边界

- 盾牌熟练保存规范化；赞助列表去重追加“别名”50元。
- 只读查看器导出本次收到的完整原始 JSON，不重新抓取或重序列化；已知工具熟练显示中文，手工标题、未知名称、字段和资源余额保留。刷新失败会移除旧卡面及导出入口。
- 2014／2024 链甲、鳞甲、盾牌六项 AC 定向验证与回归证据上线；没有追加生产 AC 公式变更或宣称整条规则已完成。
- 新战俑候选 [Web PR14](https://github.com/FullPeople/DND-card-web/pull/14)，本次核对头 `e30361fc2735d1c0a6fb974ff6b888d4adc56a32`，仍为草稿且四项 CI failure、浏览器 skipped。它明确排除于 release250；原始审计229输入仅找到4份，缺225份，当前消费者变更需要真实 Data 覆盖回执重新生成和绑定。公开交接中 Data39 的字节核验补丁不能替代原输入的完整重审；当前没有可配套合并的 Data 审计 PR。未伪造散列、数字或跳过发布门禁。
- Data 锁定 `0ac0520dae0a81ad15be0c53eac395d21a70230f`，18789 总数、4561 已核对、6527 已实装保持原核对口径。本轮不改变 Data 发布、权限、后端、独立三龙或玩家资料；不宣称整批完成。
- 公网浏览器采用合成角色、合成 SDK 就绪消息及本机真实 Chrome，不是实际枭熊登录房间或实体手机验收。真实房间、玩家原设备及实体手机仍待现场验证。用户更新插件时关闭附加窗口、刷新枭熊房间后重新打开。

## 源码与合并

| 分支 | 已检查且实际运行的源码 | 发布时实际合并 SHA | 合并 |
| --- | --- | --- | --- |
| FullPeople/DND-card-web / main | `ae6d213676d8eca71436e34c2400a5261479ecca` | `d57578b60270de14b60f9b04b198a75512cea11b` | [PR13](https://github.com/FullPeople/DND-card-web/pull/13) |
| FullPeople/obr-suite / dev | `a8c694e0c692886c8cef83d9ffc2e4526b93384c` | `905cd96c1564e800ffa5a6a867531315b7dfd849` | [PR16](https://github.com/FullPeople/obr-suite/pull/16) |
| FullPeople/obr-suite / main | `dce737ba0b99e144910eaeed92531277a55832cf` | `7d67e501845ce75601b07475bfd01457ee8a365e` | [PR17](https://github.com/FullPeople/obr-suite/pull/17) |

后续仅文档回执提交不改变运行源码或上述已测试文件树中的产品文件。源码下载 ZIP 的 git archive comment、完整哈希与运行元数据绑定到发布源码，而不是临时 PR merge SHA。

## 验证

精确发布源码9个工作流／34 jobs 全部 success；Web 完整 CI 23/23，1013 单元通过／32 既有条件跳过。开发插件完整回归45组、跨窗口及资源四 job 通过；旧稳定宿主构建与四个实际稳定查看器浏览器场景通过。

- [FullPeople/DND-card-web · .github/workflows/web.yml · 23 jobs](https://github.com/FullPeople/DND-card-web/actions/runs/37579806293): success，精确源码 `ae6d213676d8eca71436e34c2400a5261479ecca`。
- [FullPeople/DND-card-web · .github/workflows/automation-progress.yml · 1 jobs](https://github.com/FullPeople/DND-card-web/actions/runs/37579809966): success，精确源码 `ae6d213676d8eca71436e34c2400a5261479ecca`。
- [FullPeople/DND-card-web · .github/workflows/shield-training.yml · 1 jobs](https://github.com/FullPeople/DND-card-web/actions/runs/37579813724): success，精确源码 `ae6d213676d8eca71436e34c2400a5261479ecca`。
- [FullPeople/DND-card-web · .github/workflows/equipment-ac.yml · 1 jobs](https://github.com/FullPeople/DND-card-web/actions/runs/37578762526): success，精确源码 `ae6d213676d8eca71436e34c2400a5261479ecca`。
- [FullPeople/DND-card-web · .github/workflows/legacy-viewer.yml · 1 jobs](https://github.com/FullPeople/DND-card-web/actions/runs/37578765595): success，精确源码 `ae6d213676d8eca71436e34c2400a5261479ecca`。
- [FullPeople/obr-suite · .github/workflows/verify-suite.yml · 1 jobs](https://github.com/FullPeople/obr-suite/actions/runs/37578579094): success，精确源码 `a8c694e0c692886c8cef83d9ffc2e4526b93384c`。
- [FullPeople/obr-suite · .github/workflows/dice-cross-window-ready.yml · 1 jobs](https://github.com/FullPeople/obr-suite/actions/runs/37578582411): success，精确源码 `a8c694e0c692886c8cef83d9ffc2e4526b93384c`。
- [FullPeople/obr-suite · .github/workflows/dice-release246-profile.yml · 4 jobs](https://github.com/FullPeople/obr-suite/actions/runs/37578585900): success，精确源码 `a8c694e0c692886c8cef83d9ffc2e4526b93384c`。
- [FullPeople/obr-suite · .github/workflows/verify-stable-paired.yml · 1 jobs](https://github.com/FullPeople/obr-suite/actions/runs/37578630372): success，精确源码 `dce737ba0b99e144910eaeed92531277a55832cf`。

公网11个独立场景全部通过：三入口两版原 JSON 连续导出、中文/手工/未知熟练、无额外资料读取或角色写入、390px 导出按钮、失败刷新清除；旧0.3原文导出及实际上传桥接保留未知字段；网站1440/390px实际版本、日期公告、完整折叠历史、实际6527进度；两个插件宿主公告日期及折叠历史。已检查公网旧稳定窄屏、稳定公告与390px进度截图。

公网296个差量与固定入口文件逐文件 SHA256一致；17个源码别名校验206首尾范围、长度和精确提交，源码ZIP完整哈希在服务器整树核验中校验，没有将范围请求冒称整包HTTP下载；12个可压缩响应解压后哈希通过。三入口当前全部1247／5733／2460文件与发布预期一致，三个完整恢复副本及16项非目标/配置/服务保护均一致。未写玩家数据，未重启服务，未修改 SSH、sudo、Nginx 或 GitHub OIDC 授权。

首轮验证失败保留：默认 D:/Temp 下 Chrome 启动即退出，使用本任务独立 temporary 后同脚本11项成功；未更改产品或降低断言。首轮压缩样本含75字节JS，线上 Nginx `gzip_min_length 512` 正常返回原文，其哈希通过；记录实际头部及配置后以≥512字节样本复验12项通过，原失败报告保留。先前候选公告就绪断言修正、临时PR合并构建不匹配精确源码的包拒绝，以及两次封包校验拒绝均保留，未发布失败候选。

## 发布封存与恢复

- 封包回执 SHA256：`95805d7a7eeda9391e76d0191f9f09edb74ff07437cc03c30020a6ac400946d2`。
- 发布器 SHA256：`fe01c163bd27900857de1f8946f90077ec7f9f776e0ebddfbada21dfb77d5735`。
- 服务器完整发布回执：`/root/codex-release-receipts/web-fixes250-20261007.json`，SHA256 `00ed57aeef1bfb9105a2faf1a2c2636fff112eec9298cb0c995bf307cba4d2b6`。
- 封包与已审查发布器：`/root/codex-release-packages/web-fixes250-20261007`，仅目标三个前端目录。
- 使用排他锁、每入口独立完整新备份、全树及保护状态检查和 `renameat2 RENAME_EXCHANGE`；所有备份完成且验证后才首次切换。六项 Linux 合成发布/拒绝/并发/自动回退/手动回退/路径安全验证通过。

- `card`：`/var/www/obr-plugins/card-before-web-fixes250-20261007`，1171 个原文件；已逐文件完整散列复核。
- `suite-dev`：`/var/www/obr-plugins/suite-dev-before-web-fixes250-20261007`，5582 个原文件；已逐文件完整散列复核。
- `suite`：`/var/www/obr-plugins/suite-before-web-fixes250-20261007`，2112 个原文件；已逐文件完整散列复核。

若需要恢复到本轮发布前网站249／开发插件249-dev／旧稳定1.3.14，在服务器执行以下已合成验证的受保护回滚；当前目录或保护状态有漂移时会拒绝，必须先核对，不能强制覆盖：

```sh
python3 -B /root/codex-release-packages/web-fixes250-20261007/atomic_frontends.py --archives /root/codex-release-packages/web-fixes250-20261007 --receipt-sha 95805d7a7eeda9391e76d0191f9f09edb74ff07437cc03c30020a6ac400946d2 --rollback
```

回滚保留备份和失败发布目录，不 reset、clean、force push 或删除玩家资料。源历史回退使用相应实际 merge commit 的 `git revert -m 1` 并重新运行受影响检查；本轮没有在生产执行回滚。

证据目录：`U:/CodexWork/2026-10-07/web-fixes250/evidence`；干净隔离源、精确CI构建、源码ZIP、发布包及失败记录全部保留，原混合目录和 FUS 未改动。后续文档维护不重包或重标本轮产物。
