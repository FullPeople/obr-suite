# 工作台恢复 244 合并与部署回执

本轮仅发布 `/card/` 与 `/suite-dev/`。指定恢复提交均无冲突快进合入最新主线；发布版本与公告在隔离副本中追加，三龙 0.9 网站新窗口入口及启动优化保留。稳定版、独立三龙正式/测试站、relay、服务、Nginx 和玩家数据不纳入。

| 仓库 | 指定修复 | 主线运行 SHA | 发布版本 | 最终 CI |
| --- | --- | --- | --- | --- |
| DND-card-web / main | 108d56e4c5146b7f6b4aee418fce23d6d1a0634a | 41a652373019cb912edb0fa7e0eef13f702c2fef | standalone-1.0.244 / 公告0.1.35 | 37183691337 |
| obr-suite / dev | 25380f346a3968f41fa54544ef39395ea48224e1 | 7783de080b0a32465150fbb2672daf848d5385b5 | 1.0.244-dev | 37183712279 |

输入 CI37176889303 与 CI37177352957 均核对为对应指定 SHA 的 success。发布组合另行执行完整 CI，不能用输入 CI 代替发布组合验收。

本机 Web867单元通过/25外部资料条件跳过；双构建、TypeScript和启动边界通过。角色管理6项、独立权限/三龙窗口5项、Owner与404恢复15项、双模式启动18项、Suite权限9项浏览器通过。Suite本机合成组首次27/28通过；CRLF导致权限面板测试剥离import失败，定向修正后6场景通过，最终完整Suite CI成功。启动边界初次与另一构建重叠导致ENOTEMPTY，串行复验通过，保留首次失败日志。

采用本轮参数化发布器 `atomic_frontends.py`，只沿用已审查的两站完整备份、散列门禁、旧哈希资源保留与renameat2交换流程；未运行旧版硬编码部署脚本。暂存及预检完成后，完整CI通过才执行切换。两站备份均须在任何切换前创建和核对，发布器加非阻塞锁并在切换前再次验证整树基线，发现并发变化立即停止。

恢复点预定为 `/var/www/obr-plugins/card-before-workbench-recovery244-20261004` 和 `/var/www/obr-plugins/suite-dev-before-workbench-recovery244-20261004`。两站备份在任何切换前完整创建并校验，发布已完成。服务端回执 `/root/codex-release-receipts/workbench-recovery244-20261004.json` 状态published，最终整树与备份匹配，受保护状态一致。

隔离源码/证据根：U:/CodexWork/2026-10-04/recovery244/。本地F盘容量不足后切换U盘；混合D:/Desktop/DND-card-web根目录未修改或整包发布。公开源码ZIP只含Git跟踪源码，无本轮生成证据、上游快照和私人角色。

验收使用实际HTTPS前端/权限/设置产物及原创合成宿主。真实登录枭熊房间、玩家原设备和实体手机不因此验收。删除失败仅在合成卡上注入拒绝回执，阻止真实写请求与relay/游戏socket，不在真实角色上试删。

## 最终部署与公网验收

- /card/：standalone-1.0.244 / 公告0.1.35；/suite-dev/：1.0.244-dev，骰子通信标记suite-3d-4保留。两站release.json绑定上述运行SHA；公开源码归档ZIP注释绑定相同提交。
- [Web最终CI](https://github.com/FullPeople/DND-card-web/actions/runs/37183691337) verify及18浏览器组success；[Suite最终CI](https://github.com/FullPeople/obr-suite/actions/runs/37183712279) success，固定Web41a6523。原输入CI37176889303 / 37177352957同样成功，不能替代本批最终CI。
- 公网529个非源码归档文件完整SHA-256通过；11个源码下载别名的HTTP206范围、归档总长度与Git ZIP提交注释通过，源码ZIP完整散列由服务器整树校验覆盖。12项gzip解压内容匹配。没有将源码包的范围核验冒充完整公网下载散列。
- 公网9个不同浏览器场景最终通过：1440/390px独立工作台内权限说明及明确确认、撤权收起；404错误脱离无限读取并可重试/复制脱敏诊断；拒绝合成删除时明确失败并保留选择；三龙网站新窗口、关闭后父页/卡页保留、功能开关/设置/顶部导航；独立站启动与五个页签。
- 首轮公网7通过/2失败。窄屏权限JS请求在18秒断言期内未收到响应，原断言独立复验通过；独立站烟测把实际tab写为button，修正测试选择器后通过。首次日志/trace和复验报告都保留，未更改产品代码或放松断言。源码包多别名重复全文下载耗时，停止本轮只读下载进程，采用服务器全量散列加公网ZIP范围/提交绑定收口；不会称被停止的下载已完成。
- 稳定/suite/全树、独立/three-dragon-ante/与/three-dragon-ante-dev/全树、relay源码、三龙服务源码与运行起点、Nginx和systemd配置一致；未写玩家数据。公开manifest分别仍为1.3.14、0.9.0、0.9.0-dev。保留所有既有哈希资源与公开源码别名历史文件。

## 恢复与证据

本轮参数化发布器支持 `--rollback`，需当前站、备份与受保护状态仍匹配服务端回执；不强制覆盖后续并发变化。运行命令的参数化receipt SHA为 `4c8e7df312ecc059946805337e57eddefa89c3d10a2de86d1efa9e9966b50c58`，归档目录 `/root/codex-release-packages/workbench-recovery244-20261004/`。两个完整恢复目录见上文，未清除。

本地证据根U:/CodexWork/2026-10-04/recovery244/：commits244.json、ci-{web,suite}.json/log、package/package-receipt.json、preflight.log、deployment.json、server-receipt.json、server-final-verification.json、public-artifacts.json、public-browser-final.json、public-browser.log、public-browser-rerun.log，以及web/.local-evidence/public244/results与rerun-results截图/trace。证据、私人资料与生成产物均未收入公开仓库。

真实登录房间、原设备和实体手机仍未现场验收。所有删除测试只用原创合成卡及拒绝回执，没有在真实角色上试删；公网测试阻止真实写请求与relay/游戏socket。三龙目标URL导航被原创静态目的页拦截，0.9独立站版本与完整保护树另行核对，不据此宣称真实对局已验收。
