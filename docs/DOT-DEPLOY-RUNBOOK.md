# dot GitHub 部署接入：预检阶段，2026-10-06

本分支只准备连接与只读预检。没有安装服务器文件、创建账号/密钥、填写 Secrets、修改 Environment/保护规则/防火墙、切换线上版本或开启持续部署。`server_preflight.py` 没有发布、上传、回滚和任意 shell 入口。原发布器仍是生产发布与回滚的权威；自动生产发布尚未接通。

## 已核对的目标与权限边界

| 仓库 | 唯一发布源分支 | 本阶段 Environment | 固定站点 | 当前线上版本 |
| --- | --- | --- | --- | --- |
| FullPeople/DND-card-web | main | production-card | https://obr.dnd.center/card/ → /var/www/obr-plugins/card | standalone-1.0.246 |
| FullPeople/obr-suite | dev | production-suite-dev | https://obr.dnd.center/suite-dev/ → /var/www/obr-plugins/suite-dev | 1.0.247-dev |

FUS、稳定 `/suite/`、独立三龙站点、后台服务、relay、Nginx、systemd 和玩家数据不纳入发布。只读保护校验会散列固定保护文件/站点并读取服务运行起点；不读取数据库、密码、私钥或令牌文件。

本机 SSH 已用既有认证、严格主机校验完成只读调查。服务器目前仅有 root 可进行通常的 SSH 登录，没有可复用的专用部署账号。既有 root 私钥不会放入 GitHub。服务器已有 `/run/lock/obr-static-release.lock`、`/root/codex-release-packages/`、`/root/codex-release-receipts/` 和本轮完整备份。

服务器 SSH Ed25519 公钥指纹为 `SHA256:bS1JRj3+1zJntm+ZOKtjlRhK7MjAAOEdKOdnKq+2yco`。这是公钥指纹，不是秘密；工作流固定检查它，没有关闭主机校验。

## 实际检查结果与缺口

- 线上 card 有 1011 个文件，suite-dev 有 5113 个文件；当前全树匹配各自发布回执，归档内容/源 ZIP 绑定校验通过。246、247 完整备份分别有 941、5103 个文件，并匹配原始基线。锁可取得，renameat2 可用，调查时剩余服务器空间约 10.2 GiB。
- 旧回执的 relay 运行起点已变化，因此当前受控历史回滚会因保护门禁停止。保留此限制；不能将旧备份存在表述为“此刻可以无条件回滚”。没有执行回滚或覆盖保护基线。
- Web `production-card` 已存在，允许分支列表为空、无 Secrets/Variables、无 required reviewer；Suite 没有专用 Environment。没有修改这些设置。
- Web main 的调查基线是 `b0e61826849b54b9264d9254cbec4759e23f7640`；Suite dev 是 `64a0cbb215f77a94bea0c84d11aabd9408660bfa`；Suite 默认 main 是 `639c8217b41905fbde4222783ff16e95bde13b67`。main/dev 当前是 `[skip ci]` 文档提交，旧成功 CI 不是这些新 SHA 的成功门禁。合入预检工具后必须为最终 SHA 执行完整 CI。
- Suite 默认分支是 main。首次 workflow_dispatch 注册需要 workflow 路径同时存在于默认 main 与执行 dev；另备一个仅添加这些新文件的 main 注册分支，不能整体合入 dev 到稳定 main。
- 当前 GitHub 连接可读取两个仓库，已识别 FullPeople；提供创建 issue、读取/重跑部分 Actions 的工具，但没有创建 workflow_dispatch 的工具。dot 本身的连接方式尚未确认；本机 gh 有权限不代表 dot 已能触发。工作流需要 dot 自己的现有登录态/API能力，或另经确认的 IssueOps 触发适配。没有创建新的 dot 凭据或 PAT。

## 需要用户逐项批准的配置（尚未执行）

