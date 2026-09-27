# 2026-09-27 · 205 玩家反馈修复已部署至阿里云

| 入口 | 当前版本 |
| --- | --- |
| 国内单机站 https://obr.dnd.center/card/ | standalone-1.0.205，公告 0.1.10 |
| 新版插件 https://obr.dnd.center/suite-dev/manifest-dev.json | 1.0.205-dev |
| 独立三龙牌 https://obr.dnd.center/three-dragon-ante-dev/manifest.json | 0.7.18-dev |
| 旧版插件 | 1.3.11，561 个文件保持原样，继续允许 XLSX |

运行源码：Web `6af3ad1fb81f494fe0ba6b310b4d81564fac90d5`、Suite `9a416ba7f8b5db256a5d237df012f62fa2fe7c54`。Web 已推送 main；GitHub Pages 自动验收结果另记，不与阿里云的上线状态混同。

逐项修复及未复现项目见 [FEEDBACK-205.md](FEEDBACK-205.md)。公告按功能分组、短句说明，枭熊专属内容只出现在新版插件公告。

## 验证

- 181 项单元检查通过，2 个既有跳过；本轮 4 项浏览器用例最终串行全通过。另有 6 项施法/保存/同步回归与 7 项单机公告、离线和投骰检查通过。
- 17 项安装版 SDK + 真实跨窗口通信夹具检查通过；10 项实际中继程序检查通过。目录反馈循环写入从 2363 次降至 8 次，延迟状态目录和 2 秒读取夹具下，提交 18ms、缓存切换 9ms。这些数字不是公网玩家延迟。
- 三龙牌 WebGL / DOM 实际动画顺序 8 项检查通过；刻意移除等待条件后，回归测试正确失败。旧完整 stage harness 的首条布局断言没有通过，不计为完整通过。
- 正式构建和上线后的三龙牌两个入口均通过实际公网 HTTPS/WSS 发牌、前注和断线重连；私有手牌未泄露给普通玩家。身份与枭熊 iframe 宿主由夹具提供，不是真人房间。
- 单机/新版工作台的正式构建和公网版本在桌面与 390px 窄屏检查通过，未出现横向溢出和未捕获错误；浏览器确认 HTTP/2。
- 842 个部署文件的服务器散列核验通过；91 个公网变更脚本、样式和入口文件散列核验通过。

一轮本机并发浏览器检查受 F 盘剩余空间不足影响，出现 ENOSPC 和超时；保留失败记录后，将本轮产物转移至 D 盘，4 项新用例重跑全通过。`F:/CodexWork/2026-09-27/feedback/suite/dist-workbench-dev` 现在是指向 `D:/Temp/DND-card-release205-storage/suite-dist` 的构建产物目录联接；不要删除或重新复制到接近满的 F 盘。

## 发布与回退

阿里云只重启角色卡中继 `obr-workbench-relay-dev`。三龙牌服务和用户数据库未重启或重写；仅精确删除本次两个测试牌桌，确认其他牌桌记录未变。

Nginx 已启用 HTTP/2并平滑重载，原配置备份 `/etc/nginx/rollback/obr-plugins-before-http2-205.conf`。未声称这能解决法国到香港 VPN 的线路问题。

网页回退目录：`/var/www/obr-plugins/{card,suite-dev,three-dragon-ante-dev}-before-205`。中继备份：`/opt/obr-workbench-relay-dev/before-205`。保留旧散列资源以兼容已打开页面。

证据目录：`D:/Temp/DND-card-release205-storage/release205/`，含 package-receipt.json、deployment.log、public-verification.json、candidate/live-ui.json、candidate/live-browser.json、fixture-cleanup.json 和截图。宿主证据 `D:/Temp/feedback205-host/results.json`，三龙牌时序 `D:/Temp/tda-ui-stage-va9azO/result.json`，故障注入 `D:/Temp/tda-ui-stage-NpMUBF/result.json`。

真实多人枭熊权限、场景棋子选择时延、法国 VPN、实体手机拖拽、用户具体护盾术/旧兼职卡：待验证。角色服务器链路仍使用枭熊身份和棋子同步；这不是完全迁出枭熊。

GitHub Pages 首次验收 53 项通过、2 项失败，原因是旧弹窗测试没有确认独立版本的新版公告；修复测试前置步骤后两项本机复测通过，等待第二轮完整门禁。应用源码未随此次测试修正改变。
