# 2026-10-03 · 配套发布238最终回执

已按用户授权合并、发布，并将追加赞助弹幕调整验证后并入同一批。合并前远端修复引用、最新主线、祖先关系和原修复CI均核对；两仓无冲突，保留其他人的主线修改。全程隔离工作树，没有强推、重置或打包混合原目录。

| 仓库 | 目标 | 指定修复提交 | 合并提交 | 本次运行源码 |
| --- | --- | --- | --- | --- |
| DND-card-web | main | f393016d69652a9d6f23192fbc25eb9a21d44f97 | d5f80ee70be7edcd53c025d324826641b8744556 | 4aaee7dd758b96904a907e31851e369aa1c6804c |
| obr-suite | dev | 5d762d2477301670452b03b6be842ed3a18244b3 | dfbc0675be11f18bc19dc046d45e663967c11ed3 | dfc4f4d03e05bfad7839cdf63678c5462f5f81f0 |

Web完整17组[CI](https://github.com/FullPeople/DND-card-web/actions/runs/37105626973)成功；Suite最终[CI](https://github.com/FullPeople/obr-suite/actions/runs/37106387840)成功，工作流精确绑定上述Web源码。原指定修复CI为37102486042和37102539941，均success。运行源码ZIP由git archive生成，提交注释、CRC和散列已验证；回执文档提交不改变运行SHA。

| 线上目标 | 已发布版本 | 全量回滚备份 |
| --- | --- | --- |
| https://obr.dnd.center/card/ | standalone-1.0.238，公告0.1.29 | /var/www/obr-plugins/card-before-intro-three-dragon238-20261003 |
| https://obr.dnd.center/suite-dev/manifest-dev.json | 1.0.238-dev | /var/www/obr-plugins/suite-dev-before-intro-three-dragon238-20261003 |
| https://obr.dnd.center/three-dragon-ante-dev/manifest.json | 0.7.22-dev | /var/www/obr-plugins/three-dragon-ante-dev-before-intro-three-dragon238-20261003 |

沿用既有静态部署器的最新线上树核对、全部目标先备份、完整暂存树校验和renameat2原子交换流程。保留既有散列资源和历史公告。部署记录 `/root/codex-release-receipts/intro-three-dragon238-20261003.json`；服务联动记录 `/root/codex-release-intro238-20261003/combined-deployment.json`。

三龙牌原始service.mjs与新服务bundle同步部署，只重启obr-three-dragon。服务active、健康接口ok，systemd单元SHA核对不变。运行server.mjs SHA256为 `122b8b33da55c7eb0e2e5f10bd7c4e77fa7c29e09e31845e9467ea95a6ba4288`；原始service.mjs SHA256为 `906c0584747f84f42014410b167acfbf9d9fc52c8e23e33f2d8c2090d73f4596`。新回滚点 `/opt/obr-three-dragon/before-intro-three-dragon238-20261003` 保存旧服务代码和SQLite一致性备份，quick_check=ok。没有还原数据库或改写既有玩家对局。

## 验收

- 本机Web796单元通过/25外部资料条件跳过，类型和集成/单机双构建成功；Suite最终CI覆盖21组回归、宿主、牌桌和独立版构建。本机服务9组、130次玩法和重启恢复通过。
- 公网 `459` 项HTTPS文件SHA/源码ZIP检查全部通过，包含三个目标的脚本、页面、开屏PNG、公告、清单、支持者JSON及运行源码。
- 公网实际角色卡与集成入口浏览器 `31` 项通过、`2` 性能诊断条件跳过、0未解决失败：开屏四图与退出后公告顺序、减少动态效果/加载失败恢复、公告确认与重开、技能勾选/双标签保存、A4与窄屏、穿甲来源条件和护甲调整值/旧值恢复、仪表盘保存失败提示/取消放弃/重试保留草稿和刷新恢复。
- 实际HTTPS牌桌入口房主/访客四种组合均可点击结束画面的离开控件，ACK前回主界面、刷新后仍在大厅；2–6玩家及所有视角的1440/390px真实WebGL姓名可见且不重叠。宿主身份与传输在这组浏览器测试中模拟。
- 实际公网HTTPS/WSS服务7组通过：六客户端入座、私有手牌隔离、旧gameId离开拒绝、进行中访客离开限制、房主自动移交保留座位与手牌、真实规则操作直至结束、结束后访客/房主离开保留对局。仅创建隔离合成身份测试房间，两轮测试房间均按房间ID、joinHash和6名成员前缀严格核验后清理。
- 赞助弹幕流速提高到240px/s，色彩与基础字号增大，随机行/间隔和初始进度消除阶梯入场。洛伦兹力100元已加入网页与Suite中文名单，金额曲线保留：网页30px、Suite原生43px。线上DOM桌面/窄屏与缩放非重叠抽样、关闭效果检查通过；原生DOM使用实际公开名单的子集，完整名单由HTTPS散列核对。

真实登录枭熊双账号房间、玩家原设备和实体手机未现场复验。公网合成身份测试、真实浏览器渲染与模拟宿主分别记录，不等同这些现场验收。

## 保留边界与恢复记录

旧稳定Suite主线639c8217b41905fbde4222783ff16e95bde13b67和线上/suite/保持不变；没有合并oldstable、后端PR或自动化重构。relay运行状态/代码、nginx和三龙牌systemd配置散列保护通过。混合Web/Suite原目录仍有419/315条状态，文件未编辑。

初次公告CI因独立版文字混入Suite验证说明失败，修正适用范围后完整CI通过，测试断言保留。Windows回归脚本匹配路径归一化后座位测试通过。原生大字号按窗口高度限制行数并在缩放时重新排布，浏览器复验通过。

服务器预检空间不足时停止切换；只删除与正式备份全树SHA一致的9份历史retired重复副本，并核对移除两份已在U盘保留、SHA一致的公开237上传归档，正式回滚备份和发布记录均保留。第一次服务备份路径校验拒绝DynamicUser父目录链接，未切换网站或服务；核对实际 `/var/lib/private/obr-three-dragon/game.sqlite` 后固定路径继续，未完成旧代码副本保存在 `/opt/obr-three-dragon/incomplete-before-intro-three-dragon238-20261003-attempt1`。

公网验收首次多次刷新耗尽90秒预算、双标签夹具误进站点根目录403，修正独立验收夹具地址与公网时限后只复验失败项，原产品断言保留。公网服务验收脚本首次误用内部stage字段，改为公开phase后7组通过。赞助脚本编码与随机全名单等待问题在验收脚本中修正，运行源码未受影响。详细输出和截图保留在隔离任务证据目录，不上传私人资料。

一次进度诊断全量读取约383MB的nginx日志并拆分行，触发系统终止Python诊断进程；已改为只读取6MiB日志尾部。内核记录只显示该Python进程被终止，三龙牌和relay仍active，运行时间核对未变化，健康接口继续ok。这是诊断实现错误，已经记录；没有改动生产代码或配置。

代码回退应使用上述本轮全量静态备份与旧服务代码；SQLite备份仅为恢复材料，不随常规代码回退覆盖玩家发布后操作。玩家应关闭附加窗口、刷新房间并重新打开新版插件。
