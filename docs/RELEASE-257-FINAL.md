# 2026-10-08 · 257 统一界面与职业图标已合并上线

在线车卡：[dnd.center/card/](https://dnd.center/card/)。角色卡库：[dnd.center/library/](https://dnd.center/library/)。同源后端继续位于 `/api/`，健康检查：[api/health](https://dnd.center/api/health)。首页、三龙牌及旧站导出入口保留。

| 入口 | 实际版本 | 运行源码 |
| --- | --- | --- |
| 独立站及卡库 | standalone-1.0.257，公告 0.1.47 | `553ab51d84e48f4fc06647f646fd09a60c5a4874` |
| 枭熊新版 | 1.0.257-dev | `ea5d47859f17180281d682919f41e9a6d888a21b` |
| 枭熊稳定版 | 1.3.18 | `a631e4fa5479b048f68cdc2df7fa07deb63dd0a7` |
| 云端后端 | 1.0.253，未重启 | 原持久服务与数据库 |

Web PR25、Suite PR27/26 与公告补充 PR28 已合并；合并树分别等于通过 CI 的候选。混合的原工作区未重置或打包。源码与规则报告绑定固定提交，后续文档提交不重新构建或部署。

## 本批变化

- 上栏调色盘打开底部抽屉，统一调整基础界面、Wiki 与角色卡组件；移除旧配色入口，保留夜间模式和旧偏好。组件配色随完整角色 JSON 保存。
- Wiki 右键创建自定义副本；法术悬浮提示省略学习者，完整 Wiki 保留学习范围。新版枭熊同步自定义资料、怪物、三态过滤、拖入 JSON 和自适应法术位。
- 卡库卡面内部只展示；点击进入同页平滑全屏，查看五页和细节。ID/复制位于标题中央，操作在上方，手机侧栏默认隐藏。切换及全屏返回复用已读取卡，最多缓存八张。
- 独立站、卡库及新旧枭熊公告均显示云端大字报。首页或卡库进入在线车卡时跳过启动动画，保留实际加载与失败反馈。
- 从提供的 PSD 提取 11 个职业图标，透明 PNG 为 512×512、至少留空 52 像素，合计 194,277 字节；缺少图层的职业沿用原图。原始 PSD 不公开。映射与散列见 [职业图标记录](https://github.com/FullPeople/DND-card-web/blob/main/docs/CLASS-BADGES-20261008.md)。

枭熊不接入云端，继续使用原房间权限和保存。独立站临时公开上传已可用：同 IP 最多 10 张、六位大写字母 ID、明确确认后上传、原浏览器管理、自动同步和冲突草稿。QQ 登录仍申请中，付款和购买槽位入口未开放。

## 验证与边界

精确源码的 11 个工作流、36 个任务成功；Web PR25 的 32 项检查成功。主要 CI：Web `37775571003`、云端 `37775570807`、新版 `37775607230`、稳定版 `37775607457`、公告补充 `37780696909`。Data `37769714421` 验证真实报告；229 份原输入全量重审，18,789 条中 6,527 有实际支持，49 个消费者字节一致。Data 固定 `b1805c73`，报告 SHA-256 `8908e474df1318db0379a1ab0783beae6afbeb116808f6262d38dc2c3ccfe02e`。这不是全部规则语义已自动化的声明。

| 检查 | 结果 |
| --- | --- |
| 本机及 CI | 类型、构建、单元、44 组新版插件回归、云端 22 个浏览器流程、调色盘/夜间模式、职业水印切换与实际 PNG 解码通过。 |
| 公网角色卡 | 9 组真实流程通过，含明确确认后 POST、同步 PUT、新配色在旧后端保留、六位 ID/复制、匿名五页、越权拒绝、冲突草稿和完整 JSON 往返。验收卡已清理。 |
| 公网卡库 | 无痕式访问现存 4 张卡并循环两轮，无 404；每卡只读取一次，全屏返回不重新读取。390 像素侧栏展开/关闭及无横向溢出通过。没有打印或发布玩家内容。 |
| 实际缓存 | 256→257 保留本机草稿，仅保留新 worker 缓存；已访问五页离线重载通过。 |
| 公网资源 | Web 149 个 HEAD、12 个关键 GET 散列，插件 115 项页面/资源检查通过。两域名 TLS 1.3 证书有效；页面/worker 可更新、哈希资源 immutable、API no-store。 |
| 公告 | 两插件在 390/1440 宽度的实际公网资源显示大字报、最新说明及版本。只模拟 SDK 就绪，没有真实枭熊房间。 |
| 发布保护 | 三次回执均为 published，保护值前后相等。首页、三龙牌、旧站、Nginx/SSH、其他后台及原 4 张云端卡保持。SQLite 完整性正常，备份定时器 active。 |

初轮门禁捕获并修复了 Wiki 旧样式覆盖、全屏入口样式、异步状态等待、SVG 内联资源识别、三龙牌旧地址测试及稳定版构建输出路径问题。Warforged 复载检查改为等待资料实际就绪，保留所有机械与存档断言。公网复核进一步发现稳定版公告索引仍为 1.3.14；新增 1.3.18 索引及实际版本读取器检查，通过完整 CI 后发布。没有删除断言或放宽权限。

原角色卡服务数据目录持续接受玩家写入：两次遍历之间新增 36、移除 4、改写 45 个文件，包含完整卡片文件组和索引；所有核对的写入由 `www-data` 完成，原服务未重启。此目录没有被当作冻结快照恢复，不能宣称 93,627 个文件逐个不变。本轮发布只写指定静态前端目录，保留服务的实时数据。

21:09 左右服务器剩余约 17 GB，可用内存约 634 MiB，2 GiB Swap 使用为 0。构建在本机/CI 执行，发布器按块读取文件。本轮没有修改 Nginx、SSH、防火墙、安全组或网络。

真实 QQ、玩家原浏览器、实体手机和真实枭熊多人房间尚待现场验收。上述宽度和 SDK 就绪测试不代替这些验收。

## 备份与回滚

三份封包和 published 回执分别位于 `/root/codex-release-packages/`、`/root/codex-release-receipts/`，名称如下。Web 完整备份在包内 `backup/frontend/{card,library}`；插件完整备份为 `/var/www/obr-plugins/{suite-dev,suite}-before-<发布名>`。

回退整批时依次执行下面三条。第一步退公告补丁，第二步退两个插件到此前 1.0.253-dev / 1.3.17，最后退独立站到 256。只恢复前端，保留数据库、新增角色卡、当前首页和三龙牌。脚本发现后来更新或配置漂移会拒绝；先核对，不能绕过保护。

```sh
python3 /root/codex-release-packages/suite-unified-ui257-notice-20261008/suite_links.py --archives /root/codex-release-packages/suite-unified-ui257-notice-20261008 --receipt-sha f5e4923e1fadf2aa5db093d2f063135c8a9c707b6d2275f5e80294524ea054a0 --rollback
python3 /root/codex-release-packages/suite-unified-ui257-20261008/suite_links.py --archives /root/codex-release-packages/suite-unified-ui257-20261008 --receipt-sha a800ebaa56316c72e50f9488037c0f36017e7d94240acc61a7a613cef3998041 --rollback
python3 /root/codex-release-packages/dnd-center-ui257-20261008/frontend.py --package /root/codex-release-packages/dnd-center-ui257-20261008 --manifest-sha 44bc66a678444cdb98ad8cd58ffccef00af3fef2d17d3dfcc2f8615efed51ef5 --rollback
```

持久数据库为 `/var/lib/dnd-card-cloud/cards.sqlite`，每日备份 `/var/backups/dnd-card-cloud` 保留 14 份。保留原服务数据 `/var/www/character-cards-data`。所有失败、复验、构建与公网证据位于本机 `U:/CodexWork/2026-10-08/unified-ui/evidence` 和 `web/.local-evidence`，不公开私人文件或上游内容快照。
