# Workbench 181：完整角色同步与库存位置修复

2026-09-24，本地候选，尚未部署。此记录仅覆盖 Suite 宿主与中继部分；网页端队列、状态恢复与通知改动由同批次其他记录补充。

## 已复现的同步故障

旧角色移到其他房间后，目录保留最初上传的 `url`。宿主读取遵循该地址，例如 `characters/upload-room/hero/data.json`，但保存始终写当前房间 `profile-room`。若当前房间已经存在相同初始快照，第一次 CAS 可以成功，写入者看到本机新缓存；其他宿主仍从原上传地址读旧角色。若当前房间没有对应副本，则会保存失败。

`tools/workbench-document-181-selftest.mjs` 使用两个独立 iframe、实际安装的 Owlbear SDK 和真实宿主命令逻辑。把旧代码作为 `PROFILE_SOURCE` 注入后，第一项姓名编辑就出现上述分岔：写入位置为 `profile-room`，原上传文档版本仍为 1。不是通过手动伪造保存成功来验证。

另一个缺口是显式刷新仍沿用 ETag。静态服务器的 mtime/大小 ETag 可能在快速、等长写入时重复；宿主以前无条件接受 304，再把旧缓存标记为最新。现在广播失效会清除 ETag，已知更高版本不能由 304 满足；棋子的较新 runtime-baseline 也能触发文档读取，补足未收到广播的情况。

## 修复

- `card-location.ts` 统一原上传房间/文档 ID。读取、CAS 保存、未知写入结果回读和删除使用同一地址，拒绝跨源地址。
- 文档所属房间与当前库存所属房间分开。Relay 宿主注册时绑定当前房间；跨房角色保存的库存凭证必须属于该宿主房间。角色 CAS 仍按文档地址加锁，库存投影仍与当前房间账本共用串行锁，没有跳过库存版本检查。
- `currency.ts` 把旧 `inventory.currency.wallet`、平面 currency 和新 native coins 转成五种有限数值。目录快照不能把整个 wallet 对象传给数字 UI；库存首次接入保留旧卡实际货币。
- `move` 接受 `observedSlots`。只要被移动物品的位置仍等于手势开始位置或已等于目的地，无关数量/资源造成的容器版本变化不会拒绝移动。真正的同一物品争用、占位冲突、权限变化继续拒绝；已有操作回执仍幂等。
- 库存投影写入 `dnd_card_web.inventory.positions`，确认投影也检查位置。首次建账从已有 positions 恢复。只切换卡页/重新读取文档不应还原旧格子。
- 人物资源和整卡保存播报移到持久提交之后、棋子投影之前；怪物无独立人物文档，仍在 metadata 写入成功后播报。

## 验证命令与结果

在 `U:/枭熊插件/obr-suite` 运行：

| 命令 | 结果 |
| --- | --- |
| `node tools/workbench-document-181-selftest.mjs` | 6 项；姓名、职业、背景、种族、法术分别通过真实 save 命令写入，另一宿主持续停留该卡仍收到完整 native + legacy 数据；恒定 ETag 不阻止新版本。修复后本机夹具每项 31–69 ms，读写均在 upload-room，当前房间副本保持版本 1。 |
| `node tools/workbench-host-181-selftest.mjs` | 8 项；旧币种、建账、地址归一、位置三方冲突、投影位置，以及实际中继跨房文档/当前库存凭证；伪造库存房间、过期账本、宿主换房均拒绝。 |
| `node tools/workbench-live-179-cache-probe.mjs` | 原 4 组继续通过：无关慢读不阻塞、同卡过期读中断、重复通知合并、提交不等场景投影确认就通知另一宿主。 |
| `node tools/inventory-model-selftest.mjs` | 原 4 组库存原子性、权限、拆分/撤销、合并检查通过。 |
| `node tools/workbench-inventory-sync-selftest.mjs` | 原 9 组通过。投影确认夹具补齐实际格位，明确缺失 positions 不能确认已完成投影。 |

证据位于 `workbench-test-output/host-181/results.json`、`F:/CodexWork/2026-09-20/w-xu/workbench-document-181/results.json`。失败旧代码副本位于同工作区 `workbench-document-181-before/background-baseline.ts`，可通过 `PROFILE_SOURCE`、`WORKBENCH_DOCUMENT181_OUT` 重现。SDK 之外的房间/HTTP 服务是受控夹具，**没有把本机时延宣称为真实房间或公网零延迟验收**。

## 发布要求

本次需要一并升级 `server/workbench-relay/server.mjs` 并重启开发版中继，不能只部署网页静态包。旧中继把文档房间当库存房间，会拒绝新跨房库存凭证。服务端保持旧同房间请求兼容；新注册房间绑定后不接受改绑。发布前保留现有回滚目录，部署后核对开发版 manifest、静态文件及中继权限/CAS 探针；稳定版不在此次修改范围。
