# 登录后的逐卡云端入口 281 上线回执

[角色卡网站](https://dnd.center/card/?intro=0)和[卡库](https://dnd.center/library/)已上线 standalone-1.0.281；[新版枭熊插件](https://obr.dnd.center/suite-dev/manifest-dev.json)已上线 1.0.281-dev；云端服务已上线 1.0.281 / account-private。刷新网站；刷新整个枭熊房间页面后重新打开工作台。

登录后，两端所有卡片右上角统一使用云端按钮，弹窗按卡片状态和当前权限显示内容。

| 卡片状态 | 云端按钮中的内容 |
| --- | --- |
| 尚未上传的普通卡 | 当前 QQ 账号、上传选项；无本地编辑权限时显示原因 |
| 本人的云端卡 | 卡主信息、云端卡编号、房间授权、锁定及移除操作 |
| 获授权的他人云端卡 | 实际卡主、已获得的编辑权限及同步信息 |
| 未获授权的他人云端卡 | 基本信息和只读原因；DM 身份本身不授予编辑权限 |

上传保留原房间卡 ID、棋子绑定和修订连续性。先等待本地修改保存，上传结果不明时暂停重复创建；账号或权限变化阻止错误绑定。云端卡名称及角色簿继续显示云标记；获准的房间修改自动写回原卡。已有云端卡的卡主信息取自云端记录。

## 运行来源与检查

- Web：`98e81482b2cfeac231823fdc8800b677118c657a`，[PR 54](https://github.com/FullPeople/DND-card-web/pull/54)。
- Suite：`28eed1711836be56d3f0eaa739bfeee025bb3af1`，[PR 57](https://github.com/FullPeople/obr-suite/pull/57)。
- Data：`196031ce1034df783fa53321b0a6f2894a0ab400`，[PR 29](https://github.com/FullPeople/dnd5e-automation-data/pull/29)。

| 精确提交检查 | 运行 | 结果 |
| --- | --- | --- |
| web / web | [38088429599](https://github.com/FullPeople/DND-card-web/actions/runs/38088429599) | 26 项任务成功 |
| web / cloud-migration | [38088447325](https://github.com/FullPeople/DND-card-web/actions/runs/38088447325) | 1 项任务成功 |
| web / dot-deploy-contract | [38088450431](https://github.com/FullPeople/DND-card-web/actions/runs/38088450431) | 1 项任务成功 |
| suite / qq-permissions | [38090218764](https://github.com/FullPeople/obr-suite/actions/runs/38090218764) | 1 项任务成功 |
| suite / verify-suite | [38090218816](https://github.com/FullPeople/obr-suite/actions/runs/38090218816) | 1 项任务成功 |
| suite / dice-release246-profile | [38090218765](https://github.com/FullPeople/obr-suite/actions/runs/38090218765) | 4 项任务成功 |

最终运行源码共 28 项 Web 任务、6 项 Suite 任务成功。原生卡浏览器检查 32 项通过，覆盖普通卡登录、只读信息、原位上传、最新修改、修订连续性、授权及未授权 DM；采用实际构建、真实 HTTP 权限接口和合成账号。本机单机云端浏览器检查 4 项通过。完整实际运行审计保留 18,789 个身份、6,535 个实现见证和 63 个消费者模块，绑定不可变 Data 报告。

首次候选整体检查出现 SDK 消息超时，最终版本首次检查出现测试页加载时传消息导致页面上下文销毁；均保留原始失败日志，并在相同源码上重跑。最终检查成功，不据此宣称测试环境完全没有偶发问题。没有为通过检查修改骰子源码、放宽断言或改动 QQ 权限。

公网 95 项资源与入口核对通过；源码别名在服务器核对完整散列，公网按独立封包核对完整散列，其余别名核对长度和首尾字节。公开浏览器确认角色卡、私有卡库、桌面和窄屏 QQ 入口，腾讯授权页返回 200。真人 QQ 扫码、真实多人枭熊房间和实体设备未现场验收。

## 发布与恢复

网站官方[预检 38089563807](https://github.com/FullPeople/DND-card-web/actions/runs/38089563807)及[发布 38090196919](https://github.com/FullPeople/DND-card-web/actions/runs/38090196919)成功，制品 SHA-256 `1ce043dd125e441cdddd0b25e705cb81c8b12ca38a3b6b8aa23ff37269f8267c`。独立恢复目录：`/root/codex-release-packages/dnd-center-actions-38089563807-1/backup/frontend/card`、`/root/codex-release-packages/dnd-center-actions-38089563807-1/backup/frontend/library`。

云端服务恢复点：`/root/codex-release-packages/dnd-center-qq-backend-281-account-20261011/backup`。数据库没有替换，既有网站及卡库在服务更新阶段保留。

Suite-dev 独立完整备份：`/var/www/obr-plugins/suite-dev-before-qq-cloud281-20261011.tar.gz`，253471454 字节，SHA-256 `dad9f40e7101e141358d4da31adf0747f220e665a8f8bcdec2a077fca469d93e`。封存回执 `12e9042d3c5153050407563ec9ed5614dfdbe2210fff0f72dacfad0269293019`；发布后完整目录 9912 项文件、127 项保护值通过核对。

服务器封存回执在 `2026-10-10T22:39:18.896016+00:00` 记录发布完成。本地 SSH 客户端未正常收尾；独立核对服务器回执、封存散列、源码与线上版本后，结束本地等待连接并恢复发布结果，没有重复执行发布。

```sh
/usr/local/sbin/obr-maintenance python3 /root/codex-release-packages/qq-cloud281-20261011/suite_links.py --archives /root/codex-release-packages/qq-cloud281-20261011 --receipt-sha 12e9042d3c5153050407563ec9ed5614dfdbe2210fff0f72dacfad0269293019 --rollback
```

恢复入口先核对当前目录、独立备份和保护项，再执行原子交换。组合恢复先读取各目标回执及当前状态，保留后续玩家修改。稳定插件、首页、三龙牌和旧卡入口的公网散列一致；混合工作区未用于打包或重置。

发布后 7 个服务运行、数据库完整性为 ok、本次重启后无新增内存耗尽记录；可用磁盘约 16.76 GB。管理会话和维护任务的内存上限继续生效，服务器没有承担构建。

本文件及后续文档提交只补充发布记录。已发布运行源码、制品、源码 ZIP 和 CI 仍绑定上述精确运行提交。
