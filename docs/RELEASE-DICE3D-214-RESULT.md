# 新版骰子 214 发布回执

日期：2026-10-01（Asia/Shanghai）。仅新版 /suite-dev/。

## 来源与交付

- 版本：1.0.214-dev；骰子协议构建：suite-3d-2。房主和玩家都应刷新房间页面，避免旧客户端保留被移除材质。
- 源码提交：71f21f2156427a5b6e69476f42908529231d5738。已合入线上 213 的角色卡与 relay 客户端修复；未部署服务端修改。
- 候选包：C:/Users/admin/AppData/Local/Temp/codex-suite-dice3d214-package-20261001/suite-dev-dice3d214.tar.gz。
- 包 SHA-256：cdca5c8636fdc26cee819434bd9bb7a260b819d5f36ba1c2bd442d7f3472b9f7。服务器上传后散列一致。
- 服务器回执：/var/www/obr-plugins/dice3d214-deployment.json。
- 恢复点：/var/www/obr-plugins/suite-dev-before-dice3d214。
- 261 个实际发布文件校验成功；新插件内部 987 个非本轮文件保持不变。
- 保护站点逐文件一致：旧 suite 581、独立 card 127、dice-lab-dev 81；Nginx 与两个服务启动时间未变化。
- 对应源码 archive 已同时放入新版根目录与两个许可入口；没有 git push。

## 验证与边界

- 两个 TypeScript 工程、正式构建与 36 项核心检查通过。
- 正式页面：五个材质按钮、七骰真实模型/UV/shader 预览、玩家颜色、按需加载、上下键历史及草稿恢复通过。只读预览没有生成任何 roll/房间广播。
- 真实 SDK 加模拟宿主的两个客户端：不打开角色卡/骰盘仍预加载，只创建一个覆盖层并主动请求历史悬浮窗；预测或中途查询不入列，完整动画后保存一致历史。d100、既有权威结果、暗骰/公开、鼠标穿透回归通过。
- 公网正式资源 https://obr.dnd.center/suite-dev/ 实际 Jolt/WASM/WebGL 初始化与投骰通过；固定种子 2d6+1d20+5 为 6、5、16，总数 32。实际 Canvas 总数绘制颜色为玩家色 #76bceb，错误 0；未发送任何真实房间消息。
- 证据：.cache/dice3d-evidence/loading.json、sdk.json、production-local.json、live.json；皮肤截图 skin-*.png。
- 这不是多人真人枭熊房间验收；应由玩家在不打开骰盘的情况下直接接收房主投骰，观察历史是否确实等整段演出结束再加入。
- 并行启动多个测试浏览器曾触发测试机 WebGL 上下文丢失；串行双端及正式公网探针通过，不据此承诺所有玩家显卡环境已验收。

## 本机临时包处理

F 盘打包时耗尽空间，仅删除本轮生成的不完整源码 zip 和失败 delta 候选目录（可重建），未删除源码、历史、旧包或测试证据；改在 C 盘独立临时目录完成打包。原生 Desktop Dice 工作树未修改。
