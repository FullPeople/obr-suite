# QQ 云端卡 279 上线回执

[角色卡网站](https://dnd.center/card/?intro=0)与[卡库](https://dnd.center/library/)已上线 **standalone-1.0.279**，公告版本 **0.1.59**；[新版枭熊插件](https://obr.dnd.center/suite-dev/manifest-dev.json)已上线 **1.0.279-dev**。云端服务为 **1.0.279 / account-private**。刷新网站、关闭工作台并刷新枭熊房间后读取新版本。

QQ 入口使用现有官方登录图片。未登录时点击直接发起授权；登录后点击打开二级账号与卡库弹窗，选择自己的卡进行导入或查看，复制账号 ID、退出登录。选中的云端 JSON 直接进入原有角色簿及五页角色卡，不再嵌套另一个卡片浏览器。角色名、角色簿及页签显示云图标，右上角云按钮打开该卡的信息和权限设置。

卡主可授权房间成员修改，也可指定账号授予或撤回权限；未授权 DM 同样只读。获授权账号拥有角色内容的编辑权，卡主仍单独管理授权和房间移除。房间修改自动写回云端原卡，保留原 ID，不产生同步副本。移除房间卡不会删除卡主云端原卡。切换至无权编辑的卡时，黄色横幅解释原因；横幅与旧卡核对提示共用紧凑样式，无独立边框或阴影。

网站卡库修复上一张及两侧循环卡的飞行动画，保留纸卡缓存和减少动态效果设置。账号退出操作放入二级弹窗，左侧移除重复账号；卡库不再出现角色卡专用公告和调色盘。插件修复被序列化为 null 的读取参数和无效 GET 请求体，减少重复读取；未选中的云端卡不持续下载完整正文。个人账号凭据不进入房间共享数据。保留 278 的个人 2D／3D 骰子设置和既有数字动画。

QQ Connect 提供 OpenID、昵称和头像，不提供数字 QQ 号；指定授权使用该系统可信的账号 ID。官方说明见 [get_user_info](https://wiki.connect.qq.com/get_user_info)和[获取 OpenID](https://wiki.connect.qq.com/获取用户openid_oauth2-0)。

## 运行来源与检查

- Web：`f1e92bf18a5dd884ea23815e4a4997cc0fd1a94c`，[PR 51](https://github.com/FullPeople/DND-card-web/pull/51)。
- Suite：`a4eedb8c6ae798bd072ca0bade8e366db59132c6`，[PR 54](https://github.com/FullPeople/obr-suite/pull/54)。
- Data：`8b9e6c0ba0e9d10a3f3c7d5405c9427ce039b194`，[PR 27](https://github.com/FullPeople/dnd5e-automation-data/pull/27)。

| 精确提交 CI | 结果 |
| --- | --- |
| [Web 38057491188](https://github.com/FullPeople/DND-card-web/actions/runs/38057491188) | 26 项任务成功 |
| [云端迁移 38057495194](https://github.com/FullPeople/DND-card-web/actions/runs/38057495194) | 成功 |
| [部署合约 38057497821](https://github.com/FullPeople/DND-card-web/actions/runs/38057497821) | 成功 |
| [Suite 38058040850](https://github.com/FullPeople/obr-suite/actions/runs/38058040850) | 成功 |
| [QQ 权限 38058040764](https://github.com/FullPeople/obr-suite/actions/runs/38058040764) | 成功 |
| [骰子对照 38058040875](https://github.com/FullPeople/obr-suite/actions/runs/38058040875) | 4 项任务成功 |

本机 Web 单元检查 1287 项通过、91 项既有条件跳过；实际 HTTP 云端检查 50 项、Suite 回归 55 组通过。云端浏览器场景完整 47 项通过；原生云端卡浏览器验证 22 项，覆盖官方按钮、个人卡库、原生角色簿导入、五页编辑、原卡自动写回、未授权 DM、房间授权与重新锁定、指定账号授权及撤回、退出登录和凭据隔离。权限横幅实际高度小于 30 px。

完整运行审计使用原 229 份真实输入，18789 个身份、6535 个实现见证、4561 项审查、零未决、63 个消费者模块，报告散列 `b69aa23e3228e01d2370454e5e979765d5b2af3ff05b5765c2368a5f68078055`。没有手改见证、计数或消费者指纹。

公网版本、84 项入口和实际依赖的字节散列均匹配封存制品。桌面与窄屏浏览器确认官方 QQ 图片、私有卡库登录要求、卡库没有公告或调色盘；真实授权跳转到 `graph.qq.com/oauth2.0/show` 返回 200，未出现 100008。此检查没有完成账号扫码授权。原生导入及多人权限浏览器使用合成账号和 SDK；**真实 QQ 扫码、真实多人枭熊房间与实体设备未现场验收**，不据此宣称卡顿全部消失。

## 发布、保护与恢复

网站复用精确提交的[预检制品 38058713061](https://github.com/FullPeople/DND-card-web/actions/runs/38058713061)，[发布 38058950842](https://github.com/FullPeople/DND-card-web/actions/runs/38058950842)成功。制品封存散列 `c7b926a15cd5bcca73d6b725cedd28df1d89e67a689558796ccba60a4c331441`。

Suite 复用精确提交 CI 的生产制品；发布后完整目录 9604 项、9 个完整源码别名和 125 项保护值通过核对，保护值一致。发布前完整独立备份含 9339 项文件、249385285 字节，SHA-256 `06891ebe52e188c3da237fd7a1963eff325113c21443b7ef604fdd6c1c8b8238`。源码别名共享两份完整源码封包，独立恢复备份不依赖线上目录。玩家数据库没有被替换，云端发布前后原有卡记录均为 27 张。

并发首页 r11、r12 是另一会话的独立授权发布。第一次插件预检发现首页变化并停止；核对实际首页回执、文件与原备份后，重新捕获保护基线并封存新回执。原基线保留为 `.before-home-r12`，没有回退首页或放宽门禁。最终首页散列为 `db3ccf6e7d749a7845532d686ef24adebc1c757d4b4ddc6f715520263cca4ae2`，稳定插件、旧角色卡、三龙牌及其他服务保持正常。原有两个混合工作区未修改。

服务器空间处理仅将本任务早先两份重复上传包移到已核对散列的本机保留副本：`qq-account274-20261010/suite-dev.tar.gz` 和 `suite.tar.gz`，分别为 195120276 和 101175560 字节。线上文件、源码封包、玩家数据和恢复备份保留。完成发布后服务器剩余空间 364158976 字节；本次没有创建自动清理任务。

| 目标 | 回执 | 独立恢复点 |
| --- | --- | --- |
| 云端服务 | `/root/codex-release-receipts/dnd-center-qq-backend-279-account-20261010.json` | `/root/codex-release-packages/dnd-center-qq-backend-279-account-20261010/backup` |
| 网站与卡库 | `/root/codex-release-receipts/dnd-center-actions-38058713061-1.json` | `/root/codex-release-packages/dnd-center-actions-38058713061-1/backup/frontend` |
| Suite-dev | `/root/codex-release-receipts/qq-native279-20261010.json` | `/var/www/obr-plugins/suite-dev-before-qq-native279-20261010.tar.gz` |

Suite 单独恢复入口：

```sh
python3 /root/codex-release-packages/qq-native279-20261010/suite_links.py --archives /root/codex-release-packages/qq-native279-20261010 --receipt-sha f7a25f1ff10d84e9c90a9e1cf0232956321070c3e91df2977366713a77b89f54 --rollback
```

该入口先核对完整备份、当前发布目录、保留的原目录及全部保护值，再原子交换；后续目标或保护项改变时会拒绝覆盖。网站和云端的组合恢复不能忽略此后已上线的首页 r12 或新版插件，需先读取当前状态及对应回执，保留独立发布后再制定恢复顺序；不会用发布前数据库覆盖现有玩家卡。

本文件及随后状态提交只补充实际发布记录。已发布运行源码、制品和源码 ZIP 仍对应上列精确提交，不重新构建或发布。
