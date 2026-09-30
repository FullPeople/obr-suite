# 工作台选择恢复与中继冲突隔离（本地候选，未发布）

日期：2026-10-01。基于已发布 213 的隔离源码，只做本地修复；没有提交、推送、部署或修改真实玩家卡。

## 已确认原因与修复

1. `background.ts` 原先在 `access` / `canOpen` 成功前就消费选择签名，签名也仅含棋子 ID。绑定/怪物组件晚到，或同一棋子换绑角色后，后续事件不会再尝试该选择。现仅在可打开时记为完成，并把角色绑定和怪物 slug 纳入签名；权限撤回清除处理标记。固定卡模式与异步读取代次保护保留。
2. `observation.ts` 把纯选择变化当成资料变化，导致每次选卡都刷新目录并核对所有角色的运行值。现区分 `selection` 与 `data`；只改选择时仅刷新选中内容。角色身份、权限、资料、场景事件仍完整刷新，数据版本不会被纯选择事件反复作废。
3. `background.ts` 在检查场景怪物资料前直接返回已缓存正文。现把缓存与观察到的场景资料身份关联；场景资料晚到、替换、移除，以及移除文档覆盖时会重读正确来源。没有把怪物运行值改成提前确认。
4. Web / Suite `relay.ts` 原先把普通业务 409 也写成连接级退避。一笔后台库存 `ensure` 的 409 会使随后的重新读取及无关保存立即重复抛出旧错误；五次 CAS 重试甚至不会访问服务器。现业务 POST 的 400/403/404/409/422 只拒绝该操作。注册和轮询仍保留退避，401/410、429、5xx及网络错误保持既有恢复行为。没有自动重放被拒或未知结果的写操作。

修改文件：Suite `src/workbench/background.ts`、`observation.ts`、`relay.ts`；Web `src/platform/relay.ts`。新增 Suite `tools/workbench-follow-selection-214-selftest.mjs` 与 Web `tests/relayConflict214.test.ts`。

## 定向证据

全部数据为原创合成资料。性能/宿主测试使用已安装的真实 Owlbear SDK 和真实 iframe `postMessage`；HTTP / Owlbear 房间边界由夹具控制，不能当真人多人验收。

| 检查 | 修前 | 修后 |
| --- | --- | --- |
| 80 卡、300 棋子，12 次已缓存选卡 | 247 ms；1,008 次目录访问；960 次全卡运行值核对；0 HTTP 读 | 多轮 38–64 ms；24 次目录访问；0 次全卡运行值核对；0 HTTP 读 |
| 同一选择绑定晚到、换绑、怪物组件晚到 | 三项均在 700 ms 窗口后仍显示旧卡 | 最终 31 / 21 / 23 ms，自动显示目标 |
| 同一怪物场景正文后来到达 | 700 ms 后仍旧正文 | 最终 18 ms；移除覆盖也恢复资料库正文 |
| 业务错误拒绝后紧接另一个命令 | 新增 6 个用例中 5 失败 | 新增 6 + 原恢复 2，共 8 通过 |
| 既有 resource183 真实 SDK 双客户端回归 | HEAD 后台与本轮后台都因旧 Relay 409 连锁而在并发投影场景超时 | 仅补上 Relay 修复后，原 10 项断言全部通过；总执行约 6 秒 |

跟随定向脚本最终 13 个行为断言通过、1 个性能采样、0 页面异常。覆盖：迟到绑定、换绑、怪物资料变化与移除、固定/取消固定、慢 A 请求不夺回已选择的 B、权限收回与恢复、两笔持久保存和过期字段拒绝。

resource183 保留原行为断言，仅在本地适配外置依赖和输出路径并增加失败日志。覆盖两次资源写入/通知、旧投影迟到、扣住 SDK 投影/广播回执时人物继续提交、怪物必须等待实际 metadata 写入、原生运行值核对、跨房间文档地址、合并期间原生 HP 修改保留、暖缓存连续保存和未广播远端改动的 CAS 拒绝。暖缓存两笔宿主执行为 4 / 9 ms；怪物提前 ACK 数为 0。

全 Suite TypeScript 与 `git diff --check` 通过。外置依赖只读复用，没有安装/复制依赖；没有启动第二个 Vite 服务。完整发布门禁由整批任务统一执行。

## 真实房间的只读观察

使用用户已打开的 Chrome，经个人资料菜单确认指定 Google 账号，地址确认是用户指定房间。通过正式插件链接打开工作台，保持跟随选择开启；未重启浏览器、读取登录文件、导出整张私有卡或修改真实卡数值/场景内容。

- 已发布 213 的一次真实怪物选中能显示对应卡，本次未复现这条路径必须刷新。
- 五页切换观察为 64–121 ms；四张可读角色切换观察为 160–317 ms。方法为原生点击至 UI Automation 观察目标卡页，含轮询开销，非浏览器性能追踪。没有证明用户所述所有 5 秒卡顿已消失。
- 第三张角色切换后标题改变、纸卡仍为上一张，并明确提示“专精记录无效”；12 秒观察窗口也不会成功。临时只读监听只提取 `expertise` 字段结构：普通 object，额外存在 `save:cha:false`、`save:con:false`。未导出正文、头像或整卡。临时监听已移除。该兼容读取与错误展示修复由同批 Web 主任务处理，不混算为本模块已验收。
- 自带同步诊断显示 `transport: direct`、`pending: []`、`recent: []`；同时存在 relay status 0 重连提示。直连有效，不能把本次直连观察当中继网络验收。

本地候选尚未加载到真人房间，真实玩家多人并发、跨设备/实体手机与修复后的真人验收仍未执行。真实页面照片、专精字段结构和诊断均仅留本机忽略目录，不进入公开仓库。

## 本机证据与复跑

证据根：`D:/Desktop/DND-card-web/.local-evidence/performance-20261001/`（内含 `.gitignore`，全部忽略）。关键记录：`before/results.json`、`before-monster-definition/results.json`、`verified/results.json`、`relay-conflict-before.json`、`relay-after.json`、`resource183-baseline/failure.json`、`resource183-relay-fixed/results.json`、`live-switch-measure.json`、`live-expertise-shapes.json`、`live-connection-diagnostic.json`。

Suite 新测试从 Suite 根目录运行 `node tools/workbench-follow-selection-214-selftest.mjs`；可用 `SUITE_ROOT`、`WEB_ROOT`、`SUITE_DEPS` 指定隔离源码与已有依赖，`PROFILE_OUT` 指定仓库外输出，`EXPECT_PASS=1` 将行为失败置为非零退出。

Web 定向运行 `node node_modules/vitest/vitest.mjs run tests/relayConflict214.test.ts tests/relayRecovery.test.ts`。
