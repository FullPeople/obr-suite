# Full Suite-dev 1.0.175

本轮修订对应网页 docs/WORKBENCH-175.md：资源密度与折叠仓库、独立立绘与灰色纸面、法术准备格与子职业等级、唯一全局搜索。

通知基础设施改为 src/workbench/notices.ts，由 setupWorkbench 立即启动。旧资源模块不再负责 dev 的提示层。发送者直接本机入队，另向远端发送；成功持久化后发布资源、库存和法术准备事件。重复送达与提示层重建去重，保留隐私、静默开关和原音效。

专测 tools/workbench-notice-175-selftest.mjs（独立 5297/5298）覆盖真实工作台入口、SDK 边界不回环、旧模块阻塞、资源模块关闭、成功/失败保存、仓库与原生背包操作、预备/取消、隐私与去重。

集成浏览器回归 tools/workbench-175-selftest.mjs 调用 workbench-presentation-175-selftest.mjs 检查折叠和资源尺寸。真实枭熊房间与实体平板未实测；上线回执另记。

本地检查：64 项网页单元、10 项网页浏览器、53 项联动（28 次保存）与 19 项通知检查（11 次保存）通过；8 组合并、9 组库存同步与库存事务模型通过。首轮网页浏览器因临时磁盘 ENOSPC 写入截图/trace 失败，转用 F 盘任务临时目录后完整重跑通过。

补充：提示页与备用通知拒绝晚到的初始 GM 角色覆盖期间收到的 PLAYER 降权；两条异步角色竞态回归通过。

已部署 1.0.175-dev，595 服务器文件与 235 公网关键文件及两份源码包核对一致；stable 335 文件未变，1.3.5。公网中继注册/投递、宿主隔离、删除校验与持久 CAS 通过。回执：workbench-test-output/public-1.0.175-dev.json；回滚：/var/www/obr-plugins/suite-dev-before-workbench-1.0.175 和 /opt/obr-workbench-relay-dev/before-1.0.175。真实房间/平板未实测。
