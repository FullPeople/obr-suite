# 指定角色卡与骰子修复245合并部署回执

本轮先核对远端与线上244：指定三项提交均尚未合入。以Web main `1e234716948e6b1095c81da4efc013711f16c4f0`、Suite dev `ca684455cef7decacb8bd0d5cffc011b77b500a3`建隔离工作树，只合入指定修复。三龙独立站、FUS、自动化数据仓库、后台PR、未推送资源小修及其他骰子性能实验分支不纳入。

| 仓库/主线 | 输入修复 | 实际合并提交 | 运行与公开源码ZIP SHA |
| --- | --- | --- | --- |
| Web / main | 05dcfdb645339cac9f68d1f6009f44b7e63d5c25 | c6f4e849c3538bb53603bf05f2e6dea384dc5d7c | a1ddc1cb6eb684b96b5e1a89f1ceff7c158af91a |
| Web / main | 5178ab9f11b761fd4d5f65152d8337981fa024dd | d360841fbc6f1042cb21e2329bf4bf531e24a34b | 同上 |
| Suite / dev | 2e2ddb1f642e1375cffda45efad9584b33100008 | 24a498d317d4f107fdb29e320a4647e3f50b0252 | de58239911222572dc56274c7ab2365baca229f3 |

产品代码无冲突；Web工作流的分支触发和矩阵冲突按集合合并，保留新豁免、起源专长、转场、权限及244恢复测试。发布器只非强推推进main/dev，Suite完整CI与六组骰子诊断全部固定最终Web SHA。Web CI配套权限面板引用Suite24a498d，其面板生产代码与最终Suite相同；后续Suite只加版本及CI检查。公告保留244完整折叠历史，仅展开245新批次；单机只列豁免与起源专长，Suite另列转场、权限及骰子。

## 组合验证

本机Web896单元通过/26条件跳过，115测试文件通过/1条件跳过。类型、集成与standalone双生产构建、启动依赖边界通过。Suite37组回归及宿主/骰子两套TypeScript通过；新增时钟、派发、轮廓、canvas resize、材质、保守裁剪及原恢复回归纳入完整CI。部署输入使用固定 `DND_CARD_WEB_ROOT`，重新生成宿主/物理worker、骰子、角色卡、只读查看器与面板；宿主overlay265文件、1077静态引用、锁定骰子资产与源码未变门禁通过。

