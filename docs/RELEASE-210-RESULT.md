# 210 发布回执 · 2026-09-30

用户本轮明确要求“部署吧，部署到网站和枭熊插件”，并要求更新对应公告。本次网站、新版工作台、旧版阅读器和 GitHub Pages 均已上线。

| 入口 | 已发布版本 |
| --- | --- |
| 国内车卡网站 https://obr.dnd.center/card/ | standalone-1.0.210 / 公告 0.1.15 |
| 新版 Full Suite https://obr.dnd.center/suite-dev/manifest-dev.json | 1.0.210-dev |
| 旧版 Full Suite https://obr.dnd.center/suite/manifest.json | 1.3.14，仅同步阅读器与公告，保留 XLSX |
| GitHub Pages https://fullpeople.github.io/DND-card-web/ | 公告 0.1.15，与国内站同一运行构建 |

公开源码包对应 Web `b0f2cb18c99633f652f43894f52655e2320d7e87`、Suite `5f1f30fa1700cdad25c52aeea92dbe2eb1fdee17`。运行代码来自 Web `b9895c377929c8fb8747d5a0bc2fc28515027d18`，之后只更新测试和验证记录；最终包已逐项确认运行文件字节相同。Web 正常快进 main；Suite 发布维护分支为 `codex/release-210`，没有强推分叉 main。

## 本批内容与公告

- 保留云端既有熟练项识别、背景赠品删除记忆、双列操作按钮、拖拽拒绝原因、明确指定赠送戏法和单件武器属性选择修复。
- 空白角色无容量时隐藏预备框，框高随内容收缩；已知法术按戏法和环阶折叠。默认普通预备分类，额外分类随职业或来源出现；分类标题可输入正负容量修正，实际格数按上限显示，超额内容单独保留。
- 首次规则、资料显示与扩展设置；反馈仅在公告内，使用 DND-card Issues 与 1763086701psw@gmail.com；角色卡暂时移除语言选项。
- 职业同步采用映射核对、变化预览、创建副本，保留原卡及既有资源次数，新资源从 0 开始。自定义职业可保留原样，子职与未知规则仍需人工核对。
- 最新公告为 2026-09-30，2026-09-28 和两批 2026-09-27 历史完整折叠。网站、新版、旧版分别说明适用范围；群发纯文本见 [ANNOUNCEMENT-210.txt](ANNOUNCEMENT-210.txt)。

## 验证

- [完整 CI 36720252591](https://github.com/FullPeople/DND-card-web/actions/runs/36720252591) 通过并发布 Pages：270 单元通过、5 项外部资料测试跳过；142 浏览器通过、8 项按项目不适用跳过；最终 0 失败。包括发布 55、反馈 17、兼容 4、触屏 6、独立站 17、自动化 25、双入口 18。
- 本机 Node 22.17.1 / Windows Edge：270 单元、类型检查、常规与独立构建通过；最终公告下 17 项独立站浏览器通过。五条新增流程各连续运行五次，25 次通过。独立产物审计无联机模块。
- 首次 CI 的两项失败为旧测试契约：未预备手动戏法及已移到分类标题的容量计数。随后三次 CI 分别暴露成功迁移、保存失败、容量刷新测试过早读取或刷新存储；改为等待导入初始化或目标容量实际落盘后再取基线/刷新。完整对象比较、格数、资源、失败重试与原卡保留断言均保留，产品实现未因此改动。所有失败日志保留在发布证据中。
- 服务器 120 个发布文件散列匹配；新版其他 1032 个文件、旧版其他 548 个文件内容保持不变。Pages HTML、服务工作线程与全部 JS/CSS 共 12 个运行文件与本机已测构建字节一致。
- 公网网站与新版的宽屏/窄屏公告四个场景通过；最新日期与三批历史默认折叠正确，无页面异常。旧版真实公告渲染和浏览器 JSON 桥往返通过。Wiki 与 SDK 身份采用合成夹具，未连接真人房间或写玩家角色。
- 公网 111 个文件（包含运行文件、独立下载包和对应源码档案）散列全部匹配，共校验 40,249,133 字节；逐项结果在 `G:/CodexArtifacts/release210/public-verification.json`。

## 数据、隔离与回退

只替换静态前端，不修改角色或牌局数据库；中继、三龙牌服务的程序和启动时间不变，Nginx 不变，没有重启服务。旧散列资源保留给尚未刷新的页面。

回退目录：`/var/www/obr-plugins/card-before-210`、`suite-dev-before-210`、`suite-before-210`。仅回退静态文件，不用旧数据库覆盖玩家后续操作。

Web 工作目录 `U:/code/DND-card-cloud-feedback-20260930-7f00bead`，Suite 工作目录 `U:/code/DND-card-suite-release210`。受保护的 `U:/code/DND-card-automation-209` 仍为原 HEAD，18 个已跟踪修改、9 个未跟踪文件的 SHA256 和 Git 状态均未变化。其他 Suite 骰子开发、Godot/native 和历史混合脏树未打包。

最终证据：`G:/CodexArtifacts/release210`，包含 package-receipt、deployment-output、ci-final、local-verification、public-verification、pages-verification、live-ui、live-legacy-ui 和截图。此前各候选及本地回归保存在 `U:/code/DND-card-cloud-feedback-20260930-7f00bead-validation` 及 G 盘同任务候选目录。本机独立预览 `http://127.0.0.1:5183/` 保持运行。

## 未完成与未验证

自动选择/按条件筛选的专长赠送规则、完整英文翻译尚未完成；手动容量不代表自动规则完成。复杂兼职、动态次数和完整休息规则未全部支持。真实 Suite 宿主、权限变化与多人同步、实体手机和玩家具体旧卡仍需验证。棋子状态残留和保存结果未确认的问题仍在排查。独立预览不能证明完整枭熊联动正常。
