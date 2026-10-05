# 骰子跨窗口与准备尾段247合并部署回执

用户指定 `fix/dice-cross-window-tail-246-20261005` 的 `695a3523eeabbf7cbb07e86590310ca0fa3f34a9`，已在246主线上快进合入Suite dev。仅发布 `/suite-dev/` 为 **1.0.247-dev**；独立角色卡 `/card/` 仍为standalone-1.0.246。稳定Suite、独立三龙、relay、应用服务、Nginx和玩家数据保留。

运行及公开源码ZIP绑定：Suite `29e3591e5a9677bbf81a06979266c5df0b5ffb81`，配套Web `2bfc832916896e85aa22b4f36f3ba66a7bae6749`。后续仅追加本回执与状态文档，不重新构建或改变运行ZIP绑定。隔离源码与证据在 `U:/CodexWork/2026-10-05/dice-tail247/`，历史混合根目录没有reset、clean、构建或整包回填。

## 实际变更与边界

- 快捷投骰没有历史消费者时跳过历史重放；完整历史面板仍读取、显示和保存100条记录，私密筛选及角色切换保留。
- 验证通过的时钟回复立即唤醒已准备接收者；每项接收轨迹只保留一个有界回退计时器，完成、取消、会话替换和销毁时清理。
- 已验证的公开单次投骰、物理骰数少于10且所有必要接收者准备完成时，可复用队列尾段发送开始。保留时钟提前量、受众限制、组投掷/暗骰回退、丢块恢复和确定性物理轨迹。
- 相比指定候选，发布元数据只调整dev清单版本、CI触发及精确Web配对、交接文档和一处CI依赖复制修复。候选生产差量严格为控制器与SDK facade两个文件。630份构建输入逐文件核对；78份渲染器产物与线上246逐字节一致，suite-3d-4、物理引擎和锁定素材保留。
- 共享Web公告仍为246批次，本轮没有更改Web公告或独立站版本。前端覆盖范围为新宿主/骰子产物、dev清单与三个Suite源码下载副本；其余Web、查看器、非骰子面板及旧hash资源保留。

## 具体验证

- 原候选[跨窗口CI37262256845](https://github.com/FullPeople/obr-suite/actions/runs/37262256845)成功。
- 最终源码的[完整Suite CI37294127121](https://github.com/FullPeople/obr-suite/actions/runs/37294127121)、[跨窗口专项37294127179](https://github.com/FullPeople/obr-suite/actions/runs/37294127179)和[资源四组专项37294233719](https://github.com/FullPeople/obr-suite/actions/runs/37294233719)全部success。没有以旧SHA或取消的运行替代最终门禁。
- 本机45组Suite回归通过；时钟唤醒18/18与准备尾段34/34通过。VM测试保留同字节传输、历史消费者、权限和队列断言；队列模型数字不作用户设备延迟指标。
- 最终跨窗口CI使用真实分离的卡窗/opener、默认Chromium上下文与自然可见性；验证可见但未聚焦卡窗、隐藏宿主标签页、返回后不重复提交、完整历史及伪造兄弟消息拒绝。房间宿主为原创夹具，没有真实枭熊房间或首枚骰子呈现延迟声明。
- 四种兼容场景执行实际SDK/Jolt/WASM/轨迹编解码与Three渲染：1d20、9d6、私密self 1d6和丢最后一块恢复。授权结果一致、动态不透明像素回读完成、非授权端无私密结果；合成房间和软件WebGL不作实机性能证明。
- 发布包本机及公网实际quick/full JavaScript均通过原四组断言：连续五次快捷点击零历史请求；完整100条历史；当前结果与GM降权/恢复筛选；关闭重开保存新结果并保留历史请求。公网仅宿主响应是原创夹具，资源来自实际HTTPS，非GET及房间WebSocket被阻止。
- 公网18份非源码差量完整SHA256、3份Suite源码别名HTTP206长度/ZIP提交绑定、5项gzip解压散列全部通过。源码全文散列由服务器完整树校验覆盖，范围检查不冒充全文公网下载。
- 公网生产WASM/Jolt/WebGL投骰结果6、5、16，总计32，错误0、房间消息0。全部目标文件、完整备份及受保护站点/服务散列与起点匹配回执。

## 首次失败与恢复

第一次发布组合094a232的完整Suite及跨窗口CI成功。合入dev后自动资源CI37293562834失败于旧对照工作树：候选测速构建脚本新增import `tools/dice-tail-trace.mjs`，原复制清单漏带依赖，报ERR_MODULE_NOT_FOUND；时钟与纹理对照构建失败，其他部分运行/取消不列为成功。日志`ci-resource-timing-failure.log`保留。

仅补齐资源工作流两处依赖复制清单，不改产品、断言、阈值或门禁。原失败运行随后取消以释放队列；修复后上述最终三份CI重新执行成功。第一次包与已上传目录保留为审计记录，未执行上线；最终包另用r2目录及固定回执散列。构建输入核对证实CI修复前后实际运行产物完全相同。

## 发布与本轮回滚

- 服务器回执：`/root/codex-release-receipts/dice-cross-window-tail247-20261005-r2.json`，状态published。
- 本轮完整备份：`/var/www/obr-plugins/suite-dev-before-dice-cross-window-tail247-20261005-r2`，5103文件。
- 最终包与参数化发布器：`/root/codex-release-packages/dice-cross-window-tail247-20261005-r2/`。
- 发布包回执SHA256：`5ee9fe5309e19af7f14eb5c581f5c8a33757e45564212096a6d1bd4246e07411`。
- 发布器在锁内重核现场与保护基线，校验完整新备份和暂存树后，用renameat2原子切换一个目标；没有复用246备份。

```sh
python3 /root/codex-release-packages/dice-cross-window-tail247-20261005-r2/atomic_frontends.py --archives /root/codex-release-packages/dice-cross-window-tail247-20261005-r2 --receipt-sha 5ee9fe5309e19af7f14eb5c581f5c8a33757e45564212096a6d1bd4246e07411 --rollback
```

回滚会核对当前站和保护状态仍匹配本轮回执，不覆盖后续发布。证据包括source-audit.json、各CI终态/日志/原失败、final-cross-evidence-r2、runtime247.build-evidence、package/package-receipt.json、preflight.json、deployment.json、server-receipt.json、server-final-verification.json、public-artifacts.json、public247/history/result.json与live247/live.json。原始浏览器证据和运行结果留在本地忽略目录，没有新增公开上游正文。

更新时关闭附加窗口、刷新整个枭熊房间后重新打开插件。真实枭熊双账号房间、玩家原设备与实体手机/平板未现场验收；不宣称所有跨窗口首枚骰子等待或大量投掷卡顿已根治。
