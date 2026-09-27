# 2026-09-27 三龙牌：命运之轮的轮转使用

在开局的牌组选择中新增第二项“命运之轮的轮转使用”。沿用第一项的 70 张普通牌和随机抽取的 10 张特殊牌，额外保证加入一张时光龙，共 81 张。原牌组和自选特殊牌组仍为 80 张，原有 30 张特殊牌池不变。

时光龙属于传说巨龙、善良，力量 12。卡面原文为“获得弃牌堆里的所有牌，直到手牌上限。”仍遵守普通的能力触发规则；触发时从弃牌堆顶依次取牌，最多补到 10 张手牌，未取得的牌留在弃牌堆。弃牌不足时只取现有弃牌，不从牌库补牌、不洗牌。取回事件只记录原本公开的弃牌，不公开已有私牌。

新版牌组身份贯穿开局、公开摘要、私有投影、保存与恢复。旧版没有 variant 的存档仍按原牌组恢复；不允许把新卡注入旧牌组存档。显式 DM 换牌维持所在牌组的卡片总数。牌组预览显示新卡卡面、阵营、力量及效果说明。

## 验证记录

- Suite TypeScript 与独立三龙牌 TypeScript 均通过。
- `node tools/three-dragon-time-dragon-selftest.mjs`：32 个种子下原牌组 80 张、新牌组 81 张，新卡恰好一张，原随机特殊牌选择相同；原自选牌组和旧存档兼容。
- 实际规则出牌覆盖弃牌少于空位、弃牌超过空位、空弃牌、出牌前 10 张手牌、正常触发限制、输入不变性、动作重复收据、原牌库不被补抽、公开投影不泄露其他私牌、损坏/错牌组存档拒绝、DM 显式替换后的恢复。
- 实际 TableController 与原生 WebCrypto 验证新牌组主持权限、私有发牌、81 张牌的持久化及主持重连；房间 SDK 和存储边界使用夹具。
- 原控制器 15 组集成回归通过。隐私自检 11 项和 2 项故意破坏校验通过；本次仅修正过时的测试夹具：普通座位用普通私有投影，已获准的本机主持全能投影应被保留，远端公开/座位投影白名单仍检查。没有借机变更隐私运行代码。
- `node tools/three-dragon-time-dragon-browser.mjs`：桌面 1440×960 实际 WebGL 渲染（SwiftShader）与 390×844 触屏尺寸 DOM 回退均通过。实际选择牌组、启动 81 张牌局、出牌并显示能力，9 张手牌/8 张弃牌变成 10 张手牌/6 张弃牌，行动收据不残留；无页面脚本错误及页面横向溢出。已人工检查截图。发送/主持传输使用明确标注的夹具。

证据：`D:/Temp/time-dragon-rules-vp456c`、`D:/Temp/three-dragon-controller-IJ09CW`、`D:/Temp/tda-privacy-GpuoyR`、`D:/Temp/time-dragon-browser-kUpkcW`。发布版本、生产构建与公网检查另记发布回执。

真实多设备枭熊房间和实体手机手势待验证。新旧客户端混用不属于验证范围，参与者应刷新到同一版本。

## 卡面与生成来源

最终资源：`extensions/three-dragon-ante/src/game/art/wheel-of-fate-v1/time-dragon.png`。使用内置 imagegen 编辑模式，参考原有金王卡面的金色边框、“传说巨龙”标记及版式，中央替换为孩童蜡笔画风的抽象龙。原有 100 张牌面资源未修改；这张是用户指定的自定义牌，不是原版官方新增牌。生成结果直接保存，未再用代码修改图像。

参考图：`extensions/three-dragon-ante/src/game/art/pack-20260910/cards/gold-monarch.webp`。

实际生成提示词：

```text
Edit this existing Chinese Three-Dragon Ante card into one new playable custom card. Keep the full portrait card, exact existing tall aspect ratio (768x1357), ornate warm gold frame, aged ivory paper, rounded corners and black outside corners. Preserve as closely as possible the original top banner with the exact black Chinese words “传说巨龙” and its distinctive long black dragon silhouette emblem to their right. Keep strength 12 in the upper-left circular medallion and the upside-down 12 in the lower-right medallion. The central large gold dragon illustration must be completely replaced by a SIMPLE ABSTRACT CHILD'S WAX CRAYON DOODLE of a dragon, convincingly drawn by a small child: very few clumsy uneven turquoise/teal and purple crayon lines, round lumpy body, funny small head, dot eye, crooked triangle wings, four stick legs and a curly tail, visible rough crayon wax grain. Naive, sparse, awkward, playful, not a professional cartoon, no detailed scales, no polished painting or shaded fantasy dragon. It may hold or sit beside one equally simple crayon clock circle to suggest time. Keep ample unmarked parchment around the child drawing. Below the illustration replace the old name with exactly “时光龙 | 善良” with 善良 green as in the reference and the name bold dark Chinese serif. Keep the thin rule underneath. Replace all previous ability text with exactly “获得弃牌堆里的所有牌，直到手牌上限。” in clear dark Chinese serif, generously sized and readable, wrapped into 2 lines if needed. No other ability or extra text. Remove the old copyright text from the bottom; replace it with small unobtrusive “自定义牌”. The frame and type must remain professional and consistent with the reference; ONLY the dragon illustration should look child-made. Output one final straight-on full card image, no mockup, no scenery outside the card, no annotations.
```
