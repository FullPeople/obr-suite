# QQ 卡库入口 277 上线回执

Full Suite 测试版已更新至 **1.0.277-dev**，仅发布 `/suite-dev/`。“我的 QQ 卡库”直接显示在当前工作台，关闭后返回之前的工作区。保留本人卡库读取与加载、默认锁定、卡主解锁后房间成员自动写回云端原卡，以及重新锁定。工作台的账号连接由云端验证后同步到当前玩家自己的插件后台，个人凭据不会进入房间信息。

运行源码 Suite `344aa81739507b0c36ca9f112c7694f126e409f0`、Web `0127861795822911c150fcc76b721ebab3c260ad`、Data `d9a1064a90b73522bbadf63132fe150969974592`。Suite 通过普通快进合并保留实际受测提交；后续提交仅补上线记录，不改变运行源码和发布包。276 的骰子修复及上线记录已保留。

17 项实际页面 QQ 流程、8 项通信权限、5 项个人账号连接和 55 项插件回归通过。最终源代码的 5 组 CI 共 30 个任务成功，正式文件来自 [QQ CI 38046046686](https://github.com/FullPeople/obr-suite/actions/runs/38046046686) 的完整发布包；[Suite CI 38046046721](https://github.com/FullPeople/obr-suite/actions/runs/38046046721) 通过完整兼容性检查。Web 的全量运行审计保留 18,789 条规则与 6,535 条已实现结果。

公网 28 项检查、服务器 9065 个完整文件及 124 项保护值通过。9 个完整源码 ZIP 别名逐项核对，公网抽检完整 Web 源码 ZIP。网站、后端、稳定插件、旧浏览器卡库、服务器配置及玩家数据保留。浏览器检查使用合成账号与房间接口，真实 QQ 扫码和真实多人房间未现场验收。

完整备份 `/var/www/obr-plugins/suite-dev-before-qq-entry277-20261010.tar.gz`，SHA-256 `1b3b15f9a5fe2c92016828f27602921e5cf9c2e181d0a1b9196c87290b8b7675`；发布回执 `/root/codex-release-receipts/qq-entry277-20261010.json`。首次备份核对将本次备份文件计作外部改动而安全停止，修正精确排除规则后，按已核对哈希重新验证同一份本次完整备份，并通过保护、切换和回滚检查。

回滚使用本次发布包的 `suite_links.py --archives /root/codex-release-packages/qq-entry277-20261010 --receipt-sha defdd6c1046df728a49adae49089a1cfae5ee44d60502e225924971e9ce7c581 --rollback`，会核对完整备份、原版文件和保护值后恢复。切换前的原版也保留在 `.suite-dev-retired-qq-entry277-20261010`。

使用时先关闭旧工作台、刷新枭熊房间，再重新打开 Full Suite 工作台。