1. **一个服务器账号 `obr-deploy` 与只读固定入口。** 目标是从 GitHub-hosted runner 使用 TCP 22 连接 obr.dnd.center。锁定账号密码，无通用 sudo；账号/home/.ssh 布局由 root 管理，账号不能写入 authorized_keys 或发布脚本。唯一 sudo 命令是 `/usr/bin/python3 -I -B /usr/local/libexec/obr-deploy/server_preflight.py`，无可变参数。SSH 公钥必须带 `restrict,command="/usr/bin/sudo -n /usr/bin/python3 -I -B /usr/local/libexec/obr-deploy/server_preflight.py"`。禁用 PTY、端口/agent/X11 转发与用户 rc；用户请求的远端命令被固定入口代替。入口只返回指定目标与保护状态的散列/容量/门禁结果，不能上传、发布、回滚、改服务或运行任意命令。后果是一个持续存在但只读的服务器访问授权；撤销对应 authorized_keys 项和 sudoers 文件即可停止该入口。此阶段没有任何生产写权限。
2. **复用 Web `production-card`，新建 Suite `production-suite-dev`。** 只允许 branch main/dev（无 tag/通配符），设置 required reviewer 为用户确认的审批人，禁用管理员跳过审批；保留任何新发现的现有审批。如审批人为 FullPeople 且 dot 使用同一 FullPeople 身份，开启 Prevent self-review 会阻止该身份审批自己触发的运行。需用户决定保留同账号人工审批，还是指定另一个已有审批人；不擅自创建账号或放松审批。本阶段工作流仅 workflow_dispatch，绝不增加 push/workflow_run/issue 发布触发器。
3. **一个专用 SSH 身份，由用户通过安全入口管理。** 未发现既有受限部署身份可复用；先经用户批准，再由用户在安全平台/密钥管理入口生成或选择一个身份，把公钥以第1项限制安装到服务器，把同一私钥分别提交到两个 Environment 的 `DEPLOY_SSH_KEY`。不创建第二套 SSH 密钥，不复制 root 私钥，不写入聊天、截图、日志、仓库或 GitHub repository-level Secret。`DEPLOY_KNOWN_HOSTS` 是 Environment Variable，内容是与上述指纹匹配的唯一 `obr.dnd.center ssh-ed25519 ...` 公钥行，由平台入口填写。工作流没有密码回退和主机信任回退。

4. **只针对 `obr-deploy` 的 SSH 隔离设置和 SSH 服务 reload。** 实测全局启用了云平台动态 `AuthorizedKeysCommand`。仅设置 authorized_keys 上的 restrict 不能约束该替代认证路径，故必须先安装 `obr-deploy-preflight.sshd` 对应的 Match User 配置：仅允许公钥、关闭密码/键盘认证、禁用此账号的动态公钥入口、固定唯一 authorized_keys 文件、ForceCommand 固定 helper、DisableForwarding、禁止 PTY/tunnel/user-rc。user-environment 继承现有全局 no；本服务器不允许该选项写在 Match 中，安装器检查最终有效值仍为 no。固定配置文件建议 `/etc/ssh/obr-deploy-preflight.conf`，管理员审查后在主配置末尾 Include，执行 `sshd -t` 并 reload SSH；不影响 root/其他用户的规则，不重启或断开现有连接。若配置结构/平台机制不允许如此隔离，停止而非扩大权限。后果是此账号失去常规终端与云平台临时公钥登录能力，只能使用指定入口；保留账号时不能先移除这个限制再留下动态认证路径。

账号和固定 sudo 入口的安装模板见 `tools/dot-deploy/admin-install-preflight.sh`。它在创建账号前检查已批准并生效的 Match User 规则；没有替用户编辑/reload SSH 配置。这些均是审查材料，不是本轮已执行操作。需要 root 是因为历史发布根和服务保护文件目前由 root 管理；授予的是精确只读程序，并非 root shell。管理员安装/检查完成、用户填好认证材料后才运行一次 GitHub 连接预检。**不修改防火墙；GitHub runner 到 TCP 22 的实际可达性尚待该次运行验收。**

