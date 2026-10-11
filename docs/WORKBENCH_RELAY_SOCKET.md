# 工作台中继：WebSocket 推送（2026-10-11）

开发版工作台在 `window.postMessage` 直连之外，经 `server/workbench-relay/server.mjs`（loopback 5012，nginx `location = /suite-dev/relay`）中继消息。此前接收只有 HTTP 长轮询：一条消息要等本轮轮询返回、下一轮发出，空响应每 20 s 一次，掷骰、选中和卡片变更的到达时间取决于轮询相位。

## 现在

- **接收**：客户端（`src/workbench/relay.ts`，Web 侧 `src/platform/relay.ts`）照常立即发出长轮询，同时在后台打开 `wss://…/suite-dev/relay?session=…&role=…`，子协议 `full-suite-relay` 加 `token.<密钥>`（浏览器无法给 WebSocket 设 Authorization 头）。握手只在宿主已通过 HTTP 注册且密钥正确时接受，套接字从不创建会话。
- 套接字接上后服务端用 `[]` 释放等待中的长轮询，客户端循环转为空闲；之后入队的消息由 `flush()` 立即以 JSON 数组推送（本机往返约 5 ms）。服务端每 25 s ping，50 s 无 pong 断开；ping/pong 与文本 `ping` 都刷新会话 `touched`，与长轮询等效，套接字空闲不会被清理。
- 套接字关闭（nginx 超时、网络切换、会话清理）后立即恢复长轮询并重连；升级被拒（代理未转发 Upgrade、密钥失效）按 15 s、30 s、60 s、2 min、5 min 退避重试，期间长轮询不受影响。
- **发送**仍为 HTTP POST：保存、共享文档和库存需要应答与 409 冲突码。
- 实现：`server/workbench-relay/websocket.mjs` 是 RFC 6455 服务端最小实现（握手、掩码解析、text/ping/pong/close、16 MiB 上限），不新增依赖。

## 删除接口的应答

`deleteCard` 过去用 `result.json()` 读角色 API 的 DELETE 应答：空 `204`、空正文或 HTML 错误页都会在中继内抛错，变成 `500 relay operation failed`，宿主只能回答「删除结果尚未确认」，而服务器其实已经删掉（再删一次遇到 404 才"成功"）。现在以状态码为准：任何 2xx、404、410 都回 `{ok:true}`，其余原样带状态码和可读错误。自检用一个假角色 API 覆盖这四种应答。

## 验证

```bash
node server/workbench-relay/relay-selftest.mjs
```

16 项：注册前拒绝、错密钥拒绝、推送延迟、持续推送、ping/pong、关闭后长轮询回退、等待中的长轮询被释放、重连后推送、宿主侧套接字，以及删除接口的 200 JSON、空 204、404、HTML 500、JSON 409 五种应答。Web 侧 `tests/relaySocket.test.ts` 用可编排的假 WebSocket 验证：首个长轮询不等套接字、套接字打开期间不再轮询、关闭后立即恢复、升级被拒时按退避重试。

## 部署

1. 按既有 `tools/deploy-workbench-relay.py` 的方式把 `server/workbench-relay/server.mjs` 与 `websocket.mjs` 复制到 `/opt/obr-workbench-relay-dev`（两者必须同目录），重启 `obr-workbench-relay-dev`。
2. 运行 `tools/deploy-workbench-relay-ws.py`：给 relay location 加 `proxy_http_version 1.1`、`Upgrade`/`Connection` 头，并把 `proxy_read_timeout` 提到 90 s；脚本备份站点文件、`nginx -t`、重启服务、reload nginx，`nginx -t` 失败时自动还原。
3. 不执行第 2 步时，升级请求被 nginx 当普通 GET 转发，服务端以 401 拒绝，客户端立即退回长轮询，行为与此前完全一致。推送是优化，不是前提。

## 同分支的其他延迟改动

- 骰子：`broadcastDiceRoll` 的颜色与名字、`tokenTopWorld` 的物品与 DPI、面板的选中与玩家 id、DM 自动目标的视口参数都改为一次 `Promise.all`；`showDiceEffect` 不再先关再开 modal；玩家 metadata 读写改为本地快照（`playerMetadata()` / `writePlayerMetadata()`），由 `OBR.player.onChange` 保持最新。
- 特效页缓存场景 DPI，位置轮询限 50 ms 一次。
- 设置页启动时并行读取角色与覆盖模块。
- 血量气泡同步一次批量读取物品、DPI 与 metadata。
- 工作台：共享规则读取去重（同一 key 复用进行中的请求）；直连 15 s 内收到过子窗口消息时不再同时经中继镜像发送。
