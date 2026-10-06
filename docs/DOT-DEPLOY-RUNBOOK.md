# dot GitHub 部署接入 · 只读预检阶段

2026-10-06 用户批准后，已安装专用账号、固定只读入口及 SSH 隔离，配置两个 Environment。**生产发布尚未接通。** 本工作流仅手动触发预检；没有生产写入、上传或回滚入口，也没有持续发布触发器。最终实际 SSH/OIDC 结果与完整 CI 以交接回执为准，不能由配置完成推断通过。

| 仓库 | 允许分支 | Environment | 固定目标 | 配置时线上版本 |
| --- | --- | --- | --- | --- |
| FullPeople/DND-card-web | main | production-card | obr.dnd.center/card/ → /var/www/obr-plugins/card | standalone-1.0.248 |
| FullPeople/obr-suite | dev | production-suite-dev | obr.dnd.center/suite-dev/ → /var/www/obr-plugins/suite-dev | 1.0.248-dev |

FUS、稳定 suite、独立三龙站点、后台服务、relay、Nginx、systemd 与玩家数据均不纳入发布。配置前发现其他发布已从246/247推进到248；保留新的产品与 CI 基线，以正常合并更新准备分支，未强推、回退或覆盖线上。

## 已执行的持续授权

- 服务器 `obr-deploy`（uid996）：密码锁定；home、authorized_keys、helper 与 sudoers 均由 root 管理。唯一 sudo 命令 `/usr/bin/python3 -I -B /usr/local/libexec/obr-deploy/server_preflight.py`；不接受可变参数。helper 只接受 `preflight`，固定仓库/分支/Environment/目标与 JSON 字段，没有通用命令入口。
- `/etc/ssh/obr-deploy-preflight.conf` 在主配置末尾以 Match all + Include 加载。只针对此账号允许公钥、禁用密码/键盘认证及云动态 AuthorizedKeysCommand；固定 authorized_keys 和 ForceCommand，禁用转发、PTY、tunnel、user rc。用户环境继承既有全局 no。`sshd -t`、原 root/sync 有效配置一致检查、SSH reload 和 root 重新连接通过。未修改防火墙。
- 两个 Environment 仅允许表中精确 branch，无 tag/通配符；审批人 FullPeople，管理员不可跳过。同账号人工审批保留，Prevent self-review 关闭；dot 不能代替人工审批。
- `DEPLOY_KNOWN_HOSTS` 已填入已核对的服务器公开 host key；指纹固定为 `SHA256:bS1JRj3+1zJntm+ZOKtjlRhK7MjAAOEdKOdnKq+2yco`。未读取服务器私钥。
- 安装期间持有既有 `/run/lock/obr-static-release.lock`。五站点全量散列、固定保护文件与后台服务状态前后一致；任意 sudo 与 publish 负例被拒绝。安装回执 `/root/codex-release-receipts/dot-deploy-preflight-20261006.json`；SSH 配置原件仅保存在服务器 root 管理目录，未上传仓库。

## 用户安全入口步骤

尚未由工具创建或读取部署私钥；安装时 authorized_keys 为空、Environment Secrets 为空。用户只选择/生成**一个**专用身份，沿用到两个 Environment；不复用 root 私钥，不创建第二套 PAT/SSH 身份。

服务器安全控制台由管理员把该身份公钥写成唯一一行，保持 root 所有、0644，目录0755：

```text
restrict,command="/usr/bin/sudo -n /usr/bin/python3 -I -B /usr/local/libexec/obr-deploy/server_preflight.py" ssh-ed25519 <public-key>
```

将同一私钥分别通过 GitHub Environment 的安全输入框提交为 `DEPLOY_SSH_KEY`：

