# 2026-10-01 · 213 发布状态

本批来源、职业提示及中继修复已发布，最新范围、277 单元 / 155 浏览器结果、HTTPS 与公网校验方式、恢复点和未验收边界见 [213 发布回执](RELEASE-213-RESULT.md)。下方本地候选/未发布状态属于历史阶段；真实房间联动与完整自动化未因此完成。

# 2026-09-30 · 210 后续本地候选

分支 codex/relay-capacity-20260930，未提交或部署。对应 Web 隔离分支 codex/source-conflicts-relay-20260930，详细检查报告在 Web docs/SOURCE-RELAY-FEEDBACK-20260930.md。

已只读核对线上 401 前的 503/429：旧中继上限 100，容量满仍累计注册额度，加上客户端继续刷新闲置会话和固定 1.4 秒重试，造成注册失败后客户端持续 401。

本地修改 server/workbench-relay/server.mjs 与两端 Relay：默认可配置 512 会话、仅成功创建计额度、Retry-After/退避、宿主独立过期时间、64 MiB 全局队列预算、唯一注册流程；保留认证、角色权限与并发校验，不重放数据写入。class-summary.ts 仅从既有受权限约束的已加载资料中提取职业摘要，供 Web 在角色标签标记兼容性；不带笔记、头像或背包，也不新增读取请求。

验证通过：真实 HTTP 容量/失效/认证/队列测试 1，职业摘要测试 1，本机 Edge 对真实本地中继故障恢复 1；Web 276 单元（5 外部资料跳过）、12 分入口浏览器。Suite 全量 TypeScript 通过；用原 Vite 配置、隔离源码及 F 盘既有依赖构建全部 HTML 入口，515 模块通过。公共资产未复制，该输出是验证证据而非发布包。源码未从其他脏树复制。

证据：G:/CodexArtifacts/source-relay-20260930，含 suite-tsconfig.json、suite-build-2、relay-browser/browser-result.json。复跑构建脚本 tools/build-feedback-verify.mjs 需要 DND_SUITE_DEPS_ROOT 与全新 DND_SUITE_VERIFY_OUT；服务器测试 tools/relay-capacity.test.mjs，摘要测试用 Node 22 的 --experimental-strip-types，真实浏览器恢复工具 tools/relay-browser-test.mjs。

未执行真实房间、权限/多人同步、发布 CI 或公网验收。本批没有改线上服务器或重启服务。后续上线要备份并同时处理 Web、Suite 宿主前端和中继服务，保护玩家文档、牌局和未确认操作；旧的 release210 静态发布脚本不能直接用于这次服务端升级。公告仅在 Web docs/ANNOUNCEMENT-SOURCE-RELAY-DRAFT.txt 准备草稿，按当次部署授权更新实际入口公告。
