# 角色卡资源释放与骰子修复246合并部署回执

用户指定 Web `fb584043c6bed831b9ca92eab783653770c24fe6` 与 Suite `f67516100c1e5af450a4ee6a948241c03286c397`；均从245主线无冲突快进整合。原混合维护目录没有构建、reset、clean或整包回填。隔离源码与证据位于 `U:/CodexWork/2026-10-05/resource246/{web,suite}`。

冻结的运行及公开源码ZIP：Web `2bfc832916896e85aa22b4f36f3ba66a7bae6749`，Suite `be3b13df39477491dda0b6ec152b1bf836e22b4a`。除指定修复外，生产差量仅为版本与公告，另有文档及CI精确配对。上线完成后仅追加本回执与状态文档；这些文档提交不改变上述运行源码ZIP绑定。新增inline传输、被否决的渲染实验、稳定旧插件、独立三龙网站、后台与玩家数据不纳入。

已发布 `/card/` standalone-1.0.246 / 公告0.1.37与 `/suite-dev/` 1.0.246-dev；现行骰子通信标记suite-3d-4保留。角色撤读释放完整body并保留纯数字修订水位；只撤写不释放可读内容，未确认草稿与ACK收束保留。骰子包含小屏显示、验证后纹理共用、必要音频预热以及暂停、重启和异步销毁清理。

本机909单元通过/26条件跳过，类型、集成/单机双构建与启动边界通过；Suite45组以及宿主/3D类型检查通过。实际Chrome18项权限/恢复浏览器通过，发布包三项撤读/重新授权/草稿流程和独立站五页、编辑后刷新保留通过。发布包实际WASM/WebGL投骰结果6/5/16，总计32，错误0，不发送房间消息。

首轮Web CI37248034617的反馈组16通过/1失败，原因是本轮独立站公告误提“枭熊”，违反既有渠道隔离断言。只修公告措辞，原断言本机复验通过；原日志保留，其余未完成组被新提交按工作流取消。首轮Suite CI37248039023成功；其旧骰子CI37248039085已完成时钟、录制与生命周期，视口尚未完成时为释放同分支队列取消，不能列为全通过。本次最终骰子组合另行重跑全部像素与45视口，原有继承门禁未修改；本轮执行完整视觉复验。最后Suite重绑只改两份工作流，源码审计确认运行构建相关文件逐字节保持不变。

本地发布包首次standalone流程被未确认版本公告阻挡，三个角色权限流程已通过后中断。补上既有suppressAnnouncement夹具后原五页/持久化断言通过；未改产品。测试原始输出和暂存trace保留。

## 最终CI、上线与公网核验

- Web完整矩阵[37248489967](https://github.com/FullPeople/DND-card-web/actions/runs/37248489967) verify和21浏览器组全部success；909单元通过/26条件跳过，669次浏览器执行通过/24条件跳过，次数包含分组重复，不能称为不同用例数量。
- Suite精确配套Web的完整CI[37248494920](https://github.com/FullPeople/obr-suite/actions/runs/37248494920) success。
- 最终骰子专项[37248494924](https://github.com/FullPeople/obr-suite/actions/runs/37248494924) 四job全部success：同runner时钟对照、录制双端、实际暂停/销毁生命周期，以及完整纹理像素与45视口。录制22场景/0错误；生命周期21轮投掷、2次模块循环/0错误。实体房间、手机、平板、真实后台标签页、音频可听性和场景切换不由该夹具验收。
- 原修复提交均为main/dev当前运行提交的祖先，使用非强推快进，发布之前再次核对远端仍是这对SHA。
- 服务器回执`/root/codex-release-receipts/resource-repair246-20261005.json`为published；目标完整树与回执一致，所有受保护静态站、Nginx/systemd/relay/三龙服务源码及服务运行起点保持不变。备份分别941/4952文件，不手工写玩家数据。
- 公网240份非源码文件完整SHA256、11份源码别名HTTP206长度/ZIP提交注释绑定、12项gzip解压散列全部通过。源码全文散列由服务器整树覆盖，范围检查不冒充全文公网下载。
- 实际HTTPS页面4项交互通过：撤读隐藏/重新授权拒绝旧body；在途草稿恢复且迟到ACK不重放；过期重试退出loading后当前版本恢复；独立站五页和编辑后刷新持久化。生产HTML/JS/CSS真实，规则与房间宿主是原创夹具；禁止非GET与房间websocket，不接触真实人物。
- 公网空缓存Chrome实际WASM/Jolt/WebGL投骰和动画通过，6/5/16，总计32，0错误、0房间消息。

main/dev自动重复触发的同SHA常规CI另存`ci-web-main.json`、`ci-suite-dev.json`；相同SHA的重复dev骰子专项37249433890被取消以免重复长运行，真正发布门禁是上述四job全部成功的精确SHA分支运行，不以取消作通过。

## 本轮回滚与证据

- `/var/www/obr-plugins/card-before-resource-repair246-20261005`
- `/var/www/obr-plugins/suite-dev-before-resource-repair246-20261005`
- 包及参数化发布器：`/root/codex-release-packages/resource-repair246-20261005/`
- 发布包回执SHA256：`c38fcb4a19d9771451fd5cbefe5a8ea6cfec4d40f02a489edbe3f4e4d78a43ed`

```sh
python3 /root/codex-release-packages/resource-repair246-20261005/atomic_frontends.py --archives /root/codex-release-packages/resource-repair246-20261005 --receipt-sha c38fcb4a19d9771451fd5cbefe5a8ea6cfec4d40f02a489edbe3f4e4d78a43ed --rollback
```

回滚会检查当前站、受保护状态和本轮备份仍匹配回执；不覆盖后续发布。两个历史混合根目录status前后保持相同。完整证据包括source-audit.json、原候选与首轮失败/取消日志、最终CI日志/状态、dice-final-evidence、dice-final-timing、runtime246.build-evidence、package/package-receipt.json、preflight.json、deployment.json、server-receipt.json、server-final-verification.json、public-artifacts.json、public246/report.json和live246/live.json。所有浏览器及像素证据只存本地忽略目录，不公开上游快照。


参数化atomic_frontends.py只读预检与发布均已完成；使用固定package-receipt SHA256 `c38fcb4a19d9771451fd5cbefe5a8ea6cfec4d40f02a489edbe3f4e4d78a43ed`，已先创建并校验两份新完整备份，取得发布锁并重新核对现场基线，再以renameat2交换两站。旧hash资源及历史源码下载保留。回滚不得覆盖后来发布。

真实登录枭熊双账号房间、玩家原设备、实体手机和平板没有现场验收。受控引用释放不等于真实Edge内存泄漏根治；模拟viewport/DPR与SwiftShader不等于实体设备性能，CPU返回不等于GPU呈现，也不宣称启动等待或大量投骰卡顿全部根治。
