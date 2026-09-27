# 2026-09-27 · 207 浏览器兼容修复已发布

| 入口 | 已验证版本 |
| --- | --- |
| https://obr.dnd.center/card/ | standalone-1.0.207，公告 0.1.12 |
| https://obr.dnd.center/suite-dev/manifest-dev.json | 1.0.207-dev |
| https://obr.dnd.center/three-dragon-ante-dev/manifest.json | 0.7.19-dev |
| https://fullpeople.github.io/DND-card-web/ | 0.1.12 |
| 旧插件 | 1.3.11，561 个文件未变，继续允许 XLSX |

运行源码：Web `7c004a4843e770adf27bcbb9f42c51db2a4a05da`，Suite `6c7b8ecccc83a50340f167b75e76dd4a9dc30eb7`。后续文档回执提交不改变运行代码。原因、修复及边界见 [BROWSER-COMPAT-207.md](BROWSER-COMPAT-207.md)，群公告见 [ANNOUNCEMENT-207.txt](ANNOUNCEMENT-207.txt)。

## 实质验证

- 206 正式构建在缺少 AbortSignal.any / timeout 时读不出 Wiki，负向测试失败记录保留；207 同一路径通过。
- 当前 Edge 和实际 Chrome for Testing 114.0.5696.0 各 4 项生产构建检查通过：缺少较新请求 API、Wiki 缓存写满、动态文件失败后重试且保存卡片身份不变、入口脚本失败时仍显示 HTML 错误和重试按钮。
- Chrome 114 的 18 项安装版 Owlbear SDK / 真实跨窗口宿主检查通过；后端为合成夹具，不等同于真人房间。
- [CI 36318292448](https://github.com/FullPeople/DND-card-web/actions/runs/36318292448) 验收通过：186 项单元、98 项浏览器检查；另有 2 项既有单元跳过、8 项按浏览器项目跳过。测试没有因失败而跳过。Pages 首次发布遇到 GitHub OIDC 取令牌超时；只重试失败发布任务后成功，没有更改权限或重新绕过验收。
- Chrome 114 在候选构建和阿里云公网上验证了单机/新版工作台的桌面和 390px 窄屏，无横向溢出和未捕获错误，HTTP/2 正常。Wiki 使用合成响应，不能称为全真实资料验证。
- Chrome 114 在缺少 any / timeout 的情况下，候选与公网三龙牌双入口实际连接阿里云 HTTPS/WSS，完成建桌、加入、发牌、前注、私有手牌隔离和断线重连。Owlbear 身份及 iframe 宿主为夹具；游戏接口及 SQLite 为真实服务。
- 831 个服务器文件、158 个公网关键变更文件散列核验通过。GitHub Pages 0.1.12 公网页面也在 Chrome 114 打开通过。

## 数据、部署与回退

没有重启角色卡中继或三龙牌服务，前后服务启动时间一致；没有修改 Nginx、服务器程序和玩家角色数据。测试后仅删除两个明确登记的合成牌桌，确认所有其他房间记录不变。

回退目录 `/var/www/obr-plugins/{card,suite-dev,three-dragon-ante-dev}-before-207`。中继备份 `/opt/obr-workbench-relay-dev/before-207`，但本次中继服务源码散列未变。前端旧散列资源继续保留；不能删用户数据库来回退前端。

源码仍在 `F:/CodexWork/2026-09-27/feedback/{web,suite}`。两处脏主目录只回填文档。Suite 构建目录继续联接至 `D:/Temp/DND-card-release205-storage/suite-dist`，不要向接近满的 F 盘重新复制构建产物。

证据：`D:/Temp/DND-card-compat207/` 保存负向复现、Edge / Chrome 114 浏览器及宿主检查；`D:/Temp/DND-card-release207-storage/release207/` 保存包清单、部署回执、公网散列、候选/公网浏览器和三龙牌检查、Pages 检查、CI 及重试日志、服务启动时间和精确测试房间清理回执。

## 尚未确认

玩家只提供了“加载失败之类”的描述，没有具体报错与浏览器版本。本轮修复了明确复现的兼容缺陷，尚不能认定就是该玩家的全部原因。该设备、IE 模式、更老内核、浏览器扩展拦截、真实网络和受限角色存储待验证。构建语法目标 109 / Firefox 102 / Safari 15.4 不代表这些平台均经过实机验收。
