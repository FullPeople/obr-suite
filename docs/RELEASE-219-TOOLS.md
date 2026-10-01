# 219 热修复发布工具

本文件描述工具和边界，不是部署成功或真实枭熊验收回执。219 仅发布 Suite 的两项修复：点击 Action 内的骰子历史保持 Action 开启，以及先攻投掷/玩家端骰子故障。Suite 中对应公告也更新；卡面、资源、100 条历史及其他未发布 218 工作不随本包上线。用户本轮选择先做自动验证并部署，真实枭熊房主/玩家房间验收本轮不执行。

## 输入与范围

- Suite 从已发布 217 `79e0c46f3d86078946426ccdad4e2a03ced2c34f` 的隔离树构建。版本为 `1.0.219-dev`。
- Web 从运行 217 `023feb6256dd5a1d85d92e9fe338b45fe8f280f0` 的另一隔离树构建，版本保持 `0.1.19`。打包器限定 Web 提交差异只有 `src/platform/announcement.ts`、`src/platform/releaseNotes.ts` 和 `docs/` 下 Markdown/纯文本；其他运行逻辑、样式、依赖变化一律拒绝。
- 只发布 `suite-dev-219.tar.gz`。根 HTML/assets 和完整 `dice3d`、`workbench-dice` 来自新构建；workbench 只随公告重新构建。网站 `card`、旧 `suite`、其他独立子站、服务配置与玩家数据都不写。
- Web source.zip 更新根目录及 workbench 两份；Suite suite-source.zip 更新根目录、workbench 和 card-viewer 三份。源码 ZIP 绑定各自最终审阅的完整提交，要求 Git 树文件集合、注释、CRC、散列一致。card 网站的旧源码包保持原样。

## 构建与打包

先将两棵隔离树提交到最终审阅 SHA，并保持干净。Web 最终 integrated 构建前记录输入：

```powershell
python U:/code/DND-card-suite-dice-hotfix219-20261001/tools/package219.py --web-root U:/code/DND-card-web-dice-hotfix219-20261001 --snapshot-web F:/DND-card-dice-hotfix219-evidence-20261001/<fresh-web-snapshot>.json
# 运行最终 integrated 构建，然后构建 Suite；每次使用新的输出路径。
$env:DND_SUITE_DEPS_ROOT='F:/CodexWork/2026-09-27/feedback/suite'
$env:DND_SUITE_RELEASE_OUT='F:/DND-card-dice-hotfix219-evidence-20261001/<fresh-suite-build>/suite-host'
node U:/code/DND-card-suite-dice-hotfix219-20261001/tools/build-release217.mjs
python U:/code/DND-card-suite-dice-hotfix219-20261001/tools/package219.py --web-root U:/code/DND-card-web-dice-hotfix219-20261001 --web-commit <Web完整SHA> --suite-commit <Suite完整SHA> --web-source-snapshot F:/DND-card-dice-hotfix219-evidence-20261001/<fresh-web-snapshot>.json --integrated F:/DND-card-dice-hotfix219-evidence-20261001/<final-integrated> --suite-host F:/DND-card-dice-hotfix219-evidence-20261001/<fresh-suite-build>/suite-host --out F:/DND-card-dice-hotfix219-evidence-20261001/<fresh-ready>
```

复用已审阅的历史构建器 `build-release217.mjs`。其内部 `receipt.release` 仍为 217；219 外层回执明确记录 `builder.receiptRelease:217`，不篡改旧回执或绕过输入验证。源码、构建输入快照、构建输出、静态依赖闭包和 ZIP 提交逐一核对，打包前后再查一次。该构建器使用 `suite-3d-3` 协议。本工具不安装依赖、不重建 standalone、不上传、不提交或推送。

## 只读预检与原子切换

将部署脚本、tar 和 package-receipt.json 放在全新的服务器暂存目录。脚本只接受 `/var/www/obr-plugins`，默认只读；实际发布必须显式 `--apply`。

```sh
python3 /path/to/reviewed-stage/deploy-release219.py
python3 /path/to/reviewed-stage/deploy-release219.py --apply
```

预检锁定线上 217 的 Suite manifest、card release.json、两个 `release217-hashes.json` 和源码包散列，随后检查这两份旧文件清单的全部实际文件。新包逐成员验散列/字节数，拒绝逃逸、重复项、链接、特殊文件和范围外路径。旧 217 散列文件保留为历史证据，219 另写 `release219-hashes.json`；发布后应使用 219 回执及其恢复点审查，不能要求已替换文件继续满足旧清单。

`--apply` 在静态根目录下新建 stage，完整复制当前 Suite，只在 stage 中删除并重建两个骰子子目录。其他旧资产及独立子应用逐文件保留；workbench 更新已审查的公告产物，旧散列 chunk 保留。切换前再次核对 live 没有被其他发布更改。

生产切换用 Linux `renameat2(RENAME_EXCHANGE)` 将 live 与 stage 原子交换，没有站点路径消失窗口。旧目录随后命名为 `suite-dev-before-219`。没有该 API 或文件系统拒绝原子交换时直接停止，不降级到非原子切换。任何切换后验证失败再次原子交换恢复 live，并将失败候选保留为 `suite-dev-failed-219`。已有 stage、before、failed、成功回执或临时回执时拒绝覆盖，先人工检查。

成功前检查完整候选树、原始恢复点、整个 card/旧 suite/骰子试验站/三龙牌站、Nginx与后端程序散列，以及 relay/三龙牌服务启动时间。脚本不重启服务、不写后端或玩家数据。成功回执经 fsync 后原子改名落盘。回执明确真实枭熊房间未验、跨宿主最高层级问题未解决。

## 本机工具验证

```powershell
python U:/code/DND-card-suite-dice-hotfix219-20261001/tools/release219-selftest.py
```

脚本使用 F 盘下全新合成目录，验证归档路径/成员/内容、源码 ZIP 副本/提交、Web 公告白名单、stage 保留/替换、成功恢复点，以及切换前、校验后、恢复点命名失败三种恢复路径。兼容检查使用 Python 3.9 语法并移除 `hashlib.file_digest`；服务端依靠流式散列和逐文件解包，不使用较新版本的 `extractall(filter=...)`。Windows 通过注入目录交换验证恢复状态机，不冒充已执行 Linux 原子系统调用；真实服务器预检/发布回执需由发布者另记。

2026-10-01 本地自动验证：51 项合成检查通过，其中直接执行 CLI 的默认预检并比较整个夹具树，确认零写入；随后测试变更的 217 文件被拒绝，以及显式 apply 后回执、原始恢复点和 card 保护。证据保存在 `F:/DND-card-dice-hotfix219-evidence-20261001/release-tools/` 下各次全新 `offline-check-*` 目录，结果注明 `productionWrites:false` 和未执行真实 Linux 原子交换。
