# 新插件连接、文字演出与传送门 300 最终发布记录

北京时间 2026-10-17 00:50:03，新版插件 `1.0.300-dev` 与内嵌工作台 `0.1.74` 已完成实际原子切换和 HTTP 就绪检查。独立发布后核对于北京时间 2026-10-17 00:52:05 通过。

## 冻结运行来源与范围

- Web main：`cf1add887bcbd41de97f70794c8f230843192369`，PR82／83／84；Suite dev：`0a9d5ae28740227e9ea7f614f164a9b261f33321`，PR100／101／102／103。后续文档提交不替代运行来源。
- 唯一目标：`/var/www/obr-plugins/suite-dev`。网站／卡库／Wiki 保留 `standalone-1.0.299`（`34c0e4bfee01f5d85c5b94bb52bfa20619301754`）；稳定 Suite 保留 `1.3.33`（`79466fe2ff2da502c463c134587975cbdea62c6b`）。
- 后台 `1.0.295`、QQ／云端暂停、账号私有、轻量 2D、首页、旧站、其他项目、服务与配置、玩家资料受保护。没有启用物理骰子、QQ 发布例外或触碰 Godot／FUS。

## 修复与验证

连接现在由当前页面的有效控制握手确认；旧宿主仍需完整握手。首个确认不再夹带大历史／分组数据；控制和大消息有界分路，旧排队快照及旧重试不能覆盖新状态。发送前复核权限，结果未知的业务修改不重放。断线立即停用远程操作，缓存按原权限只读。

文字演出复用初始化读取，连接恢复后重新确认角色与场景，同时保留配置和本地预览；断线后的迟到场景事件也不能恢复“已连接”提示。透明画布允许宿主深浅色协商，播放使用前景 modal；播放期间接管前景输入，结束后归还。传送门触发、提示与目的地采用当前图片尺寸、DPI、缩放、旋转与锚点的同一几何，不再沿用过时的创建半径。未批量迁移真实玩家道具。

六项实际拖拽结束处理检查通过，旧实现在缩放进入用例失败，新实现在相同输入通过；这些 SDK 依赖仍为合成环境。15 项实际 Relay／几何检查、原 HTTP 容量与回执恢复、最终发送权限检查通过；4 项实际客户端握手浏览器检查、21 项工作台权限／恢复浏览器检查、18 项演出控制器与 17 组编辑器／渲染器流程通过。透明性既检查实际构建 HTML／CSS，也运行真实构建脚本与透明演出，在浅／深色宿主合成像素中均显示宿主底色。

旧词条菜单和骰盘夹具已补齐有效控制确认；骰盘新增 pong 不会造成假连接的断言，原撤权、历史、目录独立初始化和分享断言保留。前一候选的 Web 界面组曾有一次配色导入像素断言失败；本机在该提交连续三次通过，配色产品代码保持不变，最终提交通过完整 CI 重验，旧失败记录保留。最终 Web 首次运行还出现一次未改动的 Firefox 离线缓存断言失败，按原断言在同一提交重验失败组，最终 29 项任务回执成功，首次失败日志保留。旧可变来源下载与旧物理 3D 专项失败仍存在，未通过改散列、放宽断言或恢复 3D 消除。来源审计沿用已完成记录，未发布原始资料快照。

## 精确提交 CI

以下 8 组必要检查完成且成功，共 36 个任务。若某一组重验，准确尝试次数和每个任务回执保存在 `ci-proof.json`；所有任务都对应上述运行来源。

