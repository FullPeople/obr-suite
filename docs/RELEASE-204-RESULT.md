# 2026-09-27 · 204 旧插件 XLSX 恢复已上线

旧插件 [Full Suite 1.3.11](https://obr.dnd.center/suite/manifest.json) 已部署。恢复原有 XLSX 选择、拖拽、批量上传、同卡 ↻ 覆盖更新及 2014/2024 模板下载；JSON 上传、粘贴和覆盖更新继续保留，仍使用五页只读阅读器。只回退此前关闭 XLSX 的限制，没有整体降回旧软件版本。用户最新决定覆盖此前公告中的“不再支持 XLSX”。

运行源码 `e7bbac3a4696b7b9b44badf2f9c70fa1fe4e09cb`，基于原线上稳定版 1.3.10 对应的 3e2d935；工作树 D:/Temp/DND-card-release204-storage/suite，分支 codex/legacy-xlsx-204 已推送。该实现也已合入日常 codex/feedback-september（3469925），避免后续发布重新关掉 XLSX。本次未发布新版 Full Suite、单机网站、Pages 或三龙牌。

## 已验证

- TypeScript 与稳定版生产构建通过。
- 候选产物及最终公网页面，各完成 7 项实际浏览器检查：公开 2014/2024 XLSX 模板由真实服务器批量解析，规则版本保持正确；XLSX 覆盖更新保持同一角色 ID；五页阅读器打开；拖拽和大写 .XLSX 后缀；JSON 导入仍转换为原生资料；.xls 在请求前拒绝；损坏 .xlsx 不新增卡。
- 另有 5 项 JSON/阅读器定向回归通过，包含 JSON 同 ID 覆盖后姓名、HP 和阅读器立即更新、窄屏可见、旧书签跳转。此组 HTTP 数据用夹具，前一组使用真实上传/解析服务。
- 浏览器无脚本错误，1280/760px 页面无横向溢出，截图已检查。Owlbear 身份与场景 metadata 使用 SDK 宿主夹具；真实多人房间操作仍待验证。
- 378 个服务器文件哈希、25 个公网关键脚本/入口哈希通过。测试使用独立 xlsx204-* 房间的公开模板，成功运行的测试卡已通过 DELETE 接口清理；中断夹具测试的两张卡也按明确房间 ID 清理，未访问或删除玩家卡。

## 发布边界与恢复

只有 /var/www/obr-plugins/suite 更新到 1.3.11，回滚目录 /var/www/obr-plugins/suite-before-204；旧哈希资源保留。新版 Suite 1.0.203-dev、独立三龙牌 0.7.17-dev、单机 standalone-1.0.200 不变。角色卡 API 的 server.py/parser.py、三龙牌服务、原中继和 nginx 哈希/服务启动时间均核对未变，没有重启任何服务。

原只读阅读器直接沿用稳定版 201 的已部署文件，Web 源码归档仍为 46329c2；没有混入 203 的新版公告代码。两个脏主工作区只回填本文及状态入口，不覆盖源码。详细恢复路径见 [实现说明](LEGACY-XLSX-204.md)。

证据与发布包：D:/Temp/DND-card-release204-storage/release204/。用户刷新旧插件页面即可看到恢复后的入口。