- Web组合CI [37211970725](https://github.com/FullPeople/DND-card-web/actions/runs/37211970725) 的verify及21浏览器组全部success；日志合计666次浏览器执行通过/24条件跳过，不能当作666个不同用例。
- Web合入main后的同SHA完整CI [37212697132](https://github.com/FullPeople/DND-card-web/actions/runs/37212697132) success。
- Suite最终组合CI [37212248371](https://github.com/FullPeople/obr-suite/actions/runs/37212248371) success；dev同SHA完整CI [37212704905](https://github.com/FullPeople/obr-suite/actions/runs/37212704905) success。
- 骰子组合诊断 [37212249710](https://github.com/FullPeople/obr-suite/actions/runs/37212249710) 六job全部success，包括真实SDK/Jolt/WASM/WebGL双端、视频/无采集、私骰与故障路径、固定姿态像素相等、复杂效果完整视口回退和同runner基线→候选→基线。

本机起源专长2、权限/窗口9、Suite权限9场景通过；局部save/转场/启动初批27通过/1条件跳过，因自建测试配置误将suite项目叫integrated，6项启动场景读取错误公告模式而失败。配置纠正后Suite启动9项全部通过，原失败日志保留，没有改产品代码或放宽断言。首轮SuiteCI37212009490历史三龙退出夹具按钮等待超时，最终精确SHA完整CI原断言通过；失败日志保留，没有修改三龙源码。额外为新增材质基线回归保留完整Git历史。

## 部署与线上核验

只更新 `/card/` standalone-1.0.245（公告0.1.36）和 `/suite-dev/` 1.0.245-dev，通信标记suite-3d-4保留。两站release.json与公开Git源码ZIP注释绑定上述运行SHA。完整CI通过才执行参数化atomic_frontends.py：先创建并逐文件核对两份完整备份，再暂存、再次核对现场基线和受保护状态，通过renameat2交换两站。保留既有hash资源和源码下载历史。部署锁及整树门禁拒绝并发覆盖。

服务器回执 `/root/codex-release-receipts/card-suite-fixes245-20261004.json` 为published。最终两站全树与回执一致；备份分别869/4797文件。稳定Suite、独立三龙正式/测试站完整树、Nginx、systemd、relay源码、三龙服务源码及运行起点均与本轮部署前匹配，未写玩家数据。线上非目标清单实际为1.3.14、0.9.1和0.9.1-dev；历史244记载0.9.0不用于覆盖现场。

公网247份非源码归档文件完整SHA256、11份源码别名HTTP206长度/ZIP提交注释绑定、12项gzip解压散列通过。源码ZIP全量散列由服务器整树检查覆盖，不把范围请求称为全文公网下载。首轮公网核验脚本错误沿用三龙0.9.0断言，修正为本轮现场基线散列后通过；没有部署三龙。

公网25个不同交互场景最终通过/1条件跳过，包含原生与legacy豁免增量、撤权、只读第二页、桌面/窄屏对齐、起源专长选择/持久化/去重/清除、权限持续提醒与明确确认、转场仅演出、五页启动、404恢复和合成拒绝删除。首批20通过/5失败/1条件跳过；两处第二页仍访问根路径而403，一处公告选择器误写announcement-dialog，修正测试后通过；两处起源专长在正常代理路径等Wiki界面超出18秒，原断言在直连复验通过。五项独立复验全部通过，首次日志/trace保留，没有更改产品或放宽交互断言。测试使用实际HTTPS页面、JS、CSS与权限/设置产物，规则和宿主为原创夹具，禁止真实写请求与游戏/relay websocket，没有在真实角色上执行导入/删除。三龙导航使用静态目的页截获，不宣称真实对局已验收。

实际公网Edge直连空缓存WASM/Jolt/WebGL投骰成功，骰面6、5、16，总计32，错误0，没有发送房间消息。首次正常代理路径冷下载在60秒结束观察时仍46/49，剩余音频下载未完成，失败JSON/截图保留；另以直连与180秒观察预算验证完成。此复验仅证明功能可以完成，未关闭首次冷加载慢问题。

## 性能及验收边界

同runner SwiftShader、同Web、同seed、1280×800/DPR1无采集对照：暖单骰首CPU绘制返回中位1766→1068→1680ms，帧P95中位283→150→283ms。20骰P95两段基线783–800ms，候选450–467ms；实际演出基线约53–56秒，候选32.4–32.5秒。具有改善证据，仍不能称大量骰子卡顿根治，也不能外推真实GPU/玩家设备FPS。CPU绘制返回不是GPU呈现时刻。

启动尾等待仍未证明根治。真实登录双账号枭熊房间、玩家原设备与实体手机没有现场验收。本轮不是全部产品/所有规则/真实多人完成声明。

## 回滚与证据

- `/var/www/obr-plugins/card-before-card-suite-fixes245-20261004`
- `/var/www/obr-plugins/suite-dev-before-card-suite-fixes245-20261004`
- 发布包目录 `/root/codex-release-packages/card-suite-fixes245-20261004/`
- package-receipt SHA256 `02cea7d2ed6bf6067f182ab9613f45f41041c4dca6ddc0664a654a47b0ba9ecf`

```sh
python3 /root/codex-release-packages/card-suite-fixes245-20261004/atomic_frontends.py --archives /root/codex-release-packages/card-suite-fixes245-20261004 --receipt-sha 02cea7d2ed6bf6067f182ab9613f45f41041c4dca6ddc0664a654a47b0ba9ecf --rollback
```

回滚先核对当前站、备份与受保护状态仍匹配回执；不会强制覆盖后续发布。

隔离源码/证据根 `F:/CodexWork/2026-10-04/card-suite-combined/`。包含commits245.json、CI完整日志/状态、dice-paired-evidence和dice-metrics-summary.json、package/package-receipt.json、preflight.log、deployment.json、server-receipt.json、server-final-verification.json、public-artifacts.json、首次与修正浏览器报告/trace、suite/.local-evidence/live245投骰成功与首次冷下载失败证据。两个混合原目录的status前后相同；没有reset/clean、从原目录构建或纳入其未推送修改。
