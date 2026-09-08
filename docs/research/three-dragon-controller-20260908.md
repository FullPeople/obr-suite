# 三龙牌控制器交付与恢复边界

日期：2026-09-08。控制器子任务已封板；主任务负责模块入口、面板消息、UI、最终固定树构建与发布。本记录不等于实际 Owlbear 多人验收。

## 产品行为

- 空房间完成 SDK 初读后允许创建，无桌时不生成密钥或发送轮询网络流量。
- 创建者自动入座；其他访问者自动与主持人建立私密连接，可一键入座或旁观。准备大厅最多六席，至少两席才能开始。
- `newGame` 的产品含义是经 UI 确认后结束旧局、保留座位并回到准备大厅。玩家此时可以进退；`start` 才创建新的 game ID 和洗牌。进行中的退席会被拒绝，关闭面板保留座位。
- 控制器不监听场景打开/关闭。普通场景切换、面板缩放与关闭不结束牌局；后台模块关闭或浏览器退出才停止控制器。
- 主持人先串行执行规则并完成存档，再发布摘要与成功回执。保存失败不更新权威内存；保存成功、metadata 发布失败则保留同一结果待重发。重试不重新出牌或重新生成牌局。
- 客户端保留待确认请求，自动重试最多三次，再允许同页重试。规则动作继续使用原 action ID；准备下一局等控制请求的回执保存在本机存档，最多 128 条。

## 接口与文件归属

`TableController` 导出：`constructor(changed: (view: TableView) => void, options?: ControllerOptions)`、只读 `view`、异步 `start()` / `stop()` / `command(TableCommand)`。

生产默认：`controller-platform.ts` 使用当前安装的 Owlbear SDK，`TableStore` 使用 IndexedDB。第二个构造参数仅用于注入平台/存储及测试时间参数。控制器自己监听 room metadata、party、player 与 `TABLE_NETWORK`；不监听 LOCAL UI 消息；`close` 由模块入口处理。

新增产品文件：

- `src/modules/threeDragonAnte/controller.ts`
- `src/modules/threeDragonAnte/controller-platform.ts`
- `src/modules/threeDragonAnte/controller-validation.ts`

`ControllerRecord = SavedTable & { controller?: { receipts: ControlReceipt[] } }` 是可选私有扩展；`TableStore` 当前的 structured clone 会保留它。后续存档 schema 迁移不能丢弃这一字段。原有私有信道、store、wire、protocol、规则模块及其他模块由各自负责人持有，本子任务未修改。

## 私密性与版本控制

使用 SDK 回调的实际 connectionId 关联当前 party/self 玩家，主持人再将该玩家映射至 seatId。载荷自称的 playerId/seatId 不能获得另一人的手牌或出牌权限。所有访问者建立各自加密链路；旁观者获得公共投影，入座者只获得自己的手牌和私有选择。

每次新 hello 都有唯一请求 ID，主持人给出独立随机 sessionId；待确认链路与活跃链路分开，只有新链路上解密成功的 sync 才替换旧链路。客户端只接受当前 hello 对应的回复。加密消息允许有限乱序，但视图另行检查 table ID、摘要 revision、game ID 和 game revision。

不将手牌、秘密下注、私有候选、牌库顺序、排除牌、规则随机种子或完整权威状态放进房间 metadata。主持人作为可信发牌者仍能看到本机内存和存档中的完整牌局，不能宣称防止主持人作弊。

## 普通房间和设备恢复限制