| 检查 | 仓库 | 运行 | 成功任务 | 尝试 |
| --- | --- | --- | ---: | ---: |
| Verify web | Web | [38929700153](https://github.com/FullPeople/DND-card-web/actions/runs/38929700153) | 29 | 2 |
| DND Center cloud migration | Web | [38929757637](https://github.com/FullPeople/DND-card-web/actions/runs/38929757637) | 1 | 1 |
| Validate dot deploy contract | Web | [38929763395](https://github.com/FullPeople/DND-card-web/actions/runs/38929763395) | 1 | 1 |
| Verify Suite candidate | Suite | [38931883797](https://github.com/FullPeople/obr-suite/actions/runs/38931883797) | 1 | 1 |
| Verify QQ account and room permissions | Suite | [38931883708](https://github.com/FullPeople/obr-suite/actions/runs/38931883708) | 1 | 1 |
| Lightweight 2D dice | Suite | [38931942520](https://github.com/FullPeople/obr-suite/actions/runs/38931942520) | 1 | 1 |
| Multiplayer synchronization regression | Suite | [38931883710](https://github.com/FullPeople/obr-suite/actions/runs/38931883710) | 1 | 1 |
| Cloud suspension release checks | Suite | [38931937447](https://github.com/FullPeople/obr-suite/actions/runs/38931937447) | 1 | 1 |

## 封包、备份与回执

- 封包：`/root/codex-release-packages/connectivity300-final-20261017`；全局回执：`/root/codex-release-receipts/connectivity300-final-20261017.json`。
- 最终清单 SHA-256：`8b150a1873cd00840ee25c9d4f2ce1f1d5b5c20ca9f58d2453f139704e4fb217`；基线 SHA-256：`b25a55fc5d578eac40e1b3cef2a7d6175c5a5ffae2b4375b768cb50f4d625bfe`；发布器 SHA-256：`cd5f45fc73e26356e540d58b206a817143f932897c96c5a67ab12be8f4f58025`。
- 全局／published 回执相同，SHA-256：`aab23c730b59c118ef4667145d96d0606264a690a39c71b69539d3eef35c7db0`。独立发布后核对与 125 项保护值通过。
- 完整恢复副本：`/var/www/obr-plugins/suite-dev-before-connectivity300-final-20261017`，2207 个原文件逐一相同。新制品 1262 个文件，保留 1093 个既定旧资源，线上完整树共 2355 个文件核对通过。没有按新制品数量删除所有旧哈希资源。
- 本轮只启动一次最终预检和一次 apply，后台以 nice 10／I/O 优先级 7 执行，退出码均为 0，回执和 stdout／stderr 持久保存。前两份 `connectivity300-20261016`、`connectivity300-r2-20261016` 因旧夹具提交修正而停用，都只完成上传与基线 capture，从未启动 apply；旧记录没有覆盖。最终封包独立捕获新基线，没有因查询超时重放。

公网 95 个关键文件按完整字节散列核对；四个源码 ZIP 入口在服务器验证完整 SHA-256，归档内逐文件匹配冻结 Git blob。公网核对各入口长度、ETag 和首尾各 4096 字节，总共仅下载 32 KiB 归档片段；本轮没有重复全量下载这些归档，以免占用玩家带宽。这是服务端完整验证加公网抽样，不冒充公网全量归档下载。

## 未完成的真实验收

CDP 9222—9225 均不可连接，没有关闭、重启用户浏览器或清除登录／存档。合成 SDK、多端客户端与浏览器测试不等于真实枭熊房间验收。仍缺：

- 主持人和玩家至少各一端的真实房间条件，复测投骰、演出、断线恢复与原线路的重连频率；F7 四端仍未完成。
- 同一真实房间同时打开先攻条和文字演出，确认原宿主跨 iframe 透明与前景顺序。
- 出问题的原传送门／图像条目及当前场景，按原换图、缩放、非正方形图片步骤复测“棋子进入完全不触发”。当前几何回归覆盖这些变换，但未操作原玩家道具。
- Issue73 仍缺原始角色卡、资料版本及具体错误值；Issue77 仍缺 Full Suite 在真实主持人／玩家端清除、重开、刷新后的分步结果。两者保持开放，不用本轮合成测试结案。

已有九封邮件反馈未重复修复或擅自发送回复。旧发布记录和稳定版验收边界继续有效。
