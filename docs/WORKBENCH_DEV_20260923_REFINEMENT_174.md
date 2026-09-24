# Full Suite-dev 1.0.174

与配套网页一起发布。完整行为和根因见 Web 源码包 docs/WORKBENCH-174.md。

宿主改动：lock 按目标权限接受总览请求并返回快照；怪物总览按 PLAYER owner 筛选；库存相同条目事务合并；金币显示引用镜像；资源/背包通知与提示层送达恢复；停用旧 HP popover、保留 HP flag 与组件。

网页改动：源样式拖拽、精确落点与描边、A4 怪物双页、共用生命控件、资源队列、错误 toast、#50525B 及命名色盘/颜色代码。

新增 tools/workbench-174-selftest.mjs 使用实际应用、宿主、提示页及中继，只有 Owlbear SDK 边界被模拟。与现有 168/v2 和库存、合并回归配套。

仅部署 suite-dev；稳定版保持 1.3.5，发布脚本逐文件确认未改变。发布收据在 workbench-test-output/public-1.0.174-dev.json。真实房间未验证。

发布前检查：57 单元、47 + 89 + 77 项浏览器/协议检查、库存事务/8 组合并/9 组库存同步通过。纸卡/库存 6 项 UI 回归通过；最后重跑库存 3 项通过。

发布完成：服务器 595 文件、公网 235 关键文件及两份源码包核对一致；稳定版 335 文件未改动。中继公开收发、权限边界和持久 CAS 通过，专用探测文档已清理。回滚：/var/www/obr-plugins/suite-dev-before-workbench-1.0.174 及 /opt/obr-workbench-relay-dev/before-1.0.174。真实房间/实体平板未验收；本地模拟预览 http://127.0.0.1:5197/preview。