- 房间摘要只负责发现牌桌；完整存档只在原主持浏览器的 IndexedDB。关闭面板后后台继续主持；主持浏览器关闭后暂停，回到原浏览器可使用新 SDK connectionId 恢复原牌局。
- 同一账号换到没有该存档的设备会显示 `recoveryMissing`。普通重试绝不创建替代手牌。只有显式确认“准备新游戏”才允许旧主持连接离线时回到新大厅；这是放弃旧局，不是恢复。只有一席也能回大厅等待其他人加入。
- 有在线旧主持连接时不抢占主持权。若只是禁用了扩展但连接仍留在 party，其他设备不能据此假定旧主持已退出。成员离线事件会立即暂停；扩展无响应但连接仍在线时，心跳按默认 24 秒失联界限判断连接不可用。
- 私钥与待确认客户端请求随后台实例存在；原主持存档持久。清理站点数据、隐私浏览存储丢失或原设备不可用，会失去恢复来源。没有外部服务器或跨设备云备份。
- Owlbear room metadata 没有 compare-and-swap。建桌用短暂候选协商、写前读现桌、写后核对所有权减少冲突；不能宣称在任意网络延迟下实现分布式原子创建。竞争失败方接受现桌，不继续主持。首次创建尚未发布且随即关闭浏览器时可能留下本地空大厅记录；此时没有已发手牌。
- metadata、IndexedDB 与广播没有跨系统原子事务。已公布桌的保存后发布失败可从原桌 ID 恢复；通用 SDK 错误显示重试，不一概谎称房间容量不足。

## 已完成验证

1. `node tools/three-dragon-controller-selftest.mjs`：12 组实际 controller / 规则 / 浏览器原生密码原语的多实例回归。仅 SDK 房间传输和存储端口被模拟。覆盖创建/加入/开始、旁观与本席私有投影、ACK 丢失、存储失败、回大厅后换玩家、保存后发布失败的回执幂等、旧握手与旧私密消息、主持关闭时未完成存档的后续恢复、无档设备拒绝、有效旧快照晚到不覆盖新 revision、恶意客户端伪造其他座位、迟到初读、旧生命周期回调、SDK 首次失败重试、版本不兼容及 stop 清理。
2. `node tools/three-dragon-controller-ui.mjs`：实际 Edge 152.0.4191.66，真实冻结 UI 点击连接实际控制器、规则、WebCrypto 与生产 IndexedDB。验证空房创建按钮可用、创建/加入/开始、秘密下注、关闭重开同一手牌、无档主持的取消/确认流程、回大厅后再次 Start。SDK 房间端口及“其他设备没有档案”被显式模拟。
3. 当前整树 `tsc --noEmit` 通过。主任务仍需对最终固定树独立构建稳定/开发版本。

最终本机证据：

- 控制器：`C:\Users\admin\AppData\Local\Temp\three-dragon-controller-Xo88db\selftest.mjs`
- 浏览器：`C:\Users\admin\AppData\Local\Temp\three-dragon-controller-ui-kI9pdx\controller-ui.png`，已实际查看两席各自手牌与准备/下注布局。测试页故意并列两位玩家表面，实际产品是各自独立面板。

测试文件：`tools/three-dragon-controller-selftest.mjs`、`tools/three-dragon-controller-selftest.entry.ts`、`tools/fixtures/three-dragon-controller-room.ts`、`tools/three-dragon-controller-ui.mjs`、`tools/three-dragon-controller-ui.entry.ts`。

收口时另发现模块入口的 LOCAL 完整 TableView 也会超过单条消息上限：当前实际六人规则自然牌序 seed 3 / 第 89 次操作，48 张弃牌、100 条记录、15 张 flight，完整视图 UTF-8 为 18,655 bytes。主任务已增加卡牌 ID 编码、有界分片、窗口 nonce 和最新视图发送队列，并在独立编解码及实际 page.ts 中复验大视图；详见 `three-dragon-transport-20260908.md`。这里的直接 UI 端口测试与该壳层测试分开计数。

仍待真实 Owlbear 验证：多人实际身份、房间网络乱序/配额、后台关闭与重连、相同账号多标签、浏览器存储策略、实际长局 LOCAL 消息传输和人类对局。没有从模拟测试推断真实宿主已验收；本子任务未提交、推送或部署。
