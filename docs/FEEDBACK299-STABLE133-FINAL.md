# 299 与稳定版 1.3.33 最终发布记录

2026-10-16 两次独立发布均已执行切换，并完成服务器和公网验证。本文是后续文档记录，不替代下列运行源码。

## 运行来源

| 入口 | 版本 | Git 运行来源 |
| --- | --- | --- |
| 网站／卡库／Wiki | standalone-1.0.299 | 34c0e4bfee01f5d85c5b94bb52bfa20619301754 |
| 新版插件 suite-dev | 1.0.299-dev | 303f72ee33ec32028bf449d2c29e3abab05044ab |
| 稳定插件 suite | 1.3.33 | 79466fe2ff2da502c463c134587975cbdea62c6b |
| 稳定插件内查看器 | standalone-1.0.295 | c2d20cdc9e434dd8c22e4e89966ece51c39120af |

稳定插件配套查看器沿用已发布来源，没有混入新版插件架构。QQ／云端继续暂停、账号资料私有，后台保持 1.0.295，轻量 2D 路径、网站首页、旧站导出、其他项目及玩家数据受保护。1.3.33 经用户追加授权，独立封包、独立完整备份；299 发布时的稳定版保护值是历史验收值，随后只由本次独立稳定发布替换。

## 修复和 PR

- Web PR80、Suite PR98：公共仓库零余额货币格可在原权限、锁定和修订校验下移除；角色钱包及有余额货币继续受保护，不自动清理玩家数据。实际事务与实际 UI 各七项检查通过。
- Suite PR97：稳定版完整骰盘与浮动历史页写入前读取当前持久记录，存储读取失败时才回退内存；完整骰盘同步同源清除事件，防止旧页面把已删记录合并写回。五组实际页面浏览器流程通过。
- Suite PR97：Boss／先攻透明页面允许协商宿主的浅色／深色方案，修复深色宿主下不透明白底。原像素断言保留；当前公网实际页面的四组组合与配置对照通过。
- Suite PR96 修正 298 候选的公开版本元数据；Web PR81 与 Suite PR99 将新运行包、公告及完整源码下载统一为 299。原封存 298 制品没有覆盖。
- 继承 298 已发布的来源职业表资源次数、休息恢复、升级保留消耗、宿主持久化删除与同源旧页面修复，没有重做完整来源审计。

## 精确提交 CI

### feedback299-20261016