- [Web Environment 设置](https://github.com/FullPeople/DND-card-web/settings/environments) → production-card。
- [Suite Environment 设置](https://github.com/FullPeople/obr-suite/settings/environments) → production-suite-dev。

密码、令牌、私钥不进入聊天、截图、日志或仓库。授权完成后只检查 Secret 名称、服务器公钥数量/指纹、权限；不读取 Secret 值。真实 GitHub runner TCP22 可达性、受限 SSH 与真实 OIDC 尚须单次预检验收。

## 工作流、输入与门禁

工作流名 `Dot deployment preflight`，路径 `.github/workflows/dot-deploy-preflight.yml`，唯一触发 `workflow_dispatch`。Suite 默认 main 注册同一套预检文件及完整CI入口；跨窗口/四资源CI仅补workflow_dispatch，测试内容不变。不得把 dev 产品整体合入 main。main 上 Suite 预检主动拒绝，实际执行仅 dev。

输入均必填：

- `ci_run_ids`：逗号分隔的最终分支精确 SHA 完整成功 CI IDs。Web 必须 Verify web（web.yml，完整 verify/浏览器矩阵）；Suite 必须 verify-suite.yml、dice-cross-window-ready.yml、dice-release246-profile.yml（保留四资源 job）。所有 jobs 必须 completed/success，失败、取消、跳过和分页不全均拒绝。
- `expected_release_sha256`：当前目标 release.json SHA256。配置时 card `d156e0fdc5cf848911cdacec2d61ef2ad6318428b1db607faf10bed38dbfa50a`；suite-dev `cbcc8b635eaf2d6b71e80205e246d33f70af69e306c72addc99723e1e2e56e16`。每次运行前刷新，不能沿用旧线上值。

保留最新既有完整 CI 与其精确 paired Web SHA；当前 Suite verify-suite 的配套 Web 是 `0dde358a2382d4c3d88977165f3a854feb0609e4`，含新自动化来源验证。接入不重写已有测试门禁。

服务器固定验证 GitHub 官方 JWKS/RS256、issuer/audience、repository ID/owner ID、branch、Environment、workflow 路径/SHA、job SHA、github-hosted、event 和短期有效期；SSH key 本身不能绕过 OIDC。运行前后复核当前分支头，旧绿灯不能替代当前 SHA。

使用 GitHub-hosted runner，不安装本机/服务器自托管 runner；触发后用户电脑离线不影响任务。仓库 concurrency 不取消既有运行；跨仓库串行依靠服务器现有全局锁，锁忙即拒绝。只读检查验证当前全树、保护状态、备份/暂存容量和 renameat2，不持久改线上；返回 `candidateArtifactValidated:false`，不冒充新候选包验收。

## dot 触发与查结果

dot 使用自身现有 GitHub 认证调用 `POST /repos/<固定仓库>/actions/workflows/dot-deploy-preflight.yml/dispatches`，ref main/dev，inputs 如上。需要现有认证的 Actions write；不得依赖本机 gh token。当前可用连接器已实际验过 Actions rerun，但没有首次 dispatch 工具；dot 首次请求仍需其现有认证/API能力验收，或另行审查触发适配。不能把本机 CLI 成功表述为 dot 已可用。

```text
gh workflow run dot-deploy-preflight.yml --repo FullPeople/DND-card-web --ref main -f ci_run_ids=<exact-ci> -f expected_release_sha256=<fresh-hash>
gh workflow run dot-deploy-preflight.yml --repo FullPeople/obr-suite --ref dev -f ci_run_ids=<suite-ci>,<cross-window-ci>,<resource-ci> -f expected_release_sha256=<fresh-hash>
gh run list --repo <fixed-repository> --workflow dot-deploy-preflight.yml
gh run view <run-id> --repo <fixed-repository>
```

FullPeople 在 Actions 网页人工批准对应 Environment。查看 conclusion、summary 与 `dot-preflight-<run-id>` artifact 的 `preflight.json`；验收必须 `ok:true`、正确 target/精确 SHA，onlineVersionWrites/persistentServerWrites=false。密钥仅托管 runner 临时目录使用后清理；JWT 只在内存/stdin，不输出。合约工作流 `Validate dot deploy contract` / dot-deploy-contract.yml 无凭据，只证明授权与拒绝合约测试通过。

## 正式发布与回滚仍需完成

真实预检通过后展示结果，用户再确认首次生产目标和持续触发条件。随后准备精确 SHA 产物（含 Suite 受校验生产包）、全文件/源 ZIP 绑定和 artifact 散列，审查固定生产入口并另行批准写权限。复用原 atomic_frontends.py 的全局锁、归档/全树校验、全部目标本轮备份先于切换、历史资源保留、renameat2、发布回执、失败回滚及保护漂移拒绝；不接受上传的可执行发布器、任意路径/root 命令。

最新248发布的管理员恢复入口为 `/root/codex-release-packages/automation-progress248-20261006/atomic_frontends.py`，受其精确 package-receipt 散列及原保护状态约束，目标成对 card + suite-dev。最终交接另给实际校验结果；不得只回滚其中一站、改写旧回执或使用246/247的旧入口恢复248。新账号/helper 明确拒绝 rollback；dot 固定回滚工作流尚未启用。撤销访问时先撤销 authorized_keys/Environment Secret 与 sudo 入口，再停用账号，保留限制直到账号停用；不留下云动态认证路径。

参考：[GitHub workflows API](https://docs.github.com/en/rest/actions/workflows)、[Environment 审批](https://docs.github.com/en/actions/how-tos/managing-workflow-runs-and-deployments/managing-deployments/reviewing-deployments)、[OIDC](https://docs.github.com/en/actions/reference/security/oidc)、[OpenSSH](https://man.openbsd.org/sshd.8)。
