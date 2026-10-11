# QQ 卡库导入与在线接收更新 282 上线回执

[角色卡网站](https://dnd.center/card/?intro=0)和[卡库](https://dnd.center/library/)已上线 standalone-1.0.282；[新版枭熊插件](https://obr.dnd.center/suite-dev/manifest-dev.json)已上线 1.0.282-dev；云端服务为 1.0.282 / account-private。刷新网站；刷新整个枭熊房间页面后重新打开工作台。

单机版 QQ 账号二级弹窗加入角色卡搜索、刷新和“导入当前场景”。导入原五页编辑器中的云端卡；再次选择同一张卡打开已有副本，不另开浏览器。保留账号设置、退出和逐卡云端按钮。原卡身份、授权及未授权 DM 只读规则继续生效，编辑开关随只读权限禁用。

281 能将获准修改写回原卡，但缺少单机版接收其他端更新的轮询；枭熊已缓存的非当前云端卡也会跳过后台读取。282 补上这两条路径，以及同浏览器只读标签页显示更新和卡库画廊目录轮询。单机版可见且在线时每 5 秒读轻量目录，仅版本变化时拉取完整角色；枭熊采用 5 秒缓存及有界并发。切回页面或恢复网络后重新检查。云端目录只返回名字、版本和权限；未变化的房间读取也不再转换完整角色对象。

正常在线、同一张云端卡、有效账号和授权、无并发冲突时，网站、卡库和枭熊中的修改自动写回并被其他已加载副本接收。离线修改、结果不明的写入和并发冲突走独立恢复流程。两端同时有本机改动时，即使改的是不同字段，也保留本机草稿并提示冲突；本批没有宣称任意并发修改可逐字段自动合并。

## 运行来源与检查

- Web：`2e98cd984e433678573b166df3182243a5e65205`，[PR 56](https://github.com/FullPeople/DND-card-web/pull/56)。
- Suite：`7000cb61e3d55599184e91c306420290e187e212`，[PR 58](https://github.com/FullPeople/obr-suite/pull/58)，构建配对上述 Web。
- Data：`71ca23b7a9568add9f722215ab8ef1ace04d0977`，[PR 33](https://github.com/FullPeople/dnd5e-automation-data/pull/33)。

| 精确提交检查 | 运行 | 结果 |
| --- | --- | --- |
| web / .github/workflows/web.yml | [38115228957](https://github.com/FullPeople/DND-card-web/actions/runs/38115228957) | 26 项任务成功 |
| web / .github/workflows/cloud-migration.yml | [38115232001](https://github.com/FullPeople/DND-card-web/actions/runs/38115232001) | 1 项任务成功 |
| web / .github/workflows/dot-deploy-contract.yml | [38115276957](https://github.com/FullPeople/DND-card-web/actions/runs/38115276957) | 1 项任务成功 |
| suite / .github/workflows/qq-permissions.yml | [38116567611](https://github.com/FullPeople/obr-suite/actions/runs/38116567611) | 1 项任务成功 |
| suite / .github/workflows/verify-suite.yml | [38116567681](https://github.com/FullPeople/obr-suite/actions/runs/38116567681) | 1 项任务成功 |
| suite / .github/workflows/dice-release246-profile.yml | [38116567604](https://github.com/FullPeople/obr-suite/actions/runs/38116567604) | 4 项任务成功 |

最终运行源码共 28 项 Web 任务、6 项 Suite 任务成功。单机云端浏览器 9 项检查通过，涵盖账号弹窗原位导入、重复选择、跨标签页、当前与非当前角色接收更新、房间与网站经真实 HTTP 双向交换及锁定后禁用编辑。原生枭熊云端浏览器 32 项场景通过，使用真实构建、HTTP 权限服务和合成账号、SDK 房间环境；不替代真人 QQ 扫码、真实多人房间或实体设备验收。

完整实际运行审计保留 18,789 个身份、6,535 个实现见证、4,561 个已审查条目和 65 个消费者模块，绑定不可变 Data 报告。原始规则缓存 229 个文件共 52,318,109 字节，逐文件散列和长度已核对。本批最终消费者审计为 `909dd8c1d7973904ecd12dd20a72bdecb5727bc7`，报告 SHA-256 为 `a7555eab6dccd0b2739c3f93dd8f3b5fa3f341df7f5d09d5b0ffdee6ef0f1fb0`。

初轮审计发现工作区换行与已提交字节不一致，规范换行后重新执行完整审计。浏览器检查发现编辑开关遗漏只读条件，修复后再次完整回放并生成最终报告。原生 QQ 检查的公告确认版本仍固定为 281，阻挡了 282 交互；测试改为读取实际构建版本后重跑。保留失败记录，没有跳过审计或放宽账号授权。

插件发布前一次 GitHub 只读请求连接中断，当时尚未发出服务器发布动作；重新读取相同运行提交的检查后正常发布，没有重复执行目录切换。

公网 95 项资源与入口核对通过，公开浏览器确认网站角色卡、私有卡库、桌面和窄屏 QQ 入口以及腾讯授权跳转。源码别名在服务器核对完整散列，公网对独立源码封包核对完整散列，其余别名核对长度和首尾字节。未执行真实 QQ 扫码与真实多人房间验收。

## 发布与恢复

网站官方[预检 38116588498](https://github.com/FullPeople/DND-card-web/actions/runs/38116588498)与[发布 38116784620](https://github.com/FullPeople/DND-card-web/actions/runs/38116784620)成功。独立恢复目录：`/root/codex-release-packages/dnd-center-actions-38116588498-1/backup/frontend/card`、`/root/codex-release-packages/dnd-center-actions-38116588498-1/backup/frontend/library`。

云端服务恢复点：`/root/codex-release-packages/dnd-center-qq-backend-282-account-20261011/backup`。数据库未替换，QQ 配置及服务环境文件保留。

Suite-dev 独立恢复点及校验值：

```json
{
  "suite-dev": {
    "path": "/var/www/obr-plugins/suite-dev-before-qq-cloud282-20261011.tar.gz",
    "sha256": "c432892aa32eeb7c78446149868c3153b41d5449dee22ed8d1c977ae48ea2990",
    "bytes": 255069949,
    "complete": true,
    "independent": true,
    "resumedSameReleaseBackup": false
  }
}
```

封存回执 `cc186d17d555a1d2e3cc29cb060e13d8e04157acc4fcb5015d4cf4379028beb9`；发布后完整目录 10062 项文件、128 项保护值通过核对。恢复入口先核对当前目录、备份及保护项，再交换目录；组合恢复需先检查当前状态并保留后续玩家修改。

```sh
/usr/local/sbin/obr-maintenance python3 /root/codex-release-packages/qq-cloud282-20261011/suite_links.py --archives /root/codex-release-packages/qq-cloud282-20261011 --receipt-sha cc186d17d555a1d2e3cc29cb060e13d8e04157acc4fcb5015d4cf4379028beb9 --rollback
```

稳定插件、首页、三龙牌和旧站导出入口的公网散列与发布前一致。发布后 7 个服务运行，数据库完整性为 ok，本次重启后无新增内存耗尽记录，可用磁盘 16.12 GB。管理会话与维护任务的内存上限继续生效；服务器未承担构建。

本文件和后续文档提交仅补充发布记录。实际运行源码、制品、源码 ZIP 和 CI 仍绑定上列运行提交。