- [38911667399](https://github.com/FullPeople/DND-card-web/actions/runs/38911667399)：FullPeople/DND-card-web，main，34c0e4bfee01f5d85c5b94bb52bfa20619301754；第 1 次运行，29 项全部成功。
- [38911831725](https://github.com/FullPeople/DND-card-web/actions/runs/38911831725)：FullPeople/DND-card-web，main，34c0e4bfee01f5d85c5b94bb52bfa20619301754；第 1 次运行，1 项全部成功。
- [38911839362](https://github.com/FullPeople/DND-card-web/actions/runs/38911839362)：FullPeople/DND-card-web，main，34c0e4bfee01f5d85c5b94bb52bfa20619301754；第 1 次运行，1 项全部成功。
- [38911885356](https://github.com/FullPeople/obr-suite/actions/runs/38911885356)：FullPeople/obr-suite，dev，303f72ee33ec32028bf449d2c29e3abab05044ab；第 1 次运行，1 项全部成功。
- [38911892108](https://github.com/FullPeople/obr-suite/actions/runs/38911892108)：FullPeople/obr-suite，dev，303f72ee33ec32028bf449d2c29e3abab05044ab；第 1 次运行，1 项全部成功。
- [38911902027](https://github.com/FullPeople/obr-suite/actions/runs/38911902027)：FullPeople/obr-suite，dev，303f72ee33ec32028bf449d2c29e3abab05044ab；第 1 次运行，1 项全部成功。
- [38911910392](https://github.com/FullPeople/obr-suite/actions/runs/38911910392)：FullPeople/obr-suite，dev，303f72ee33ec32028bf449d2c29e3abab05044ab；第 1 次运行，1 项全部成功。
- [38911916704](https://github.com/FullPeople/obr-suite/actions/runs/38911916704)：FullPeople/obr-suite，dev，303f72ee33ec32028bf449d2c29e3abab05044ab；第 1 次运行，1 项全部成功。

### stable133-feedback-20261016

- [38912454654](https://github.com/FullPeople/obr-suite/actions/runs/38912454654)：FullPeople/obr-suite，main，79466fe2ff2da502c463c134587975cbdea62c6b；第 1 次运行，2 项全部成功。
- [38912454923](https://github.com/FullPeople/obr-suite/actions/runs/38912454923)：FullPeople/obr-suite，main，79466fe2ff2da502c463c134587975cbdea62c6b；第 1 次运行，1 项全部成功。
- [38912454815](https://github.com/FullPeople/obr-suite/actions/runs/38912454815)：FullPeople/obr-suite，main，79466fe2ff2da502c463c134587975cbdea62c6b；第 1 次运行，1 项全部成功。
- [38912454948](https://github.com/FullPeople/obr-suite/actions/runs/38912454948)：FullPeople/obr-suite，main，79466fe2ff2da502c463c134587975cbdea62c6b；第 1 次运行，1 项全部成功。

Web PR80 同一提交的首次验证曾有三项目录加载等待失败，重跑失败项后 29 项全部通过；未隐藏首次失败。稳定版首轮透明画布、启用态 QQ 夹具与公告检查失败后修正了实际问题，同一最终提交完整检查成功。旧可变来源下载的大小守卫和旧 3D 专项仍有历史失败，没有改审计散列、放宽断言或恢复 3D 来消除红灯。

## 发布、回执和完整恢复点

### feedback299-20261016

- 实际发布完成（北京时间）：2026-10-16T22:26:48.491679+08:00。
- 服务器封包：/root/codex-release-packages/feedback299-20261016。
- 全局回执：/root/codex-release-receipts/feedback299-20261016.json；published.json 与全局回执逐字节相同。
- Manifest SHA-256：afaf3c38ad71c9811f176c5c6655fbbdd2eb31c26dfcbe9412f77f254a8f34ce。
- Baseline SHA-256：fbb94683a4b95446f02542c47d312b34ff9c29a4602ae9f1ef3d6c2c79533565。
- 发布回执 SHA-256：86fc029ef1f9fee72e8bec42bbc7c245dde7c703bc1fa7cb7f1f6593d03e0313。
- capture／preflight／apply／postverify 各执行一次且退出码为 0；连接查询没有触发重放。发布器含完整备份、暂存散列、原子交换、HTTP 字节就绪和失败恢复；未发生失败切换或回滚。
- 125 项保护前后相同，完整线上树和完整备份逐文件匹配；后台和数据库身份保护通过。

| 目标 | 新包文件 | 保留旧资源 | 线上合计 | 完整备份文件 | 恢复目录 |
| --- | ---: | ---: | ---: | ---: | --- |
| card | 185 | 1517 | 1702 | 1624 | /var/www/dnd-center/card-before-feedback299-20261016 |
| library | 109 | 543 | 652 | 630 | /var/www/dnd-center/library-before-feedback299-20261016 |
| suite-dev | 1262 | 945 | 2207 | 2061 | /var/www/obr-plugins/suite-dev-before-feedback299-20261016 |
| wiki | 64 | 6 | 70 | 70 | /var/www/dnd-center/wiki-before-feedback299-20261016 |

备份是发布前完整目录。需要恢复时先检查后续发布和回执，保留现状并持有发布锁，再按目标原子恢复；不得用旧备份覆盖随后新增的玩家资料或其他目标。

公网核对 55 项通过，包括 7 个完整 Git 源码 ZIP 的实际字节。分段下载逐段校验 HTTP 206、范围、长度、ETag，完整重组后的 SHA-256 与封存清单一致；并非只核对 HEAD。源码 ZIP 已逐文件匹配 Git blob，不含原始资料快照。

### stable133-feedback-20261016

- 实际发布完成（北京时间）：2026-10-16T22:54:37.518850+08:00。
- 服务器封包：/root/codex-release-packages/stable133-feedback-20261016。
- 全局回执：/root/codex-release-receipts/stable133-feedback-20261016.json；published.json 与全局回执逐字节相同。
- Manifest SHA-256：b76569e6959f391801408d1e595a64c98f9c2073d938dc633f73bc308762463d。
- Baseline SHA-256：3b337f16f266e32987332c11bf9774b91d60081b49b2684107fcba34c7a87505。
- 发布回执 SHA-256：b65a92b54e0a4c714601819304479307b7724f6f49ebac1e4fc49d1ebcf16673。
- capture／preflight／apply／postverify 各执行一次且退出码为 0；连接查询没有触发重放。发布器含完整备份、暂存散列、原子交换、HTTP 字节就绪和失败恢复；未发生失败切换或回滚。
- 125 项保护前后相同，完整线上树和完整备份逐文件匹配；后台和数据库身份保护通过。

| 目标 | 新包文件 | 保留旧资源 | 线上合计 | 完整备份文件 | 恢复目录 |
| --- | ---: | ---: | ---: | ---: | --- |
| suite | 787 | 3550 | 4337 | 4334 | /var/www/obr-plugins/suite-before-stable133-feedback-20261016 |

备份是发布前完整目录。需要恢复时先检查后续发布和回执，保留现状并持有发布锁，再按目标原子恢复；不得用旧备份覆盖随后新增的玩家资料或其他目标。

公网核对 18 项通过，包括 2 个完整 Git 源码 ZIP 的实际字节。分段下载逐段校验 HTTP 206、范围、长度、ETag，完整重组后的 SHA-256 与封存清单一致；并非只核对 HEAD。源码 ZIP 已逐文件匹配 Git blob，不含原始资料快照。

## 验收范围和未完成项

- 299：独立生产浏览器上下文中的两个资源流程通过，覆盖资源出现、次数修改、升级保留已消耗次数与刷新恢复；只用原创测试角色和来源夹具。实际轻量运行包四个合成客户端及 11 个公式通过，不能代替真实房间。
- 1.3.33：公网关键文件与完整源码 ZIP、暂停策略、实际 Boss／先攻页面合成像素检查通过；完整骰盘、浮动历史页及其引用资源的额外 22 项公网字节核对通过。浏览器测试使用独立上下文，不接管用户浏览器。
- Issue75 已在 298 部署和发布包验证完成后关闭。Issue73 和 Issue77 保持开放。
- Issue73 缺原卡的脱敏副本、六维修改前后值及保存顺序、普通原生卡／此前 QQ 关联卡的入口说明，以及前台与宿主同版时的真实错误状态和时间。现有诊断只有 status:0，前台 288-dev 与宿主 292-dev 不同，不能证明某项规则或六维数据有错。
- Issue77 第二处按维护者澄清指 Full Suite 自带骰子。仍缺原反馈具体稳定／开发入口和完整版本、专用真实房间、独立 GM／玩家身份，以及分别执行 F5、换场景、退出重进、再掷骰后双方所见结果。本次保护本客户端历史持久化，没有把清除改为替所有玩家全局删除。
- 原浏览器 CDP 9222—9225 无法连接，未关闭、重启用户浏览器或清理登录／存档。真实 F7 四端和原设备验收未完成；合成检查、源码和公网验证不冒充现场通过。

## 来源审计、PR 与邮件

已完成的审计沿用 Data 提交 3d37d147bf557829c7846c0ef0d5d9ca50c524d4，报告 SHA-256 32f224c2358f233671491ee05eabb13470d20215c1b04f3876385e6f31d4556e：229 份输入、18,789 个身份、70 个实际消费者模块；6,537 个身份至少一项计算／选择可用，不代表整条规则完整执行。未重做、扩大统计或公开原始快照。

Web／Suite 本轮相关 PR 已合并。Data 的六个既有草稿 #41、#39、#37、#31、#30、#5 没有新采纳证据，继续草稿；#5 权限审查未被合并绕过。

已核对邮箱 1763086701psw@gmail.com 的九封相关反馈，九份回复均为未发送草稿。公共空货币格、人类多用、Boss／先攻草稿按实际版本和剩余验收边界更新；旧竖琴手、法术设置、赌具和 Edge 修复没有重复改写。血猎手保留第三方 2024 适配与其他来源的区别，未把版本差异误修成同一规则。没有发送邮件。