## 工作流与输入

- 名称 `Dot deployment preflight`，路径 `.github/workflows/dot-deploy-preflight.yml`。
- 唯一触发是 workflow_dispatch；目标、host、port、账号、路径、命令、Environment、允许分支均不能由输入改写。
- 输入 `ci_run_ids`：逗号分隔的完整成功 CI run IDs，必须对应执行分支的精确当前 SHA，不能用旧发布的绿灯顶替。
- Web 必须包含 `.github/workflows/web.yml` 的完整 verify/全部浏览器矩阵。
- Suite 必须同时包含 `.github/workflows/verify-suite.yml`、`dice-cross-window-ready.yml`、`dice-release246-profile.yml`。保持精确配套 Web SHA、`DND_CARD_WEB_ROOT`、原来的类型/构建/浏览器/源码/时钟/资源/视口门禁。所有 jobs 必须 completed/success，取消、失败、跳过或分页不全都拒绝。
- 输入 `expected_release_sha256`：目标当前 `release.json` 的完整 SHA256。本轮 card 为 `9ea58837f7f53f6e4d11008661b24c99c4f1d4b32903ad31eec4382308319e2b`，suite-dev 为 `d855baa42db68d3c4a8e24f60bc86c6cc4d79f14d7ce4af03b2d64083311a705`。再次运行前需刷新，不能无限沿用历史值。
- GitHub 提供短时 OIDC。服务器用官方固定 JWKS 与 OpenSSL 验证签名，检查 repository ID、owner ID、branch、Environment、workflow 路径/SHA、github-hosted runner、event、audience、有效期。SSH key 单独泄漏也不能替代正确的 GitHub job 身份。JWT 不打印或持久保存，不另设凭据。
- `concurrency.cancel-in-progress:false` 保留运行；跨仓库全局串行依靠现有服务器锁，抢锁失败即停止，不能依靠 GitHub 仓库内 concurrency 假称全局串行。
- GitHub-hosted runner 执行预检，电脑关机不影响已经触发的运行。服务器没有安装自托管 runner。

## 触发与看结果（配置验收后才适用）

dot 必须使用自己的现有 GitHub 认证进行以下 API/网页操作，不读取本机会话的 token。REST 入口是 `POST /repos/FullPeople/DND-card-web/actions/workflows/dot-deploy-preflight.yml/dispatches`，Suite 则是 `FullPeople/obr-suite` 同一路径；ref 分别 main/dev，inputs 如上。该 API 需要现有认证的 Actions write 权限。当前连接器未提供此调用，不能将以下 CLI 示例当成 dot 已验收。

```text
gh workflow run dot-deploy-preflight.yml --repo FullPeople/DND-card-web --ref main -f ci_run_ids=<exact-full-ci-run> -f expected_release_sha256=<fresh-card-release-hash>
gh workflow run dot-deploy-preflight.yml --repo FullPeople/obr-suite --ref dev -f ci_run_ids=<suite-ci>,<cross-window-ci>,<resource-ci> -f expected_release_sha256=<fresh-suite-dev-release-hash>
gh run list --repo FullPeople/DND-card-web --workflow dot-deploy-preflight.yml
gh run view <run-id> --repo FullPeople/DND-card-web
```

在 Actions 页面批准对应 Environment 等待项；dot 不代替用户审批。查看 run conclusion、job summary 及 `dot-preflight-<run_id>` artifact 的 `preflight.json`。必须为 `ok:true`、正确 target/精确 SHA，且 onlineVersionWrites/persistentServerWrites=false。签名验证只暂存公开验签公钥/签名字节，SSH 私钥只在托管 runner 的临时目录短暂存在并清理；JWT 和私钥没有日志、证据上传或仓库写入路径。

`Validate dot deploy contract` / `.github/workflows/dot-deploy-contract.yml` 是无认证材料的 Linux 单元测试，独立分支上的成功只证明合约测试通过，不证明 SSH/OIDC/Environment 或 dot 首次触发通过。

