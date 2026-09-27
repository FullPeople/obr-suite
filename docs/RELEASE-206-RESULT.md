# 2026-09-27 · 206 已部署，完整 CI 与公网核验通过

| 入口 | 版本 |
| --- | --- |
| 国内单机站 https://obr.dnd.center/card/ | standalone-1.0.206，公告 0.1.11 |
| 新版插件 https://obr.dnd.center/suite-dev/manifest-dev.json | 1.0.206-dev |
| 独立三龙牌 https://obr.dnd.center/three-dragon-ante-dev/manifest.json | 0.7.18-dev |
| GitHub Pages https://fullpeople.github.io/DND-card-web/ | 0.1.11，已验证公网页面 |
| 旧插件 | 1.3.11，561 个文件保持原样，XLSX 继续允许 |

本轮逐项说明见 [FEEDBACK-206.md](FEEDBACK-206.md)，群公告见 [ANNOUNCEMENT-206.txt](ANNOUNCEMENT-206.txt)。本次承接 205，补上完整回归发现的两个问题：职业正文里的装备熟练项引用保留当前页，避免自动翻到背包后找不到熟练栏；DM 明确撤回权限后，其他场景的旧棋子归属不能重新授予权限。

实际部署源码：Web `d77f360af5ff67e7a4ce42d5835153a5d9028e0e`，Suite `2ed5ec802f3ba4e1ddf26d0f7376e674d6210a57`。后续回执文档提交不改变运行代码。

## 验证

- [完整 CI 36315320245](https://github.com/FullPeople/DND-card-web/actions/runs/36315320245) 验收与 Pages 发布均成功：181 项单元通过、2 项既有跳过；浏览器 94 项通过、8 项按项目跳过（发布 55、feedback198 8、触屏 6、单机 7、统一入口 18）。
- 本机 8 项 feedback198 浏览器回归通过；18 项安装版 SDK / 真实跨窗口宿主检查通过，包括授予、撤回、禁止自授予、跨场景旧棋子不恢复权限。后端数据为夹具，真人房间仍待验证。
- 205 中 10 项实际中继程序检查通过：并发更新保护、同房间通知、原上传房间关联、禁止跨房间通知与伪造范围。本次中继代码散列完全相同，没有再次重启。
- 两宿主目录循环测试写入从 2363 次降为 8 次。带延迟状态目录、2 秒读取的夹具下，提交 18ms、缓存切换 5ms；这些数字不是公网玩家延迟。
- 三龙牌实际浏览器 WebGL / DOM 动画顺序 8 项检查通过，故意恢复提前横幅后被测试抓出。已核对所有时序测试源码和独立三龙牌构建文件与 205 验证时完全相同。205 正式构建及公网上的双入口发牌、前注、私有手牌隔离和断线恢复通过；身份与 iframe 宿主为夹具。旧完整 stage harness 首条布局断言不通过，不计为完整通过。
- 206 正式构建和公网上的单机 / 新版工作台在桌面及 390px 窄屏均通过，无横向溢出与未捕获错误；浏览器确认 HTTP/2。Wiki 响应为合成空夹具，未把这些检查当作完整真实资料验收。
- 830 个服务器部署文件、80 个公网关键变更脚本 / 样式 / 入口文件散列核验通过。GitHub Pages 的 0.1.11 公网页面打开通过。

205 首轮 CI 的两个旧弹窗测试被新版公告挡住；修复测试前置后通过。第二轮发现真实的熟练项拖拽翻页回归和过期的公告版本断言，均在 206 修复；没有跳过失败项目，最终完整门禁通过。

## 部署与回退

206 未重启角色卡中继或三龙牌服务，前后服务启动时间一致。没有修改用户角色卡数据、三龙牌数据库或 Nginx 配置。HTTP/2 与角色卡服务器通知已在 205 开启；其回退记录见 [205 发布回执](RELEASE-205-RESULT.md)。

网页备份 `/var/www/obr-plugins/{card,suite-dev,three-dragon-ante-dev}-before-206`；中继备份 `/opt/obr-workbench-relay-dev/before-206`。继续保留旧散列资源，避免已打开页面请求丢失。不能通过删除数据库来回退前端。

本轮继续使用 `F:/CodexWork/2026-09-27/feedback/{web,suite}`。`suite/dist-workbench-dev` 是指向 `D:/Temp/DND-card-release205-storage/suite-dist` 的目录联接，F 盘空间不足，不要把构建产物重新复制回去。两处脏主目录只回填文档，不覆盖源码。

证据目录 `D:/Temp/DND-card-release206-storage/release206/`：package-receipt.json、deployment.log、public-verification.json、candidate/live-ui.json、live-pages.json、ci-full.log、services-before/after.txt 和截图。前置实测证据 `D:/Temp/feedback205-host-final/results.json`、`D:/Temp/tda-ui-stage-va9azO/result.json`、`D:/Temp/tda-ui-stage-NpMUBF/result.json` 及 205 的公网三龙牌回执继续有效。

真实多人枭熊权限、场景棋子选择时延、法国 VPN、实体手机拖拽、用户具体护盾术/旧兼职卡：待验证。法术攻击/DC 手动调整仍共同生效，预备数量仍使用角色的现有总设置。角色服务器链路仍依赖枭熊身份和棋子同步，不能称为全部迁出枭熊。