## 正式发布前的独立确认与验收

本阶段没有自动发布工作流、生产写入 sudo 权限或待执行的服务器 apply。正式部署仍需以下具体工作与用户确认，不能将预检工作流称为“自动部署已打通”：

1. 用户确认正式允许的仓库/分支/目标及“手动 dot 请求后审批发布”或“指定分支完整 CI 成功后请求审批发布”的触发条件；任何持续触发器只在该确认后添加。分支保护/审批人配置需单独审查，禁止强推、删除保护或绕过审批。
2. 准备精确 SHA 组合的完整候选产物、GitHub artifact SHA256/源 ZIP 绑定/manifest 与逐文件散列；Suite 现有 CI 产出主要是证据，仍需增加受校验的生产包产物，不能发布未经过完整门禁的新构建。CI gate、实际打包源码/配套 Web SHA、发布 SHA 必须一致。
3. 审查并安装固定生产发布适配器，复用已有 atomic_frontends.py 的归档校验、全树基线、全局锁、所有本轮备份先于任何切换、保留旧哈希资源与源码别名、renameat2、逐步回执、失败回滚、保护散列和回滚漂移拒绝。不得接受上传的可执行发布器、客户端任意路径或 root 命令。现有成对发布器与单目标发布器的目标集合/保护集合不同，必须针对这两个范围审查；不能只改 TARGETS 而漏保护集合。
4. 先在 GitHub runner 完成一次新连接/只读预检，用 dot 自身认证触发并看见结果。当前阶段此项未完成，因为第1至3项持续授权尚未批准/配置。
5. 展示预检与完整候选包结果、刷新线上及 Git 现场，获得首次生产发布确认，然后按 Environment 规则人工审批。发布后验证公网版本/全量文件/源码/压缩/必要交互和所有非目标保护状态。

本轮历史包审计验证了当前已发布产物；新预检入口返回 `candidateArtifactValidated:false`，明确未验新候选包。真实玩家设备和真实 Owlbear 房间不由部署连接测试验收。

## 现有回滚入口（本轮只检查，未执行）

Suite 247 的固定历史入口：

```text
python3 /root/codex-release-packages/dice-cross-window-tail247-20261005-r2/atomic_frontends.py --archives /root/codex-release-packages/dice-cross-window-tail247-20261005-r2 --receipt-sha 5ee9fe5309e19af7f14eb5c581f5c8a33757e45564212096a6d1bd4246e07411 --rollback
```

Web 246 的旧成对入口同时涉及 card 与 suite-dev，不能当成独立 card 回滚命令：

```text
python3 /root/codex-release-packages/resource-repair246-20261005/atomic_frontends.py --archives /root/codex-release-packages/resource-repair246-20261005 --receipt-sha c38fcb4a19d9771451fd5cbefe5a8ea6cfec4d40f02a489edbe3f4e4d78a43ed --rollback
```

两者目前保护状态不匹配；246 还会检查配套 suite-dev 是否仍为246，当前已247，因此不可直接执行。以后 dot 的固定回滚工作流必须关联新的发布回执、指定 Environment 人工审批、同一个受限账号/固定入口，并保留漂移拒绝。此阶段 SSH 入口明确拒绝 rollback。管理员需独立审查历史恢复影响，不修改旧回执让门禁强行通过。

## 参考

- GitHub workflow_dispatch 默认分支注册及 Actions write：[GitHub workflows API](https://docs.github.com/en/rest/actions/workflows)。
- 人工审批与 self-review 行为：[Reviewing deployments](https://docs.github.com/en/actions/how-tos/managing-workflow-runs-and-deployments/managing-deployments/reviewing-deployments)。
- 官方 JWT claims/JWKS：[OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc)。
- 固定命令与 restrict：[OpenSSH sshd manual](https://man.openbsd.org/sshd.8)。
